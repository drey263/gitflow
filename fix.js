import fs from 'fs';

function fixFile(file) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/\\`/g, '`');
  content = content.replace(/\\\$/g, '$');
  fs.writeFileSync(file, content);
}

['src/components/ui.tsx', 'src/App.tsx', 'server.ts'].forEach(fixFile);
console.log('Fixed!\\n');
