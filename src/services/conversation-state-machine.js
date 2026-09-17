export const ConversationState=Object.freeze({AI_ACTIVE:'AI_ACTIVE',HUMAN_TAKEOVER:'HUMAN_TAKEOVER',WAITING_TELEGRAM:'WAITING_TELEGRAM',PROCESSING:'PROCESSING',CLOSED:'CLOSED'});
const allowed={
 AI_ACTIVE:new Set(['HUMAN_TAKEOVER','WAITING_TELEGRAM','PROCESSING','CLOSED']),
 HUMAN_TAKEOVER:new Set(['AI_ACTIVE','CLOSED']),
 WAITING_TELEGRAM:new Set(['AI_ACTIVE','HUMAN_TAKEOVER','PROCESSING','CLOSED']),
 PROCESSING:new Set(['AI_ACTIVE','WAITING_TELEGRAM','HUMAN_TAKEOVER','CLOSED']),
 CLOSED:new Set([])
};
export function canTransition(from,to){return from===to||Boolean(allowed[from]?.has(to))}
export function assertTransition(from,to){if(!canTransition(from,to)){const e=new Error('INVALID_CONVERSATION_STATE_TRANSITION');e.status=409;throw e;}return to}
