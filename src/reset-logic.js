import { normalizeText } from './normalizer.js';

function customerTexts(rows){ return rows.filter(x=>x.sender_type==='customer').map(x=>String(x.text||'').trim()).filter(Boolean); }
function extractAccountData(rows){
  const text=customerTexts(rows).join('\n');
  const lower=text.toLowerCase();
  const types=['seabank','bca','bri','bni','mandiri','cimb','jago','dana','ovo','gopay','linkaja','shopeepay','bank'];
  const type=types.find(x=>new RegExp(`(^|[^a-z0-9])${x.replace(/\s+/g,'\\s*')}([^a-z0-9]|$)`,'i').test(lower))||'';
  const noRaw=(text.match(/(?:no\.?\s*(?:rek(?:ening)?|rekening|akun)|nomor\s*(?:rek(?:ening)?|rekening|akun))\s*[:=]?\s*((?:\d[\s.\-]?){6,22})/i)||text.match(/\b((?:\d[\s.\-]?){8,22})\b/))?.[1]||'';
  const no=String(noRaw).replace(/[^0-9]/g,'').slice(0,22);
  let name=(text.match(/(?:nama\s*(?:rek(?:ening)?|rekening)?|atas\s*nama|atasnama|\ba\.?\s*n\.?\b)\s*[:=]?\s*([a-z][a-z .'-]{2,60})/i))?.[1]?.trim()||'';

  if(!name && no){
    const lines=customerTexts(rows).slice(-4).reverse();
    for(const line of lines){
      if(!line.replace(/[^0-9]/g,'').includes(no)) continue;
      let rest=line
        .replace(new RegExp(no.split('').join('[\\s.\\-]*'),'g'),' ')
        .replace(/\b(?:seabank|bca|bri|bni|mandiri|cimb|jago|dana|ovo|gopay|linkaja|shopeepay|bank|e\s*-?\s*wallet|ewallet)\b/ig,' ')
        .replace(/\b(?:no|nomor|rek|rekening|akun|nama|atas|a\/?n|bos|bosku|kak|min|admin|tolong|bantu|lupa|password|sandi|reset)\b/ig,' ')
        .replace(/[^a-zA-Z .'-]/g,' ')
        .replace(/\s+/g,' ')
        .trim();
      if(/^[a-zA-Z][a-zA-Z .'-]{2,60}$/.test(rest)){ name=rest; break; }
    }
  }
  return {type,name,no};
}
function simpleCustomerValue(text=''){
  return String(text||'').trim().replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g,'');
}
export function inferResetAccountData(rows, previous={}){
  const parsed=extractAccountData(rows);
  const data={type:parsed.type||previous.type||'',name:parsed.name||previous.name||'',no:parsed.no||previous.no||''};
  const last=rows.filter(x=>x.sender_type==='customer').slice(-1)[0];
  const raw=simpleCustomerValue(last?.text||'');
  const low=raw.toLowerCase();
  const typeWords=['seabank','bca','bri','bni','mandiri','cimb','jago','dana','ovo','gopay','linkaja','shopeepay'];
  const exactType=typeWords.find(x=>low===x || low.includes(` ${x}`) || low.startsWith(`${x} `) || low.startsWith(`${x}:`));
  if(!data.type && exactType) data.type=exactType;
  const digitsRaw=(raw.match(/\b(?:\d[\s.\-]?){6,22}\b/)||[])[0]||'';
  const digits=String(digitsRaw).replace(/[^0-9]/g,'').slice(0,22);
  if(!data.no && digits.length>=6) data.no=digits;
  if(!data.name && raw && !digits && !exactType && /^[a-zA-Z][a-zA-Z .'-]{2,60}$/.test(raw) && !/(lupa|password|sandi|reset|rekening|bank|wallet|akun|user|id)/i.test(raw)) data.name=raw;
  return data;
}
export function resetMissing(data={}){
  // Reset-password verification only requires the registered account/wallet number
  // and account holder name. Bank/e-wallet type is optional context, never a blocker.
  const out=[];
  if(!String(data.no||'').trim()) out.push('no');
  if(!String(data.name||'').trim()) out.push('name');
  return out;
}
export function resetAskFor(field, missing=[]){
  const m=Array.isArray(missing)?missing:[];
  if(m.includes('no') && m.includes('name')) return 'Bisa dibantu nomor REKENING / E-Wallet beserta atas nama rekeningnya bosku? 😊';
  if(field==='name') return 'Boleh dibantu atas nama rekeningnya juga bosku? 😊';
  return 'Boleh dibantu nomor REKENING / E-Wallet yang terdaftar ya bosku? 😊';
}
export function isDepositConfirmedText(text=''){
  const n=normalizeText(text);
  if(n.includes('belum')) return false;
  return (n.includes('sudah')||n.includes('udah')) && (n.includes('deposit')||n.includes('depo'));
}
