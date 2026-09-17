export const CONTENT_COLLECTIONS={
  knowledge:{table:'knowledge_base',pool:'brain',label:'Knowledge Base',columns:['category','title','content','examples','tags','priority','active']},
  responses:{table:'bot_manual_responses',pool:'brain',label:'Responses Manual',columns:['name','intent','trigger_text','response_text','priority','enabled','notes']},
  rules:{table:'ai_rules',pool:'brain',label:'AI Rules',columns:['category','rule_type','content','intent','conditions','action','priority','stop_processing','active','notes']},
  important:{table:'bot_important_info',pool:'brain',label:'Menu Penting',columns:['item_type','item_key','title','content','aliases','meta','priority','active']},
  supplies:{table:'bot_promo_rules',pool:'brain',label:'Bekal Bot',columns:['name','keywords','min_deposit','max_bonus','turnover','claim_limit','active_hours','game_scope','rules','reply_template','active']}
};
export function getCollection(name){const c=CONTENT_COLLECTIONS[String(name||'')];if(!c){const e=new Error('UNKNOWN_COLLECTION');e.status=404;throw e;}return c;}
