import express from "express";
import axios from "axios";
import multer from "multer";
import AdmZip from "adm-zip";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust first proxy
  app.set("trust proxy", 1);

  app.use(express.json());

  // Setup multer for file uploads
  const upload = multer({ storage: multer.memoryStorage() });

  // Helper middleware to check auth
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const token = req.headers["x-github-token"];
    if (!token || typeof token !== "string") {
      return res.status(401).json({ error: "Not authenticated" });
    }
    next();
  };

  // --- AUTH ENDPOINTS ---

  app.post("/api/auth/login", async (req, res) => {
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
      res.status(401).json({ error: "Authentication failed. Invalid or expired Personal Access Token." });
    }
  });

  app.get("/api/auth/status", async (req, res) => {
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
        }
      });
    } catch (error) {
      res.json({ authenticated: false });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    res.json({ success: true });
  });

  // --- GITHUB REPOS ENDPOINTS ---

  // Custom Axios instance creator
  const githubApi = (token: string) => axios.create({
    baseURL: "https://api.github.com",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  app.get("/api/repos", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const response = await githubApi(token).get(`/user/repos?sort=updated&per_page=100`);
      res.json(response.data);
    } catch (error: any) {
      console.error("Fetch repos error:", error.message || error);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/repos/create", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const response = await githubApi(token).post('/user/repos', req.body);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/repos/update", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, ...data } = req.body;
      const response = await githubApi(token).patch(`/repos/${owner}/${repo}`, data);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/repos/clear", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, branch = 'main', message = "Clear repository" } = req.body;
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
        parents: [commitSha]
      });

      await api.patch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        sha: newCommitRes.data.sha,
        force: false
      });

      res.json({ success: true, filesRemoved: treeCount });
    } catch (error: any) {
      console.error("Clear repo error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/repos/delete", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo } = req.body;
      await githubApi(token).delete(`/repos/${owner}/${repo}`);
      res.json({ success: true });
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  // --- FILES & CONTENT ---

  app.get("/api/files", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, path = "", ref } = req.query;
      let url = `/repos/${owner}/${repo}/contents/${path}`;
      if (ref) url += `?ref=${ref}`;
      
      const response = await githubApi(token).get(url);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: "Unknown error" });
    }
  });

  app.post("/api/files/update", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, path, message, content, sha, branch } = req.body;
      
      let base64Content = "";
      if (content || content === "") {
        base64Content = Buffer.from(content).toString("base64");
      }
      
      const response = await githubApi(token).put(`/repos/${owner}/${repo}/contents/${path}`, {
        message,
        content: base64Content,
        sha,
        branch
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/files/delete", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, path, message, sha, branch } = req.body;
      const response = await githubApi(token).delete(`/repos/${owner}/${repo}/contents/${path}`, {
        data: { message, sha, branch }
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/files/rename", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, oldPath, newPath, branch, message } = req.body;
      const api = githubApi(token);

      const branchData = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${branch || 'main'}`);
      const commitSha = branchData.data.object.sha;

      const commitData = await api.get(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
      const baseTreeSha = commitData.data.tree.sha;

      const treeData = await api.get(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`);
      const tree = treeData.data.tree;

      const newTree: any[] = [];
      let replacedCount = 0;

      const exactFile = tree.find((t: any) => t.path === oldPath && t.type === 'blob');
      
      if (exactFile) {
        newTree.push({
          path: oldPath,
          mode: '100644',
          type: 'blob',
          sha: null
        });
        newTree.push({
          path: newPath,
          mode: exactFile.mode,
          type: exactFile.type,
          sha: exactFile.sha
        });
        replacedCount++;
      } else {
        const filesToMove = tree.filter((t: any) => t.type === 'blob' && t.path.startsWith(`${oldPath}/`));
        if (filesToMove.length > 0) {
          // Add deletion marker for the old folder itself (sometimes not strictly necessary if all contents are deleted, but good for completeness, actually GitHub trees don't explicitly require deleting the folder if it's empty, deleting contents is enough implicitly, but we can explicitly null out the old folder tree if it exists)
          const exactTree = tree.find((t: any) => t.path === oldPath && t.type === 'tree');
          if (exactTree) {
             newTree.push({
               path: oldPath,
               mode: '040000',
               type: 'tree',
               sha: null
             });
          }

          for (const file of filesToMove) {
            const relPath = file.path.substring(oldPath.length + 1);
            newTree.push({
              path: oldPath + '/' + relPath,
              mode: '100644',
              type: 'blob',
              sha: null
            });
            newTree.push({
              path: `${newPath}/${relPath}`,
              mode: file.mode,
              type: file.type,
              sha: file.sha
            });
            replacedCount++;
          }
        }
      }

      if (replacedCount === 0) throw new Error("Path not found or empty");

      const newTreeRes = await api.post(`/repos/${owner}/${repo}/git/trees`, {
        base_tree: baseTreeSha,
        tree: newTree
      });

      const newCommitRes = await api.post(`/repos/${owner}/${repo}/git/commits`, {
        message: message || `Rename ${oldPath} to ${newPath}`,
        tree: newTreeRes.data.sha,
        parents: [commitSha]
      });

      await api.patch(`/repos/${owner}/${repo}/git/refs/heads/${branch || 'main'}`, {
        sha: newCommitRes.data.sha,
        force: false
      });

      res.json({ success: true, filesMoved: Math.floor(replacedCount) });
    } catch (error: any) {
      console.error("Rename error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/files/delete_folder", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, path, message, branch } = req.body;
      const api = githubApi(token);

      // We need to recursively get all files in the folder (wait, a better way is to simply get the git tree recursively)
      // Getting tree recursively:
      const branchDetails = await api.get(`/repos/${owner}/${repo}/branches/${branch || 'main'}`);
      const commitSha = branchDetails.data.commit.sha;
      const treeDetails = await api.get(`/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`);
      
      const filesToDelete = treeDetails.data.tree.filter((t: any) => 
        t.type === 'blob' && t.path.startsWith(`${path}/`)
      );

      // Now we delete each file sequentially (parallel might hit rate limits or conflict)
      for (const file of filesToDelete) {
        await api.delete(`/repos/${owner}/${repo}/contents/${file.path}`, {
          data: { 
            message: message || `Delete ${file.path}`, 
            sha: file.sha, 
            branch 
          }
        });
      }

      res.json({ success: true, count: filesToDelete.length });
    } catch (error: any) {
      console.error("Delete folder error:", error.message || error);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/files/upload", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      if (!req.file) throw new Error("No file uploaded");
      const { owner, repo, path: reqPath, message, branch, sha } = req.body;
      
      const base64Content = req.file.buffer.toString("base64");
      
      const data: any = {
        message: message || `Add ${req.file.originalname}`,
        content: base64Content,
      };
      if (branch) data.branch = branch;
      if (sha) data.sha = sha;

      const finalPath = reqPath.endsWith("/") ? `${reqPath}${req.file.originalname}` : (reqPath || req.file.originalname);

      const response = await githubApi(token).put(`/repos/${owner}/${repo}/contents/${finalPath}`, data);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  app.post("/api/files/upload_multiple", requireAuth, upload.array("files", 100), async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      if (!req.files || !Array.isArray(req.files)) throw new Error("No files uploaded");
      const { owner, repo, path: baseReqPath, branch } = req.body;
      let uploadCount = 0;
      let errors: any[] = [];
      const api = githubApi(token);

      for (const file of req.files) {
        try {
          const base64Content = file.buffer.toString("base64");
          
          let sha = "";
          const finalPath = baseReqPath ? `${baseReqPath}/${file.originalname}` : file.originalname;
          
          try {
            const fileCheck = await api.get(`/repos/${owner}/${repo}/contents/${finalPath}`, {
              params: branch ? { ref: branch } : {}
            });
            if (fileCheck.data && !Array.isArray(fileCheck.data)) {
              sha = (fileCheck.data as any).sha;
            }
          } catch (err: any) {
             // ignore 404
          }

          const data: any = {
            message: `Add ${file.originalname}`,
            content: base64Content,
          };
          if (branch) data.branch = branch;
          if (sha) data.sha = sha;

          await api.put(`/repos/${owner}/${repo}/contents/${finalPath}`, data);
          uploadCount++;
        } catch (fileErr: any) {
          errors.push({ file: file.originalname, error: fileErr.response?.data?.message || fileErr.message });
        }
      }

      res.json({ success: true, count: uploadCount, errors: errors.length > 0 ? errors : undefined });
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });

  // Extract Zip
  app.post("/api/zip/upload", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      if (!req.file) throw new Error("No ZIP file uploaded");
      const { owner, repo, path: destPath = "", branch } = req.body;
      
      const zip = new AdmZip(req.file.buffer);
      const zipEntries = zip.getEntries();
      
      let uploadCount = 0;
      let errors: any[] = [];
      const api = githubApi(token);

      for (const entry of zipEntries) {
        if (!entry.isDirectory) {
          try {
            const fileContent = entry.getData().toString("base64");
            const entryName = entry.entryName;
            
            // Clean up relative paths inside the zip context
            let filePath = destPath ? `${destPath}/${entryName}` : entryName;
            filePath = filePath.replace(new RegExp('\\\\', 'g'), "/"); // normalize Windows paths
            filePath = filePath.replace(new RegExp('^/+'), ""); // remove leading slashes
            
            // Try to get file first to see if it exists (needs SHA to update)
            let sha = "";
            try {
              const fileCheck = await api.get(`/repos/${owner}/${repo}/contents/${filePath}`, {
                params: branch ? { ref: branch } : {}
              });
              if (fileCheck.data && !Array.isArray(fileCheck.data)) {
                sha = (fileCheck.data as any).sha;
              }
            } catch (err: any) {
              if (err.response?.status !== 404) {
                console.error(`Error checking existing file ${filePath}:`, err.response?.data);
              }
            }

            const data: any = {
              message: `Extract uploaded zipped file ${entryName}`,
              content: fileContent,
            };
            if (sha) data.sha = sha;
            if (branch) data.branch = branch;

            await api.put(`/repos/${owner}/${repo}/contents/${filePath}`, data);
            uploadCount++;
          } catch (fileErr: any) {
            errors.push({ file: entry.entryName, error: fileErr.response?.data?.message || fileErr.message });
          }
        }
      }

      res.json({ success: true, count: uploadCount, errors: errors.length > 0 ? errors : undefined });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- BRANCHES & COMMITS ---
  app.get("/api/branches", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo } = req.query;
      const response = await githubApi(token).get(`/repos/${owner}/${repo}/branches`);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: "Unknown error" });
    }
  });

  app.get("/api/commits", requireAuth, async (req, res) => {
    try {
      const token = req.headers["x-github-token"] as string;
      const { owner, repo, sha, path } = req.query;
      let url = `/repos/${owner}/${repo}/commits`;
      const params = new URLSearchParams();
      if (sha) params.append("sha", sha as string);
      if (path) params.append("path", path as string);
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await githubApi(token).get(url);
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: "Unknown error" });
    }
  });

  // --- VITE MIDDLEWARE ---
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
