const HIGH_RISK_INTENTS = new Set(['WITHDRAW_PROBLEM','DEPOSIT_PROBLEM','FORGOT_PASSWORD','BONUS','BONUS_REQUEST','BONUS_DAILY','ACCOUNT_CHANGE','ACCOUNT_CHANGE_REQUEST','PAYOUT_NOT_RECEIVED','BANK_ACCOUNT_LIMIT']);

function arr(v,max=20){ return Array.isArray(v)?v.map(x=>String(x||'').trim()).filter(Boolean).slice(0,max):[]; }
export function normalizeBrain(input={}, fallbackIntent='GENERAL'){
  const risk=String(input.risk||'MEDIUM').toUpperCase();
  const sentiment=String(input.sentiment||'NORMAL').toUpperCase();
  return {
    goal:String(input.goal||fallbackIntent||'GENERAL').toUpperCase().slice(0,80),
    stage:String(input.stage||'UNDERSTAND').toUpperCase().slice(0,80),
    knownFacts:arr(input.known_facts||input.knownFacts,30),
    missingInfo:arr(input.missing_info||input.missingInfo,20),
    contradictions:arr(input.contradictions,10),
    sentiment:['NORMAL','BINGUNG','BURU_BURU','KESAL','MARAH','KASAR'].includes(sentiment)?sentiment:'NORMAL',
    risk:['LOW','MEDIUM','HIGH'].includes(risk)?risk:'MEDIUM',
    nextStep:String(input.next_step||input.nextStep||'').slice(0,500),
    understanding:String(input.understanding||'').slice(0,900),
    primaryIntent:String(input.primary_intent||input.primaryIntent||input.goal||fallbackIntent||'GENERAL').toUpperCase().slice(0,80),
    status:String(input.status||input.stage||'ACTIVE').toUpperCase().slice(0,80),
    expectedReply:String(input.expected_reply||input.expectedReply||'').slice(0,300),
    actionsDone:arr(input.actions_done||input.actionsDone,30),
    resolved:Boolean(input.resolved)
  };
}

export function applyBrainGate({intent='GENERAL',decision={},brain={},hasKnowledge=false}){
  const b=normalizeBrain(brain,intent);
  const out={...decision};
  // Konflik fakta berarti AI tidak boleh menebak jawaban.
  if(b.contradictions.length){
    out.action='ASK_HUMAN'; out.reply='';
    out.reason=`brain_contradiction:${b.contradictions.join(' | ').slice(0,300)}`;
    return out;
  }
  const highRisk=b.risk==='HIGH'||HIGH_RISK_INTENTS.has(String(intent).toUpperCase());
  if(highRisk && ['AUTO_REPLY'].includes(out.action) && !hasKnowledge){
    out.action='ASK_HUMAN'; out.reply=''; out.reason='brain_high_risk_without_verified_source';
    return out;
  }
  // Bila model tahu ada data yang benar-benar kurang, jangan menjawab seolah proses sudah lengkap.
  if(b.missingInfo.length && out.action==='AUTO_REPLY' && !highRisk){
    out.action='ASK_INFO';
  }
  return out;
}

export function brainToPrompt(brain={}){
  const b=normalizeBrain(brain);
  return JSON.stringify({goal:b.goal,primary_intent:b.primaryIntent,status:b.status,stage:b.stage,known_facts:b.knownFacts,missing_info:b.missingInfo,contradictions:b.contradictions,expected_reply:b.expectedReply,actions_done:b.actionsDone,resolved:b.resolved,sentiment:b.sentiment,risk:b.risk,next_step:b.nextStep,understanding:b.understanding},null,2);
}
