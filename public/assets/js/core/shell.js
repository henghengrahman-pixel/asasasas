import {api} from './api.js';
const groups=[
  ['OPERATIONS',[['conversations','Conversations'],['archives','Archives'],['case-management','Case Management']]],
  ['BOT BRAIN',[['knowledge','Knowledge'],['ai-rules','AI Rules'],['responses','Responses Manual'],['menu-penting','Menu Penting'],['bekal-bot','Bekal Bot']]],
  ['HUMAN TOOLS',[['canned-responses','Canned Responses']]],
  ['INTEGRATIONS',[['telegram-cta','Telegram CTA'],['telegram-settings','Telegram Settings'],['website-profile','Website Profile']]],
  ['SYSTEM',[['ai-settings','AI Settings'],['learning','Learning'],['logs','Logs'],['system-health','Health'],['security','Security']]]
];
const iconMap={conversations:'◫',archives:'▱','case-management':'◇',knowledge:'▤','ai-rules':'⌘',responses:'≡','menu-penting':'★','bekal-bot':'◆','canned-responses':'#','telegram-cta':'↗','telegram-settings':'✦','website-profile':'◎','ai-settings':'⚙',learning:'↻',logs:'☷','system-health':'♥',security:'⌾'};
export async function mountShell(){
  const page=document.body.dataset.page||'';let me;try{me=await api('/api/me')}catch{}if(!me?.ok){location.replace('/');return}
  const content=document.querySelector('#page-content');const nav=groups.map(([g,items])=>`<div class="nav-group"><div class="nav-caption">${g}</div>${items.map(([r,l])=>`<a href="/${r}" class="${page===r?'active':''}" title="${l}"><span class="nav-icon">${iconMap[r]||'•'}</span><span class="label">${l}</span></a>`).join('')}</div>`).join('');
  document.body.innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">AI</div><div class="brand-copy"><b>AI LIVECHAT 8008</b><small>Operations Console</small></div><button class="sidebar-collapse" id="sidebarCollapse" title="Compact sidebar">‹</button></div><nav class="nav">${nav}</nav><div class="sidebar-foot"><span class="status-dot"></span><span>Production</span></div></aside><section class="workspace"><header class="topbar"><div class="topbar-left"><button class="icon-btn mobile-menu" id="mobileMenu">☰</button><div><div class="topbar-title">${document.title}</div><div class="topbar-sub">Operations Console</div></div></div><div class="topbar-right"><div class="system-chip" id="healthChip"><i></i><span>System</span></div><div class="system-chip" id="aiChip"><i></i><span>AI</span></div><div class="system-chip" id="telegramChip"><i></i><span>Telegram</span></div><span class="user-chip">${me.user||'admin'}</span><button class="btn ghost" id="logoutBtn">Keluar</button></div></header><main class="page" id="shellContent"></main></section></div><div class="sidebar-backdrop" id="sidebarBackdrop"></div>`;
  document.querySelector('#shellContent').append(content);
  const collapsed=localStorage.getItem('sidebar.compact')==='1';document.querySelector('.app-shell').classList.toggle('sidebar-compact',collapsed);
  document.querySelector('#sidebarCollapse').onclick=()=>{const shell=document.querySelector('.app-shell');shell.classList.toggle('sidebar-compact');localStorage.setItem('sidebar.compact',shell.classList.contains('sidebar-compact')?'1':'0')};
  const closeMobile=()=>{document.querySelector('.sidebar').classList.remove('open');document.querySelector('#sidebarBackdrop').classList.remove('open')};
  document.querySelector('#mobileMenu')?.addEventListener('click',()=>{document.querySelector('.sidebar').classList.toggle('open');document.querySelector('#sidebarBackdrop').classList.toggle('open')});document.querySelector('#sidebarBackdrop').onclick=closeMobile;
  document.querySelector('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST',body:'{}'}).catch(()=>{});location.replace('/')};
  async function status(){try{const s=await api('/api/status');const set=(id,ok,label)=>{const el=document.querySelector(id);el?.classList.toggle('good',Boolean(ok));el?.classList.toggle('bad',!ok);const span=el?.querySelector('span');if(span)span.textContent=label};set('#healthChip',s.db&&s.brainDb,'System');set('#aiChip',s.systemEnabled,'AI '+(s.systemEnabled?'ON':'OFF'));set('#telegramChip',s.humanBridge?.enabled&&s.humanBridge?.configured,'Telegram')}catch{}}
  status();setInterval(status,30000);setInterval(()=>api('/api/session/touch',{method:'POST',body:'{}'}).catch(()=>{}),15*60*1000);
}
