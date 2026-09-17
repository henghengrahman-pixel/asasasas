import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SESSION_SECRET='test-session-secret-1234567890-abcdefghijklmnopqrstuvwxyz';
const auth=await import('../src/auth.js');
const { generateTotpSecret, totpCode, verifyTotp, makeOtpAuthUrl, createSession, verifySession, refreshSession, createPending2fa, verifyPending2fa, ADMIN_IDLE_TIMEOUT_MS }=auth;

test('TOTP secret persists as valid base32 material and verifies current/adjacent window',()=>{
  const secret=generateTotpSecret();
  assert.match(secret,/^[A-Z2-7]{32}$/);
  const now=1789315200000;
  const code=totpCode(secret,{time:now});
  assert.match(code,/^\d{6}$/);
  assert.equal(verifyTotp(secret,code,{time:now}),true);
  assert.equal(verifyTotp(secret,code,{time:now+30000}),true);
  assert.equal(verifyTotp(secret,'000000',{time:now,window:0}), code==='000000');
});

test('otpauth URI is compatible with authenticator apps',()=>{
  const url=makeOtpAuthUrl({secret:'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',username:'admin'});
  assert.match(url,/^otpauth:\/\/totp\//);
  assert.match(url,/secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP/);
  assert.match(url,/digits=6/);
  assert.match(url,/period=30/);
});

test('admin session expires after one hour inactivity but refresh extends last activity',()=>{
  const t0=1789315200000;
  const token=createSession('admin',{now:t0});
  assert.equal(verifySession(token,{now:t0+ADMIN_IDLE_TIMEOUT_MS-1})?.u,'admin');
  assert.equal(verifySession(token,{now:t0+ADMIN_IDLE_TIMEOUT_MS+1}),null);
  const original=verifySession(token,{now:t0+1000});
  const refreshed=refreshSession(original,{now:t0+30*60*1000});
  assert.equal(verifySession(refreshed,{now:t0+89*60*1000})?.u,'admin');
  assert.equal(verifySession(refreshed,{now:t0+91*60*1000}),null);
});

test('pending 2FA session cannot become an admin session',()=>{
  const t0=1789315200000;
  const pending=createPending2fa('admin',{now:t0});
  assert.equal(verifyPending2fa(pending,{now:t0+1000})?.u,'admin');
  assert.equal(verifySession(pending,{now:t0+1000}),null);
  assert.equal(verifyPending2fa(pending,{now:t0+11*60*1000}),null);
});
