const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const root = path.resolve(process.cwd());
const roots = [path.join(root,'src'), path.join(root,'server')];
const files=[];
function walk(dir){ for(const ent of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,ent.name); if(ent.isDirectory()) walk(p); else if(/\.(ts|tsx)$/.test(ent.name)) files.push(p); }}
roots.forEach(walk);
let errors=0;
for(const file of files){
  const text=fs.readFileSync(file,'utf8');
  const kind=file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,kind);
  const ds=sf.parseDiagnostics || [];
  if(ds.length){ errors+=ds.length; console.error(file, ds.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join(' | ')); }
}
console.log(`Performance audit TypeScript syntax: ${files.length} files, ${errors} diagnostics`); process.exit(errors?1:0);
