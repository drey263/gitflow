import fs from 'fs';
import path from 'path';

const replacements = {
  '#0d1117': '#020617', // slate-950
  '#161b22': '#0f172a', // slate-900
  '#30363d': '#1e293b', // slate-800
  '#8b949e': '#94a3b8', // slate-400
  '#c9d1d9': '#e2e8f0', // slate-200
  '#58a6ff': '#60a5fa', // blue-400
  '#1f6feb': '#2563eb', // blue-600
  '#da3633': '#ef4444', // red-500
  '#21262d': '#1e293b', // slate-800
  '#238636': '#2563eb', // blue-600
  '#2ea043': '#3b82f6', // blue-500
};

function processDir(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      for (const [key, value] of Object.entries(replacements)) {
         content = content.replace(new RegExp(key, 'g'), value);
      }
      fs.writeFileSync(fullPath, content);
    }
  }
}

processDir(path.join(process.cwd(), 'src'));
console.log('Colors replaced');
