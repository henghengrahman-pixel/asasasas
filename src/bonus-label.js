import { normalizeText } from './normalizer.js';

export function pickBonusLabel(text=''){
  const n=normalizeText(text);
  // Named campaigns have strict precedence so a generic word such as "harian",
  // "deposit" or "50%" cannot steal a more specific promo.
  if(/\bfree\s*bet|freebet\b/.test(n)) return 'BONUS FREEBET';
  if(/\b(new\s*member|newmember|welcome|member\s*baru)\b/.test(n)) return 'BONUS NEW MEMBER';
  if(/\bronda\b/.test(n)) return 'BONUS RONDA';
  if(/\b(harian|daily)\b/.test(n)){
    if(/slot/.test(n) && /(live\s*games?|livegame)/.test(n)) return 'BONUS HARIAN SLOT & LIVE GAMES';
    if(/slot/.test(n)) return 'BONUS HARIAN SLOT';
    if(/(live\s*games?|livegame)/.test(n)) return 'BONUS HARIAN LIVE GAMES';
    return 'BONUS HARIAN';
  }
  if(/\bbonus\b/.test(n) && /\b(?:rp\s*)?5(?:[.,]?000|\s*ribu)\b/.test(n)) return 'BONUS HARIAN Rp5.000';
  if(/\bbonus\b/.test(n) && /\b(deposit|depo)\b/.test(n) && !/\b(bulanan|monthly|mingguan|weekly|rollingan|cashback|freebet|free\s*bet|ronda|new\s*member|newmember)\b/.test(n)) return 'BONUS HARIAN Rp5.000';
  if(/\b(rollingan|rolingan|rolllingan|rolinggan|rolling)\b/.test(n)) return 'BONUS ROLLINGAN';
  if(/\b(bulanan|monthly)\b/.test(n)) return 'BONUS BULANAN';
  if(/\b(mingguan|weekly)\b/.test(n)) return 'BONUS MINGGUAN';
  if(/\bcashback\b/.test(n)) return 'BONUS CASHBACK';
  if(/\bkekalahan\b/.test(n)) return 'BONUS KEKALAHAN';
  if(/\breload\b/.test(n)) return 'BONUS RELOAD';
  if(/\bslot\b/.test(n)) return 'BONUS SLOT';
  if(/\b(live\s*games?|livegame)\b/.test(n)) return 'BONUS LIVE GAMES';
  return '';
}

export function formatBonusClaimQuestion(uid, bonusType=''){
  const label=String(bonusType||'BONUS').trim();
  const claim=/^bonus\b/i.test(label) ? `claim ${label.toLowerCase()}` : `claim bonus ${label.toLowerCase()}`;
  return `ID : ${uid}\n\n${claim}`;
}
