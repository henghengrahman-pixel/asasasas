import { config } from './config.js';

export function daypart(date=new Date(), timeZone=config.timezone){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const hour=Number(parts.find(p=>p.type==='hour')?.value||0);
  if(hour>=5 && hour<11) return 'pagi';
  if(hour>=11 && hour<15) return 'siang';
  if(hour>=15 && hour<19) return 'sore';
  return 'malam';
}
export function greetingText(date=new Date(), timeZone=config.timezone){
  const part=daypart(date,timeZone);
  return `Selamat ${part}, bosku 😊🙏 Ada yang bisa kami bantu ${part} ini bosku?`;
}


function normalizeForMatch(value=''){
  return String(value||'').toLowerCase().normalize('NFKC').replace(/\s+/g,' ').trim();
}
export function isGreetingTriggerMessage(text, patterns=config.greetingTriggerPatterns){
  const hay=normalizeForMatch(text);
  if(!hay) return false;
  return (patterns||[]).some(p=>{ const needle=normalizeForMatch(p); return needle && hay.includes(needle); });
}

export function canAutoGreetFromHistory(rows=[], triggerEventId=null){
  const meaningful = (rows||[]).filter(m=>{
    if(triggerEventId!=null && String(m?.event_id||'')===String(triggerEventId)) return false;
    const type=String(m?.sender_type||'').toLowerCase();
    if(!['customer','agent','ai'].includes(type)) return false;
    return Boolean(String(m?.text||'').trim());
  });
  return meaningful.length===0;
}
