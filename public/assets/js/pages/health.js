import{api}from'../core/api.js';import{toast,esc}from'../core/ui.js';const $=s=>document.querySelector(s);
const statusClass=v=>v==='HEALTHY'?'ok':v==='ERROR'?'danger':'warn';
async function load(){
  const[s,o]=await Promise.all([api('/api/status'),api('/api/ops/health').catch(()=>({}))]);
  const healthByName=new Map((s.integrationHealth||[]).map(x=>[String(x.integration||'').toLowerCase(),x]));
  const integ=(name,configured)=>{if(!configured)return'WARNING';const x=healthByName.get(name);if(!x)return'WARNING';return String(x.status||'').toUpperCase()==='OK'?'HEALTHY':'ERROR'};
  const cards={
    'Application':'HEALTHY',
    'PostgreSQL':s.db?'HEALTHY':'ERROR',
    'Brain DB':s.brainDb?'HEALTHY':'ERROR',
    'LiveChat':integ('livechat_poll',s.livechatConfigured),
    'Telegram':s.humanBridge?.configured?(s.humanBridge?.enabled?integ('telegram_poll',true):'WARNING'):'WARNING',
    'OpenAI':s.openaiConfigured?'HEALTHY':'WARNING'
  };
  $('#healthCards').innerHTML=Object.entries(cards).map(([k,v])=>`<div class="card"><div class="kpi-label">${esc(k)}</div><div class="metric"><span class="badge ${statusClass(v)}">${v}</span></div></div>`).join('');
  $('#healthTimestamp').textContent='Last checked: '+new Date().toLocaleString();
  $('#healthDetails').innerHTML=`<pre>${esc(JSON.stringify({poller:s.poller,learningWorker:s.learningWorker,cannedSync:s.cannedSync,humanBridge:s.humanBridge,integrationHealth:s.integrationHealth,operations:o},null,2))}</pre>`
}
$('#refreshHealth').onclick=load;load().catch(e=>toast(e.message,'error'));
