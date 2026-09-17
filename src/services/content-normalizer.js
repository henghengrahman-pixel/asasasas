import crypto from 'node:crypto';

export function normalizeTextValue(value=''){
  return String(value??'').normalize('NFKC').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
export function stableJson(value){
  if(Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function contentFingerprint(collection, record={}){
  const pick={...record};
  for(const key of ['id','created_at','updated_at','content_hash','version']) delete pick[key];
  for(const [k,v] of Object.entries(pick)) if(typeof v==='string') pick[k]=normalizeTextValue(v).toLowerCase();
  return crypto.createHash('sha256').update(`${collection}\n${stableJson(pick)}`).digest('hex');
}
