import { normalizeText } from './normalizer.js';

function tokens(s=''){
  return new Set(normalizeText(s).split(/\s+/).map(x=>x.trim()).filter(x=>x.length>2));
}
function similarity(a,b){
  const A=tokens(a), B=tokens(b); if(!A.size||!B.size) return 0;
  let hit=0; for(const x of A) if(B.has(x)) hit++;
  return hit / Math.max(A.size,B.size);
}
function asksUserId(text=''){ return /(?:user\s*id|userid|id\s*(?:akun|member|user)|username)/i.test(text); }
function asksProof(text=''){ return /(?:kirim|berikan|lampirkan|sertakan).{0,35}(?:bukti|screenshot|screen\s*shot|struk)/i.test(text); }
function factHay(brain={}){ return (brain.knownFacts||brain.known_facts||[]).map(x=>normalizeText(x)).join(' | '); }
function hasUserIdFact(brain={}){ const h=factHay(brain); return /(?:user\s*id|userid|id\s*(?:akun|member|user)|username).{0,30}[a-z0-9_.-]{3,}/i.test(h); }
function hasProofFact(brain={}){ const h=factHay(brain); return /(?:bukti|screenshot|struk).{0,30}(?:sudah|ada|diterima|terkirim|received|tersedia)/i.test(h) || /(?:sudah|ada|diterima|terkirim).{0,30}(?:bukti|screenshot|struk)/i.test(h); }

export function validateProDecision({decision={},history=[],brain={},intent='GENERAL',hasKnowledge=false}){
  const out={...decision};
  const action=String(out.action||'ASK_HUMAN');
  const reply=String(out.reply||'').trim();
  const confidence=Number(out.confidence||0);

  // Confidence is action-sensitive. Asking a harmless clarification may tolerate a
  // slightly lower score, but an autonomous answer requires stronger certainty.
  if(action==='AUTO_REPLY' && confidence<0.82){
    return {...out,action:'ASK_HUMAN',reply:'',reason:`pro_gate_low_auto_confidence:${confidence.toFixed(2)}|${out.reason||''}`};
  }
  if(action==='ASK_INFO' && confidence<0.65){
    return {...out,action:'ASK_HUMAN',reply:'',reason:`pro_gate_low_ask_confidence:${confidence.toFixed(2)}|${out.reason||''}`};
  }

  if(action==='ASK_INFO'){
    const missing=Array.isArray(brain.missingInfo)?brain.missingInfo:(Array.isArray(brain.missing_info)?brain.missing_info:[]);
    if(!missing.length){
      return {...out,action:'ASK_HUMAN',reply:'',reason:`pro_gate_ask_without_missing_info|${out.reason||''}`};
    }
    if(asksUserId(reply) && hasUserIdFact(brain)){
      return {...out,action:'ASK_HUMAN',reply:'',reason:`pro_gate_repeat_known_user_id|${out.reason||''}`};
    }
    if(asksProof(reply) && hasProofFact(brain)){
      return {...out,action:'ASK_HUMAN',reply:'',reason:`pro_gate_repeat_known_proof|${out.reason||''}`};
    }
  }

  // Stop near-duplicate CS/AI questions. This catches the classic loop where the
  // member already answered but the model asks the same question again.
  if(reply && /\?\s*$/.test(reply)){
    const previous=history.filter(x=>x && x.sender_type!=='customer').slice(-20);
    const repeated=previous.find(x=>/\?\s*$/.test(String(x.text||'')) && similarity(reply,String(x.text||''))>=0.72);
    if(repeated){
      return {...out,action:'ASK_HUMAN',reply:'',reason:`pro_gate_repeated_question|${out.reason||''}`};
    }
  }

  // High-risk autonomous answers require an approved/official source.
  const risky=new Set(['WITHDRAW_PROBLEM','DEPOSIT_PROBLEM','FORGOT_PASSWORD','BONUS','BONUS_REQUEST','BONUS_DAILY','ACCOUNT_CHANGE','ACCOUNT_CHANGE_REQUEST','PAYOUT_NOT_RECEIVED','BANK_ACCOUNT_LIMIT']);
  if(action==='AUTO_REPLY' && risky.has(String(intent).toUpperCase()) && !hasKnowledge){
    return {...out,action:'ASK_HUMAN',reply:'',reason:`pro_gate_high_risk_without_source|${out.reason||''}`};
  }
  return out;
}
