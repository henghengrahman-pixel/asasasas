import { normalizeText } from './normalizer.js';

export const IMPORTANT_TYPES = ['PROMO','LINK','RTP','PREDIKSI_TOGEL','REKENING','INFO_PENTING'];

export function normalizeImportantType(v='INFO_PENTING'){
  const t=String(v||'INFO_PENTING').trim().toUpperCase().replace(/[\s-]+/g,'_');
  return IMPORTANT_TYPES.includes(t)?t:'INFO_PENTING';
}

export function importantSearchScore(item={}, query=''){
  const q=normalizeText(query);
  if(!q) return 0;
  const aliases=Array.isArray(item.aliases)?item.aliases:[];
  const hay=normalizeText([item.item_type,item.item_key,item.title,item.content,...aliases].filter(Boolean).join(' '));
  let score=0;
  for(const token of q.split(' ').filter(x=>x.length>=2)) if(hay.includes(token)) score+=1;
  if(normalizeText(item.title||'') && q.includes(normalizeText(item.title||''))) score+=8;
  for(const a of aliases){const n=normalizeText(a);if(n && q.includes(n))score+=6;}
  if(String(item.item_key||'') && q.includes(normalizeText(item.item_key))) score+=5;
  return score;
}

export function formatImportantForAI(items=[]){
  return items.map(x=>{
    const meta=x.meta&&typeof x.meta==='object'?x.meta:{};
    const metaText=Object.entries(meta).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>`${k}=${Array.isArray(v)?v.join(', '):String(v)}`).join(' | ');
    return `[MENU PENTING:${x.item_type}] ${x.title} | KEY=${x.item_key||'-'}${metaText?` | ${metaText}`:''}\n${x.content}`;
  }).join('\n\n');
}

export function isImportantInfoQuestion(text=''){
  const n=normalizeText(text);
  if(!n)return false;
  return /(link|akses|alamat web|website|situs|rtp|prediksi togel|prediksi|angka togel|rekening|nomor rekening|no rekening|wallet|promo|event|bonus)/i.test(n);
}
