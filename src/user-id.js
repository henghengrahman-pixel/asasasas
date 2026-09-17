// Deterministic User ID parser used by claim/operational workflows.
// Current-message extraction must take priority over old conversation history.
export function extractUserIdFromText(value=''){
  const raw=String(value||'').trim();
  if(!raw) return '';
  const pats=[
    /\b(?:user\s*id|userid|username)\s*[:=\-]?\s*([a-z0-9][a-z0-9_.-]{2,39})\b/i,
    // Accept common CS/member variants: `ID Syafri01`, `ID, Syafri01`, `ID: Syafri01`,
    // `ID. Syafri01`, and compact `IDSyafri01` replies after a prompt.
    /\bid(?:\s*(?:saya|akun|nya)|\s+nya)?\s*[,.:=\-]?\s*([a-z0-9][a-z0-9_.-]{2,39})\b/i,
    /\bid([a-z][a-z0-9_.-]{2,39})\b/i,
    /\b([a-z0-9][a-z0-9_.-]{2,39})\s+(?:adalah\s+)?id(?:\s*(?:saya|akun|nya)|\s+nya)?\b/i
  ];
  const blocked=new Set(['akun','saya','nya','bonus','harian','claim','klaim','deposit','withdraw','password','bos','bosku']);
  for(const re of pats){
    const m=raw.match(re);
    const candidate=String(m?.[1]||'').trim();
    if(!candidate || blocked.has(candidate.toLowerCase())) continue;
    return candidate;
  }
  return '';
}


// Context-aware parser used ONLY when the workflow has explicitly asked the member
// for an account/member ID. Members often answer naturally, e.g.:
//   "Bonus deposit Watini01", "WD rusli93", "member BASRET"
// instead of writing "ID: Watini01". Keep this separate from the generic parser so
// ordinary conversation text is never treated as an ID unless the state machine is
// actually waiting for one.
export function extractRequestedUserIdFromText(value=''){
  const raw=String(value||'').trim();
  if(!raw) return '';
  const explicit=extractUserIdFromText(raw);
  if(explicit) return explicit;

  const blocked=new Set([
    'id','userid','user','member','akun','account','saya','aku','kami','nya','punya',
    'bonus','claim','clim','klaim','deposit','depo','dp','withdraw','wd','penarikan',
    'harian','mingguan','bulanan','slot','slotgames','live','game','games','livegame','livegames',
    'cashback','rollingan','ronda','freebet','reload','promo','event','new','baru',
    'ya','iya','yah','bos','boss','bosku','kak','min','admin','tolong','mohon','dong',
    'mau','ingin','minta','bisa','boleh','cek','check','proses','diproses','status',
    'sudah','udah','udh','belum','blm','blom','tidak','tdk','gak','ga','gk','nggak','masuk','msk','cair','pending','lama','msh',
    'ini','itu','yang','dan','atau','dari','untuk','ke','di','pada','dengan','sebagai',
    'rekening','rek','bank','dana','bca','bri','bni','mandiri','seabank','ovo','gopay',
    'atas','nama','nomor','no','nominal','bukti','transfer','tf','password','pass','psw',
    'reset','link','akses','daftar','gangguan','macet','limit','limid','kalah','rungkad'
  ]);

  const tokens=raw.match(/[A-Za-z0-9][A-Za-z0-9_.-]{2,39}/g)||[];
  const candidates=tokens.filter(token=>{
    const low=token.toLowerCase();
    if(blocked.has(low)) return false;
    if(/^https?$/i.test(token) || /^(?:www|com|net|org)$/i.test(token)) return false;
    if(/^\d+$/.test(token)) return false; // nominal/phone/account number, not member ID
    if(token.includes('.') && /^[a-z]+\.(?:com|net|org|id)$/i.test(token)) return false;
    return true;
  });

  if(candidates.length===1) return candidates[0];
  if(!candidates.length) return '';

  // With more than one unknown token, only auto-pick a strongly ID-looking token.
  // This prevents free-form sentences from silently filling the wrong account ID.
  const scored=candidates.map((token,index)=>{
    let score=0;
    if(/[A-Za-z]/.test(token) && /\d/.test(token)) score+=6;
    if(/^[A-Z0-9_.-]{4,40}$/.test(token) && /[A-Z]/.test(token)) score+=4;
    if(/[A-Z]/.test(token.slice(1)) && /[a-z]/.test(token)) score+=2;
    if(token.length>=4 && token.length<=20) score+=1;
    return {token,score,index};
  }).sort((a,b)=>b.score-a.score || b.index-a.index);
  if(scored[0].score>=4 && scored[0].score>scored[1].score) return scored[0].token;
  return '';
}
