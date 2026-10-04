import React, { useState, useEffect } from 'react';
import { Maximize2, Minimize2, Save, X } from 'lucide-react';
import Editor from '@monaco-editor/react';

interface CodeEditorProps {
  initialContent: string;
  filename: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

export function CodeEditor({ initialContent, filename, onSave, onClose }: CodeEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync content when initialContent changes
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(content);
    } finally {
      setSaving(false);
    }
  };

  const containerClasses = isFullscreen 
    ? "fixed inset-0 z-50 bg-[#020617] flex flex-col" 
    : "flex flex-col h-[600px] border border-[#1e293b] rounded-md overflow-hidden bg-[#020617] mt-4 w-full";

  // Try to determine language based on extension
  const getLanguage = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'jsx': return 'javascript';
      case 'ts':
      case 'tsx': return 'typescript';
      case 'json': return 'json';
      case 'html': return 'html';
      case 'css': return 'css';
      case 'md': return 'markdown';
      case 'py': return 'python';
      case 'go': return 'go';
      case 'rs': return 'rust';
      case 'java': return 'java';
      case 'c': return 'c';
      case 'cpp': return 'cpp';
      default: return 'plaintext';
    }
  };

  return (
    <div className={containerClasses}>
      <div className="flex items-center justify-between px-4 py-2 bg-[#0f172a] border-b border-[#1e293b] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#e2e8f0]">{filename}</span>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleSave}
            disabled={saving || content === initialContent}
            className="flex items-center gap-1.5 px-3 py-1 text-sm font-medium text-white bg-[#2563eb] rounded-md hover:bg-[#3b82f6] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button 
            onClick={() => setIsFullscreen(!isFullscreen)} 
            className="p-1.5 text-[#94a3b8] hover:text-[#e2e8f0] rounded hover:bg-[#1e293b]"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          {!isFullscreen && (
            <button 
              onClick={onClose} 
              className="p-1.5 text-[#94a3b8] hover:text-[#e2e8f0] rounded hover:bg-[#1e293b]"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 w-full relative">
        <Editor
          height="100%"
          language={getLanguage(filename)}
          theme="vs-dark"
          value={content}
          onChange={(val) => setContent(val || '')}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            padding: { top: 16 }
          }}
        />
      </div>
    </div>
  );
}
