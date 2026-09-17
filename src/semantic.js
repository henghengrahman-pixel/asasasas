const ALIASES = new Map(Object.entries({
  dp:'deposit',depo:'deposit',deposit:'deposit',wd:'withdraw',withdrawal:'withdraw',tarik:'withdraw',
  blm:'belum',blom:'belum',belom:'belum',udh:'sudah',udah:'sudah',sdh:'sudah',
  msk:'masuk',masuk:'masuk',tf:'transfer',trf:'transfer',bukti:'bukti',ss:'screenshot',
  psw:'password',pass:'password',pwd:'password',userid:'user_id',username:'user_id',id:'id',
  rek:'rekening',rekening:'rekening',gnti:'ganti',ganti:'ganti',bonus:'bonus',bnus:'bonus',
  klaim:'claim',claim:'claim',gk:'tidak',ga:'tidak',nggak:'tidak',ngga:'tidak',tdk:'tidak',
  error:'error',eror:'error',err:'error',login:'login',link:'link',game:'game'
}));

function clean(s=''){
  return String(s||'').toLowerCase().normalize('NFKD')
    .replace(/https?:\/\/\S+/g,' <url> ')
    .replace(/\b\d{6,}\b/g,' <num> ')
    .replace(/[^a-z0-9_<>]+/g,' ')
    .replace(/\s+/g,' ').trim();
}
export function semanticNormalize(s=''){
  const parts=clean(s).split(' ').filter(Boolean).map(x=>ALIASES.get(x)||x);
  return parts.join(' ');
}
function tokenSet(s){ return new Set(semanticNormalize(s).split(' ').filter(x=>x.length>1)); }
function ngrams(s,n=3){
  const x=` ${semanticNormalize(s)} `; const out=new Set();
  for(let i=0;i<=x.length-n;i++) out.add(x.slice(i,i+n));
  return out;
}
function jaccard(A,B){ if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/(A.size+B.size-hit); }
function tokenCoverage(a,b){const A=tokenSet(a),B=tokenSet(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.min(A.size,B.size);}
export function semanticScore(query,candidate){
  const q=semanticNormalize(query), c=semanticNormalize(candidate); if(!q||!c)return 0;
  if(q===c)return 1;
  const tok=tokenCoverage(q,c), tri=jaccard(ngrams(q),ngrams(c));
  const containment=(c.includes(q)||q.includes(c))?0.15:0;
  return Math.min(1,(tok*0.62)+(tri*0.28)+containment);
}
export function rankSemantic(rows=[],query='',textOf=x=>String(x||''),limit=8,minScore=.18){
  return rows.map(x=>({x,semantic_score:semanticScore(query,textOf(x))}))
    .filter(z=>z.semantic_score>=minScore)
    .sort((a,b)=>b.semantic_score-a.semantic_score)
    .slice(0,Math.max(1,limit));
}
