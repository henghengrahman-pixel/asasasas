import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root=process.cwd();
const roots=['src','public','tests','scripts'];
const files=[];

function walk(dir){
  if(!fs.existsSync(dir)) return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(full);
    else if(entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    else if(entry.isFile() && entry.name.endsWith('.mjs')) files.push(full);
  }
}

for(const r of roots) walk(path.join(root,r));
files.sort();

const failed=[];
for(const file of files){
  const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(r.status!==0) failed.push({file:path.relative(root,file),error:(r.stderr||r.stdout||'').trim()});
}

if(failed.length){
  for(const f of failed){
    console.error(`SYNTAX_FAIL ${f.file}`);
    console.error(f.error);
  }
  process.exit(1);
}
console.log(`Syntax OK: ${files.length} JS/MJS files`);
