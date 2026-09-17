
export const REGISTER_FORM=`Silahkan di Bantu data-datanya dengan benar dan Lengkap ya bosku seperti :

📌Username :
📌Email :
📌Nomor Telepon :
📌Bank/E-wallet :
📌Atas Nama Rekening :
📌Nomor Rekening :`;

export const REGISTER_WAITING_REPLY='Mohon tunggu sebentar ya bosku 😊 Permintaan pendaftaran akun sedang diproses oleh staff. Begitu sudah selesai, langsung kami informasikan ya bosku 🙏';

function clean(v=''){ return String(v||'').trim().replace(/\s+/g,' '); }
function extractLabeled(text,labelRe){
  const m=String(text||'').match(new RegExp(`(?:^|\\n)\\s*(?:${labelRe})\\s*[:=\\-]?\\s*([^\\n]+)`,'i'));
  return clean(m?.[1]||'');
}
export function parseRegistrationText(text='',prev={}){
  const s=String(text||'');
  const out={...prev};

  const username=extractLabeled(s,'(?:username|user\\s*name|user)');
  const email=extractLabeled(s,'(?:email|e-mail)');
  const phone=extractLabeled(s,'(?:nomor\\s*(?:telepon|hp)|no\\.?\\s*(?:telepon|hp)|telepon|hp)');
  const bank=extractLabeled(s,'(?:bank\\s*\\/\\s*e-wallet|bank|e-wallet|ewallet|wallet)');
  const name=extractLabeled(s,'(?:atas\\s*nama\\s*rekening|atas\\s*nama|a\\/?n)');
  const no=extractLabeled(s,'(?:nomor\\s*rekening|no\\.?\\s*rekening|nomor\\s*rek|no\\.?\\s*rek)');

  if(username) out.username=username;
  if(email) out.email=email;
  if(phone) out.phone=phone;
  if(bank) out.bank=bank;
  if(name) out.name=name;
  if(no) out.no=no;

  // Natural compact forms, e.g. "username budi123", "dana 08123".
  if(!out.username){
    const m=s.match(/\busername\s+([a-z0-9._-]{3,40})\b/i);
    if(m) out.username=m[1];
  }
  if(!out.email){
    const m=s.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    if(m) out.email=m[0];
  }
  if(!out.phone){
    const m=s.match(/\b(?:\+?62|0)8\d{7,13}\b/);
    if(m) out.phone=m[0];
  }
  if(!out.bank){
    const m=s.match(/\b(bca|bni|bri|mandiri|cimb|danamon|seabank|jago|dana|ovo|gopay|linkaja|shopeepay)\b/i);
    if(m) out.bank=m[1];
  }
  return out;
}
export function registrationMissing(data={}){
  const miss=[];
  if(!clean(data.username)) miss.push('Username');
  if(!clean(data.bank)) miss.push('Bank/E-wallet');
  if(!clean(data.name)) miss.push('Atas Nama Rekening');
  if(!clean(data.no)) miss.push('Nomor Rekening');
  return miss;
}
export function registrationTicket(data={}){
  return `📝 PENDAFTARAN MEMBER BARU

Username : ${clean(data.username)}
Email : ${clean(data.email)||'-'}
Nomor Telepon : ${clean(data.phone)||'-'}
Bank/E-wallet : ${clean(data.bank)}
Atas Nama Rekening : ${clean(data.name)}
Nomor Rekening : ${clean(data.no)}

Mohon CS daftarkan akun member ini.
Setelah selesai, REPLY ke ticket ini dengan:
UserID : contoh123
Password : qq123123
Link Login : https://omtogeltxt.com/clearcache`;
}
