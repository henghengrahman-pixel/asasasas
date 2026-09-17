import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);const dir=path.join(root,'public/assets/css');
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.css')).sort();const owners=new Map();
function selectors(css){
  const clean=css.replace(/\/\*[\s\S]*?\*\//g,'');const out=[];const re=/([^{}]+)\{/g;let m;
  const splitTopLevel=head=>{const parts=[];let cur='',depth=0;for(const ch of head){if(ch==='('||ch==='[')depth++;if(ch===')'||ch===']')depth=Math.max(0,depth-1);if(ch===','&&depth===0){if(cur.trim())parts.push(cur.trim());cur='';continue}cur+=ch}if(cur.trim())parts.push(cur.trim());return parts};
  while((m=re.exec(clean))){const head=m[1].trim();if(!head||head.startsWith('@'))continue;for(const s of splitTopLevel(head))out.push(s)}return out
}
for(const file of files){for(const selector of new Set(selectors(fs.readFileSync(path.join(dir,file),'utf8')))){if(!owners.has(selector))owners.set(selector,[]);owners.get(selector).push(file)}}
const allowedResponsive=new Set(['.app-shell','.app-shell.sidebar-compact','.brand-copy','.nav-caption','.nav .label','.sidebar-foot span:not(.status-dot)','.sidebar-collapse','.brand','.nav a','.grid.cards','.sidebar','.sidebar.open','.mobile-menu','.sidebar-backdrop.open','.topbar','.topbar-sub','.user-chip','.system-chip span','.topbar-right #logoutBtn','.system-chip','.page','.page-head','.page-head .toolbar','.split-2','.split-3','.form-grid','.brand .sidebar-collapse']);
const duplicates=[...owners].filter(([,v])=>v.length>1).map(([selector,files])=>({selector,files,classification:files.includes('responsive.css')&&allowedResponsive.has(selector)?'A. INTENTIONAL RESPONSIVE OVERRIDE':'B. REVIEW/ACCIDENTAL DUPLICATE'}));
const report=['# CSS DUPLICATE AUDIT','','Generated from `public/assets/css/*.css`.','',...duplicates.flatMap(d=>[`## ${d.selector}`,`- FILES: ${d.files.join(', ')}`,`- CLASSIFICATION: ${d.classification}`,''])];
if(!duplicates.length)report.push('No cross-file duplicate selectors detected.');fs.writeFileSync(path.join(root,'CSS_DUPLICATE_AUDIT.md'),report.join('\n')+'\n');
const bad=duplicates.filter(d=>d.classification.startsWith('B.'));console.log(JSON.stringify({files:files.length,selectors:owners.size,duplicates:duplicates.length,accidental:bad.length},null,2));if(bad.length)process.exitCode=2;
