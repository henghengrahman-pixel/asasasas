export function sanitizeCorrection(text=''){
  return String(text||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').trim().slice(0,1600);
}
export function learningLabel(item={}){
  const src=String(item.source_type||'HUMAN_CHAT').toUpperCase();
  return src==='AI_FEEDBACK'?'Teguran AI':'Chat CS';
}


export function isSafeHistoryExample(text=''){
  const v=String(text||'').trim();
  if(v.length<3 || v.length>500) return false;
  if(/(?:password|psw|user\s*id|userid|username|rekening|no\.?\s*rek|nomor\s*rek|https?:\/\/|deposit\s+(?:sudah|telah)|withdraw\s+(?:sudah|telah)|bonus\s+(?:sudah|telah))/i.test(v)) return false;
  if(/\b\d{6,}\b/.test(v)) return false;
  return true;
}

export function learningSignature(text=''){
  return String(text||'').toLowerCase().normalize('NFKD')
    .replace(/https?:\/\/\S+/g,' <url> ')
    .replace(/\b\d{5,}\b/g,' <num> ')
    .replace(/[^a-z0-9<>]+/g,' ')
    .replace(/\b(?:bosku|bos|ya|yah|oke|ok|siap|mohon|silakan|dong|nih|deh)\b/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,240);
}
