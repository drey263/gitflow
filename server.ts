import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import axios from "axios";
import multer from "multer";
import AdmZip from "adm-zip";
import path from "path";
import { createServer as createViteServer } from "vite";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractGitHubError(error: any, fallback = "Operation failed"): string {
  const data = error?.response?.data;
  if (data) {
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const detail = data.errors
        .map((e: any) => e.message || `${e.field || ""} ${e.code || ""}`.trim())
        .filter(Boolean)
        .join(", ");
      if (detail) {
        return data.message ? `${data.message}: ${detail}` : detail;
      }
    }
    if (typeof data.message === "string" && data.message) {
      return data.message;
    }
    if (typeof data.error === "string" && data.error) {
      return data.error;
    }
  }
  return error?.message || fallback;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Trust proxy for Cloud Run / Render / Railway / Nginx
  app.set("trust proxy", 1);

  // Increase payload limits for large files and batches
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Setup multer for file uploads with 100MB limit
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024, files: 500 },
  });

  // Helper middleware to check auth
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers["x-github-token"];
    if (!token || typeof token !== "string") {
      return res.status(401).json({ error: "Not authenticated" });
    }
    next();
  };

  // Custom Axios instance creator with generous timeout for GitHub API
  const githubApi = (token: string) =>
    axios.create({
      baseURL: "https://api.github.com",
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

  // Helper to resolve the OAuth callback URL reliably across AI Studio and production hosts
  const getOAuthRedirectUri = (req: Request): string => {
    const clientOrigin = typeof req.query.origin === "string" ? req.query.origin.trim() : "";
    const baseUrl = (clientOrigin || process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    return `${baseUrl}/api/auth/github/callback`;
  };

  // --- AUTH ENDPOINTS (PAT + GITHUB OAUTH) ---

  app.get("/api/auth/github/config", (req: Request, res: Response) => {
    const configured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    res.json({
      configured,
      callbackUrl: getOAuthRedirectUri(req),
    });
  });

  app.get("/api/auth/github/url", (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: "GitHub OAuth is not configured on the server yet. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your environment variables.",
        missingConfig: true,
      });
    }

    const redirectUri = getOAuthRedirectUri(req);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "repo delete_repo read:user",
    });

    const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    res.json({ url: authUrl, redirectUri });
  });

  const oauthCallbackHandler = async (req: Request, res: Response) => {
    const { code, error: oauthError, error_description } = req.query;

    const renderPopupResponse = (payload: Record<string, any>, statusText: string, isError = false) => {
      const serialized = JSON.stringify(payload);
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${isError ? "Authentication Failed" : "Authentication Successful"}</title>
  <style>
    body { background: #020617; color: #e2e8f0; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 24px 32px; text-align: center; max-width: 400px; }
    .title { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: ${isError ? "#ef4444" : "#60a5fa"}; }
    .sub { font-size: 14px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">${isError ? "Authentication Failed" : "Authentication Successful"}</div>
    <div class="sub">${statusText}</div>
  </div>
  <script>
    (function() {
      var data = ${serialized};
      try {
        if (data.token) {
          localStorage.setItem('github_token', data.token);
        }
      } catch (e) {}
      if (window.opener) {
        window.opener.postMessage(data, '*');
        setTimeout(function() { window.close(); }, 300);
      } else {
        setTimeout(function() { window.location.href = '/'; }, 1000);
      }
    })();
  </script>
</body>
</html>`);
    };

    if (oauthError) {
      return renderPopupResponse(
        { type: "OAUTH_AUTH_ERROR", error: String(error_description || oauthError) },
        String(error_description || oauthError),
        true
      );
    }

    if (!code || typeof code !== "string") {
      return renderPopupResponse(
        { type: "OAUTH_AUTH_ERROR", error: "Missing authorization code from GitHub." },
        "Missing authorization code from GitHub.",
        true
      );
    }

    try {
      const tokenRes = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        },
        {
          headers: { Accept: "application/json" },
        }
      );

      const accessToken = tokenRes.data?.access_token;
      if (!accessToken) {
        const errMsg = tokenRes.data?.error_description || tokenRes.data?.error || "Failed to exchange code for token.";
        return renderPopupResponse({ type: "OAUTH_AUTH_ERROR", error: errMsg }, errMsg, true);
      }

      return renderPopupResponse(
        { type: "OAUTH_AUTH_SUCCESS", token: accessToken },
        "You are now signed in with GitHub. This window will close automatically."
      );
    } catch (err: any) {
      const msg = extractGitHubError(err, "OAuth token exchange failed.");
      return renderPopupResponse({ type: "OAUTH_AUTH_ERROR", error: msg }, msg, true);
    }
  };

  app.get(["/api/auth/github/callback", "/api/auth/github/callback/"], oauthCallbackHandler);

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }

      // Get user info to verify token
      const userResponse = await axios.get("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      const user = {
        login: userResponse.data.login,
        avatar_url: userResponse.data.avatar_url,
        name: userResponse.data.name,
      };

      res.json({ success: true, user, token });
    } catch (error: any) {
      console.error("Token Auth error:", error.message || error);
      res.status(401).json({ error: "Authentication failed. Invalid or expired token." });
    }
  });

  app.get("/api/auth/status", async (req: Request, res: Response) => {
    const token = req.headers["x-github-token"];
    if (!token || typeof token !== "string") {
      return res.json({ authenticated: false });
    }

    try {
      const userResponse = await axios.get("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      res.json({
        authenticated: true,
        user: {
          login: userResponse.data.login,
          avatar_url: userResponse.data.avatar_url,
          name: userResponse.data.name,
        },
      });
    } catch (error) {
      res.json({ authenticated: false });
    }
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.json({ success: true });
  });

  // --- GITHUB REPOS ENDPOINTS ---

  app.get("/api/repos", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const response = await githubApi(token).get(`/user/repos?sort=updated&per_page=100`);
      res.json(response.data);
    } catch (error: any) {
      console.error("Fetch repos error:", error.message || error);
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error, "Failed to fetch repositories") });
    }
  });

  app.post("/api/repos/create", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const api = githubApi(token);

      const rawName = typeof req.body.name === "string" ? req.body.name.trim() : "";
      if (!rawName) {
        return res.status(400).json({ error: "Repository name is required" });
      }

      const payload: Record<string, any> = {
        name: rawName,
        private: Boolean(req.body.private),
        auto_init: req.body.auto_init !== undefined ? Boolean(req.body.auto_init) : true,
      };
      if (req.body.description && typeof req.body.description === "string") {
        payload.description = req.body.description.trim();
      }

      const response = await api.post("/user/repos", payload);
      const newRepo = response.data;

      // When auto_init is true, GitHub initializes the default branch asynchronously.
      // Wait briefly until the default branch commit ref exists so immediate file/ZIP uploads never fail.
      if (payload.auto_init && newRepo?.owner?.login && newRepo?.name) {
        const branch = newRepo.default_branch || "main";
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            await api.get(`/repos/${newRepo.owner.login}/${newRepo.name}/git/ref/heads/${branch}`);
            break;
          } catch {
            await sleep(500);
          }
        }
      }

      res.json(newRepo);
    } catch (error: any) {
      console.error("Create repo error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: extractGitHubError(error, "Failed to create repository"),
      });
    }
  });

  app.post("/api/repos/update", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, ...data } = req.body;
      const response = await githubApi(token).patch(`/repos/${owner}/${repo}`, data);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error) });
    }
  });

  app.post("/api/repos/clear", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, branch = "main", message = "Clear repository" } = req.body;
      const api = githubApi(token);

      const branchData = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
      const commitSha = branchData.data.object.sha;

      const commitData = await api.get(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
      const baseTreeSha = commitData.data.tree.sha;

      const treeData = await api.get(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}`);
      const treeCount = treeData.data.tree.length;

      if (treeCount === 0) {
        return res.json({ success: true, message: "Repository is already empty" });
      }

      // 4b825dc642cb6eb9a060e54bf8d69288fbee4904 is the well-known Git hash for an empty tree
      const emptyTreeSha = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

      const newCommitRes = await api.post(`/repos/${owner}/${repo}/git/commits`, {
        message: message,
        tree: emptyTreeSha,
        parents: [commitSha],
      });

      await api.patch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        sha: newCommitRes.data.sha,
        force: false,
      });

      res.json({ success: true, filesRemoved: treeCount });
    } catch (error: any) {
      console.error("Clear repo error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error, "Failed to clear repository") });
    }
  });

  app.post("/api/repos/delete", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo } = req.body;
      await githubApi(token).delete(`/repos/${owner}/${repo}`);
      res.json({ success: true });
    } catch (error: any) {
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error, "Failed to delete repository") });
    }
  });

  // --- HELPER: ATOMIC BATCH UPLOAD VIA GIT DATA API ---
  interface UploadFileItem {
    path: string;
    base64Content: string;
  }

  const normalizeRepoFilePath = (rawPath: string): string => {
    return rawPath
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/")
      .trim();
  };

  const shouldIgnorePath = (filePath: string): boolean => {
    if (!filePath) return true;
    const parts = filePath.split("/");
    if (parts.includes(".git") || parts.includes("__MACOSX") || parts.includes("node_modules")) {
      return true;
    }
    const baseName = parts[parts.length - 1];
    if (baseName === ".DS_Store" || baseName === "Thumbs.db") {
      return true;
    }
    return false;
  };

  const uploadFilesViaGitTree = async (
    token: string,
    owner: string,
    repo: string,
    branch: string,
    items: UploadFileItem[],
    commitMessage: string
  ) => {
    const api = githubApi(token);
    const validItems = items
      .map((item) => ({
        path: normalizeRepoFilePath(item.path),
        base64Content: item.base64Content,
      }))
      .filter((item) => !shouldIgnorePath(item.path));

    if (validItems.length === 0) {
      return { uploadCount: 0, errors: [] };
    }

    let remainingItems = [...validItems];
    let uploadCount = 0;
    const errors: { file: string; error: string }[] = [];

    // 1. Check if branch exists & get current commit SHA and base tree SHA.
    // If repository is completely empty (no commits yet), initialize it with the first file via Contents API.
    let commitSha = "";
    let baseTreeSha = "";

    const getBranchHead = async (): Promise<{ commitSha: string; baseTreeSha: string } | null> => {
      try {
        const branchData = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
        const cSha = branchData.data.object.sha;
        const commitData = await api.get(`/repos/${owner}/${repo}/git/commits/${cSha}`);
        return { commitSha: cSha, baseTreeSha: commitData.data.tree.sha };
      } catch (err: any) {
        return null;
      }
    };

    let head = await getBranchHead();

    if (!head) {
      // Repository might still be initializing or completely empty; try initializing with the first file
      const firstItem = remainingItems[0];
      try {
        await api.put(`/repos/${owner}/${repo}/contents/${firstItem.path}`, {
          message: `Initialize repository with ${firstItem.path}`,
          content: firstItem.base64Content,
          branch,
        });
        uploadCount++;
        remainingItems = remainingItems.slice(1);
        await sleep(300);
        head = await getBranchHead();
      } catch (initErr: any) {
        // Maybe auto_init just finished; try getting branch head again
        await sleep(500);
        head = await getBranchHead();
        if (!head) {
          throw new Error(extractGitHubError(initErr, "Repository branch is not ready"));
        }
      }
    }

    if (remainingItems.length === 0) {
      return { uploadCount, errors };
    }

    commitSha = head.commitSha;
    baseTreeSha = head.baseTreeSha;

    // 2. Create blobs in controlled parallel batches (concurrency = 5)
    const treeEntries: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
    const CONCURRENCY = 5;

    for (let i = 0; i < remainingItems.length; i += CONCURRENCY) {
      const batch = remainingItems.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (item) => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const blobRes = await api.post(`/repos/${owner}/${repo}/git/blobs`, {
                content: item.base64Content,
                encoding: "base64",
              });
              return { path: item.path, sha: blobRes.data.sha as string, error: null };
            } catch (err: any) {
              if (attempt === 2) {
                return { path: item.path, sha: null, error: extractGitHubError(err) };
              }
              await sleep(400 * (attempt + 1));
            }
          }
          return { path: item.path, sha: null, error: "Failed to create blob" };
        })
      );

      for (const res of results) {
        if (res.sha) {
          treeEntries.push({
            path: res.path,
            mode: "100644",
            type: "blob",
            sha: res.sha,
          });
        } else if (res.error) {
          errors.push({ file: res.path, error: res.error });
        }
      }
    }

    if (treeEntries.length === 0) {
      return { uploadCount, errors };
    }

    // 3. Create a single Git tree, single commit, and update branch reference atomically
    // Re-fetch latest head right before committing to avoid fast-forward conflicts
    const latestHead = (await getBranchHead()) || { commitSha, baseTreeSha };

    const newTreeRes = await api.post(`/repos/${owner}/${repo}/git/trees`, {
      base_tree: latestHead.baseTreeSha,
      tree: treeEntries,
    });

    const newCommitRes = await api.post(`/repos/${owner}/${repo}/git/commits`, {
      message: commitMessage,
      tree: newTreeRes.data.sha,
      parents: [latestHead.commitSha],
    });

    await api.patch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      sha: newCommitRes.data.sha,
      force: false,
    });

    uploadCount += treeEntries.length;
    return { uploadCount, errors };
  };

  // --- FILES & CONTENT ---

  app.get("/api/files", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, path: reqPath = "", ref } = req.query;
      let url = `/repos/${owner}/${repo}/contents/${reqPath}`;
      if (ref) url += `?ref=${ref}`;

      const response = await githubApi(token).get(url);
      res.json(response.data);
    } catch (error: any) {
      // If repository is empty (404 on root contents), return empty array instead of error
      if (error.response?.status === 404 && (!req.query.path || req.query.path === "")) {
        return res.json([]);
      }
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error, "Failed to fetch files") });
    }
  });

  app.post("/api/files/update", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, path: filePath, message, content, sha, branch } = req.body;

      let base64Content = "";
      if (content || content === "") {
        base64Content = Buffer.from(content).toString("base64");
      }

      const response = await githubApi(token).put(`/repos/${owner}/${repo}/contents/${normalizeRepoFilePath(filePath)}`, {
        message,
        content: base64Content,
        sha,
        branch,
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error, "Failed to save file") });
    }
  });

  app.post("/api/files/delete", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, path: filePath, message, sha, branch } = req.body;
      const response = await githubApi(token).delete(`/repos/${owner}/${repo}/contents/${normalizeRepoFilePath(filePath)}`, {
        data: { message, sha, branch },
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error, "Failed to delete file") });
    }
  });

  app.post("/api/files/rename", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, oldPath, newPath, branch, message } = req.body;
      const api = githubApi(token);

      const branchData = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${branch || "main"}`);
      const commitSha = branchData.data.object.sha;

      const commitData = await api.get(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
      const baseTreeSha = commitData.data.tree.sha;

      const treeData = await api.get(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`);
      const tree = treeData.data.tree;

      const newTree: any[] = [];
      let replacedCount = 0;

      const exactFile = tree.find((t: any) => t.path === oldPath && t.type === "blob");

      if (exactFile) {
        newTree.push({
          path: oldPath,
          mode: "100644",
          type: "blob",
          sha: null,
        });
        newTree.push({
          path: newPath,
          mode: exactFile.mode,
          type: exactFile.type,
          sha: exactFile.sha,
        });
        replacedCount++;
      } else {
        const filesToMove = tree.filter((t: any) => t.type === "blob" && t.path.startsWith(`${oldPath}/`));
        if (filesToMove.length > 0) {
          const exactTree = tree.find((t: any) => t.path === oldPath && t.type === "tree");
          if (exactTree) {
            newTree.push({
              path: oldPath,
              mode: "040000",
              type: "tree",
              sha: null,
            });
          }

          for (const file of filesToMove) {
            const relPath = file.path.substring(oldPath.length + 1);
            newTree.push({
              path: oldPath + "/" + relPath,
              mode: "100644",
              type: "blob",
              sha: null,
            });
            newTree.push({
              path: `${newPath}/${relPath}`,
              mode: file.mode,
              type: file.type,
              sha: file.sha,
            });
            replacedCount++;
          }
        }
      }

      if (replacedCount === 0) throw new Error("Path not found or empty");

      const newTreeRes = await api.post(`/repos/${owner}/${repo}/git/trees`, {
        base_tree: baseTreeSha,
        tree: newTree,
      });

      const newCommitRes = await api.post(`/repos/${owner}/${repo}/git/commits`, {
        message: message || `Rename ${oldPath} to ${newPath}`,
        tree: newTreeRes.data.sha,
        parents: [commitSha],
      });

      await api.patch(`/repos/${owner}/${repo}/git/refs/heads/${branch || "main"}`, {
        sha: newCommitRes.data.sha,
        force: false,
      });

      res.json({ success: true, filesMoved: Math.floor(replacedCount) });
    } catch (error: any) {
      console.error("Rename error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error, "Failed to rename") });
    }
  });

  app.post("/api/files/delete_folder", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, path: folderPath, message, branch = "main" } = req.body;
      const api = githubApi(token);

      const branchData = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
      const commitSha = branchData.data.object.sha;

      const commitData = await api.get(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
      const baseTreeSha = commitData.data.tree.sha;

      const treeDetails = await api.get(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`);
      const filesToDelete = treeDetails.data.tree.filter(
        (t: any) => t.type === "blob" && t.path.startsWith(`${folderPath}/`)
      );

      if (filesToDelete.length === 0) {
        return res.json({ success: true, count: 0 });
      }

      const newTree = filesToDelete.map((file: any) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: null,
      }));

      const newTreeRes = await api.post(`/repos/${owner}/${repo}/git/trees`, {
        base_tree: baseTreeSha,
        tree: newTree,
      });

      const newCommitRes = await api.post(`/repos/${owner}/${repo}/git/commits`, {
        message: message || `Delete folder ${folderPath}`,
        tree: newTreeRes.data.sha,
        parents: [commitSha],
      });

      await api.patch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        sha: newCommitRes.data.sha,
        force: false,
      });

      res.json({ success: true, count: filesToDelete.length });
    } catch (error: any) {
      console.error("Delete folder error:", error.message || error);
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error, "Failed to delete folder") });
    }
  });

  app.post("/api/files/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      if (!req.file) throw new Error("No file uploaded");
      const { owner, repo, path: reqPath, message, branch = "main", sha } = req.body;
      const api = githubApi(token);

      const base64Content = req.file.buffer.toString("base64");
      const finalPath = normalizeRepoFilePath(
        reqPath && reqPath.endsWith("/")
          ? `${reqPath}${req.file.originalname}`
          : reqPath || req.file.originalname
      );

      let existingSha = sha || "";
      if (!existingSha) {
        try {
          const fileCheck = await api.get(`/repos/${owner}/${repo}/contents/${finalPath}`, {
            params: branch ? { ref: branch } : {},
          });
          if (fileCheck.data && !Array.isArray(fileCheck.data)) {
            existingSha = (fileCheck.data as any).sha;
          }
        } catch {
          // 404 means new file
        }
      }

      const data: any = {
        message: message || `Upload ${req.file.originalname}`,
        content: base64Content,
      };
      if (branch) data.branch = branch;
      if (existingSha) data.sha = existingSha;

      const response = await api.put(`/repos/${owner}/${repo}/contents/${finalPath}`, data);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error, "Failed to upload file") });
    }
  });

  app.post("/api/files/upload_multiple", requireAuth, upload.array("files", 500), async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        throw new Error("No files uploaded");
      }
      const { owner, repo, path: baseReqPath = "", branch = "main" } = req.body;

      // Support optional relative paths sent from directory upload
      let customPaths: string[] = [];
      if (req.body.filePaths) {
        try {
          customPaths = JSON.parse(req.body.filePaths);
        } catch {
          customPaths = [];
        }
      }

      const items: UploadFileItem[] = req.files.map((file, idx) => {
        const relName = customPaths[idx] || file.originalname;
        const fullPath = baseReqPath ? `${baseReqPath}/${relName}` : relName;
        return {
          path: fullPath,
          base64Content: file.buffer.toString("base64"),
        };
      });

      const { uploadCount, errors } = await uploadFilesViaGitTree(
        token,
        owner,
        repo,
        branch || "main",
        items,
        `Upload ${items.length} file(s)`
      );

      res.json({
        success: true,
        count: uploadCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      console.error("Multi-file upload error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: extractGitHubError(error, "Failed to upload files"),
      });
    }
  });

  // Extract & Commit ZIP in a Single Atomic Git Tree Operation
  app.post("/api/zip/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      if (!req.file) throw new Error("No ZIP file uploaded");
      const { owner, repo, path: destPath = "", branch = "main" } = req.body;

      let zip: AdmZip;
      try {
        zip = new AdmZip(req.file.buffer);
      } catch (zipErr: any) {
        return res.status(400).json({ error: "Invalid or corrupted ZIP archive." });
      }

      const zipEntries = zip.getEntries();
      const items: UploadFileItem[] = [];

      for (const entry of zipEntries) {
        if (!entry.isDirectory) {
          const entryName = entry.entryName.replace(/\\/g, "/").replace(/^\/+/, "");
          if (shouldIgnorePath(entryName)) continue;

          const filePath = destPath ? `${destPath}/${entryName}` : entryName;
          items.push({
            path: filePath,
            base64Content: entry.getData().toString("base64"),
          });
        }
      }

      if (items.length === 0) {
        return res.status(400).json({ error: "No valid files found inside the ZIP archive." });
      }

      const { uploadCount, errors } = await uploadFilesViaGitTree(
        token,
        owner,
        repo,
        branch || "main",
        items,
        `Extract and upload ${req.file.originalname} (${items.length} files)`
      );

      res.json({
        success: true,
        count: uploadCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      console.error("ZIP upload error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: extractGitHubError(error, "Failed to upload ZIP archive"),
      });
    }
  });

  // --- BRANCHES & COMMITS ---
  app.get("/api/branches", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo } = req.query;
      const response = await githubApi(token).get(`/repos/${owner}/${repo}/branches`);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error) });
    }
  });

  app.get("/api/commits", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, sha, path: filePath } = req.query;
      let url = `/repos/${owner}/${repo}/commits`;
      const params = new URLSearchParams();
      if (sha) params.append("sha", sha as string);
      if (filePath) params.append("path", filePath as string);

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await githubApi(token).get(url);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({ error: extractGitHubError(error) });
    }
  });

  // Multer error handler (e.g., file too large)
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    next(err);
  });

  // --- VITE MIDDLEWARE / PRODUCTION STATIC SERVING ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
