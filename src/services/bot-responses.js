import {brainPool} from '../db.js';
import {semanticScore} from '../semantic.js';
export async function getRelevantBotResponses(text='',intent='GENERAL',limit=14){
  const r=await brainPool.query(`SELECT id,name,intent,trigger_text,response_text,priority,notes,updated_at FROM bot_manual_responses WHERE enabled=true AND (upper(intent)=upper($1) OR upper(intent)='GENERAL') ORDER BY priority DESC,updated_at DESC LIMIT 250`,[intent||'GENERAL']);
  return r.rows.map(x=>({...x,semantic_score:semanticScore(`${x.name||''} ${x.trigger_text||''} ${x.response_text||''}`,text)})).sort((a,b)=>(b.semantic_score-a.semantic_score)||(b.priority-a.priority)).slice(0,limit);
}
