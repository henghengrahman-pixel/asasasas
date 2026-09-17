import crypto from 'node:crypto';
import { config } from './config.js';

export const ADMIN_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const ADMIN_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const PENDING_2FA_TIMEOUT_MS = 10 * 60 * 1000;

function b64url(input) { return Buffer.from(input).toString('base64url'); }
function sign(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}
function signedBody(data){
  const body=b64url(JSON.stringify(data));
  return `${body}.${sign(body)}`;
}
function readSigned(token=''){
  const [body,sig]=String(token||'').split('.');
  if(!body||!sig||!config.sessionSecret) return null;
  const expected=sign(body);
  const a=Buffer.from(sig), b=Buffer.from(expected);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
  try{return JSON.parse(Buffer.from(body,'base64url').toString());}catch{return null;}
}


export function hashPassword(password,{salt=crypto.randomBytes(16)}={}){
  const pwd=String(password||'');
  if(pwd.length<10) throw new Error('PASSWORD_TOO_SHORT');
  const saltBuf=Buffer.isBuffer(salt)?salt:Buffer.from(String(salt),'base64url');
  const digest=crypto.scryptSync(pwd,saltBuf,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return `scrypt$16384$8$1$${saltBuf.toString('base64url')}$${digest.toString('base64url')}`;
}
export function verifyPassword(password,encoded=''){
  const value=String(encoded||'');
  const parts=value.split('$');
  if(parts.length!==6||parts[0]!=='scrypt') return false;
  const [,n,r,p,saltB64,hashB64]=parts;
  try{
    const expected=Buffer.from(hashB64,'base64url');
    const actual=crypto.scryptSync(String(password||''),Buffer.from(saltB64,'base64url'),expected.length,{N:Number(n),r:Number(r),p:Number(p),maxmem:64*1024*1024});
    return actual.length===expected.length && crypto.timingSafeEqual(actual,expected);
  }catch{return false;}
}

export function safeEqualText(a='',b=''){
  const aa=Buffer.from(String(a)); const bb=Buffer.from(String(b));
  if(aa.length!==bb.length) return false;
  return crypto.timingSafeEqual(aa,bb);
}

export function createSession(username,{now=Date.now()}={}) {
  return signedBody({u:String(username),iat:now,last:now,exp:now+ADMIN_ABSOLUTE_TIMEOUT_MS,t:'admin'});
}
export function refreshSession(session,{now=Date.now()}={}){
  const originalIat=Number(session?.iat)||now;
  const absoluteExp=Number(session?.exp)||originalIat+ADMIN_ABSOLUTE_TIMEOUT_MS;
  return signedBody({u:String(session?.u||''),iat:originalIat,last:now,exp:absoluteExp,t:'admin'});
}
export function verifySession(token='',{now=Date.now(),ignoreIdle=false}={}) {
  const data=readSigned(token);
  if(!data || data.t!=='admin' || !data.u || !data.exp || data.exp<now) return null;
  const last=Number(data.last||data.iat||0);
  if(!ignoreIdle && (!last || now-last>ADMIN_IDLE_TIMEOUT_MS)) return null;
  return data;
}
export function createPending2fa(username,{now=Date.now()}={}){
  return signedBody({u:String(username),iat:now,exp:now+PENDING_2FA_TIMEOUT_MS,t:'2fa_pending'});
}
export function verifyPending2fa(token='',{now=Date.now()}={}){
  const data=readSigned(token);
  if(!data || data.t!=='2fa_pending' || !data.u || !data.exp || data.exp<now) return null;
  return data;
}

const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf){
  let bits=0,value=0,out='';
  for(const byte of Buffer.from(buf)){
    value=(value<<8)|byte; bits+=8;
    while(bits>=5){ out+=B32[(value>>>(bits-5))&31]; bits-=5; }
  }
  if(bits>0) out+=B32[(value<<(5-bits))&31];
  return out;
}
export function base32Decode(text=''){
  const s=String(text).toUpperCase().replace(/[^A-Z2-7]/g,'');
  let bits=0,value=0; const out=[];
  for(const ch of s){ const idx=B32.indexOf(ch); if(idx<0) continue; value=(value<<5)|idx; bits+=5; if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;} }
  return Buffer.from(out);
}
export function generateTotpSecret(){ return base32Encode(crypto.randomBytes(20)); }
export function generateRecoveryCodes(count=8){return Array.from({length:Math.max(4,Math.min(12,count))},()=>crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-'));}
export function hashRecoveryCode(code){return crypto.createHmac('sha256',config.sessionSecret).update(String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'')).digest('hex');}
export function totpCode(secret,{time=Date.now(),step=30,digits=6}={}){
  const counter=Math.floor(time/1000/step);
  const msg=Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h=crypto.createHmac('sha1',base32Decode(secret)).update(msg).digest();
  const off=h[h.length-1]&0x0f;
  const num=((h[off]&0x7f)<<24)|((h[off+1]&0xff)<<16)|((h[off+2]&0xff)<<8)|(h[off+3]&0xff);
  return String(num%(10**digits)).padStart(digits,'0');
}
export function verifyTotp(secret,code,{time=Date.now(),window=1}={}){
  const c=String(code||'').replace(/\s+/g,'');
  if(!/^\d{6}$/.test(c)) return false;
  for(let w=-window;w<=window;w++) if(safeEqualText(totpCode(secret,{time:time+w*30000}),c)) return true;
  return false;
}
export function makeOtpAuthUrl({secret,username,issuer='OMTOGEL LiveChat'}){
  const label=`${issuer}:${username}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [decodeURIComponent(i >= 0 ? v.slice(0,i) : v), decodeURIComponent(i >= 0 ? v.slice(i+1) : '')];
  }));
}
export function sessionCookie(token){
  return `lcai_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${config.nodeEnv==='production'?'; Secure':''}`;
}
export function clearSessionCookie(){
  return `lcai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.nodeEnv==='production'?'; Secure':''}`;
}
export function requireAdmin(req,res,next){
  const session=verifySession(parseCookies(req).lcai_session||'');
  if(!session){res.setHeader('Set-Cookie',clearSessionCookie());return res.status(401).json({ok:false,error:'SESSION_EXPIRED'});}
  req.admin=session; next();
}
