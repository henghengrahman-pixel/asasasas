import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const notes=[];

function walk(dir,exts=null){
  const out=[];
  if(!fs.existsSync(dir)) return out;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...walk(full,exts));
    else if(entry.isFile() && (!exts || exts.some(x=>entry.name.endsWith(x)))) out.push(full);
  }
  return out;
}
function rel(p){return path.relative(root,p).replaceAll('\\','/');}
function fail(msg){failures.push(msg);}

for(const required of ['package.json','Dockerfile','railway.toml','.env.example','src/server.js','src/engine.js','src/livechat.js','src/db.js','public/index.html','public/app.js']){
  if(!fs.existsSync(path.join(root,required))) fail(`Missing required file: ${required}`);
}

const js=[...walk(path.join(root,'src'),['.js']),...walk(path.join(root,'public'),['.js'])];

// Local import existence + named export consistency.
const exportMap=new Map();
for(const file of js){
  const src=fs.readFileSync(file,'utf8');
  const names=new Set();
  for(const m of src.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for(const m of src.matchAll(/\bexport\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for(const m of src.matchAll(/\bexport\s*\{([^}]+)\}/gs)){
    for(const raw of m[1].split(',')){
      const part=raw.trim();
      if(!part) continue;
      const pieces=part.split(/\s+as\s+/);
      names.add((pieces[1]||pieces[0]).trim());
    }
  }
  exportMap.set(path.resolve(file),names);
}
for(const file of js){
  const src=fs.readFileSync(file,'utf8');
  for(const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/gs)){
    const base=path.resolve(path.dirname(file),m[2]);
    const target=fs.existsSync(base)?base:(fs.existsSync(base+'.js')?base+'.js':null);
    if(!target){fail(`Missing local import target: ${rel(file)} -> ${m[2]}`);continue;}
    const available=exportMap.get(path.resolve(target))||new Set();
    for(const raw of m[1].split(',')){
      const imported=raw.trim().split(/\s+as\s+/)[0]?.trim();
      if(imported && !available.has(imported)) fail(`Missing named export ${imported}: ${rel(file)} -> ${rel(target)}`);
    }
  }
  for(const m of src.matchAll(/(?:from\s+|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)){
    const base=path.resolve(path.dirname(file),m[1]);
    if(![base,base+'.js',base+'.json',path.join(base,'index.js')].some(fs.existsSync)) fail(`Missing local import: ${rel(file)} -> ${m[1]}`);
  }
}

// ENV documentation parity.
const envUsed=new Set();
for(const file of js){
  const src=fs.readFileSync(file,'utf8');
  for(const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) envUsed.add(m[1]);
  for(const m of src.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) envUsed.add(m[1]);
}
const envDoc=new Set();
for(const line of fs.readFileSync(path.join(root,'.env.example'),'utf8').split(/\r?\n/)){
  if(/^\s*#/.test(line)||!line.includes('=')) continue;
  const k=line.split('=',1)[0].trim();
  if(/^[A-Z0-9_]+$/.test(k)) envDoc.add(k);
}
for(const k of envUsed) if(!envDoc.has(k)) fail(`ENV undocumented: ${k}`);
for(const k of envDoc) if(!envUsed.has(k)) notes.push(`ENV documented but not referenced directly: ${k}`);

// Duplicate Express routes.
const server=fs.readFileSync(path.join(root,'src/server.js'),'utf8');
const seen=new Map();
for(const m of server.matchAll(/app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)/g)){
  const key=`${m[1].toUpperCase()} ${m[2]}`;
  seen.set(key,(seen.get(key)||0)+1);
}
for(const [key,count] of seen) if(count>1) fail(`Duplicate route ${key} x${count}`);

// Telegram callback code -> engine handler coverage.
const hb=fs.readFileSync(path.join(root,'src/human-bridge.js'),'utf8');
const engine=fs.readFileSync(path.join(root,'src/engine.js'),'utf8');
const callbackCodes=new Set([...hb.matchAll(/callback_data:d\('([A-Z0-9_]+)'\)/g)].map(m=>m[1]));
for(const code of callbackCodes) if(!engine.includes(code)) fail(`Telegram callback has no engine handler token: ${code}`);

// Ensure production basics.
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.engines?.node!==' >=20' && pkg.engines?.node!=='>=20') notes.push(`Node engine is ${pkg.engines?.node||'unset'}`);
if(pkg.dependencies?.express!=='5.1.0') fail(`express must stay pinned to 5.1.0`);
if(pkg.dependencies?.pg!=='8.16.3') fail(`pg must stay pinned to 8.16.3`);

// package-lock must contain the full dependency inventory required by npm ci.
const lockPath=path.join(root,'package-lock.json');
if(!fs.existsSync(lockPath)) fail('Missing package-lock.json');
else {
  try {
    const lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));
    if(lock.lockfileVersion!==3) fail(`package-lock lockfileVersion must be 3, got ${lock.lockfileVersion}`);
    const rootPkg=lock.packages?.['']||{};
    for(const [name,version] of Object.entries(pkg.dependencies||{})){
      if(rootPkg.dependencies?.[name]!==version) fail(`package-lock root dependency mismatch: ${name}@${version}`);
      const entry=lock.packages?.[`node_modules/${name}`];
      if(!entry) fail(`package-lock missing node_modules/${name}`);
      else if(entry.version!==version) fail(`package-lock version mismatch: ${name} expected ${version}, got ${entry.version}`);
    }
    const packageEntries=Object.keys(lock.packages||{}).filter(k=>k.startsWith('node_modules/'));
    if(packageEntries.length<20) fail(`package-lock dependency inventory is suspiciously incomplete (${packageEntries.length} package entries)`);
  } catch(err) {
    fail(`Invalid package-lock.json: ${err.message}`);
  }
}

if(failures.length){
  console.error(`Release audit FAILED (${failures.length})`);
  for(const x of failures) console.error(`- ${x}`);
  process.exit(1);
}
console.log(`Release audit OK`);
console.log(`Runtime JS files: ${js.length}`);
console.log(`ENV parity: ${envUsed.size}/${envDoc.size}`);
console.log(`Telegram callback handlers: ${callbackCodes.size}/${callbackCodes.size}`);
if(notes.length) for(const x of notes) console.log(`NOTE: ${x}`);
