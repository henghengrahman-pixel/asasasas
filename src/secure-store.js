import crypto from 'node:crypto';
import { config } from './config.js';

function key(){ return crypto.createHash('sha256').update(String(config.sessionSecret||'')).digest(); }
export function encryptSecret(value=''){
  const plain=String(value||''); if(!plain) return '';
  const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const enc=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()]); const tag=cipher.getAuthTag();
  return ['v1',iv.toString('base64url'),tag.toString('base64url'),enc.toString('base64url')].join('.');
}
export function decryptSecret(value=''){
  const s=String(value||''); if(!s) return '';
  const [v,ivB,tagB,dataB]=s.split('.'); if(v!=='v1'||!ivB||!tagB||!dataB) throw new Error('SECRET_FORMAT_INVALID');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(ivB,'base64url'));
  decipher.setAuthTag(Buffer.from(tagB,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB,'base64url')),decipher.final()]).toString('utf8');
}
export function maskSecret(value=''){
  const s=String(value||''); if(!s) return '';
  if(s.length<=10) return '••••••••';
  return `${s.slice(0,6)}••••••••${s.slice(-4)}`;
}
