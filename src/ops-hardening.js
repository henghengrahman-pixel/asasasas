
import crypto from 'node:crypto';

const lc=v=>String(v||'').toLowerCase();

export const OPERATIONAL_PRIORITY={
  FORGOT_PASSWORD:100,
  LOGIN_PROBLEM:98,
  LINK_PROBLEM:96,
  DEPOSIT_CANCEL:95,
  DEPOSIT_PROBLEM:94,
  WITHDRAW_PROBLEM:94,
  WITHDRAW_REQUEST:92,
  PAYOUT_NOT_RECEIVED:91,
  ACCOUNT_CHANGE_REQUEST:90,
  BANK_ACCOUNT_LIMIT:90,
  BONUS_REQUEST:80,
  BONUS_DAILY:80,
  REGISTER_REQUEST:75,
  REGISTER_PROBLEM:75,
  GAME_PROBLEM:70,
  GENERAL_DISTURBANCE:65,
  LOSS_COMPLAINT:40,
  BONUS_INFO:30,
  RTP_INFO:20,
  GREETING:5,
  GENERAL:0
};

export const BONUS_PRECEDENCE=[
  'FREEBET',
  'NEW_MEMBER',
  'RONDA',
  'HARIAN_5000',
  'ROLLINGAN',
  'BULANAN',
  'CASHBACK',
  'GENERAL'
];

export function priorityForIntent(intent='GENERAL'){
  return OPERATIONAL_PRIORITY[String(intent||'GENERAL').toUpperCase()] ?? 10;
}

export function topicFamily(intent='GENERAL'){
  const x=String(intent||'GENERAL').toUpperCase();
  if(x.startsWith('DEPOSIT')||x==='TRANSACTION_AMBIGUOUS') return 'DEPOSIT';
  if(x.startsWith('WITHDRAW')) return 'WITHDRAW';
  if(x==='FORGOT_PASSWORD'||x==='LOGIN_PROBLEM'||x==='LINK_PROBLEM') return 'ACCESS';
  if(x.startsWith('BONUS')||x==='RTP_INFO') return 'BONUS';
  if(x.startsWith('REGISTER')) return 'REGISTER';
  if(x==='PAYOUT_NOT_RECEIVED') return 'PAYOUT';
  if(x==='ACCOUNT_CHANGE_REQUEST'||x==='BANK_ACCOUNT_LIMIT') return 'ACCOUNT';
  if(x==='GAME_PROBLEM'||x==='GENERAL_DISTURBANCE') return 'ISSUE';
  if(x==='LOSS_COMPLAINT') return 'LOSS';
  return x;
}

export function shouldHardSwitch({previousIntent='',freshIntent='',text=''}) {
  const fresh=String(freshIntent||'GENERAL').toUpperCase();
  const prev=String(previousIntent||'GENERAL').toUpperCase();
  if(!fresh || fresh==='GENERAL' || fresh==='GREETING' || fresh===prev) return false;
  const pf=topicFamily(prev), ff=topicFamily(fresh);
  if(pf===ff) return false;
  const explicit=/(deposit|depo|dpo|wd|withdraw|penarikan|password|sandi|login|link|daftar|register|bonus|ronda|freebet|rollingan|rekening|bank|game|permainan|kemenangan|payout|jp|kalah|rungkad)/i.test(String(text||''));
  return explicit || priorityForIntent(fresh)>=priorityForIntent(prev);
}

export function detectGenericAmbiguity(text=''){
  const t=lc(text).trim();
  if(!t) return null;
  const generic=/^(?:belum masuk|ga masuk|gak masuk|tidak masuk|belum ada|ga ada|gak ada|tidak ada|gagal|error|eror|ga bisa|gak bisa|tidak bisa|lama|pending|masih pending|belum selesai|belum cair|belum proses|belum diproses)[.!?\s]*$/i;
  if(generic.test(t)) return 'Yang bermasalah deposit, withdraw, login, bonus, atau game-nya ya bosku?';
  return null;
}

export function isClosingMessage(text=''){
  const t=lc(text).trim().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ');
  if(!t) return false;
  if(/\b(tapi|namun|belum|masih|gagal|error|kendala|masalah|tidak|ga|gak)\b/.test(t)) return false;
  return /^(?:makasih|terima kasih|thanks|thx|sudah|udah|selesai|aman|done|beres|mantap|ok sudah|oke sudah|sip sudah|sudah bos|aman bos|selesai bos)(?:\s+bos(?:ku)?|\s+kak|\s+min)?$/.test(t);
}

export function isReopenMessage(text=''){
  const t=lc(text);
  return /\b(masih|tetap|ternyata|belum)\b.{0,25}\b(belum masuk|ga masuk|gak masuk|tidak masuk|gagal|error|belum selesai|belum cair|belum dapat)\b/.test(t)
    || /\bmasih\b.{0,25}\b(kendala|masalah|pending|proses)\b/.test(t);
}

export function extractTransactionAmount(text='',intent=''){
  const raw=String(text||'');
  // Common shorthand in Indonesian CS: "wd 500" / "depo 100" means 500k / 100k.
  const short=raw.match(/\b(?:wd|withdraw|penarikan|depo|deposit|dp)\s*(\d{2,3})\b/i);
  if(short){
    const n=Number(short[1]);
    if(n>=10&&n<=999) return n*1000;
  }
  const matches=[...raw.matchAll(/\b(?:rp\s*)?(\d{1,3}(?:[.,]\d{3})+|\d{2,9})\s*(rb|ribu|k|jt|juta)?\b/ig)];
  for(const m of matches){
    let n=Number(String(m[1]).replace(/[.,]/g,''));
    const u=lc(m[2]);
    if(u==='rb'||u==='ribu'||u==='k') n*=1000;
    if(u==='jt'||u==='juta') n*=1000000;
    // Avoid treating phone/account/id-like long numbers as transaction nominal.
    if(Number.isFinite(n) && n>=1000 && n<=2_000_000_000 && String(m[1]).replace(/\D/g,'').length<=10){
      return n;
    }
  }
  return null;
}

export function extractWaitingDuration(text=''){
  const t=lc(text);
  const m=t.match(/\b(?:sudah|udah|dari)?\s*(\d{1,3})\s*(menit|mnt|jam|hari)\b/);
  if(m){
    const value=Number(m[1]); const unit=m[2];
    const minutes=unit==='hari'?value*1440:unit==='jam'?value*60:value;
    return {value,unit,minutes,raw:m[0]};
  }
  if(/\bsejak pagi\b/.test(t)) return {value:null,unit:'daypart',minutes:null,raw:'sejak pagi'};
  if(/\bdari tadi\b/.test(t)) return {value:null,unit:'relative',minutes:null,raw:'dari tadi'};
  return null;
}

export function attachmentClass({intent='GENERAL',text='',attachments=[]}){
  if(!Array.isArray(attachments)||!attachments.length) return null;
  const t=lc(text); const x=String(intent||'GENERAL').toUpperCase();
  if(x==='DEPOSIT_PROBLEM'||/\b(depo|deposit|transfer|bukti tf|bukti transfer)\b/.test(t)) return 'TRANSFER_PROOF';
  if(x==='WITHDRAW_PROBLEM'||/\b(wd|withdraw|penarikan)\b/.test(t)) return 'WITHDRAW_SCREENSHOT';
  if(x==='LOGIN_PROBLEM'||/\b(login|masuk akun)\b/.test(t)) return 'LOGIN_ERROR';
  if(/\b(qr|qris|barcode|scan)\b/.test(t)) return 'QR_BARCODE';
  if(x==='GAME_PROBLEM'||/\b(game|permainan|slot|macet|hang)\b/.test(t)) return 'GAME_ERROR';
  if(/\b(saldo|balance)\b/.test(t)) return 'BALANCE_SCREENSHOT';
  return 'UNKNOWN_IMAGE';
}

export function caseKey({chatId='',eventId='',intent='GENERAL',sessionKey=''}) {
  const raw=[chatId,sessionKey,String(intent||'GENERAL').toUpperCase(),eventId||''].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0,40);
}

export function hashText(text=''){
  return crypto.createHash('sha256').update(String(text||'').trim().replace(/\s+/g,' ')).digest('hex');
}

export function redactSensitive(value=''){
  return String(value||'')
    .replace(/((?:password|psw|pw|pass)\s*[:=]\s*)([^\s]+)/ig,'$1***')
    .replace(/((?:bot[_\s-]?token|api[_\s-]?key|secret|authorization)\s*[:=]\s*)([^\s]+)/ig,'$1***')
    .replace(/\b(us-[a-z0-9-]+:[A-Za-z0-9_-]{12,})\b/g,'***TOKEN***');
}

export function normalizeCommonTypos(text=''){
  const map=new Map([
    ['gbs','ga bisa'],['gabisa','ga bisa'],['gakbisa','ga bisa'],['blm','belum'],['blom','belum'],
    ['udh','sudah'],['udah','sudah'],['msh','masih'],['dpt','dapat'],['msk','masuk'],
    ['wd','withdraw'],['dp','deposit'],['depo','deposit'],['rek','rekening'],['bns','bonus'],
    ['gnti','ganti'],['psw','password'],['pw','password'],['pass','password'],['dftar','daftar']
  ]);
  return String(text||'').split(/\s+/).map(w=>map.get(lc(w))||w).join(' ');
}

export function fuzzyConfidence(text=''){
  const t=String(text||'').trim();
  if(!t) return 0;
  const weird=(t.match(/[^a-zA-Z0-9\s@._\-:/]/g)||[]).length;
  const tokens=t.split(/\s+/).filter(Boolean);
  const veryShort=tokens.length<=2;
  let c=0.9;
  if(weird>Math.max(2,t.length*.15)) c-=0.2;
  if(veryShort) c-=0.15;
  if(tokens.some(x=>x.length>24)) c-=0.1;
  return Math.max(0,Math.min(1,c));
}

export function bonusStageAllowed(current='NONE',next='NONE'){
  const order=['NONE','TERMS_SHOWN','WAITING_AGREEMENT','WAITING_ID','WAITING_STAFF','APPROVED','REJECTED'];
  const a=order.indexOf(String(current||'NONE').toUpperCase());
  const b=order.indexOf(String(next||'NONE').toUpperCase());
  if(a<0||b<0) return false;
  if(['APPROVED','REJECTED'].includes(order[a])) return false;
  return b>=a || next==='REJECTED';
}

export function validateRegistrationData(data={}){
  const errors=[];
  const username=String(data.username||'').trim();
  const bank=String(data.bank||'').trim();
  const name=String(data.name||'').trim();
  const no=String(data.no||'').replace(/\s+/g,'');
  const email=String(data.email||'').trim();
  const phone=String(data.phone||'').replace(/\s+/g,'');
  if(username && !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) errors.push('Username minimal 3 karakter dan hanya huruf/angka/._-');
  if(bank && !/^(bca|bni|bri|mandiri|cimb|danamon|seabank|jago|dana|ovo|gopay|linkaja|shopeepay|bank|e-wallet|ewallet)$/i.test(bank)) errors.push('Bank/E-wallet belum dikenali');
  if(name && name.length<3) errors.push('Atas Nama Rekening terlalu pendek');
  if(no && !/^[0-9]{6,20}$/.test(no)) errors.push('Nomor Rekening/E-wallet tidak valid');
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email tidak valid');
  if(phone && !/^(?:\+?62|0)8\d{7,13}$/.test(phone)) errors.push('Nomor Telepon tidak valid');
  return {ok:errors.length===0,errors};
}

export function caseExpired(createdAt,maxMinutes=120){
  const t=new Date(createdAt||0).getTime();
  if(!Number.isFinite(t)||t<=0) return true;
  return Date.now()-t > Math.max(1,Number(maxMinutes)||120)*60000;
}

export function contradictionStatus(oldStatus='',humanText=''){
  const old=lc(oldStatus), t=lc(humanText);
  if(/gagal|ditolak|tidak bisa|limit|reject|dibatalkan/.test(t) && /proses|pending|cek/.test(old)) return 'OVERRIDE_FAILED';
  if(/selesai|done|berhasil|sudah masuk|sudah dibayar/.test(t)) return 'OVERRIDE_DONE';
  return null;
}
