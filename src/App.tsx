import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Github, FolderGit2, Folder, File as FileIcon, ChevronRight, Download, Upload, LogOut, ArrowLeft, Plus, FolderUp, Archive, Trash2, Copy, Check, Eye, EyeOff, KeyRound, HelpCircle, ExternalLink } from 'lucide-react';
import { Toast, Modal } from './components/ui';
import { CodeEditor } from './components/CodeEditor';
import { motion, AnimatePresence } from 'motion/react';

// --- TS Interfaces ---
interface User { login: string; avatar_url: string; name: string; }
interface Repo { id: number; name: string; full_name: string; private: boolean; updated_at: string; default_branch: string; owner: { login: string }; language: string | null; description?: string | null; }
interface FileNode { name: string; path: string; sha: string; size: number; download_url: string; type: 'dir' | 'file'; children?: FileNode[]; isOpen?: boolean; isLoading?: boolean; }
interface ToastData { message: string; type: 'success' | 'error' | 'info'; }

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  PHP: '#4F5D95',
  Ruby: '#701516',
  Go: '#00ADD8',
  Rust: '#dea584',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Shell: '#89e051',
  Dockerfile: '#384d54',
};

const getLanguageColor = (lang: string | null) => lang && LANGUAGE_COLORS[lang] ? LANGUAGE_COLORS[lang] : '#8b949e';

function formatRelativeRepoTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'min' : 'mins'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ${diffHr === 1 ? 'hr' : 'hrs'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} ${diffDay === 1 ? 'day' : 'days'} ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffDay < 30) return `${diffWeek} ${diffWeek === 1 ? 'week' : 'weeks'} ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffDay < 365) return `${diffMonth} ${diffMonth === 1 ? 'month' : 'months'} ago`;
  return `${date.getFullYear()}`;
}

function decodeBase64Utf8(base64Str: string): string {
  const clean = base64Str.replace(/\s/g, '');
  const binaryString = atob(clean);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [currentView, setCurrentView] = useState<'repos' | 'repo' | 'settings' | 'create-repo'>('repos');

  // Create Repo View
  const [createRepoStep, setCreateRepoStep] = useState<'details' | 'preview'>('details');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoDesc, setNewRepoDesc] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [newRepoFiles, setNewRepoFiles] = useState<File[]>([]);
  const [newRepoZip, setNewRepoZip] = useState<File | null>(null);

  // Repo search
  const [repoSearchQuery, setRepoSearchQuery] = useState('');

  // Editor State
  const [activeFile, setActiveFile] = useState<{ path: string; content: string; sha: string } | null>(null);

  // Upload/ZIP
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResults, setUploadResults] = useState<{ total: number; success: number; errors: { file: string; error: string }[] } | null>(null);
  const [showUploadResults, setShowUploadResults] = useState(false);

  // Rename
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);
  const [renameNewName, setRenameNewName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  // Delete File/Folder Confirmation Modal
  const [deleteFileTarget, setDeleteFileTarget] = useState<FileNode | null>(null);
  const [deleteFileLoading, setDeleteFileLoading] = useState(false);

  // Create Modals
  const [createType, setCreateType] = useState<'file' | 'folder' | null>(null);
  const [createName, setCreateName] = useState('');
  const [createContent, setCreateContent] = useState('');

  // Login & OAuth State
  const [pat, setPat] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [showOAuthSetupModal, setShowOAuthSetupModal] = useState(false);
  const [callbackCopied, setCallbackCopied] = useState(false);

  // Token Display State
  const [showToken, setShowToken] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  const callbackUrl = `${window.location.origin}/api/auth/github/callback`;

  // Intercept all axios requests to add the token
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use((config) => {
      const token = localStorage.getItem('github_token');
      if (token) {
        config.headers['x-github-token'] = token;
      }
      return config;
    });

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
    };
  }, []);

  // Check existing token on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Listen for OAuth popup postMessage callback
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'OAUTH_AUTH_SUCCESS' && data.token) {
        localStorage.setItem('github_token', data.token);
        setOauthLoading(false);
        setToast({ message: 'Signed in with GitHub successfully!', type: 'success' });
        await checkAuth();
      } else if (data.type === 'OAUTH_AUTH_ERROR') {
        setOauthLoading(false);
        setToast({ message: data.error || 'GitHub OAuth authentication failed', type: 'error' });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('github_token');
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await axios.get('/api/auth/status');
      if (res.data.authenticated) {
        setUser(res.data.user);
        fetchRepos();
      } else {
        localStorage.removeItem('github_token');
        setUser(null);
      }
    } catch (err) {
      console.error('Auth check failed');
      localStorage.removeItem('github_token');
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubOAuthLogin = async () => {
    setOauthLoading(true);
    try {
      const res = await axios.get(`/api/auth/github/url?origin=${encodeURIComponent(window.location.origin)}`);
      const { url } = res.data;

      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        url,
        'github_oauth_popup',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        setOauthLoading(false);
        setToast({ message: 'Popup was blocked. Please allow popups for this site.', type: 'error' });
        return;
      }

      // Reset loading state if user manually closes the popup
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollTimer);
          setOauthLoading(false);
        }
      }, 1000);
    } catch (error: any) {
      setOauthLoading(false);
      if (error.response?.data?.missingConfig) {
        setShowOAuthSetupModal(true);
      } else {
        setToast({
          message: error.response?.data?.error || 'Failed to start GitHub OAuth flow',
          type: 'error',
        });
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pat.trim()) {
      setToast({ message: 'Personal Access Token is required', type: 'error' });
      return;
    }
    setLoginLoading(true);
    try {
      const res = await axios.post('/api/auth/login', { token: pat.trim() });
      if (res.data.success) {
        localStorage.setItem('github_token', res.data.token);
        setUser(res.data.user);
        fetchRepos();
        setToast({ message: 'Authenticated successfully', type: 'success' });
        setPat('');
      }
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Failed to login', type: 'error' });
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await axios.post('/api/auth/logout');
    localStorage.removeItem('github_token');
    setUser(null);
    setRepos([]);
    setSelectedRepo(null);
    setCurrentView('repos');
  };

  const fetchRepos = async () => {
    setLoadingRepos(true);
    try {
      const res = await axios.get('/api/repos');
      setRepos(res.data);
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || 'Failed to fetch repositories', type: 'error' });
    } finally {
      setLoadingRepos(false);
    }
  };

  const handleCreateRepo = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newRepoName.trim()) return;
    try {
      setUploadLoading(true);
      const payload: any = {
        name: newRepoName.trim(),
        private: newRepoPrivate,
        auto_init: true,
      };
      if (newRepoDesc.trim()) {
        payload.description = newRepoDesc.trim();
      }

      const res = await axios.post('/api/repos/create', payload);
      const newRepo = res.data;

      // Upload initial ZIP or multiple files using our atomic Git Tree endpoints
      if (newRepoZip) {
        setToast({ message: 'Repository created. Extracting & committing ZIP...', type: 'info' });
        const formData = new FormData();
        formData.append('file', newRepoZip);
        formData.append('owner', newRepo.owner.login);
        formData.append('repo', newRepo.name);
        formData.append('path', '');
        formData.append('branch', newRepo.default_branch || 'main');
        await axios.post('/api/zip/upload', formData);
      } else if (newRepoFiles && newRepoFiles.length > 0) {
        setToast({ message: `Repository created. Committing ${newRepoFiles.length} file(s)...`, type: 'info' });
        const formData = new FormData();
        formData.append('owner', newRepo.owner.login);
        formData.append('repo', newRepo.name);
        formData.append('path', '');
        formData.append('branch', newRepo.default_branch || 'main');

        const filePaths: string[] = [];
        for (let i = 0; i < newRepoFiles.length; i++) {
          formData.append('files', newRepoFiles[i]);
          filePaths.push((newRepoFiles[i] as any).webkitRelativePath || newRepoFiles[i].name);
        }
        formData.append('filePaths', JSON.stringify(filePaths));

        await axios.post('/api/files/upload_multiple', formData);
      }

      setToast({ message: 'Repository successfully created!', type: 'success' });
      setCreateRepoStep('details');
      setNewRepoName('');
      setNewRepoDesc('');
      setNewRepoPrivate(false);
      setNewRepoFiles([]);
      setNewRepoZip(null);

      // Auto-navigate to the new repo
      setSelectedRepo(newRepo);
      setCurrentView('repo');
      fetchFiles(newRepo, '');

      // Refresh repositories list in the background
      fetchRepos();
    } catch (err: any) {
      setToast({
        message: err.response?.data?.error || err.response?.data?.message || err.message || 'Create repo failed',
        type: 'error',
      });
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDeleteRepo = async () => {
    if (!selectedRepo) return;
    try {
      setDeleteLoading(true);
      await axios.post('/api/repos/delete', { owner: selectedRepo.owner.login, repo: selectedRepo.name });
      setToast({ message: 'Repository deleted successfully', type: 'success' });
      setShowDeleteModal(false);
      setSelectedRepo(null);
      setCurrentView('repos');
      fetchRepos();
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || err.response?.data?.message || err.message || 'Delete repo failed', type: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleClearRepo = async () => {
    if (!selectedRepo) return;
    try {
      setClearLoading(true);
      await axios.post('/api/repos/clear', { owner: selectedRepo.owner.login, repo: selectedRepo.name, branch: selectedRepo.default_branch });
      setToast({ message: 'Repository cleared successfully', type: 'success' });
      setShowClearModal(false);
      refreshNode(selectedRepo, currentPath);
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || err.response?.data?.message || err.message || 'Clear repo failed', type: 'error' });
    } finally {
      setClearLoading(false);
    }
  };

  const openRepo = (repo: Repo) => {
    setSelectedRepo(repo);
    setCurrentPath('');
    fetchFiles(repo, '');
    setCurrentView('repo');
  };

  const fetchFiles = async (repo: Repo, path: string = '') => {
    setLoadingFiles(true);
    setCurrentPath(path);
    try {
      const res = await axios.get(`/api/files?owner=${repo.owner.login}&repo=${repo.name}&path=${encodeURIComponent(path)}`);
      let data = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
      // sort folders first
      data.sort((a: any, b: any) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'dir' ? -1 : 1;
      });
      setFiles(data);
      setActiveFile(null);
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || 'Failed to fetch files', type: 'error' });
    } finally {
      setLoadingFiles(false);
    }
  };

  const refreshNode = async (repo: Repo, path: string) => {
    fetchFiles(repo, path);
  };

  const handleFileClick = async (file: FileNode, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (file.type === 'dir') {
      fetchFiles(selectedRepo!, file.path);
    } else {
      setLoadingFiles(true);
      try {
        const res = await axios.get(`/api/files?owner=${selectedRepo!.owner.login}&repo=${selectedRepo!.name}&path=${encodeURIComponent(file.path)}`);
        const content = res.data.content ? decodeBase64Utf8(res.data.content) : '';
        setActiveFile({ path: file.path, content, sha: res.data.sha });
      } catch (err: any) {
        setToast({ message: err.response?.data?.error || 'Failed to load file content', type: 'error' });
      } finally {
        setLoadingFiles(false);
      }
    }
  };

  const saveFile = async (newContent: string) => {
    if (!activeFile || !selectedRepo) return;
    try {
      const res = await axios.post('/api/files/update', {
        owner: selectedRepo.owner.login,
        repo: selectedRepo.name,
        path: activeFile.path,
        message: `Update ${activeFile.path} via GitHub Flow Manager`,
        content: newContent,
        sha: activeFile.sha,
        branch: selectedRepo.default_branch,
      });
      setActiveFile({ ...activeFile, content: newContent, sha: res.data.content.sha });
      setToast({ message: 'File saved successfully', type: 'success' });
      refreshNode(selectedRepo, currentPath);
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || err.response?.data?.message || 'Failed to save', type: 'error' });
    }
  };

  const handleCreateFile = async (name: string) => {
    if (!selectedRepo) return;
    const path = currentPath ? `${currentPath}/${name}` : name;
    try {
      const res = await axios.post('/api/files/update', {
        owner: selectedRepo.owner.login,
        repo: selectedRepo.name,
        path: path,
        message: `Create ${path}`,
        content: createContent,
        branch: selectedRepo.default_branch,
      });
      setToast({ message: 'File created successfully', type: 'success' });
      refreshNode(selectedRepo, currentPath);

      setActiveFile({ path, content: createContent, sha: res.data.content.sha });

      setCreateType(null);
      setCreateName('');
      setCreateContent('');
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || err.response?.data?.message || 'Failed to create file', type: 'error' });
    }
  };

  const handleCreateFolder = async (name: string) => {
    if (!selectedRepo) return;
    const path = currentPath ? `${currentPath}/${name}/.gitkeep` : `${name}/.gitkeep`;
    try {
      await axios.post('/api/files/update', {
        owner: selectedRepo.owner.login,
        repo: selectedRepo.name,
        path: path,
        message: `Create folder ${name}`,
        content: 'This file was created to keep the folder.',
        branch: selectedRepo.default_branch,
      });
      setToast({ message: 'Folder created successfully', type: 'success' });
      refreshNode(selectedRepo, currentPath);
      setCreateType(null);
      setCreateName('');
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || err.response?.data?.message || 'Failed to create folder', type: 'error' });
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo || !renameTarget || !renameNewName.trim()) return;

    setRenameLoading(true);
    try {
      const oldPath = renameTarget.path;
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
      const newPath = parentDir ? `${parentDir}/${renameNewName.trim()}` : renameNewName.trim();

      if (oldPath === newPath) {
        setRenameModalOpen(false);
        return;
      }

      await axios.post('/api/files/rename', {
        owner: selectedRepo.owner.login,
        repo: selectedRepo.name,
        oldPath,
        newPath,
        branch: selectedRepo.default_branch,
        message: `Rename ${oldPath} to ${newPath}`,
      });

      setToast({ message: 'Renamed successfully', type: 'success' });
      setRenameModalOpen(false);
      setRenameNewName('');
      setRenameTarget(null);
      refreshNode(selectedRepo, currentPath);
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || err.response?.data?.message || 'Failed to rename', type: 'error' });
    } finally {
      setRenameLoading(false);
    }
  };

  const confirmAndDeleteFile = async () => {
    if (!selectedRepo || !deleteFileTarget) return;
    setDeleteFileLoading(true);
    try {
      if (deleteFileTarget.type === 'dir') {
        await axios.post('/api/files/delete_folder', {
          owner: selectedRepo.owner.login,
          repo: selectedRepo.name,
          path: deleteFileTarget.path,
          message: `Delete folder ${deleteFileTarget.path}`,
          branch: selectedRepo.default_branch,
        });
        setToast({ message: 'Folder deleted successfully', type: 'success' });
      } else {
        await axios.post('/api/files/delete', {
          owner: selectedRepo.owner.login,
          repo: selectedRepo.name,
          path: deleteFileTarget.path,
          message: `Delete ${deleteFileTarget.path}`,
          sha: deleteFileTarget.sha,
          branch: selectedRepo.default_branch,
        });
        setToast({ message: 'File deleted successfully', type: 'success' });
      }
      refreshNode(selectedRepo, deleteFileTarget.path.split('/').slice(0, -1).join('/'));
      setDeleteFileTarget(null);
    } catch (err: any) {
      setToast({
        message: err.response?.data?.error || err.response?.data?.message || 'Failed to delete',
        type: 'error',
      });
    } finally {
      setDeleteFileLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedRepo) return;

    setUploadLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('owner', selectedRepo.owner.login);
    formData.append('repo', selectedRepo.name);
    formData.append('path', currentPath ? `${currentPath}/${file.name}` : file.name);
    formData.append('branch', selectedRepo.default_branch);

    try {
      await axios.post('/api/files/upload', formData);
      setToast({ message: `Successfully uploaded ${file.name}`, type: 'success' });
      refreshNode(selectedRepo, currentPath);
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || err.response?.data?.message || 'Failed to upload file', type: 'error' });
    } finally {
      setUploadLoading(false);
      e.target.value = '';
    }
  };

  const handleDirectoryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !selectedRepo) return;

    setUploadLoading(true);
    const formData = new FormData();
    formData.append('owner', selectedRepo.owner.login);
    formData.append('repo', selectedRepo.name);
    formData.append('path', currentPath);
    formData.append('branch', selectedRepo.default_branch);

    const filePaths: string[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      formData.append('files', file);
      filePaths.push(file.webkitRelativePath || file.name);
    }
    formData.append('filePaths', JSON.stringify(filePaths));

    try {
      const res = await axios.post('/api/files/upload_multiple', formData);
      const uploadedCount = res.data.count || 0;
      const errors = res.data.errors || [];
      setUploadResults({ total: fileList.length, success: uploadedCount, errors });
      setShowUploadResults(true);
      refreshNode(selectedRepo, currentPath);
    } catch (err: any) {
      setToast({
        message: err.response?.data?.error || err.message || 'Failed to upload folder',
        type: 'error',
      });
    } finally {
      setUploadLoading(false);
      e.target.value = '';
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedRepo) return;

    setUploadLoading(true);
    setToast({ message: `Extracting and committing ${file.name}...`, type: 'info' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('owner', selectedRepo.owner.login);
    formData.append('repo', selectedRepo.name);
    formData.append('path', currentPath);
    formData.append('branch', selectedRepo.default_branch);

    try {
      const res = await axios.post('/api/zip/upload', formData);
      if (res.data.errors && res.data.errors.length > 0) {
        setUploadResults({
          total: (res.data.count || 0) + res.data.errors.length,
          success: res.data.count || 0,
          errors: res.data.errors,
        });
        setShowUploadResults(true);
      } else {
        setToast({ message: `Successfully extracted and committed ${res.data.count} files!`, type: 'success' });
      }
      refreshNode(selectedRepo, currentPath);
    } catch (err: any) {
      setToast({
        message: err.response?.data?.error || err.message || 'Failed to extract and upload ZIP',
        type: 'error',
      });
    } finally {
      setUploadLoading(false);
      e.target.value = '';
    }
  };

  let displayFiles = files;
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    displayFiles = displayFiles.filter(f => f.name.toLowerCase().includes(q));
  }

  if (loading) return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center p-6">
      <div className="max-w-md w-full flex flex-col items-center">
        <motion.div
          animate={{ scale: [1, 1.1, 1], rotate: [0, 180, 360] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="w-16 h-16 bg-gradient-to-tr from-[#3b82f6] to-[#60a5fa] rounded-full mb-8 shadow-[0_0_30px_rgba(59,130,246,0.5)]"
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="h-6 bg-[#1e293b] rounded w-64 mb-4 relative overflow-hidden"
        >
          <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="h-4 bg-[#1e293b] rounded w-48 relative overflow-hidden"
        >
          <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear', delay: 0.2 }} />
        </motion.div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020617] text-[#e2e8f0] font-sans selection:bg-[#2563eb] selection:text-white">
      {/* Header */}
      <header className="bg-[#0f172a] border-b border-[#1e293b] px-6 py-4 flex items-center justify-between relative z-20">
        <div
          onClick={() => {
            if (user) {
              setSelectedRepo(null);
              setActiveFile(null);
              setCurrentView('repos');
            }
          }}
          className={`flex items-center gap-3 ${user ? 'cursor-pointer' : ''}`}
        >
          <Github size={28} className="text-white shrink-0" />
          <h1 className="text-xl font-semibold text-white tracking-tight hidden sm:block">ViralBit Git Manager</h1>
        </div>
        {user && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <img src={user.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full border border-[#1e293b]" />
              <span className="text-sm font-medium hidden sm:inline-block">{user.login}</span>
            </div>

            {currentView !== 'settings' && (
              <button
                onClick={() => setCurrentView('settings')}
                className="text-[#94a3b8] hover:text-[#e2e8f0] flex items-center gap-2 text-sm bg-[#1e293b] px-3 py-1.5 rounded-md border border-[#1e293b]"
              >
                Settings
              </button>
            )}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        {!user ? (
          <div className="mt-12 flex flex-col items-center justify-center p-8 text-center border border-[#1e293b] rounded-xl bg-[#0f172a] max-w-md mx-auto shadow-lg">
            <div className="w-14 h-14 rounded-full bg-[#1e293b] flex items-center justify-center mb-4 border border-[#334155]">
              <Github size={32} className="text-white" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Welcome to ViralBit Git Manager</h2>
            <p className="text-[#94a3b8] text-sm mb-6">
              Manage your GitHub repositories, edit code with syntax highlighting, and upload files or ZIP archives in seconds.
            </p>

            {/* Method 1: Login with GitHub OAuth */}
            <div className="w-full flex flex-col gap-2 mb-5">
              <button
                type="button"
                onClick={handleGitHubOAuthLogin}
                disabled={oauthLoading || loginLoading}
                className="w-full bg-white hover:bg-[#f1f5f9] text-[#020617] text-sm font-semibold py-2.5 px-6 rounded-md flex items-center justify-center gap-2.5 transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
              >
                <Github size={18} />
                {oauthLoading ? 'Connecting to GitHub...' : 'Continue with GitHub'}
              </button>
              <button
                type="button"
                onClick={() => setShowOAuthSetupModal(true)}
                className="text-xs text-[#94a3b8] hover:text-[#60a5fa] flex items-center justify-center gap-1 transition-colors self-center"
              >
                <HelpCircle size={12} />
                How to configure GitHub OAuth for your host
              </button>
            </div>

            <div className="w-full flex items-center gap-3 my-2">
              <div className="h-px bg-[#1e293b] flex-1" />
              <span className="text-xs uppercase tracking-wider text-[#64748b] font-medium">Or sign in with token</span>
              <div className="h-px bg-[#1e293b] flex-1" />
            </div>

            {/* Method 2: Personal Access Token (PAT) */}
            <form onSubmit={handleLogin} className="w-full flex flex-col gap-3 mt-4 text-left">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[#cbd5e1] flex items-center gap-1.5">
                    <KeyRound size={13} className="text-[#60a5fa]" />
                    Personal Access Token (Classic)
                  </label>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo,delete_repo&description=ViralBit+Git+Manager"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#60a5fa] hover:underline flex items-center gap-1"
                  >
                    Generate token <ExternalLink size={11} />
                  </a>
                </div>
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  required
                  className="w-full bg-[#020617] border border-[#1e293b] rounded-md px-3 py-2 text-sm outline-none focus:border-[#60a5fa] focus:ring-1 focus:ring-[#60a5fa] text-white"
                />
              </div>
              <button
                type="submit"
                disabled={loginLoading || oauthLoading || !pat.trim()}
                className="w-full bg-[#2563eb] hover:bg-[#3b82f6] text-white text-sm font-medium py-2.5 px-6 rounded-md flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loginLoading ? 'Authenticating...' : (
                  <>
                    <KeyRound size={15} />
                    Sign in with Personal Access Token
                  </>
                )}
              </button>
            </form>
          </div>
        ) : currentView === 'settings' ? (
          <div className="max-w-xl mx-auto mt-6">
            <button
              onClick={() => setCurrentView(selectedRepo ? 'repo' : 'repos')}
              className="text-[#94a3b8] hover:text-white mb-4 flex items-center gap-2 group transition-colors text-sm"
            >
              <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back
            </button>
            <h2 className="text-xl font-semibold text-white mb-4">Settings</h2>
            <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5">
              <div className="flex items-center gap-4 mb-6">
                <img src={user.avatar_url} alt="Avatar" className="w-12 h-12 rounded-full border border-[#1e293b]" />
                <div>
                  <h3 className="text-lg font-bold text-white">{user.name || user.login}</h3>
                  <p className="text-sm text-[#94a3b8]">@{user.login}</p>
                </div>
              </div>

              <div className="border-t border-[#1e293b] pt-5 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-base font-medium text-white">Authentication Details</h4>
                  <button
                    onClick={() => setShowOAuthSetupModal(true)}
                    className="text-xs text-[#60a5fa] hover:underline flex items-center gap-1"
                  >
                    <HelpCircle size={13} /> OAuth Setup Guide
                  </button>
                </div>
                <div className="bg-[#020617] border border-[#1e293b] rounded-lg p-3">
                  <label className="block text-xs font-medium mb-1.5 text-[#e2e8f0]">Active GitHub Access Token</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 relative">
                      <input
                        type={showToken ? 'text' : 'password'}
                        readOnly
                        value={localStorage.getItem('github_token') || ''}
                        className="w-full bg-[#0f172a] border border-[#1e293b] rounded-md px-2.5 py-1.5 text-sm text-white pr-9 focus:outline-none"
                      />
                      <button
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-white transition-colors"
                        title={showToken ? 'Hide token' : 'Show token'}
                      >
                        {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        const token = localStorage.getItem('github_token') || '';
                        navigator.clipboard.writeText(token);
                        setTokenCopied(true);
                        setTimeout(() => setTokenCopied(false), 2000);
                      }}
                      className="bg-[#1e293b] hover:bg-[#334155] border border-[#1e293b] text-white px-2.5 py-1.5 text-sm rounded-md transition-colors flex items-center justify-center shrink-0 w-[70px]"
                    >
                      {tokenCopied ? (
                        <div className="flex items-center gap-1 text-[#22c55e]">
                          <Check size={14} /> <span>Copied</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Copy size={14} /> <span>Copy</span>
                        </div>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#94a3b8] mt-1.5">
                    This token is stored in your browser's local storage and authenticates your requests with GitHub.
                  </p>
                </div>
              </div>

              <div className="border-t border-[#1e293b] pt-5 mb-6">
                <h4 className="text-base font-medium text-white mb-3">Repository Analytics</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[#020617] border border-[#1e293b] rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-white mb-0.5">{repos.length}</div>
                    <div className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-semibold">Total</div>
                  </div>
                  <div className="bg-[#020617] border border-[#1e293b] rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-white mb-0.5">{repos.filter(r => !r.private).length}</div>
                    <div className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-semibold">Public</div>
                  </div>
                  <div className="bg-[#020617] border border-[#1e293b] rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-white mb-0.5">{repos.filter(r => r.private).length}</div>
                    <div className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-semibold">Private</div>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#1e293b] pt-5">
                <h4 className="text-base font-medium text-white mb-3">Account Actions</h4>
                <button
                  onClick={handleLogout}
                  className="bg-[#ef4444]/10 hover:bg-[#ef4444]/20 border border-[#ef4444]/30 text-[#ef4444] font-medium py-2 px-6 rounded-md flex items-center justify-center gap-2 transition-colors w-full text-sm"
                >
                  <LogOut size={16} /> Logout
                </button>
              </div>
            </div>
          </div>
        ) : currentView === 'repos' ? (
          <div>
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-4 w-full md:w-auto">
                <h2 className="text-xl font-semibold text-white whitespace-nowrap">Your Repositories</h2>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto">
                <input
                  type="text"
                  placeholder="Find a repository..."
                  value={repoSearchQuery}
                  onChange={(e) => setRepoSearchQuery(e.target.value)}
                  className="w-full md:w-64 bg-[#020617] border border-[#1e293b] rounded-md px-3 py-1.5 focus:border-[#60a5fa] focus:outline-none focus:ring-1 focus:ring-[#60a5fa] text-sm text-white"
                />
                <button
                  onClick={() => {
                    setCreateRepoStep('details');
                    setNewRepoName('');
                    setNewRepoDesc('');
                    setNewRepoPrivate(false);
                    setNewRepoFiles([]);
                    setNewRepoZip(null);
                    setCurrentView('create-repo');
                  }}
                  className="bg-[#2563eb] hover:bg-[#3b82f6] text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 shrink-0 transition-colors"
                >
                  <Plus size={16} /> New Repo
                </button>
              </div>
            </div>

            {loadingRepos ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5 flex flex-col min-h-[120px] overflow-hidden relative"
                  >
                    <motion.div
                      className="absolute inset-0 z-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                      animate={{ x: ['-100%', '100%'] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear', delay: i * 0.1 }}
                    />
                    <div className="flex items-start justify-between mb-4 relative z-10">
                      <div className="h-5 bg-[#1e293b] rounded w-2/3"></div>
                      <div className="h-4 bg-[#1e293b] rounded w-12"></div>
                    </div>
                    <div className="h-4 bg-[#1e293b] rounded w-1/3 mb-2 relative z-10"></div>
                    <div className="mt-auto pt-4 flex items-center justify-between relative z-10">
                      <div className="h-3 bg-[#1e293b] rounded w-1/4"></div>
                      <div className="h-3 bg-[#1e293b] rounded w-1/4"></div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : repos.filter(r => r.name.toLowerCase().includes(repoSearchQuery.toLowerCase())).length === 0 ? (
              <div className="text-center py-12 border border-[#1e293b] rounded-lg bg-[#0f172a]">
                <FolderGit2 className="mx-auto text-[#94a3b8] opacity-50 mb-4" size={48} />
                <p className="text-[#e2e8f0] font-medium text-lg">No repositories found</p>
                <p className="text-[#94a3b8] text-sm mt-1">Try entering a different search query or create a new one.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {repos.filter(r => r.name.toLowerCase().includes(repoSearchQuery.toLowerCase())).map(repo => (
                  <div
                    key={repo.id}
                    onClick={() => openRepo(repo)}
                    className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5 hover:border-[#94a3b8] cursor-pointer transition-all flex flex-col min-h-[120px] shadow-sm hover:shadow-md"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 text-[#60a5fa] font-semibold text-lg overflow-hidden pr-2">
                        <FolderGit2 size={20} className="shrink-0 text-[#94a3b8]" />
                        <span className="truncate hover:underline">{repo.name}</span>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full border border-[#1e293b] text-[#94a3b8] bg-[#020617] font-medium shrink-0">
                        {repo.private ? 'Private' : 'Public'}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-[#94a3b8] truncate">
                      Main branch: <span className="text-[#e2e8f0]">{repo.default_branch || 'main'}</span>
                    </div>
                    <div className="mt-auto pt-4 flex items-center justify-between text-xs text-[#94a3b8]">
                      <div className="flex items-center gap-3 opacity-80">
                        {repo.language && (
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getLanguageColor(repo.language) }}></div>
                            <span>{repo.language}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${repo.private ? 'bg-[#ef4444]' : 'bg-[#e3b341]'}`}></div>
                          <span>{repo.private ? 'Private' : 'Public'}</span>
                        </div>
                      </div>
                      <span>Updated {formatRelativeRepoTime(repo.updated_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : currentView === 'create-repo' ? (
          <div className="max-w-3xl mx-auto mt-6">
            <button
              onClick={() => setCurrentView('repos')}
              className="text-[#94a3b8] hover:text-white mb-4 flex items-center gap-2 group transition-colors"
            >
              <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back
            </button>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-bold text-white">Create a new repository</h2>
            </div>
            <p className="text-[#94a3b8] mb-5 text-sm">A repository contains all project files, including the revision history.</p>

            <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5 md:p-6 relative overflow-hidden">
              {uploadLoading ? (
                <div className="py-16 flex flex-col items-center justify-center relative z-10">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    className="relative w-16 h-16 mb-6"
                  >
                    <motion.span
                      className="absolute inset-0 rounded-full border-t-2 border-r-2 border-[#3b82f6] shadow-[0_0_15px_#3b82f6]"
                      animate={{ scale: [1, 1.1, 1], opacity: [0.8, 1, 0.8] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <motion.span
                      className="absolute inset-2 rounded-full border-b-2 border-l-2 border-[#60a5fa]"
                      animate={{ rotate: -720 }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                    />
                  </motion.div>
                  <motion.h3
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xl font-semibold text-white tracking-wide"
                  >
                    Setting things up...
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="text-sm text-[#94a3b8] mt-2"
                  >
                    {newRepoFiles.length > 0 || newRepoZip ? 'Creating repository & committing files...' : 'Creating repository...'}
                  </motion.p>
                </div>
              ) : createRepoStep === 'details' ? (
                <form onSubmit={(e) => { e.preventDefault(); setCreateRepoStep('preview'); }} className="flex flex-col gap-5">
                  <div>
                    <label className="block text-sm font-medium mb-1.5 text-[#e2e8f0]">Repository name <span className="text-[#ef4444]">*</span></label>
                    <input
                      autoFocus
                      required
                      value={newRepoName}
                      onChange={e => setNewRepoName(e.target.value)}
                      className="w-full bg-[#020617] border border-[#1e293b] rounded-md px-3 py-2 focus:border-[#60a5fa] focus:outline-none focus:ring-1 focus:ring-[#60a5fa] text-sm text-white"
                      placeholder="awesome-project"
                    />
                    <p className="text-xs text-[#94a3b8] mt-1.5">Great repository names are short and memorable.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1.5 text-[#e2e8f0]">Description <span className="text-[#94a3b8] font-normal">(optional)</span></label>
                    <textarea
                      value={newRepoDesc}
                      onChange={e => setNewRepoDesc(e.target.value)}
                      className="w-full bg-[#020617] border border-[#1e293b] rounded-md px-3 py-2 focus:border-[#60a5fa] focus:outline-none focus:ring-1 focus:ring-[#60a5fa] text-sm text-white min-h-[80px]"
                      placeholder="What is this repository about?"
                    />
                  </div>

                  <div className="bg-[#020617] border border-[#1e293b] border-dashed rounded-md p-6 flex flex-col items-center justify-center relative hover:bg-[#0f172a] transition-colors cursor-pointer group">
                    <input
                      type="file"
                      id="new-repo-files"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      multiple
                      onChange={e => {
                        const filesList = Array.from(e.target.files || []) as File[];
                        if (filesList.length === 1 && filesList[0].name.toLowerCase().endsWith('.zip')) {
                          setNewRepoZip(filesList[0]);
                          setNewRepoFiles([]);
                        } else {
                          setNewRepoZip(null);
                          setNewRepoFiles(prev => [...prev, ...filesList]);
                        }
                        e.target.value = '';
                      }}
                      disabled={uploadLoading}
                    />
                    <FolderUp size={36} className="text-[#94a3b8] mb-3 group-hover:text-[#60a5fa] transition-colors" />
                    <p className="text-sm text-[#e2e8f0] font-medium mb-1">Click or drag files here to upload</p>
                    <p className="text-xs text-[#94a3b8]">Auto-detects ZIP archives or multiple files.</p>

                    {(newRepoFiles.length > 0 || newRepoZip) && (
                      <div className="mt-4 px-3 py-1.5 bg-[#1e293b] text-[#60a5fa] rounded-md text-xs font-semibold z-20 relative shadow-sm border border-[#334155]">
                        {newRepoZip ? newRepoZip.name : `${newRepoFiles.length} file(s) selected`}
                      </div>
                    )}
                  </div>

                  <div className="border border-[#1e293b] rounded-md p-3 mt-1 bg-[#020617]">
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newRepoPrivate}
                        onChange={e => setNewRepoPrivate(e.target.checked)}
                        className="rounded border-[#1e293b] bg-[#0f172a] text-[#60a5fa] focus:ring-[#60a5fa] focus:ring-offset-[#0f172a] mt-0.5 w-3.5 h-3.5 cursor-pointer"
                      />
                      <div>
                        <div className="font-medium text-white text-sm">Private</div>
                        <div className="text-xs text-[#94a3b8] mt-0.5">You choose who can see and commit to this repository.</div>
                      </div>
                    </label>
                  </div>

                  <div className="flex items-center justify-end mt-2">
                    <button
                      type="submit"
                      disabled={!newRepoName || uploadLoading}
                      className="px-5 py-1.5 rounded-md text-sm font-medium bg-[#2563eb] hover:bg-[#3b82f6] disabled:opacity-50 transition-colors text-white flex items-center gap-2 shadow-sm"
                    >
                      Continue to preview <ChevronRight size={16} className="ml-1" />
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col gap-5">
                  <h3 className="text-lg font-medium text-white mb-2">Review Repository</h3>

                  <div className="bg-[#020617] p-4 rounded-md border border-[#1e293b] grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs text-[#94a3b8] uppercase tracking-wider font-semibold">Name</span>
                      <div className="text-base text-white font-medium break-words">{newRepoName}</div>
                    </div>
                    <div>
                      <span className="text-xs text-[#94a3b8] uppercase tracking-wider font-semibold">Visibility</span>
                      <div className="text-sm text-[#e2e8f0]">{newRepoPrivate ? 'Private' : 'Public'}</div>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-xs text-[#94a3b8] uppercase tracking-wider font-semibold">Description</span>
                      <div className="text-sm text-[#e2e8f0] line-clamp-3">{newRepoDesc || 'No description provided'}</div>
                    </div>
                  </div>

                  {/* File Preview */}
                  {newRepoZip ? (
                    <div className="bg-[#020617] p-4 rounded-md border border-[#1e293b]">
                      <h4 className="text-sm font-semibold mb-3 text-[#e2e8f0]">Initialize with ZIP Content</h4>
                      <div className="flex items-center justify-between bg-[#0f172a] border border-[#1e293b] p-3 rounded-md">
                        <div className="flex items-center gap-3">
                          <Archive size={20} className="text-[#60a5fa]" />
                          <span className="text-sm font-medium text-white">{newRepoZip.name}</span>
                        </div>
                        <span className="text-xs text-[#94a3b8] font-medium bg-[#1e293b] px-2 py-1 rounded">{(newRepoZip.size / 1024).toFixed(1)} KB</span>
                      </div>
                    </div>
                  ) : newRepoFiles.length > 0 ? (
                    <div className="bg-[#020617] p-4 rounded-md border border-[#1e293b]">
                      <h4 className="text-sm font-semibold mb-3 text-[#e2e8f0]">Initialize with Files ({newRepoFiles.length})</h4>
                      <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                        {newRepoFiles.map((f, i) => (
                          <div key={i} className="flex justify-between items-center bg-[#0a0f1a] p-2 rounded-md border border-[#1e293b] hover:border-[#334155] transition-colors">
                            <div className="flex flex-col overflow-hidden mr-3">
                              <span className="text-sm font-medium text-white truncate">{f.name}</span>
                              <span className="text-[10px] text-[#94a3b8] mt-0.5">{(f.size / 1024).toFixed(1)} KB</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setNewRepoFiles(prev => prev.filter((_, index) => index !== i))}
                              className="text-[#ef4444] hover:bg-[#ef4444]/20 p-1.5 rounded-md transition-colors shrink-0 bg-[#ef4444]/10"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[#020617] p-4 rounded-md border border-[#1e293b] flex flex-col items-center justify-center text-center py-6">
                      <FileIcon size={32} className="text-[#475569] mb-2" />
                      <p className="text-sm text-[#e2e8f0] font-medium">Initialized with README</p>
                      <p className="text-xs text-[#94a3b8]">A default README.md will be created so your repository is ready immediately.</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-4 border-t border-[#1e293b] pt-4">
                    <button
                      type="button"
                      onClick={() => setCreateRepoStep('details')}
                      className="px-4 py-1.5 rounded-md text-sm font-medium text-[#c9d1d9] hover:bg-[#1e293b] transition-colors flex items-center gap-2"
                    >
                      <ArrowLeft size={16} /> Back to edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCreateRepo()}
                      disabled={uploadLoading}
                      className="px-6 py-2 rounded-md text-sm font-medium bg-[#2563eb] hover:bg-[#3b82f6] disabled:opacity-50 transition-colors text-white flex items-center gap-2 shadow-sm shadow-blue-500/20"
                    >
                      {uploadLoading ? 'Creating & Uploading...' : 'Create repository'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : selectedRepo ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-2 min-w-0 flex-1">
                <button
                  onClick={() => {
                    if (activeFile) {
                      setActiveFile(null);
                    } else {
                      setSelectedRepo(null);
                      setCurrentView('repos');
                    }
                  }}
                  className="text-[#94a3b8] hover:text-white flex items-center gap-2 group transition-colors self-start text-sm"
                >
                  <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back
                </button>
                <div className="flex items-center gap-1.5 overflow-x-auto text-[#60a5fa] font-semibold text-lg md:text-xl custom-scrollbar pb-2">
                  <button
                    onClick={() => { setCurrentView('repos'); setSelectedRepo(null); }}
                    className="hover:text-white transition-colors shrink-0"
                  >
                    {selectedRepo.owner.login}
                  </button>
                  <span className="text-[#94a3b8] font-normal mx-0.5 shrink-0">/</span>
                  <button
                    onClick={() => fetchFiles(selectedRepo, '')}
                    className={`transition-colors shrink-0 ${!currentPath ? 'text-white' : 'hover:text-white'}`}
                  >
                    {selectedRepo.name}
                  </button>
                  {currentPath && currentPath.split('/').map((part, index, arr) => {
                    const p = arr.slice(0, index + 1).join('/');
                    return (
                      <React.Fragment key={p}>
                        <span className="text-[#94a3b8] font-normal mx-0.5 shrink-0">/</span>
                        <button
                          onClick={() => fetchFiles(selectedRepo, p)}
                          className={`transition-colors shrink-0 ${index === arr.length - 1 ? 'text-white' : 'hover:text-white'}`}
                        >
                          {part}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col items-end gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="bg-[#1e293b] text-[#94a3b8] px-2.5 py-1 text-xs rounded-full border border-[#1e293b] font-normal hidden sm:inline-block">
                    {selectedRepo.default_branch}
                  </span>
                  <button
                    onClick={() => { setShowClearModal(true); setConfirmClear(false); }}
                    className="text-[#eab308] bg-[#eab308]/10 hover:bg-[#eab308]/20 border border-[#eab308]/30 px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors"
                    title="Remove all files from the Repository"
                  >
                    <Archive size={14} /> Clear
                  </button>
                  <button
                    onClick={() => { setShowDeleteModal(true); setConfirmDelete(false); }}
                    className="text-[#ef4444] bg-[#ef4444]/10 hover:bg-[#ef4444]/20 border border-[#ef4444]/30 px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors"
                    title="Delete Repository"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            </div>

            <div className="flex bg-[#0f172a] border border-[#1e293b] rounded-lg overflow-hidden min-h-[600px] flex-col">
              {activeFile ? (
                <div className="w-full h-full flex flex-col bg-[#020617] flex-1">
                  <div className="p-3 border-b border-[#1e293b] bg-[#0f172a] flex items-center gap-3">
                    <button
                      onClick={() => setActiveFile(null)}
                      className="text-[#94a3b8] hover:text-white p-1 rounded hover:bg-[#1e293b]"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <span className="text-sm font-medium text-[#e2e8f0] truncate">
                      {activeFile.path}
                    </span>
                  </div>
                  <CodeEditor
                    initialContent={activeFile.content}
                    filename={activeFile.path.split('/').pop() || 'file'}
                    onSave={saveFile}
                    onClose={() => setActiveFile(null)}
                  />
                </div>
              ) : (
                <div className="w-full flex-col bg-[#020617] flex-1 flex">
                  <div className="p-3 border-b border-[#1e293b] bg-[#0f172a] flex flex-col gap-3">
                    <div className="flex items-center justify-end gap-4">
                      <div className="relative shrink-0 w-full sm:w-64">
                        <input
                          type="text"
                          placeholder="Filter current directory..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full bg-[#020617] border border-[#1e293b] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#60a5fa] focus:ring-1 focus:ring-[#60a5fa]"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      <button
                        onClick={() => setCreateType('folder')}
                        className="whitespace-nowrap text-xs flex items-center gap-1.5 bg-[#1e293b] border border-[#1e293b] px-3 py-1.5 rounded-md hover:bg-[#1e293b] hover:border-[#94a3b8] text-[#e2e8f0] transition-all"
                      >
                        <FolderGit2 size={14} /> New Folder
                      </button>
                      <button
                        onClick={() => setCreateType('file')}
                        className="whitespace-nowrap text-xs flex items-center gap-1.5 bg-[#1e293b] border border-[#1e293b] px-3 py-1.5 rounded-md hover:bg-[#1e293b] hover:border-[#94a3b8] text-[#e2e8f0] transition-all"
                      >
                        <Plus size={14} /> New File
                      </button>
                      <div className="w-px h-4 bg-[#1e293b] mx-1"></div>
                      <div className="relative">
                        <input
                          type="file"
                          id="file-upload"
                          className="hidden"
                          onChange={handleFileUpload}
                          disabled={uploadLoading}
                        />
                        <label
                          htmlFor="file-upload"
                          className="cursor-pointer whitespace-nowrap text-xs flex items-center gap-1.5 bg-[#1e293b] border border-[#1e293b] px-3 py-1.5 rounded-md hover:bg-[#1e293b] hover:border-[#94a3b8] text-[#e2e8f0] transition-all"
                          title="Upload a single file"
                        >
                          <Upload size={14} /> Upload File
                        </label>
                      </div>
                      <div className="relative">
                        <input
                          type="file"
                          id="directory-upload"
                          className="hidden"
                          {...{ webkitdirectory: '', directory: '' }}
                          multiple
                          onChange={handleDirectoryUpload}
                          disabled={uploadLoading}
                        />
                        <label
                          htmlFor="directory-upload"
                          className="cursor-pointer whitespace-nowrap text-xs flex items-center gap-1.5 bg-[#1e293b] border border-[#1e293b] px-3 py-1.5 rounded-md hover:bg-[#1e293b] hover:border-[#94a3b8] text-[#e2e8f0] transition-all"
                          title="Upload entire directory"
                        >
                          {uploadLoading ? <Upload size={14} className="animate-bounce" /> : <Upload size={14} />} Upload Folder
                        </label>
                      </div>
                      <div className="relative">
                        <input
                          type="file"
                          id="zip-upload"
                          className="hidden"
                          accept=".zip"
                          onChange={handleZipUpload}
                          disabled={uploadLoading}
                        />
                        <label
                          htmlFor="zip-upload"
                          className="cursor-pointer whitespace-nowrap text-xs flex items-center gap-1.5 bg-[#1e293b] border border-[#1e293b] px-3 py-1.5 rounded-md hover:bg-[#1e293b] hover:border-[#94a3b8] text-[#e2e8f0] transition-all"
                          title="Upload and extract ZIP into current folder"
                        >
                          {uploadLoading ? <Upload size={14} className="animate-bounce" /> : <Upload size={14} />} Upload ZIP
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-y-auto flex-1 p-0">
                    {loadingFiles ? (
                      <div className="flex flex-col">
                        {[...Array(5)].map((_, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className="flex items-center gap-3 p-3 border-b border-[#1e293b]"
                          >
                            <div className="w-5 h-5 bg-[#1e293b] rounded shrink-0 overflow-hidden relative">
                              <motion.div className="w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent" animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }} />
                            </div>
                            <div className="h-4 bg-[#1e293b] rounded w-1/3 overflow-hidden relative">
                              <motion.div className="w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent" animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear', delay: 0.2 }} />
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    ) : files.length === 0 ? (
                      <div className="text-sm text-[#94a3b8] p-12 text-center flex flex-col items-center">
                        <FolderGit2 size={32} className="mb-3 text-[#475569]" />
                        <p className="font-medium text-[#e2e8f0]">{!currentPath ? 'Empty repository' : 'Empty directory'}</p>
                        <p className="text-xs text-[#94a3b8] mt-1">{!currentPath ? 'This repository currently has no files. Create a new file or upload one to get started.' : 'There are no files in this directory.'}</p>
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse">
                        <tbody>
                          {displayFiles.map(file => (
                            <tr
                              key={file.path}
                              className="text-sm border-b border-[#1e293b] last:border-0 hover:bg-[#0f172a] group"
                            >
                              <td className="p-3 w-8">
                                {file.type === 'dir' ? (
                                  <Folder size={18} className="text-[#94a3b8] inline-block" />
                                ) : (
                                  <FileIcon size={18} className="text-[#94a3b8] inline-block" />
                                )}
                              </td>
                              <td className="p-3 font-medium cursor-pointer" onClick={() => handleFileClick(file)}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[#e2e8f0] hover:text-[#60a5fa]">{file.name}</span>
                                  {file.isLoading && <span className="text-xs text-[#94a3b8] animate-pulse">Loading...</span>}
                                </div>
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                  {file.type === 'file' && file.download_url && (
                                    <a
                                      href={file.download_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-[#60a5fa] hover:bg-[#60a5fa]/10 px-2 py-1 rounded text-xs border border-transparent hover:border-[#60a5fa]/30 flex items-center gap-1"
                                    >
                                      <Download size={14} /> Download
                                    </a>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRenameTarget(file);
                                      setRenameNewName(file.name);
                                      setRenameModalOpen(true);
                                    }}
                                    className="text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e293b] px-2 py-1 rounded text-xs border border-transparent hover:border-[#334155]"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteFileTarget(file);
                                    }}
                                    className="text-[#ef4444] hover:bg-[#ef4444]/10 px-2 py-1 rounded text-xs border border-transparent hover:border-[#ef4444]/30"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>

      {/* Modals */}

      {/* GitHub OAuth Setup Guide Modal */}
      {showOAuthSetupModal && (
        <Modal title="GitHub OAuth Setup Guide" onClose={() => setShowOAuthSetupModal(false)}>
          <div className="flex flex-col gap-4 text-sm text-[#cbd5e1]">
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              To enable one-click <strong>Continue with GitHub</strong> login on your hosted website, create a GitHub OAuth App and add your credentials as environment variables.
            </p>

            <div className="bg-[#020617] border border-[#1e293b] rounded-lg p-3.5 flex flex-col gap-2.5">
              <div className="font-semibold text-white text-xs uppercase tracking-wider">1. Create a GitHub OAuth App</div>
              <p className="text-xs text-[#94a3b8]">
                Go to{' '}
                <a
                  href="https://github.com/settings/developers"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#60a5fa] hover:underline inline-flex items-center gap-1"
                >
                  GitHub Developer Settings <ExternalLink size={11} />
                </a>{' '}
                → <strong>OAuth Apps</strong> → <strong>New OAuth App</strong>.
              </p>
              <div>
                <label className="block text-[11px] text-[#94a3b8] mb-1">Authorization callback URL:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={callbackUrl}
                    className="flex-1 bg-[#0f172a] border border-[#1e293b] rounded px-2.5 py-1.5 text-xs font-mono text-[#60a5fa] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(callbackUrl);
                      setCallbackCopied(true);
                      setTimeout(() => setCallbackCopied(false), 2000);
                    }}
                    className="bg-[#1e293b] hover:bg-[#334155] text-white px-2.5 py-1.5 rounded text-xs flex items-center gap-1 shrink-0"
                  >
                    {callbackCopied ? <Check size={13} className="text-[#22c55e]" /> : <Copy size={13} />}
                    {callbackCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-[#020617] border border-[#1e293b] rounded-lg p-3.5 flex flex-col gap-2">
              <div className="font-semibold text-white text-xs uppercase tracking-wider">2. Set Environment Variables</div>
              <p className="text-xs text-[#94a3b8]">
                Add these environment variables in your hosting dashboard (Render, Railway, Fly.io, or AI Studio Secrets):
              </p>
              <div className="bg-[#0f172a] border border-[#1e293b] rounded p-2.5 font-mono text-xs text-[#e2e8f0] space-y-1">
                <div><span className="text-[#60a5fa]">GITHUB_CLIENT_ID</span>=your_client_id</div>
                <div><span className="text-[#60a5fa]">GITHUB_CLIENT_SECRET</span>=your_client_secret</div>
                <div><span className="text-[#60a5fa]">APP_URL</span>={window.location.origin}</div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowOAuthSetupModal(false)}
                className="px-4 py-2 rounded-md text-sm font-medium bg-[#2563eb] hover:bg-[#3b82f6] text-white transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete File / Folder Confirmation Modal */}
      {deleteFileTarget && (
        <Modal
          title={deleteFileTarget.type === 'dir' ? 'Delete Folder' : 'Delete File'}
          onClose={() => !deleteFileLoading && setDeleteFileTarget(null)}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[#cbd5e1]">
              Are you sure you want to delete{' '}
              <strong className="text-white">{deleteFileTarget.name}</strong>
              {deleteFileTarget.type === 'dir' ? ' and all of its contents' : ''}? This action will create a new commit on{' '}
              <strong className="text-white">{selectedRepo?.default_branch}</strong>.
            </p>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                type="button"
                disabled={deleteFileLoading}
                onClick={() => setDeleteFileTarget(null)}
                className="px-4 py-2 rounded-md text-sm font-medium text-[#e2e8f0] hover:bg-[#1e293b] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteFileLoading}
                onClick={confirmAndDeleteFile}
                className="px-4 py-2 rounded-md text-sm font-medium bg-[#ef4444] hover:bg-[#dc2626] text-white transition-colors disabled:opacity-50"
              >
                {deleteFileLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create File/Folder Modal */}
      {createType && (
        <Modal title={createType === 'file' ? 'Create new file' : 'Create new folder'} onClose={() => { setCreateType(null); setCreateName(''); setCreateContent(''); }}>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (createType === 'file') handleCreateFile(createName);
            else handleCreateFolder(createName);
          }} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-[#e2e8f0]">
                {createType === 'file' ? 'File name' : 'Folder name'} <span className="text-[#ef4444]">*</span>
              </label>
              <input
                autoFocus
                required
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                className="w-full bg-[#020617] border border-[#1e293b] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#60a5fa] focus:ring-1 focus:ring-[#60a5fa]"
                placeholder={createType === 'file' ? 'e.g., index.ts' : 'e.g., src'}
              />
            </div>

            {createType === 'file' && (
              <div>
                <label className="block text-sm font-medium mb-1.5 text-[#e2e8f0]">
                  Content <span className="text-[#94a3b8] font-normal">(optional)</span>
                </label>
                <textarea
                  value={createContent}
                  onChange={e => setCreateContent(e.target.value)}
                  rows={8}
                  className="w-full bg-[#020617] font-mono text-xs border border-[#1e293b] rounded-md px-3 py-2 text-[#e2e8f0] focus:outline-none focus:border-[#60a5fa] focus:ring-1 focus:ring-[#60a5fa] resize-y custom-scrollbar"
                  placeholder="Enter file content..."
                />
              </div>
            )}

            <div className="flex items-center gap-3 justify-end mt-2">
              <button
                type="button"
                onClick={() => { setCreateType(null); setCreateName(''); setCreateContent(''); }}
                className="px-4 py-2 rounded-md text-sm font-medium text-[#e2e8f0] hover:bg-[#1e293b] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!createName.trim()}
                className="px-4 py-2 rounded-md text-sm font-medium bg-[#2563eb] hover:bg-[#3b82f6] disabled:opacity-50 transition-colors text-white"
              >
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Rename Modal */}
      {renameModalOpen && renameTarget && (
        <Modal title={renameTarget.type === 'dir' ? 'Rename folder' : 'Rename file'} onClose={() => { setRenameModalOpen(false); setRenameTarget(null); }}>
          <form onSubmit={handleRename} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-[#e2e8f0]">New name</label>
              <input
                autoFocus
                required
                value={renameNewName}
                onChange={e => setRenameNewName(e.target.value)}
                className="w-full bg-[#020617] border border-[#1e293b] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#60a5fa] focus:ring-1 focus:ring-[#60a5fa]"
                placeholder="New name..."
              />
              <p className="text-xs text-[#94a3b8] mt-2">Current path: {renameTarget.path}</p>
            </div>
            <div className="flex items-center gap-3 justify-end mt-2">
              <button
                type="button"
                onClick={() => { setRenameModalOpen(false); setRenameTarget(null); }}
                className="px-4 py-2 rounded-md text-sm font-medium text-[#e2e8f0] hover:bg-[#1e293b] transition-colors"
                disabled={renameLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!renameNewName.trim() || renameLoading || renameNewName === renameTarget.name}
                className="px-4 py-2 rounded-md text-sm font-medium bg-[#2563eb] hover:bg-[#3b82f6] disabled:opacity-50 transition-colors text-white flex items-center gap-2"
              >
                {renameLoading ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Upload Results Modal */}
      {showUploadResults && uploadResults && (
        <Modal title="Upload Results" onClose={() => setShowUploadResults(false)}>
          <div className="flex flex-col gap-4 max-h-[60vh]">
            <div className={`p-4 rounded-md text-sm border font-medium ${uploadResults.errors.length > 0 ? (uploadResults.success === 0 ? 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444]' : 'bg-[#eab308]/10 border-[#eab308]/30 text-[#eab308]') : 'bg-[#22c55e]/10 border-[#22c55e]/30 text-[#22c55e]'}`}>
              Successfully committed {uploadResults.success} out of {uploadResults.total} files.
            </div>

            {uploadResults.errors.length > 0 && (
              <div className="flex flex-col border border-[#1e293b] rounded-md overflow-hidden bg-[#020617]">
                <div className="bg-[#0f172a] px-3 py-2 border-b border-[#1e293b] text-xs font-semibold text-[#e2e8f0] uppercase tracking-wider">Failed Uploads</div>
                <div className="overflow-y-auto max-h-64 p-0">
                  {uploadResults.errors.map((err, idx) => (
                    <div key={idx} className="flex flex-col gap-1 px-3 py-2 border-b border-[#1e293b] last:border-b-0">
                      <span className="text-sm font-medium text-[#ef4444] truncate" title={err.file}>{err.file}</span>
                      <span className="text-xs text-[#94a3b8]">{err.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowUploadResults(false)}
                className="px-4 py-2 rounded-md text-sm font-medium text-white bg-[#1e293b] hover:bg-[#334155] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showClearModal && selectedRepo && (
        <Modal title="Clear repository" onClose={() => setShowClearModal(false)}>
          <div className="flex flex-col gap-4">
            <div className="bg-[#eab308]/10 border border-[#eab308]/30 text-[#eab308] p-4 rounded-md text-sm">
              <p className="font-semibold mb-1">Warning: Destructive action</p>
              <p>This will permanently remove all files and folders in the <strong>{selectedRepo.full_name}</strong> repository on the <strong>{selectedRepo.default_branch}</strong> branch using a new commit.</p>
            </div>

            <label className="flex items-center gap-2 text-sm text-[#e2e8f0] cursor-pointer mt-2 w-max transition-opacity hover:opacity-80">
              <input
                type="checkbox"
                checked={confirmClear}
                onChange={(e) => setConfirmClear(e.target.checked)}
                className="w-4 h-4 rounded border-[#1e293b] bg-[#020617] text-[#eab308] focus:ring-[#eab308] focus:ring-offset-[#0f172a] accent-[#eab308]"
              />
              I have read and understood the terms
            </label>

            <div className="flex items-center gap-3 justify-end mt-4">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 rounded-md text-sm font-medium text-[#c9d1d9] hover:bg-[#1e293b] transition-colors bg-[#0f172a] border border-[#1e293b]"
                disabled={clearLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleClearRepo}
                disabled={clearLoading || !confirmClear}
                className="px-4 py-2 rounded-md text-sm font-medium bg-[#eab308]/10 hover:bg-[#eab308]/20 border border-[#eab308]/30 text-[#eab308] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {clearLoading ? 'Clearing...' : 'Clear this repository'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showDeleteModal && selectedRepo && (
        <Modal title="Delete repository" onClose={() => setShowDeleteModal(false)}>
          <div className="flex flex-col gap-4">
            <div className="bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] p-4 rounded-md text-sm">
              <p className="font-semibold mb-1">Unexpected bad things will happen if you don't read this!</p>
              <p>This action cannot be undone. This will permanently delete the <strong>{selectedRepo.full_name}</strong> repository, wiki, issues, comments, packages, secrets, workflow runs, and remove all collaborator associations.</p>
            </div>

            <label className="flex items-center gap-2 text-sm text-[#e2e8f0] cursor-pointer mt-2 w-max transition-opacity hover:opacity-80">
              <input
                type="checkbox"
                checked={confirmDelete}
                onChange={(e) => setConfirmDelete(e.target.checked)}
                className="w-4 h-4 rounded border-[#1e293b] bg-[#020617] text-[#ef4444] focus:ring-[#ef4444] focus:ring-offset-[#0f172a] accent-[#ef4444]"
              />
              I have read and understood the terms
            </label>

            <div className="flex items-center gap-3 justify-end mt-4">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-md text-sm font-medium text-[#c9d1d9] hover:bg-[#1e293b] transition-colors bg-[#0f172a] border border-[#1e293b]"
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteRepo}
                disabled={deleteLoading || !confirmDelete}
                className="px-4 py-2 rounded-md text-sm font-medium bg-[#ef4444]/10 hover:bg-[#ef4444]/20 border border-[#ef4444]/30 text-[#ef4444] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {deleteLoading ? 'Deleting...' : 'Delete this repository'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Toast Notifications */}
      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
