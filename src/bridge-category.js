export const CATEGORIES=['RESET_PASSWORD','WD_PROBLEM','DEPOSIT_PROBLEM','BONUS','ISSUE'];

export function bridgeCategory(intent='GENERAL'){
  const s=String(intent||'').toUpperCase();
  if(s==='FORGOT_PASSWORD'||s.includes('PASSWORD')) return 'RESET_PASSWORD';
  if(s==='WITHDRAW_PROBLEM'||s.includes('WITHDRAW')||s.startsWith('WD_')||s==='ACCOUNT_CHANGE_REQUEST'||s==='BANK_ACCOUNT_LIMIT') return 'WD_PROBLEM';
  if(s==='DEPOSIT_PROBLEM'||s.startsWith('DP_')||s.includes('DEPOSIT')) return 'DEPOSIT_PROBLEM';
  if(s.includes('BONUS')) return 'BONUS';
  if(['LOGIN_PROBLEM','LINK_PROBLEM','REGISTER_PROBLEM','REGISTER_REQUEST','GAME_PROBLEM','GENERAL_DISTURBANCE','PAYOUT_NOT_RECEIVED','LOSS_COMPLAINT','COMPLAINT','ABUSIVE','ISSUE'].includes(s)) return 'ISSUE';
  return 'PANEL_ONLY';
}

export function isTelegramBridgeCategory(intent='GENERAL'){
  return CATEGORIES.includes(bridgeCategory(intent));
}
