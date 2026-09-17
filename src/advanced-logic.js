const clean=v=>String(v||'').toLowerCase();

export function detectMultiIntents(text=''){
  const t=clean(text); const out=[];
  const add=x=>{if(!out.includes(x))out.push(x)};
  if(/\b(?:depo|deposit|dpo|tf|transfer)\b/.test(t) && /belum|tidak|pending|masuk|cek|bukti|saldo/.test(t)) add('DEPOSIT_PROBLEM');
  if(/\b(?:wd|withdraw|penarikan)\b/.test(t) && /belum|tidak|pending|proses|masuk|cek|status/.test(t)) add('WITHDRAW_PROBLEM');
  if(/lupa\s*(?:password|psw|sandi)|reset\s*(?:password|psw)|password.*lupa/.test(t)) add('FORGOT_PASSWORD');
  if(/\bbonus\b|free\s*bet|cashback|rollingan/.test(t)) add('BONUS_REQUEST');
  if(/ganti|ubah/.test(t) && /rekening|bank|dana|ewallet|e-wallet/.test(t)) add('ACCOUNT_CHANGE_REQUEST');
  if(/tidak\s*bisa\s*login|gagal\s*login|login.*(?:error|gagal|masalah)/.test(t)) add('LOGIN_PROBLEM');
  if(/(?:kemenangan|menang|payout|jackpot|\bjp\b).*(?:belum|tidak).*(?:dibayar|masuk|cair)|(?:belum|tidak).*(?:dibayar|masuk|cair).*(?:kemenangan|payout|jackpot|\bjp\b)/.test(t)) add('PAYOUT_NOT_RECEIVED');
  if(/(?:rekening|bank|dana|ewallet|e-wallet).*(?:limit|limited|limid)|(?:limit|limited|limid).*(?:rekening|bank|dana|ewallet|e-wallet)/.test(t)) add('BANK_ACCOUNT_LIMIT');
  if(/(?:daftar|register|registrasi|buat akun).*(?:gagal|tidak bisa|error|mentok|macet)/.test(t)) add('REGISTER_PROBLEM');
  if(/(?:link|website|situs|web).*(?:tidak bisa|gagal|error|down|blank|akses)/.test(t)) add('LINK_PROBLEM');
  if(/(?:game|permainan).*(?:macet|hang|error|keluar sendiri|blank|tidak bisa)/.test(t)) add('GAME_PROBLEM');
  if(/\b(?:kalah|rungkad|rugi|boncos)\b/.test(t)) add('LOSS_COMPLAINT');
  return out;
}

export function detectPromptInjection(text=''){
  const t=clean(text);
  return /(?:abaikan|ignore|lupakan).{0,30}(?:instruksi|aturan|prompt|system)|(?:system|developer)\s*(?:prompt|message)|jangan\s+ikuti\s+aturan|bocorkan\s+(?:prompt|token|api|password)/i.test(t);
}

export function extractConversationFacts(text=''){
  const raw=String(text||''); const facts=[];
  const amount=raw.match(/(?:\b(?:nominal|depo|deposit|transfer)\b[^0-9]{0,20}|\brp\s*)([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{3,})\s*(rb|ribu|jt|juta|k)?/i) || raw.match(/\b([0-9]{1,6})\s*(rb|ribu|jt|juta|k)\b/i);
  if(amount){ let n=Number(amount[1].replace(/[.,]/g,'')); const u=clean(amount[2]); if(u==='rb'||u==='ribu'||u==='k')n*=1000; if(u==='jt'||u==='juta')n*=1000000; if(Number.isFinite(n)&&n>=1000)facts.push({key:'amount',value:String(n),confidence:.82,source:'member_text'}); }
  const uid=raw.match(/(?:user\s*id|userid|username|id\s*(?:member)?)\s*[:=]?\s*([a-z0-9_.-]{4,32})/i);
  if(uid) facts.push({key:'member_id',value:uid[1],confidence:.96,source:'member_text'});
  const bank=raw.match(/\b(BCA|BRI|BNI|MANDIRI|CIMB|SEABANK|DANA|OVO|GOPAY|LINKAJA|JAGO)\b/i);
  if(bank) facts.push({key:'payment_method',value:bank[1].toUpperCase(),confidence:.97,source:'member_text'});
  return facts;
}

export function detectCorrection(text=''){
  return /\b(?:bukan|salah|maksud\s+saya|koreksi|bukan\s+itu)\b/i.test(String(text||''));
}

export function actionRisk(intent='GENERAL'){
  const x=String(intent||'').toUpperCase();
  if(['FORGOT_PASSWORD','ACCOUNT_CHANGE_REQUEST','PAYOUT_NOT_RECEIVED','BANK_ACCOUNT_LIMIT'].includes(x)) return 'HIGH';
  if(['DEPOSIT_PROBLEM','WITHDRAW_PROBLEM','BONUS_REQUEST','BONUS_DAILY'].includes(x)) return 'MEDIUM';
  return 'LOW';
}
