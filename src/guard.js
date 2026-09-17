const transactionClaims = [
  /\b(sudah|telah)\s+(berhasil|masuk|diproses|selesai|dibayarkan|dikreditkan)\b/i,
  /\bbonus\b.*\b(sudah|telah)\b.*\b(masuk|diproses|diberikan)\b/i,
  /\bwithdraw\b.*\b(sudah|telah)\b.*\b(berhasil|masuk|diproses)\b/i,
  /\bdeposit\b.*\b(sudah|telah)\b.*\b(berhasil|masuk|diproses)\b/i,
  /\bbonus(?:nya)?\b.{0,45}\b(sudah|telah)\b.{0,35}\b(masuk(?:kan|an|in)?|dimasuk(?:kan|an|in)?|diproses|selesai|diberikan|dikreditkan)\b/i,
  /\b(sudah|telah)\b.{0,20}\b(kami|kita)\b.{0,20}\b(masuk(?:kan|an|in)?|dimasuk(?:kan|an|in)?|proses(?:kan)?)\b.{0,45}\b(akun|user\s*id|bonus)\b/i
];

export function guardDecision({ intent, decision, hasKnowledge=false }) {
  const result = { ...decision, blocked:false, blockReason:null };
  const text = String(decision?.reply || '');
  const sensitive = ['WITHDRAW_PROBLEM','DEPOSIT_PROBLEM','BONUS_REQUEST','BONUS_DAILY','LOGIN_PROBLEM','PAYOUT_NOT_RECEIVED','ACCOUNT_CHANGE_REQUEST','BANK_ACCOUNT_LIMIT'].includes(intent);
  if (!text.trim()) {
    result.action='HANDOFF'; result.blocked=true; result.blockReason='EMPTY_REPLY'; return result;
  }
  // Until backend action agents are connected, never let AI assert that a transaction/bonus was actually completed.
  if (transactionClaims.some(r=>r.test(text))) {
    result.action='HANDOFF'; result.blocked=true; result.blockReason='UNVERIFIED_TRANSACTION_CLAIM'; return result;
  }
  if (sensitive && decision.action==='AUTO_REPLY' && !hasKnowledge) {
    result.action='HANDOFF'; result.blocked=true; result.blockReason='SENSITIVE_WITHOUT_KNOWLEDGE'; return result;
  }
  return result;
}
