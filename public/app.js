const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let adminUiAuthenticated=false,adminLastActivity=Date.now(),adminTouchAt=0,adminIdleTimer=null,pending2faToken='';
function showAuthStep(id){['#loginStepPassword','#loginStepSetup','#loginStepVerify'].forEach(x=>$(x)?.classList.add('hidden'));$(id)?.classList.remove('hidden');$('#loginErr').textContent=''}
function forceLoggedOut(message='Sesi berakhir. Silakan login kembali.'){adminUiAuthenticated=false;clearInterval(adminIdleTimer);adminIdleTimer=null;$('#app')?.classList.add('hidden');$('#login')?.classList.remove('hidden');showAuthStep('#loginStepPassword');$('#loginErr').textContent=message}
async function api(url,opt={}){const r=await fetch(url,{headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});const d=await r.json().catch(()=>({}));if(!r.ok){if((d.error==='SESSION_EXPIRED'||d.error==='UNAUTHORIZED')&&!url.startsWith('/api/login'))forceLoggedOut('Sesi tidak aktif selama 1 jam. Silakan login kembali.');throw new Error(d.error||`HTTP_${r.status}`)}return d}
async function touchAdminSession(){if(!adminUiAuthenticated)return;const now=Date.now();if(now-adminTouchAt<60000)return;adminTouchAt=now;try{await api('/api/session/touch',{method:'POST',body:'{}'})}catch{}}
function noteAdminActivity(){if(!adminUiAuthenticated)return;adminLastActivity=Date.now();touchAdminSession()}
async function idleLogout(){if(!adminUiAuthenticated)return;if(Date.now()-adminLastActivity<3600000)return;try{await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})}catch{}forceLoggedOut('Akun otomatis logout karena tidak ada aktivitas selama 1 jam.')}
function startAdminIdleGuard(){adminUiAuthenticated=true;adminLastActivity=Date.now();adminTouchAt=0;['pointerdown','keydown','touchstart','wheel','scroll'].forEach(ev=>window.addEventListener(ev,noteAdminActivity,{passive:true}));document.addEventListener('visibilitychange',()=>{if(!document.hidden)idleLogout()});adminIdleTimer=setInterval(idleLogout,30000);touchAdminSession()}

let currentChat=null,currentTitle='',currentChatMode='AI',liveUiBusy=false,liveUiTimer=null,chatListFingerprint='',messageFingerprint='',caseMetaFingerprint='',lastChatListPoll=0,lastConversationPoll=0,cannedCache=[],editingResponseId=null,promoCache=[],editingPromoId=null,importantCache=[],editingImportantId=null,importantFilter='ALL',kbCache=[],editingKbId=null,ctaCache=[],editingCtaId=null;
const humanDrafts=new Map(), humanLearnDrafts=new Map(), humanReplyDrafts=new Map(), humanExpanded=new Set(), humanHistoryLastRefresh=new Map();

function isTrueSystemBanner(m){
  const type=String(m?.sender_type||'').toLowerCase();
  if(type!=='system')return false;
  const t=String(m?.text||'').trim();
  return /Lebih Mudah Menghubungi Kami Via Telegram\s*&\s*Whatsapp/i.test(t)
    || /Dapatkan Prediksi Bola Akurat Dengan Klik link/i.test(t)
    || /^System(?:\s+Message)?:/i.test(t);
}
function stableMessageFingerprint(items=[]){
  return JSON.stringify((Array.isArray(items)?items:[]).map(m=>[
    m.event_id||'',m.sender_type||'',m.created_at||'',m.text||'',
    (Array.isArray(m.attachments)?m.attachments:[]).map(a=>[a.url||'',Boolean(a.isImage)]),
    m.feedback_rating||''
  ]));
}
function selectionInside(el){
  const sel=window.getSelection?.();
  if(!sel||sel.isCollapsed||!sel.anchorNode)return false;
  return el.contains(sel.anchorNode)||el.contains(sel.focusNode);
}
function preserveScrollOnRender(el,render,stickToBottom=false){
  const oldTop=el.scrollTop;
  const oldHeight=el.scrollHeight;
  const distanceBottom=Math.max(0,oldHeight-oldTop-el.clientHeight);
  render();
  if(stickToBottom){
    el.scrollTop=el.scrollHeight;
  }else{
    // Keep exactly the same visual reading position when history above/below changes.
    const heightDelta=el.scrollHeight-oldHeight;
    el.scrollTop=Math.max(0,oldTop+(heightDelta<0?heightDelta:0));
    if(distanceBottom<120)el.scrollTop=el.scrollHeight;
  }
}
async function copyMessageText(btn){
  const bubble=btn.closest('.msg');
  const body=bubble?.querySelector('.msgbody');
  const text=body?.innerText||'';
  if(!text)return;
  try{
    await navigator.clipboard.writeText(text);
    const old=btn.textContent;
    btn.textContent='✓ Copied';
    setTimeout(()=>{btn.textContent=old},1000);
  }catch{
    const r=document.createRange();r.selectNodeContents(body);
    const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);
    document.execCommand('copy');
    sel.removeAllRanges();
  }
}
function bindMessageActions(){
  $$('[data-copy-msg]').forEach(b=>{if(!b.dataset.bound){b.dataset.bound='1';b.onclick=()=>copyMessageText(b)}});
  $$('[data-good]').forEach(b=>{if(!b.dataset.bound){b.dataset.bound='1';b.onclick=async()=>{try{b.disabled=true;await api('/api/conversations/'+encodeURIComponent(currentChat)+'/feedback',{method:'POST',body:JSON.stringify({eventId:b.dataset.good,rating:'GOOD'})});b.textContent='✓ Bagus';messageFingerprint='';await openChat(currentChat,currentTitle,true)}catch(e){alert(e.message)}finally{b.disabled=false}}}});
  $$('[data-feedback]').forEach(b=>{if(!b.dataset.bound){b.dataset.bound='1';b.onclick=async()=>{const correction=prompt('Tulis jawaban yang seharusnya untuk kasus ini. Koreksi akan dipakai pada kasus serupa berikutnya:');if(!correction?.trim())return;try{await api('/api/conversations/'+encodeURIComponent(currentChat)+'/feedback',{method:'POST',body:JSON.stringify({eventId:b.dataset.feedback,rating:'BAD',correction:correction.trim()})});alert('Koreksi tersimpan dan langsung aktif.');messageFingerprint='';await Promise.all([loadLearning(),openChat(currentChat,currentTitle,true)])}catch(e){alert(e.message)}}}});
}

let shortcutMenu=null,shortcutTarget=null,shortcutMatches=[],shortcutIndex=0,shortcutTokenRange=null;
function normalizeShortcutValue(v=''){
  const x=String(v||'').trim();
  return x.startsWith('#')?x:'#'+x;
}
function ensureShortcutMenu(){
  if(shortcutMenu&&document.body.contains(shortcutMenu))return shortcutMenu;
  shortcutMenu=document.createElement('div');
  shortcutMenu.id='shortcutMenu';
  shortcutMenu.className='shortcutMenu hidden';
  shortcutMenu.setAttribute('role','listbox');
  document.body.appendChild(shortcutMenu);
  shortcutMenu.addEventListener('mousedown',e=>e.preventDefault());
  shortcutMenu.addEventListener('click',e=>{
    const row=e.target.closest('[data-shortcut-index]');
    if(!row)return;
    const idx=Number(row.dataset.shortcutIndex||0);
    chooseShortcut(idx);
  });
  return shortcutMenu;
}
function activeShortcutToken(textarea){
  const value=String(textarea?.value||'');
  const caret=Number.isFinite(textarea?.selectionStart)?textarea.selectionStart:value.length;
  const left=value.slice(0,caret);
  const m=left.match(/(?:^|\s)(#[^\s#]*)$/);
  if(!m)return null;
  const token=m[1]||'';
  const start=caret-token.length;
  return {token,start,end:caret,query:token.slice(1).toLowerCase()};
}
function scoreShortcut(row,q){
  const sc=normalizeShortcutValue(row.shortcut||'').toLowerCase();
  const key=sc.slice(1);
  const title=String(row.title||'').toLowerCase();
  const category=String(row.category||'').toLowerCase();
  const tags=(Array.isArray(row.tags)?row.tags:[]).join(' ').toLowerCase();
  const content=String(row.content||'').toLowerCase();
  if(!q)return 100-(row.source_kind==='manual'?0:10);
  let score=0;
  if(key===q)score+=100;
  if(key.startsWith(q))score+=70;
  else if(key.includes(q))score+=45;
  if(title.startsWith(q))score+=35;
  else if(title.includes(q))score+=20;
  if(category.includes(q))score+=10;
  if(tags.includes(q))score+=14;
  if(content.includes(q))score+=5;
  if(row.source_kind==='manual')score+=8;
  return score;
}
function shortcutCandidates(query=''){
  const q=String(query||'').toLowerCase();
  return (Array.isArray(cannedCache)?cannedCache:[])
    .filter(x=>String(x.content||'').trim())
    .map(x=>({...x,_shortcutScore:scoreShortcut(x,q)}))
    .filter(x=>x._shortcutScore>0)
    .sort((a,b)=>b._shortcutScore-a._shortcutScore || (a.source_kind==='manual'?-1:1))
    .slice(0,10);
}
function positionShortcutMenu(textarea){
  const menu=ensureShortcutMenu();
  const r=textarea.getBoundingClientRect();
  const width=Math.max(320,Math.min(560,r.width));
  menu.style.width=width+'px';
  menu.style.left=Math.max(8,Math.min(window.innerWidth-width-8,r.left))+'px';
  const menuH=Math.min(360,menu.scrollHeight||320);
  const below=window.innerHeight-r.bottom;
  if(below>=220){
    menu.style.top=Math.min(window.innerHeight-menuH-8,r.bottom+6)+'px';
  }else{
    menu.style.top=Math.max(8,r.top-menuH-6)+'px';
  }
}
function renderShortcutMenu(){
  const menu=ensureShortcutMenu();
  if(!shortcutTarget||!shortcutMatches.length){closeShortcutMenu();return;}
  menu.innerHTML=shortcutMatches.map((x,i)=>{
    const sc=normalizeShortcutValue(x.shortcut||'RESPONSE');
    const preview=String(x.content||'').replace(/\s+/g,' ').trim();
    const source=x.source_kind==='manual'?'Manual':'LiveChat';
    return `<div class="shortcutOption ${i===shortcutIndex?'active':''}" role="option" aria-selected="${i===shortcutIndex?'true':'false'}" data-shortcut-index="${i}"><div class="shortcutTop"><b>${esc(sc)}</b><span>${esc(x.title||x.category||'Response')}</span><small>${esc(source)}</small></div><div class="shortcutPreview">${esc(preview)}</div></div>`;
  }).join('');
  menu.classList.remove('hidden');
  positionShortcutMenu(shortcutTarget);
  const active=menu.querySelector('.shortcutOption.active');
  active?.scrollIntoView({block:'nearest'});
}
function closeShortcutMenu(){
  if(shortcutMenu)shortcutMenu.classList.add('hidden');
  shortcutTarget=null;shortcutMatches=[];shortcutIndex=0;shortcutTokenRange=null;
}
async function refreshShortcutMenu(textarea){
  const token=activeShortcutToken(textarea);
  if(!token){closeShortcutMenu();return false;}
  if(!cannedCache.length){try{await loadCanned()}catch{}}
  shortcutTarget=textarea;shortcutTokenRange=token;shortcutMatches=shortcutCandidates(token.query);shortcutIndex=0;
  if(!shortcutMatches.length){closeShortcutMenu();return false;}
  renderShortcutMenu();return true;
}
function chooseShortcut(index=shortcutIndex){
  if(!shortcutTarget||!shortcutTokenRange||!shortcutMatches.length)return false;
  const row=shortcutMatches[Math.max(0,Math.min(shortcutMatches.length-1,index))];
  if(!row)return false;
  const ta=shortcutTarget,range=shortcutTokenRange;
  const before=String(ta.value||'').slice(0,range.start);
  const after=String(ta.value||'').slice(range.end);
  const content=String(row.content||'').trim();
  ta.value=before+content+after;
  const caret=(before+content).length;
  ta.selectionStart=ta.selectionEnd=caret;
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  ta.focus();
  closeShortcutMenu();
  return true;
}
async function expandResponseShortcut(textarea){
  const token=activeShortcutToken(textarea);
  if(!token||!token.token.startsWith('#'))return false;
  const exact=shortcutCandidates(token.query).find(x=>normalizeShortcutValue(x.shortcut||'').slice(1).toLowerCase()===token.query);
  if(exact){
    shortcutTarget=textarea;shortcutTokenRange=token;shortcutMatches=[exact];shortcutIndex=0;
    return chooseShortcut(0);
  }
  try{
    const d=await api('/api/canned/shortcut?shortcut='+encodeURIComponent(token.token));
    const content=String(d.item?.content||'').trim();
    if(!content)return false;
    shortcutTarget=textarea;shortcutTokenRange=token;shortcutMatches=[d.item];shortcutIndex=0;
    return chooseShortcut(0);
  }catch(e){
    if(String(e.message||'').includes('SHORTCUT_NOT_FOUND'))return false;
    throw e;
  }
}
function bindShortcutTextarea(textarea,sendButton=null){
  if(!textarea||textarea.dataset.shortcutBound==='1')return;
  textarea.dataset.shortcutBound='1';
  textarea.setAttribute('autocomplete','off');
  textarea.addEventListener('input',()=>{refreshShortcutMenu(textarea)});
  textarea.addEventListener('focus',()=>{if(activeShortcutToken(textarea))refreshShortcutMenu(textarea)});
  textarea.addEventListener('blur',()=>setTimeout(()=>{if(shortcutTarget===textarea)closeShortcutMenu()},140));
  textarea.addEventListener('keydown',async e=>{
    const menuOpen=shortcutTarget===textarea&&shortcutMatches.length>0&&shortcutMenu&&!shortcutMenu.classList.contains('hidden');
    if(menuOpen&&['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(e.key)){
      if(e.key==='Escape'){e.preventDefault();closeShortcutMenu();return;}
      if(e.key==='ArrowDown'){e.preventDefault();shortcutIndex=(shortcutIndex+1)%shortcutMatches.length;renderShortcutMenu();return;}
      if(e.key==='ArrowUp'){e.preventDefault();shortcutIndex=(shortcutIndex-1+shortcutMatches.length)%shortcutMatches.length;renderShortcutMenu();return;}
      if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();chooseShortcut(shortcutIndex);return;}
    }
    const hasShortcut=Boolean(activeShortcutToken(textarea));
    if((e.key==='Tab'||e.key==='Enter')&&!e.shiftKey&&hasShortcut){
      e.preventDefault();
      const expanded=await expandResponseShortcut(textarea).catch(err=>{alert(err.message);return false});
      if(expanded)return;
      await refreshShortcutMenu(textarea);
      return;
    }
    if(e.key==='Enter'&&!e.shiftKey&&sendButton&&!hasShortcut){
      e.preventDefault();sendButton.click();
    }
  });
}
window.addEventListener('resize',()=>{if(shortcutTarget)positionShortcutMenu(shortcutTarget)});
window.addEventListener('scroll',()=>{if(shortcutTarget)positionShortcutMenu(shortcutTarget)},true);
document.addEventListener('mousedown',e=>{if(shortcutMenu&&!shortcutMenu.contains(e.target)&&e.target!==shortcutTarget)closeShortcutMenu()});
function navigateChatByKeyboard(direction){
  const tab=$('#tab-chats');
  if(!tab?.classList.contains('active'))return false;
  const rows=$$('.chatitem[data-id]');
  if(!rows.length)return false;
  let idx=rows.findIndex(x=>x.dataset.id===currentChat);
  if(idx<0)idx=direction>0?-1:0;
  idx=Math.max(0,Math.min(rows.length-1,idx+direction));
  const el=rows[idx]; if(!el)return false;
  currentChatMode=el.dataset.mode||'AI';
  rows.forEach(x=>x.classList.toggle('active',x===el));
  el.scrollIntoView({block:'nearest'});
  openChat(el.dataset.id,el.querySelector('b')?.textContent||el.dataset.id);
  return true;
}
window.addEventListener('keydown',e=>{
  if(!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;
  const tag=String(document.activeElement?.tagName||'').toUpperCase();
  if(['INPUT','TEXTAREA','SELECT'].includes(tag)||document.activeElement?.isContentEditable)return;
  if(navigateChatByKeyboard(e.key==='ArrowDown'?1:-1))e.preventDefault();
});
async function boot(){const me=await api('/api/me');if(!me.ok){$('#login').classList.remove('hidden');showAuthStep('#loginStepPassword');return}$('#app').classList.remove('hidden');startAdminIdleGuard();await Promise.all([loadStatus(),loadChats(),loadWebsiteProfile(),loadRules(),loadKb(),loadCanned(),loadPromos(),loadImportant(),loadHuman(),loadBridge(),loadLearning(),loadLogs(),loadCta(),loadHealth(),loadSecurity()]);startLiveUi()}
$('#loginBtn').onclick=async()=>{try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#u').value,password:$('#p').value})});pending2faToken=d.pendingToken||'';if(d.next==='2fa_setup'){if(!d.qrDataUrl||!d.manualKey)throw new Error('TWOFA_SETUP_DATA_MISSING');$('#twofaQr').src=d.qrDataUrl;$('#twofaManualKey').textContent=d.manualKey;$('#twofaSetupCode').value='';showAuthStep('#loginStepSetup');$('#twofaSetupCode').focus();return}if(d.next==='2fa_verify'){ $('#twofaCode').value='';showAuthStep('#loginStepVerify');$('#twofaCode').focus();return}if(d.next==='done')location.reload();}catch(e){$('#loginErr').textContent=e.message==='LOGIN_FAILED'?'ID atau password salah.':'Login gagal: '+e.message}};
$('#twofaSetupBtn').onclick=async()=>{try{const code=$('#twofaSetupCode').value.trim();if(!/^\d{6}$/.test(code))return $('#loginErr').textContent='Masukkan 6 digit kode 2FA.';const d=await api('/api/login/2fa/setup/verify',{method:'POST',body:JSON.stringify({pendingToken:pending2faToken,code})});if(Array.isArray(d.recoveryCodes)&&d.recoveryCodes.length)alert('Simpan recovery code ini di tempat aman. Setiap kode hanya berlaku sekali:\n\n'+d.recoveryCodes.join('\n'));location.reload()}catch(e){$('#loginErr').textContent=e.message==='TWOFA_INVALID'?'Kode 2FA tidak valid. Coba kode terbaru.':'Gagal mengaktifkan 2FA: '+e.message}};
$('#twofaVerifyBtn').onclick=async()=>{try{const code=$('#twofaCode').value.trim();if(!code)return $('#loginErr').textContent='Masukkan kode 2FA atau recovery code.';await api('/api/login/2fa/verify',{method:'POST',body:JSON.stringify({pendingToken:pending2faToken,code})});location.reload()}catch(e){$('#loginErr').textContent=e.message==='TWOFA_INVALID'?'Kode 2FA tidak valid. Coba kode terbaru.':(e.message==='TWOFA_SESSION_EXPIRED'?'Sesi 2FA habis. Login ulang dengan ID dan password.':'Verifikasi 2FA gagal: '+e.message)}};
$('#copy2faKey').onclick=async()=>{const key=$('#twofaManualKey').textContent.trim();try{await navigator.clipboard.writeText(key);$('#copy2faKey').textContent='Tersalin';setTimeout(()=>$('#copy2faKey').textContent='Copy',1200)}catch{}};
['#p','#u'].forEach(sel=>$(sel)?.addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click()}));
$('#twofaSetupCode')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('#twofaSetupBtn').click()});
$('#twofaCode')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('#twofaVerifyBtn').click()});
$('#logoutBtn').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}finally{location.reload()}};
$$('nav [data-tab]').forEach(b=>b.onclick=()=>{if(b.dataset.tab!=='chats')document.body.classList.remove('mobile-chat-open');$$('nav [data-tab]').forEach(x=>x.classList.toggle('active',x===b));$$('.tab').forEach(x=>x.classList.remove('active'));$('#tab-'+b.dataset.tab).classList.add('active');if(b.dataset.tab==='website')loadWebsiteProfile();if(b.dataset.tab==='human')loadHuman();if(b.dataset.tab==='bridge')loadBridge();if(b.dataset.tab==='responses')loadCanned();if(b.dataset.tab==='learning')loadLearning();if(b.dataset.tab==='promos')loadPromos();if(b.dataset.tab==='important')loadImportant();if(b.dataset.tab==='telegramcta')loadCta();if(b.dataset.tab==='health')loadHealth();if(b.dataset.tab==='security')loadSecurity()});
async function loadStatus(){const d=await api('/api/status');$('#sDb').textContent=d.db?'CONNECTED':'ERROR';$('#sDb').className=d.db?'ok':'bad';$('#sLc').textContent=d.livechatConfigured?'READY':'MISSING';$('#sAi').textContent=d.openaiConfigured?'READY':'MISSING';$('#sPoll').textContent=d.poller?.paused?'PAUSED':(d.poller?.running?'SYNCING':(d.poller?.lastTick?'ACTIVE':'STARTING'));$('#systemEnabled').checked=d.systemEnabled;$('#greetingEnabled').checked=d.greetingEnabled;$('#humanAskEnabled').checked=d.humanAskEnabled;$('#timezone').textContent=d.timezone||'-';$('#model').textContent=d.model||'-';const st=d.replyStyle||{};if($('#replyStyle'))$('#replyStyle').value=st.replyStyle||'NATURAL_CS';if($('#replyLength'))$('#replyLength').value=st.replyLength||'SHORT';if($('#boskuUsage'))$('#boskuUsage').value=st.boskuUsage||'MODERATE';if($('#emojiUsage'))$('#emojiUsage').value=st.emojiUsage||'LIGHT';if($('#formalLanguage'))$('#formalLanguage').checked=Boolean(st.formalLanguage);if($('#replyStyleNote'))$('#replyStyleNote').value=st.replyStyleNote||'';$('#warnings').textContent=(d.warnings||[]).join(' · ')||'Tidak ada warning.'}
$('#systemEnabled').onchange=async e=>{const wanted=e.target.checked;try{await api('/api/settings/system-enabled',{method:'POST',body:JSON.stringify({enabled:wanted})});await loadStatus();}catch(err){e.target.checked=!wanted;alert(err.message)}};
$('#greetingEnabled').onchange=async e=>api('/api/settings/greeting',{method:'POST',body:JSON.stringify({enabled:e.target.checked})});
$('#humanAskEnabled').onchange=async e=>api('/api/settings/human-ask',{method:'POST',body:JSON.stringify({enabled:e.target.checked})});
$('#saveReplyStyle').onclick=async()=>{const btn=$('#saveReplyStyle'),msg=$('#replyStyleSaved');btn.disabled=true;msg.textContent='Menyimpan...';try{const d=await api('/api/settings/reply-style',{method:'PUT',body:JSON.stringify({replyStyle:$('#replyStyle').value,replyLength:$('#replyLength').value,boskuUsage:$('#boskuUsage').value,emojiUsage:$('#emojiUsage').value,formalLanguage:$('#formalLanguage').checked,replyStyleNote:$('#replyStyleNote').value})});msg.textContent='Gaya bahasa tersimpan. Balasan berikutnya langsung memakai setting ini.';setTimeout(()=>{msg.textContent=''},3500)}catch(e){msg.textContent='ERROR: '+e.message}finally{btn.disabled=false}};
function testBtn(sel,url){$(sel).onclick=async()=>{const out=$('#testOut');out.textContent='Testing...';try{out.textContent=JSON.stringify(await api(url,{method:'POST'}),null,2)}catch(e){out.textContent='ERROR: '+e.message}}}
testBtn('#testLc','/api/test/livechat');testBtn('#testAi','/api/test/openai');testBtn('#testSync','/api/test/sync');testBtn('#testDetail','/api/test/chat-detail');
$('#testTypo').onclick=async()=>{$('#typoOut').textContent=JSON.stringify(await api('/api/test/typo',{method:'POST',body:JSON.stringify({text:$('#typoText').value})}),null,2)};
async function loadChats(){
  const d=await api('/api/conversations');
  const items=Array.isArray(d.items)?d.items:[];
  const active=items.find(x=>x.chat_id===currentChat);
  if(active){currentChatMode=active.handling_mode==='HUMAN'?'HUMAN':'AI';renderChatMode();$('#typingState').textContent=active.member_typing?'Member sedang mengetik…':''}
  if($('#activeChatCount'))$('#activeChatCount').textContent=items.length;

  // LC-style stable inbox: only touch the DOM when actual chat data changed. This keeps
  // scroll position, selection and hover state stable instead of visually "refreshing" every tick.
  const fingerprint=JSON.stringify(items.map(x=>[x.chat_id,x.customer_name,x.handling_mode,x.member_typing,x.last_message,x.last_message_at,x.last_event_at,x.updated_at,x.needs_reply]));
  if(fingerprint===chatListFingerprint)return;
  chatListFingerprint=fingerprint;
  const list=$('#chatList'),oldScroll=list.scrollTop;
  list.innerHTML=items.map(x=>{const human=x.handling_mode==='HUMAN';const typing=x.member_typing?'<span class="typing">sedang mengetik…</span>':'';const name=String(x.customer_name||x.chat_id);const initials=esc(name.trim().slice(0,1).toUpperCase()||'?');const preview=String(x.last_message||'').trim()||((x.workflow_state||'')?String(x.workflow_state):human?'Human takeover':'AI active');const when=x.last_message_at||x.last_event_at||x.updated_at;const time=when?new Date(when).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'';const unread=x.needs_reply?'<span class="unreaddot" title="Menunggu balasan"></span>':'';return `<div class="chatitem ${x.chat_id===currentChat?'active':''}" data-id="${esc(x.chat_id)}" data-mode="${human?'HUMAN':'AI'}"><div class="chatlistavatar">${initials}</div><div class="chatitemtext"><div class="chatitemtop"><b>${esc(name)}</b><span class="chatlisttime">${esc(time)}</span></div><small>${esc(preview)}</small>${typing}</div>${unread}</div>`}).join('')||'<div class="emptychat">Belum ada chat aktif.</div>';
  list.scrollTop=oldScroll;
  $$('.chatitem[data-id]').forEach(el=>el.onclick=()=>{currentChatMode=el.dataset.mode||'AI';$$('.chatitem[data-id]').forEach(x=>x.classList.toggle('active',x===el));openChat(el.dataset.id,el.querySelector('b')?.textContent||el.dataset.id)})
}
function renderCaseMeta(d={}){
  const el=$('#caseMeta'); if(!el)return;
  const b=d.brain||{}, st=d.state||{};
  const goal=String(b.primaryIntent||b.primary_intent||b.goal||st.workflow_type||'GENERAL');
  const status=String(b.status||b.stage||st.workflow_state||'ACTIVE');
  const known=Array.isArray(b.knownFacts)?b.knownFacts:(Array.isArray(b.known_facts)?b.known_facts:[]);
  const missing=Array.isArray(b.missingInfo)?b.missingInfo:(Array.isArray(b.missing_info)?b.missing_info:[]);
  const next=String(b.nextStep||b.next_step||'');
  const feedback=d.feedbackStats||{};
  el.classList.remove('hidden');
  el.innerHTML=`<div><b>Kasus</b><span>${esc(goal)}</span></div><div><b>Status</b><span>${esc(status)}</span></div><div><b>Data diketahui</b><span>${esc(known.slice(0,3).join(' · ')||'-')}</span></div><div><b>Masih dibutuhkan</b><span>${esc(missing.slice(0,3).join(' · ')||'-')}</span></div>${next?`<div class="casewide"><b>Langkah berikutnya</b><span>${esc(next)}</span></div>`:''}<div class="casequality"><b>Quality</b><span>👍 ${Number(feedback.good||0)} · 👎 ${Number(feedback.bad||0)}</span></div>`;
}
async function openChat(id,title,auto=false){
  if(!auto&&window.matchMedia&&window.matchMedia('(max-width: 768px)').matches){document.body.classList.add('mobile-chat-open')}
  const switchingChat=currentChat!==id;
  if(switchingChat){messageFingerprint='';caseMetaFingerprint=''}
  currentChat=id;
  currentTitle=title||currentTitle;
  $('#chatTitle').textContent=currentTitle;
  if($('#chatAvatar'))$('#chatAvatar').textContent=(currentTitle||'?').trim().slice(0,1).toUpperCase()||'?';
  if($('#endChatBtn'))$('#endChatBtn').disabled=false;
  renderChatMode();

  const box=$('#messages');
  const nearBottom=(box.scrollHeight-box.scrollTop-box.clientHeight)<120;
  const d=await api('/api/conversations/'+encodeURIComponent(id));

  // User may switch chat while this fetch is in flight. Never paint stale data into a new room.
  if(currentChat!==id)return;

  const metaFp=JSON.stringify([d.brain||{},d.state||{},d.feedbackStats||{}]);
  if(metaFp!==caseMetaFingerprint){
    caseMetaFingerprint=metaFp;
    renderCaseMeta(d);
  }

  const items=Array.isArray(d.items)?d.items:[];
  const fp=stableMessageFingerprint(items);
  if(fp===messageFingerprint){
    // Absolutely no message DOM mutation when nothing changed; selection/copy stays intact.
    if(!auto&&nearBottom)box.scrollTop=box.scrollHeight;
    return;
  }

  // Do not destroy an active text selection just because a poll arrived.
  if(auto&&selectionInside(box))return;

  const firstAt=items?.[0]?.created_at?new Date(items[0].created_at):null;
  const started=firstAt?`<div class="startedline"><span>Started · ${esc(firstAt.toLocaleString('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))}</span></div>`:'';
  const html=started+items.map(m=>{
    const at=Array.isArray(m.attachments)?m.attachments:[];
    const media=at.map(a=>a.isImage&&a.url?`<a href="${esc(a.url)}" target="_blank" rel="noreferrer"><img class="chatimg" src="${esc(a.url)}" alt="attachment" loading="lazy" decoding="async"></a>`:(a.url?`<a href="${esc(a.url)}" target="_blank" rel="noreferrer">Lihat file</a>`:'')).join('');
    const feedback=m.sender_type==='ai'&&m.event_id?`<div class="feedbackRow"><button class="feedbackGood" data-good="${esc(m.event_id)}">👍 Bagus</button><button class="feedbackBtn" title="Tegur AI / Koreksi" data-feedback="${esc(m.event_id)}">✎ Koreksi</button></div>`:'';
    const originalType=String(m.sender_type||'unknown');
    // True LiveChat promo/system banners keep their System identity.
    // Other outbound action/system records are treated as CS to avoid fake member messages.
    const type=originalType==='customer'?'customer':isTrueSystemBanner(m)?'system':'ai';
    const label=type==='customer'?(currentTitle||'Member'):type==='system'?'System':'CS';
    const ts=m.created_at?new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'';
    const key=esc(String(m.event_id||m.id||`${m.created_at||''}:${m.text||''}`).slice(0,160));
    return `<div class="msgrow ${esc(type)}" data-msg-key="${key}" data-original-sender="${esc(originalType)}"><div class="msg ${esc(type)}"><div class="msghead"><div class="who">${esc(label)}</div><button class="copymsg" type="button" data-copy-msg title="Copy pesan">Copy</button></div><div class="msgbody">${esc(m.text)}</div>${media?`<div class="attachments">${media}</div>`:''}${feedback}${ts?`<div class="msgtime">${esc(ts)}</div>`:''}</div></div>`;
  }).join('');

  preserveScrollOnRender(box,()=>{
    box.innerHTML=html;
    messageFingerprint=fp;
    bindMessageActions();
  },!auto||nearBottom);
}

function renderChatMode(){const human=currentChatMode==='HUMAN';$('#takeoverBtn').disabled=human;$('#enableAiBtn').disabled=!human;$('#manualText').disabled=!human;$('#sendManual').disabled=!human;if($('#pickImage'))$('#pickImage').disabled=!human;$('#manualText').placeholder=human?'Balas manual sebagai human...':'Klik Take Over untuk balas manual';$('#chatMode').textContent=human?'HUMAN TAKEOVER':'AI ACTIVE';$('#chatMode').className=human?'pill warnpill':'pill okpill'}
$('#refreshChats').onclick=loadChats;
if($('#mobileBackChats'))$('#mobileBackChats').onclick=()=>{document.body.classList.remove('mobile-chat-open');};
$('#takeoverBtn').onclick=async()=>{if(currentChat){await api(`/api/conversations/${encodeURIComponent(currentChat)}/takeover`,{method:'POST'});currentChatMode='HUMAN';renderChatMode();await loadChats();$('#manualText').focus()}};
$('#enableAiBtn').onclick=async()=>{if(currentChat){await api(`/api/conversations/${encodeURIComponent(currentChat)}/enable-ai`,{method:'POST'});currentChatMode='AI';renderChatMode();chatListFingerprint='';await loadChats()}};
$('#endChatBtn').onclick=async()=>{if(!currentChat)return;if(!confirm(`End chat ${currentTitle||currentChat}? Chat akan ditutup juga di LiveChat.`))return;const b=$('#endChatBtn');b.disabled=true;try{await api(`/api/conversations/${encodeURIComponent(currentChat)}/end`,{method:'POST'});currentChat=null;currentTitle='';messageFingerprint='';caseMetaFingerprint='';document.body.classList.remove('mobile-chat-open');$('#chatTitle').textContent='Pilih chat';$('#chatAvatar').textContent='?';$('#typingState').textContent='';$('#messages').innerHTML='<div class="conversationempty">Chat sudah ditutup.</div>';currentChatMode='AI';renderChatMode();await loadChats()}catch(e){alert('Gagal end chat: '+e.message);b.disabled=false}};
let pendingManualImage=null;
function clearManualImage(){pendingManualImage=null;const f=$('#manualImage');if(f)f.value='';if($('#imagePreview'))$('#imagePreview').removeAttribute('src');if($('#imagePreviewBar'))$('#imagePreviewBar').classList.add('hidden')}
function setManualImage(file){
  if(!file)return clearManualImage();
  const allowed=['image/jpeg','image/png','image/webp','image/gif'];
  if(!allowed.includes(String(file.type||'').toLowerCase()))return alert('Format gambar harus JPG, PNG, WebP, atau GIF.');
  if(file.size>8*1024*1024)return alert('Ukuran gambar maksimal 8 MB.');
  pendingManualImage=file;
  const url=URL.createObjectURL(file);const img=$('#imagePreview');if(img){img.onload=()=>URL.revokeObjectURL(url);img.src=url}
  if($('#imagePreviewName'))$('#imagePreviewName').textContent=file.name||'gambar';
  if($('#imagePreviewSize'))$('#imagePreviewSize').textContent=`${(file.size/1024/1024).toFixed(2)} MB`;
  if($('#imagePreviewBar'))$('#imagePreviewBar').classList.remove('hidden');
}
async function uploadManualImage(file){
  const r=await fetch(`/api/conversations/${encodeURIComponent(currentChat)}/image`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name||'image')},body:file});
  const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={error:text||`HTTP_${r.status}`}}if(!r.ok)throw new Error(data.error||`HTTP_${r.status}`);return data;
}
async function sendManualMessage(){
  const t=$('#manualText').value.trim();
  if(!currentChat||(!t&&!pendingManualImage))return;
  if(currentChatMode!=='HUMAN')return alert('Klik Take Over terlebih dahulu agar AI berhenti.');
  const b=$('#sendManual');const a=$('#pickImage');b.disabled=true;if(a)a.disabled=true;
  try{
    if(pendingManualImage){await uploadManualImage(pendingManualImage);clearManualImage();}
    if(t){await api(`/api/conversations/${encodeURIComponent(currentChat)}/send`,{method:'POST',body:JSON.stringify({text:t})});$('#manualText').value='';$('#manualText').style.height='auto';}
    await openChat(currentChat,currentTitle)
  }catch(e){alert('Gagal mengirim: '+e.message)}finally{b.disabled=false;if(a)a.disabled=currentChatMode!=='HUMAN'}
}
$('#sendManual').onclick=sendManualMessage;
if($('#pickImage'))$('#pickImage').onclick=()=>{if(currentChatMode!=='HUMAN')return alert('Klik Take Over terlebih dahulu.');$('#manualImage').click()};
if($('#manualImage'))$('#manualImage').onchange=e=>setManualImage(e.target.files?.[0]||null);
if($('#removeImage'))$('#removeImage').onclick=clearManualImage;
bindShortcutTextarea($('#manualText'),$('#sendManual'));
$('#manualText').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(140,e.target.scrollHeight)+'px'});
$('#manualText').addEventListener('paste',e=>{if(currentChatMode!=='HUMAN')return;const file=[...(e.clipboardData?.files||[])].find(x=>String(x.type||'').startsWith('image/'));if(file){e.preventDefault();setManualImage(file)}});

function humanActionButtons(x){
  const intent=String(x.intent||'GENERAL').toUpperCase();
  if(intent==='FORGOT_PASSWORD'){
    const q=String(x.ai_question||'').toLowerCase();
    if(q.includes('member sudah deposit')) return `<button class="quickaction" data-hact="RESET_DEPOSIT_NOT_IN" data-hid="${x.id}">DANA Belum Masuk</button>`;
    return `<button class="quickaction" data-hact="RESET_DEPOSIT_FIRST" data-hid="${x.id}">Suruh Deposit Dahulu</button><button class="quickaction" data-hact="RESET_NOT_REGISTERED" data-hid="${x.id}">Rekening Tidak Terdaftar</button>`;
  }
  if(intent==='WITHDRAW_PROBLEM') return `<button class="quickaction" data-hact="WD_QUEUE" data-hid="${x.id}">WD Sedang Dalam Antrian</button><button class="quickaction" data-hact="WD_REQUEST_VALID_ACCOUNT" data-hid="${x.id}">Minta Rek Valid</button><button class="quickaction" data-hact="WD_DANA_LIMIT" data-hid="${x.id}">DANA Limit</button>`;
  if(intent==='DEPOSIT_PROBLEM') return `<button class="quickaction" data-hact="DP_PROCESSED" data-hid="${x.id}">DP MASUK</button><button class="quickaction" data-hact="DP_NOT_FOUND" data-hid="${x.id}">DP BELUM MASUK</button>`;
  if(intent.includes('BONUS')) return `<button class="quickaction" data-hact="BONUS_DONE" data-hid="${x.id}">DONE</button><button class="quickaction" data-hact="BONUS_DEPOSIT_FIRST" data-hid="${x.id}">Silakan Deposit Dahulu</button>`;
  return '';
}
function humanMessageHtml(m,name){
  const at=Array.isArray(m.attachments)?m.attachments:[];
  const media=at.map(a=>a.isImage&&a.url?`<a href="${esc(a.url)}" target="_blank" rel="noreferrer"><img class="chatimg" src="${esc(a.url)}" alt="attachment"></a>`:(a.url?`<a href="${esc(a.url)}" target="_blank" rel="noreferrer">Lihat file</a>`:'')).join('');
  const originalType=String(m.sender_type||'unknown');
  const type=originalType==='customer'?'customer':isTrueSystemBanner(m)?'system':'ai';
  const label=type==='customer'?(name||'Member'):type==='system'?'System':'CS';
  const ts=m.created_at?new Date(m.created_at).toLocaleString('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  return `<div class="msgrow ${esc(type)}" data-original-sender="${esc(originalType)}"><div class="msg ${esc(type)}"><div class="who">${esc(label)}</div><div class="msgbody">${esc(m.text)}</div>${media?`<div class="attachments">${media}</div>`:''}${ts?`<div class="msgtime">${esc(ts)}</div>`:''}</div></div>`;
}
async function loadHumanConversation(id,chatId,{force=false,scrollBottom=false}={}){
  const wrap=document.querySelector(`[data-human-thread="${CSS.escape(String(id))}"]`); if(!wrap||!humanExpanded.has(String(id)))return;
  const now=Date.now(),last=humanHistoryLastRefresh.get(String(id))||0;if(!force&&now-last<1800)return;humanHistoryLastRefresh.set(String(id),now);
  try{
    const d=await api('/api/conversations/'+encodeURIComponent(chatId)+'?full=1');
    const name=wrap.dataset.member||'Member', box=wrap.querySelector('.humanHistory');
    const near=box?(box.scrollHeight-box.scrollTop-box.clientHeight)<120:true;
    const html=(d.items||[]).map(m=>humanMessageHtml(m,name)).join('')||'<div class="conversationempty">Belum ada history lokal untuk chat ini.</div>';
    if(box&&box.innerHTML!==html)box.innerHTML=html;
    const human=d.state?.handling_mode==='HUMAN';
    const mode=wrap.querySelector('.humanMode'); if(mode){mode.textContent=human?'HUMAN TAKEOVER':'AI ACTIVE';mode.className=human?'pill warnpill humanMode':'pill okpill humanMode'}
    const ta=wrap.querySelector('.humanDirectText'), send=wrap.querySelector('.humanDirectSend'), take=wrap.querySelector('[data-htakeover]'), aiBtn=wrap.querySelector('[data-henableai]');
    if(ta){ta.disabled=!human;ta.placeholder=human?'Balas langsung ke member dari Tanya Staff...':'Klik Take Over agar AI berhenti dan balasan manual aktif';}
    if(send)send.disabled=!human;
    if(take)take.disabled=human;
    if(aiBtn)aiBtn.disabled=!human;
    if(box&&(scrollBottom||near))box.scrollTop=box.scrollHeight;
  }catch(e){const box=wrap.querySelector('.humanHistory');if(box)box.innerHTML=`<div class="conversationempty">Gagal memuat percakapan: ${esc(e.message)}</div>`}
}
async function loadHuman(){
  // Preserve what staff is typing. Auto refresh must never erase drafts.
  // Preserve direct-reply drafts and expanded conversations during realtime refresh.
  $$('#humanList textarea[id^="ha-"]').forEach(t=>humanDrafts.set(t.id.slice(3),t.value));
  $$('#humanList textarea[id^="hr-"]').forEach(t=>humanReplyDrafts.set(t.id.slice(3),t.value));
  $$('#humanList input[id^="learn-"]').forEach(c=>humanLearnDrafts.set(c.id.slice(6),c.checked));
  const focused=document.activeElement?.id||'';
  const d=await api('/api/human-requests?status=OPEN');$('#humanBadge').textContent=d.items.length;
  $('#humanList').innerHTML=d.items.map(x=>{
    const xid=String(x.id),human=String(x.handling_mode||'AI')==='HUMAN',expanded=humanExpanded.has(xid),brain=x.case_brain||{};
    const known=Array.isArray(brain.knownFacts)?brain.knownFacts:(Array.isArray(brain.known_facts)?brain.known_facts:[]);
    const missing=Array.isArray(brain.missingInfo)?brain.missingInfo:(Array.isArray(brain.missing_info)?brain.missing_info:[]);
    return `<div class="request humanRequest" data-human-card="${x.id}"><div class="requesthead"><div><b>${esc(x.customer_name||x.chat_id)}</b><span class="pill">${esc(x.intent||'GENERAL')}</span><span class="${human?'pill warnpill':'pill okpill'}">${human?'HUMAN TAKEOVER':'AI WAITING STAFF'}</span></div><small>${new Date(x.created_at).toLocaleString()}</small></div><div class="requestbody"><div class="humanSummary"><div><b>Member</b><p>${esc(x.member_message)}</p></div><div><b>AI bertanya ke staff</b><p>${esc(x.ai_question)}</p></div></div>${(known.length||missing.length)?`<div class="humanFacts"><span><b>Diketahui:</b> ${esc(known.slice(0,5).join(' · ')||'-')}</span><span><b>Masih dibutuhkan:</b> ${esc(missing.slice(0,5).join(' · ')||'-')}</span></div>`:''}<div class="row wrap humanPrimaryActions"><button data-hopen="${x.id}" data-chat="${esc(x.chat_id)}">${expanded?'Tutup Percakapan':'Buka Percakapan'}</button><button data-hgoto="${x.id}" data-chat="${esc(x.chat_id)}" data-name="${esc(x.customer_name||x.chat_id)}">Buka di Percakapan</button><button class="warn" data-htakeover-card="${x.id}" data-chat="${esc(x.chat_id)}" ${human?'disabled':''}>Take Over</button><button data-henableai-card="${x.id}" data-chat="${esc(x.chat_id)}" ${human?'':'disabled'}>Kembalikan ke AI</button></div>${expanded?`<div class="humanThread" data-human-thread="${x.id}" data-member="${esc(x.customer_name||x.chat_id)}"><div class="row between humanThreadHead"><b>Seluruh Percakapan</b><span class="${human?'pill warnpill':'pill okpill'} humanMode">${human?'HUMAN TAKEOVER':'AI ACTIVE'}</span></div><div class="humanHistory"><div class="conversationempty">Memuat seluruh history...</div></div><div class="humanComposer"><textarea class="humanDirectText" id="hr-${x.id}" rows="2" ${human?'':'disabled'} placeholder="${human?'Balas langsung ke member dari Tanya Staff...':'Klik Take Over agar AI berhenti dan balasan manual aktif'}">${esc(humanReplyDrafts.get(xid)||'')}</textarea><button class="humanDirectSend" data-hsend="${x.id}" data-chat="${esc(x.chat_id)}" ${human?'':'disabled'}>Kirim ke Member</button></div><div class="row wrap"><button class="warn" data-htakeover="${x.id}" data-chat="${esc(x.chat_id)}" ${human?'disabled':''}>Take Over</button><button data-henableai="${x.id}" data-chat="${esc(x.chat_id)}" ${human?'':'disabled'}>Kembalikan ke AI</button></div></div>`:''}${humanActionButtons(x)?`<div class="quickactions">${humanActionButtons(x)}</div>`:''}<textarea id="ha-${x.id}" rows="3" placeholder="Tulis data/instruksi untuk AI. Untuk reset, reply bisa berisi User ID dan Password.">${esc(humanDrafts.get(xid)||'')}</textarea><label class="savelearn"><input type="checkbox" id="learn-${x.id}" ${humanLearnDrafts.get(xid)?'checked':''}> Simpan jawaban ini sebagai knowledge untuk kasus berikutnya</label><div class="row wrap"><button data-answer="${x.id}">${human?'Simpan ke AI (Belajar)':'Kirim ke AI & Balas Member'}</button><button data-telegram="${x.id}">Kirim ke Telegram</button><button class="ghostbtn" data-cancel="${x.id}">Batalkan</button></div></div></div>`
  }).join('')||'<div class="panel">Tidak ada pertanyaan AI ke staff.</div>';
  $$('#humanList textarea[id^="ha-"]').forEach(t=>t.addEventListener('input',()=>humanDrafts.set(t.id.slice(3),t.value)));
  $$('#humanList textarea[id^="hr-"]').forEach(t=>t.addEventListener('input',()=>humanReplyDrafts.set(t.id.slice(3),t.value)));
  $$('#humanList input[id^="learn-"]').forEach(c=>c.addEventListener('change',()=>humanLearnDrafts.set(c.id.slice(6),c.checked)));
  if(focused&&document.getElementById(focused)){const el=document.getElementById(focused);el.focus();if(el.tagName==='TEXTAREA')el.selectionStart=el.selectionEnd=el.value.length}
  $$('[data-hopen]').forEach(b=>b.onclick=async()=>{const id=String(b.dataset.hopen);if(humanExpanded.has(id))humanExpanded.delete(id);else humanExpanded.add(id);await loadHuman();if(humanExpanded.has(id))await loadHumanConversation(id,b.dataset.chat,{force:true,scrollBottom:true})});
  $$('[data-hgoto]').forEach(b=>b.onclick=async()=>{const nav=$('nav [data-tab="chats"]');if(nav)nav.click();currentChatMode='AI';await openChat(b.dataset.chat,b.dataset.name||b.dataset.chat);const d=await api('/api/conversations/'+encodeURIComponent(b.dataset.chat));currentChatMode=d.state?.handling_mode==='HUMAN'?'HUMAN':'AI';renderChatMode()});
  async function takeHuman(id,chat){await api('/api/conversations/'+encodeURIComponent(chat)+'/takeover',{method:'POST'});humanExpanded.add(String(id));await loadHuman();await loadHumanConversation(String(id),chat,{force:true,scrollBottom:true});const ta=$('#hr-'+id);if(ta)ta.focus()}
  async function enableHumanAi(id,chat){await api('/api/conversations/'+encodeURIComponent(chat)+'/enable-ai',{method:'POST'});humanExpanded.add(String(id));await loadHuman();await loadHumanConversation(String(id),chat,{force:true})}
  $$('[data-htakeover-card]').forEach(b=>b.onclick=()=>takeHuman(b.dataset.htakeoverCard,b.dataset.chat).catch(e=>alert(e.message)));
  $$('[data-henableai-card]').forEach(b=>b.onclick=()=>enableHumanAi(b.dataset.henableaiCard,b.dataset.chat).catch(e=>alert(e.message)));
  $$('[data-htakeover]').forEach(b=>b.onclick=()=>takeHuman(b.dataset.htakeover,b.dataset.chat).catch(e=>alert(e.message)));
  $$('[data-henableai]').forEach(b=>b.onclick=()=>enableHumanAi(b.dataset.henableai,b.dataset.chat).catch(e=>alert(e.message)));
  $$('[data-hsend]').forEach(b=>b.onclick=async()=>{const id=String(b.dataset.hsend),chat=b.dataset.chat,ta=$('#hr-'+id),text=ta?.value.trim();if(!text)return;humanReplyDrafts.set(id,text);b.disabled=true;try{await api('/api/conversations/'+encodeURIComponent(chat)+'/send',{method:'POST',body:JSON.stringify({text})});humanReplyDrafts.set(id,'');if(ta)ta.value='';await Promise.all([loadHumanConversation(id,chat,{force:true,scrollBottom:true}),loadChats()])}catch(e){alert(e.message)}finally{b.disabled=false}});
  $$('#humanList textarea.humanDirectText').forEach(t=>{const id=t.id.slice(3),btn=document.querySelector(`[data-hsend="${CSS.escape(id)}"]`);bindShortcutTextarea(t,btn)});
  $$('[data-answer]').forEach(b=>b.onclick=async()=>{const id=b.dataset.answer,answer=$('#ha-'+id).value.trim();if(!answer)return alert('Isi jawaban staff dulu.');b.disabled=true;try{const out=await api('/api/human-requests/'+id+'/answer',{method:'POST',body:JSON.stringify({answer,saveAsKnowledge:$('#learn-'+id).checked})});if(out.item?.learned&&out.item?.delivered===false)console.info('[Tanya Staff] Jawaban disimpan untuk pembelajaran; room sedang Human Takeover, tidak dikirim ke member.');humanDrafts.delete(String(id));humanLearnDrafts.delete(String(id));humanReplyDrafts.delete(String(id));humanExpanded.delete(String(id));await Promise.all([loadHuman(),loadChats(),loadLogs()])}catch(e){alert(e.message)}finally{b.disabled=false}});
  $$('[data-hact]').forEach(b=>b.onclick=async()=>{const id=b.dataset.hid,action=b.dataset.hact;if(!confirm('Jalankan tindakan ini dan kirim balasan ke member?'))return;b.disabled=true;try{await api('/api/human-requests/'+id+'/action',{method:'POST',body:JSON.stringify({action})});humanDrafts.delete(String(id));humanLearnDrafts.delete(String(id));humanReplyDrafts.delete(String(id));humanExpanded.delete(String(id));await Promise.all([loadHuman(),loadChats(),loadLogs()])}catch(e){alert(e.message)}finally{b.disabled=false}});
  $$('[data-telegram]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const d=await api('/api/human-bridge/requests/'+b.dataset.telegram+'/send',{method:'POST'});alert(d.ok?'Ticket dikirim ke Telegram.':('Belum terkirim: '+(d.error||d.skipped||'unknown')));await loadBridge()}catch(e){alert(e.message)}finally{b.disabled=false}});
  $$('[data-cancel]').forEach(b=>b.onclick=async()=>{const id=b.dataset.cancel;await api('/api/human-requests/'+id+'/cancel',{method:'POST'});humanDrafts.delete(String(id));humanLearnDrafts.delete(String(id));humanReplyDrafts.delete(String(id));humanExpanded.delete(String(id));loadHuman()});
  for(const x of d.items){if(humanExpanded.has(String(x.id)))loadHumanConversation(String(x.id),x.chat_id).catch(()=>{})}
}
$('#refreshHuman').onclick=loadHuman;
function parseBulk(txt){const chunks=String(txt||'').trim().split(/\n\s*\n+/);const out=[];for(const c of chunks){const lines=c.split(/\n/).map(x=>x.trim()).filter(Boolean);if(!lines.length)continue;let shortcut='';if(lines[0].startsWith('#'))shortcut=lines.shift();const content=lines.join('\n').trim();if(content)out.push({shortcut,title:shortcut||'Imported Response',category:'GENERAL',content,tags:[],mode:'FLEXIBLE'})}return out}
async function loadCanned(){const d=await api('/api/canned');cannedCache=d.items||[];renderCanned()}
function resetResponseForm(){editingResponseId=null;$('#respShortcut').value='';$('#respTitle').value='';$('#respCategory').value='GENERAL';$('#respMode').value='FLEXIBLE';$('#respTags').value='';$('#respContent').value='';$('#addResponse').textContent='Simpan Response';$('#cancelResponseEdit').classList.add('hidden')}
function startEditResponse(id){const x=cannedCache.find(r=>r.source_id===id);if(!x)return;editingResponseId=id;$('#respShortcut').value=x.shortcut||'';$('#respTitle').value=x.title||'';$('#respCategory').value=x.category||'GENERAL';$('#respMode').value=x.response_mode||'FLEXIBLE';$('#respTags').value=Array.isArray(x.tags)?x.tags.join(', '):'';$('#respContent').value=x.content||'';$('#addResponse').textContent='Update Response';$('#cancelResponseEdit').classList.remove('hidden');$('#respShortcut').scrollIntoView({behavior:'smooth',block:'center'})}
function renderCanned(){const q=String($('#cannedSearch')?.value||'').toLowerCase();const rows=cannedCache.filter(x=>!q||`${x.shortcut||''} ${x.title||''} ${x.category||''} ${x.content||''}`.toLowerCase().includes(q));$('#cannedList').innerHTML=rows.map(x=>`<div class="tr responseRow"><span class="pill">${esc(x.shortcut||'RESPONSE')}</span><b>${esc(x.category||'GENERAL')} · ${esc(x.response_mode||'FLEXIBLE')}</b><span><strong>${esc(x.title||'')}</strong><br>${esc(x.content)}</span>${x.source_kind==='manual'?`<div class="row"><button data-editresp="${esc(x.source_id)}">Edit</button><button data-delresp="${esc(x.source_id)}">Hapus</button></div>`:'<span>API</span>'}</div>`).join('')||'<div class="tr">Belum ada response. Tambahkan manual dari LiveChat Responses.</div>';$$('[data-editresp]').forEach(b=>b.onclick=()=>startEditResponse(b.dataset.editresp));$$('[data-delresp]').forEach(b=>b.onclick=async()=>{if(confirm('Hapus response ini?')){await api('/api/canned/manual/'+encodeURIComponent(b.dataset.delresp),{method:'DELETE'});if(editingResponseId===b.dataset.delresp)resetResponseForm();loadCanned()}})}
$('#addResponse').onclick=async()=>{const content=$('#respContent').value.trim();if(!content)return alert('Isi response wajib diisi.');const payload={shortcut:$('#respShortcut').value,title:$('#respTitle').value,category:$('#respCategory').value,mode:$('#respMode').value,tags:$('#respTags').value.split(',').map(x=>x.trim()).filter(Boolean),content};if(editingResponseId)await api('/api/canned/manual/'+encodeURIComponent(editingResponseId),{method:'PUT',body:JSON.stringify(payload)});else await api('/api/canned/manual',{method:'POST',body:JSON.stringify(payload)});resetResponseForm();await loadCanned()};
$('#cancelResponseEdit').onclick=resetResponseForm;
$('#importResponses').onclick=async()=>{const items=parseBulk($('#bulkResponses').value);if(!items.length)return alert('Format import belum terbaca.');const d=await api('/api/canned/import',{method:'POST',body:JSON.stringify({items})});$('#importResult').textContent=`${d.created} response berhasil diimport`;$('#bulkResponses').value='';loadCanned()};$('#refreshCanned').onclick=loadCanned;$('#cannedSearch').oninput=renderCanned;

const bridgeFieldMap={
  RESET_PASSWORD:['#route-reset-chat','#route-reset-topic'],
  WD_PROBLEM:['#route-wd-chat','#route-wd-topic'],
  DEPOSIT_PROBLEM:['#route-deposit-chat','#route-deposit-topic'],
  BONUS:['#route-bonus-chat','#route-bonus-topic'],
  ISSUE:['#route-issue-chat','#route-issue-topic']
};
function bridgePayload(){const routes={};for(const [k,[c,t]] of Object.entries(bridgeFieldMap))routes[k]={chatId:$(c).value.trim(),topicId:$(t).value.trim()};return{botToken:$('#tgBotToken').value.trim(),defaultChatId:$('#tgDefaultChat').value.trim(),routes}}
async function loadBridge(){
  const [d,t]=await Promise.all([api('/api/human-bridge/settings'),api('/api/human-bridge/tickets')]);
  $('#bridgeEnabled').checked=Boolean(d.enabled);$('#tgDefaultChat').value=d.defaultChatId||'';$('#tgBotToken').value='';$('#tgBotToken').placeholder=d.configured?`Tersimpan: ${d.botTokenMasked||'••••••••'} — kosongkan jika tidak ganti`:'Isi Bot Token Telegram';
  $('#tgBotStatus').textContent=d.configured?`@${d.botUsername||d.status?.botUsername||'-'} · ${d.enabled?'ENABLED':'DISABLED'} · ${d.status?.running?'poller aktif':'poller standby'}`:'Belum dikonfigurasi';
  for(const [k,[c,tp]] of Object.entries(bridgeFieldMap)){const r=d.routes?.[k]||{};$(c).value=r.chatId||'';$(tp).value=r.topicId||'';}
  $('#bridgeTickets').innerHTML=(t.items||[]).map(x=>`<div class="tr"><span class="pill">${esc(x.ticket_code)}</span><b>${esc(x.category)}</b><span>${esc(x.customer_name||x.chat_id)}<br><small>${esc(x.status)} · TG ${esc(x.telegram_chat_id||'-')} / msg ${esc(x.telegram_message_id||'-')}</small></span><span>${new Date(x.created_at).toLocaleString()}</span></div>`).join('')||'<div class="tr">Belum ada ticket Human Bridge.</div>';
}
$('#saveBridge').onclick=async()=>{try{const d=await api('/api/human-bridge/settings',{method:'PUT',body:JSON.stringify(bridgePayload())});$('#bridgeOut').textContent=JSON.stringify(d,null,2);await loadBridge()}catch(e){$('#bridgeOut').textContent='ERROR: '+e.message}};
$('#testBridge').onclick=async()=>{try{$('#bridgeOut').textContent=JSON.stringify(await api('/api/human-bridge/test',{method:'POST'}),null,2)}catch(e){$('#bridgeOut').textContent='ERROR: '+e.message}};
$('#testBridgeMsg').onclick=async()=>{try{$('#bridgeOut').textContent=JSON.stringify(await api('/api/human-bridge/test-message',{method:'POST',body:JSON.stringify({chatId:$('#tgDefaultChat').value.trim()})}),null,2)}catch(e){$('#bridgeOut').textContent='ERROR: '+e.message}};
$('#bridgeEnabled').onchange=async e=>{try{await api('/api/human-bridge/enabled',{method:'POST',body:JSON.stringify({enabled:e.target.checked})});await loadBridge()}catch(err){e.target.checked=false;alert(err.message)}};
$('#refreshBridge').onclick=loadBridge;


let learningFilter='PENDING';
async function loadLearning(){
  if(!$('#learningList')) return;
  const d=await api('/api/learning?status='+encodeURIComponent(learningFilter));if($('#learningStats')&&d.stats)$('#learningStats').textContent=`History CS: ${d.stats.human_examples||0} · Pola otomatis: ${d.stats.patterns||0} · Pola aman: ${d.stats.safe_patterns||0}`;
  $('#learningList').innerHTML=(d.items||[]).map(x=>`<div class="request"><div class="requesthead"><div><b>${esc(x.source_type==='AI_FEEDBACK'?'Teguran AI':'Chat CS')}</b><span class="pill">${esc(x.intent||'GENERAL')}</span><span class="pill">${esc(x.status)}</span></div><small>${new Date(x.updated_at).toLocaleString()}</small></div><div class="requestbody"><b>Member</b><p>${esc(x.member_text)}</p><b>${x.source_type==='AI_FEEDBACK'?'Jawaban AI yang salah':'Balasan CS'}</b><p>${esc(x.response_text)}</p>${x.correction_text?`<b>Koreksi admin</b><p>${esc(x.correction_text)}</p>`:''}<div class="row wrap">${x.status==='PENDING'?`<button data-learnkb="${x.id}">Approve → Knowledge</button><button data-learnresp="${x.id}">Approve → Response</button><button class="ghostbtn" data-learnreject="${x.id}">Tolak</button>`:`<span class="muted">Dipakai AI sebagai contoh pembelajaran. Kemunculan: ${esc(x.occurrences||1)}x</span>`}</div></div></div>`).join('')||'<div class="panel">Belum ada kandidat pembelajaran.</div>';
  $$('[data-learnkb]').forEach(b=>b.onclick=async()=>{await api('/api/learning/'+b.dataset.learnkb+'/promote-knowledge',{method:'POST'});loadLearning();loadKb()});
  $$('[data-learnresp]').forEach(b=>b.onclick=async()=>{await api('/api/learning/'+b.dataset.learnresp+'/promote-response',{method:'POST'});loadLearning();loadCanned()});
  $$('[data-learnreject]').forEach(b=>b.onclick=async()=>{await api('/api/learning/'+b.dataset.learnreject+'/status',{method:'POST',body:JSON.stringify({status:'REJECTED'})});loadLearning()});
}
if($('#scanLearning'))$('#scanLearning').onclick=async()=>{
  const b=$('#scanLearning');
  const original=b.textContent;
  b.disabled=true;
  b.textContent='Scanning chat CS…';
  try{
    const d=await api('/api/learning/backfill',{method:'POST',body:JSON.stringify({limit:50000})});
    const stale=Number(d.staleSkipped||0),failed=Number(d.failed||0);
    b.textContent=`Selesai · ${Number(d.created||0)} baru`;
    const summary=[
      `Scan selesai`,
      `Dicek: ${Number(d.scanned||0)}`,
      `Kandidat baru: ${Number(d.created||0)}`,
      `Dilewati: ${Number(d.skipped||0)}`,
      stale?`Sesi lama dilewati: ${stale}`:'',
      failed?`Gagal per-item: ${failed}`:''
    ].filter(Boolean).join(' · ');
    console.info('[Learning scan]',summary,d.errors||[]);
    await loadLearning();
    setTimeout(()=>{if(b.textContent.startsWith('Selesai'))b.textContent=original},2200);
  }catch(e){
    const message=String(e?.message||e||'');
    if(/STALE_SESSION_REQUEST/i.test(message)){
      console.info('[Learning scan] sesi lama dilewati:',message);
      b.textContent='Sesi lama dilewati · scan lanjut';
      await loadLearning().catch(()=>{});
      setTimeout(()=>{b.textContent=original},2200);
    }else{
      b.textContent='Scan gagal';
      alert('Scan gagal: '+message);
      setTimeout(()=>{b.textContent=original},2200);
    }
  }finally{
    b.disabled=false;
  }
};
if($('#refreshLearning'))$('#refreshLearning').onclick=loadLearning;
if($('#learningPending'))$('#learningPending').onclick=()=>{learningFilter='PENDING';loadLearning()};
if($('#learningApproved'))$('#learningApproved').onclick=()=>{learningFilter='APPROVED';loadLearning()};
if($('#learningAll'))$('#learningAll').onclick=()=>{learningFilter='ALL';loadLearning()};

async function loadRules(){const d=await api('/api/rules');$('#rulesList').innerHTML=d.items.map(x=>`<div class="tr"><span class="pill">${esc(x.category)}</span><b>${esc(x.rule_type)}</b><span>${esc(x.content)}</span><button data-delrule="${x.id}">Hapus</button></div>`).join('')||'<div class="tr">Belum ada rule.</div>';$$('[data-delrule]').forEach(b=>b.onclick=async()=>{await api('/api/rules/'+b.dataset.delrule,{method:'DELETE'});loadRules()})}
$('#addRule').onclick=async()=>{await api('/api/rules',{method:'POST',body:JSON.stringify({category:$('#ruleCategory').value,ruleType:$('#ruleType').value,content:$('#ruleContent').value})});$('#ruleContent').value='';loadRules()};
function resetKb(){editingKbId=null;$('#kbTitle').value='';$('#kbContent').value='';$('#kbExamples').value='';$('#kbTags').value='';$('#kbPriority').value='100';$('#kbActive').checked=true;$('#addKb').textContent='Simpan';$('#cancelKbEdit').classList.add('hidden')}
async function loadKb(){const d=await api('/api/knowledge');kbCache=d.items||[];$('#kbList').innerHTML=kbCache.map(x=>`<div class="tr"><span class="pill">${esc(x.category)} · P${esc(x.priority||100)} · ${x.active?'ON':'OFF'}</span><b>${esc(x.title)}</b><span>${esc(x.content)}<br><small>${esc((x.examples||[]).join(', '))} ${esc((x.tags||[]).join(', '))}</small></span><div class="row"><button data-editkb="${x.id}">Edit</button><button data-delkb="${x.id}">Hapus</button></div></div>`).join('')||'<div class="tr">Belum ada knowledge.</div>';$$('[data-editkb]').forEach(b=>b.onclick=()=>{const x=kbCache.find(v=>String(v.id)===String(b.dataset.editkb));if(!x)return;editingKbId=x.id;$('#kbCategory').value=x.category||'GENERAL';$('#kbTitle').value=x.title||'';$('#kbContent').value=x.content||'';$('#kbExamples').value=(x.examples||[]).join(', ');$('#kbTags').value=(x.tags||[]).join(', ');$('#kbPriority').value=x.priority||100;$('#kbActive').checked=Boolean(x.active);$('#addKb').textContent='Update';$('#cancelKbEdit').classList.remove('hidden')});$$('[data-delkb]').forEach(b=>b.onclick=async()=>{if(confirm('Hapus knowledge ini?')){await api('/api/knowledge/'+b.dataset.delkb,{method:'DELETE'});loadKb()}})}
$('#addKb').onclick=async()=>{const payload={category:$('#kbCategory').value,title:$('#kbTitle').value.trim(),content:$('#kbContent').value.trim(),examples:$('#kbExamples').value.split(',').map(x=>x.trim()).filter(Boolean),tags:$('#kbTags').value.split(',').map(x=>x.trim()).filter(Boolean),priority:Number($('#kbPriority').value||100),active:$('#kbActive').checked};if(!payload.title||!payload.content)return alert('Judul dan official answer wajib diisi.');await api(editingKbId?'/api/knowledge/'+editingKbId:'/api/knowledge',{method:editingKbId?'PUT':'POST',body:JSON.stringify(payload)});resetKb();loadKb()};$('#cancelKbEdit').onclick=resetKb;
function resetCta(){editingCtaId=null;$('#ctaTrigger').value='';$('#ctaLabel').value='';$('#ctaAction').value='';$('#ctaResponse').value='';$('#ctaChatId').value='';$('#ctaTopicId').value='';$('#ctaTimeout').value='0';$('#ctaPriority').value='100';$('#ctaActive').checked=true;$('#ctaComplete').checked=true;$('#ctaKeepAi').checked=true;$('#ctaAutoEnd').checked=false;$('#saveCta').textContent='Simpan CTA';$('#cancelCtaEdit').classList.add('hidden')}
async function loadCta(){const d=await api('/api/telegram-cta');ctaCache=d.items||[];$('#ctaList').innerHTML=ctaCache.map(x=>`<div class="tr"><span class="pill">${esc(x.category)} · ${x.active?'ON':'OFF'}</span><b>${esc(x.button_label)}</b><span>${esc(x.action_key)}<br><small>${esc(x.member_response||'Tanpa auto reply')} · ${esc(x.telegram_chat_id||'route kategori')}</small></span><div class="row"><button data-editcta="${x.id}">Edit</button><button data-delcta="${x.id}">Hapus</button></div></div>`).join('')||'<div class="tr">Belum ada CTA custom. Tombol legacy tetap aktif sebagai fallback.</div>';$$('[data-editcta]').forEach(b=>b.onclick=()=>{const x=ctaCache.find(v=>String(v.id)===String(b.dataset.editcta));if(!x)return;editingCtaId=x.id;$('#ctaCategory').value=x.category;$('#ctaTrigger').value=x.trigger_text||'';$('#ctaLabel').value=x.button_label||'';$('#ctaAction').value=x.action_key||'';$('#ctaResponse').value=x.member_response||'';$('#ctaChatId').value=x.telegram_chat_id||'';$('#ctaTopicId').value=x.telegram_topic_id||'';$('#ctaTimeout').value=x.timeout_seconds||0;$('#ctaPriority').value=x.priority||100;$('#ctaActive').checked=Boolean(x.active);$('#ctaComplete').checked=Boolean(x.completes_case);$('#ctaKeepAi').checked=Boolean(x.keep_ai_active);$('#ctaAutoEnd').checked=Boolean(x.auto_end_chat);$('#saveCta').textContent='Update CTA';$('#cancelCtaEdit').classList.remove('hidden')});$$('[data-delcta]').forEach(b=>b.onclick=async()=>{if(confirm('Hapus CTA ini?')){await api('/api/telegram-cta/'+b.dataset.delcta,{method:'DELETE'});loadCta()}})}
$('#saveCta').onclick=async()=>{const payload={category:$('#ctaCategory').value,trigger:$('#ctaTrigger').value,buttonLabel:$('#ctaLabel').value,actionKey:$('#ctaAction').value,memberResponse:$('#ctaResponse').value,telegramChatId:$('#ctaChatId').value,telegramTopicId:$('#ctaTopicId').value,timeoutSeconds:Number($('#ctaTimeout').value||0),priority:Number($('#ctaPriority').value||100),active:$('#ctaActive').checked,completesCase:$('#ctaComplete').checked,keepAiActive:$('#ctaKeepAi').checked,autoEndChat:$('#ctaAutoEnd').checked};if(!payload.buttonLabel||!payload.actionKey)return alert('Button label dan action key wajib diisi.');await api(editingCtaId?'/api/telegram-cta/'+editingCtaId:'/api/telegram-cta',{method:editingCtaId?'PUT':'POST',body:JSON.stringify(payload)});resetCta();loadCta()};$('#cancelCtaEdit').onclick=resetCta;$('#refreshCta').onclick=loadCta;
async function loadHealth(){const d=await api('/api/status');const h=d.integrationHealth||[];const rows=[['PostgreSQL',d.db],['Brain DB',d.brainDb],['LiveChat',d.livechatConfigured],['Telegram',d.humanBridge?.configured&&d.humanBridge?.running],['AI Model',d.openaiConfigured],['Sync Worker',d.poller?.running],['Learning Worker',true]];$('#healthCards').innerHTML=rows.map(([n,ok])=>`<div class="card"><b>${esc(n)}</b><strong class="${ok?'ok':'bad'}">${ok?'READY':'ERROR'}</strong></div>`).join('');$('#healthDetails').textContent=JSON.stringify({poller:d.poller,humanBridge:d.humanBridge,integrations:h},null,2)};$('#refreshHealth').onclick=loadHealth;
async function loadSecurity(){const d=await api('/api/security');const rows=[['Password Hash',d.passwordHashConfigured],['2FA TOTP',d.twoFactorEnabled],['Legacy Password OFF',!d.legacyPasswordFallback],['Idle 60 menit',d.sessionIdleMinutes===60]];$('#securityCards').innerHTML=rows.map(([n,ok])=>`<div class="card"><b>${esc(n)}</b><strong class="${ok?'ok':'bad'}">${ok?'OK':'CHECK'}</strong></div>`).join('')};$('#refreshSecurity').onclick=loadSecurity;
async function loadLogs(){const [a,e]=await Promise.all([api('/api/logs/ai'),api('/api/logs/errors')]);$('#aiLogs').innerHTML=a.items.map(x=>`<div class="tr"><span>${esc(x.intent||'-')}</span><span>${esc(x.action||'-')} ${(x.confidence??'')}</span><span>${esc(x.reply||x.error||'-')}</span><span>${new Date(x.created_at).toLocaleString()}</span></div>`).join('')||'Belum ada AI log.';$('#errLogs').innerHTML=e.items.map(x=>`<div class="tr"><span>${esc(x.source)}</span><span>${esc(x.code||'-')}</span><span>${esc(x.message)}</span><span>${new Date(x.created_at).toLocaleString()}</span></div>`).join('')||'Belum ada error.'}
$('#refreshLogs').onclick=loadLogs;
async function liveUiTick(){
  if(liveUiBusy||document.hidden)return;
  liveUiBusy=true;
  try{
    const now=Date.now();
    const tab=$('#tab-chats');
    if(tab.classList.contains('active')){
      // Current conversation gets priority and feels immediate.
      if(currentChat&&now-lastConversationPoll>=500){
        lastConversationPoll=now;
        await openChat(currentChat,currentTitle,true);
      }
      // Inbox list changes less often; polling it separately avoids two heavy requests every tick.
      if(now-lastChatListPoll>=1200){
        lastChatListPoll=now;
        await loadChats();
      }
    }
    if($('#tab-human').classList.contains('active')&&now-lastChatListPoll>=1200){
      lastChatListPoll=now;
      await loadHuman();
    }
  }catch{}finally{liveUiBusy=false}
}
function startLiveUi(){
  if(liveUiTimer)return;
  liveUiTimer=setInterval(liveUiTick,250);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastConversationPoll=0;lastChatListPoll=0;liveUiTick()}});
}
boot().catch(e=>{document.body.innerHTML='<pre style="color:#fff">BOOT UI ERROR: '+esc(e.message)+'</pre>'});


function promoFormData(){return {name:$('#promoName').value.trim(),keywords:$('#promoKeywords').value.split(',').map(x=>x.trim()).filter(Boolean),minDeposit:$('#promoMinDeposit').value.trim(),maxBonus:$('#promoMaxBonus').value.trim(),turnover:$('#promoTurnover').value.trim(),claimLimit:$('#promoClaimLimit').value.trim(),activeHours:$('#promoHours').value.trim(),gameScope:$('#promoGameScope').value.trim(),rules:$('#promoRules').value.trim(),replyTemplate:$('#promoTemplate').value.trim(),active:$('#promoActive').checked}}
function resetPromoForm(){editingPromoId=null;['#promoName','#promoKeywords','#promoMinDeposit','#promoMaxBonus','#promoTurnover','#promoClaimLimit','#promoHours','#promoGameScope','#promoRules','#promoTemplate'].forEach(x=>$(x).value='');$('#promoActive').checked=true;$('#savePromo').textContent='Simpan Promo';$('#cancelPromoEdit').classList.add('hidden')}
async function loadPromos(){if(!$('#promoList'))return;const d=await api('/api/promos');promoCache=d.items||[];$('#promoList').innerHTML=promoCache.map(x=>`<div class="request"><div class="requesthead"><div><b>${esc(x.name)}</b><span class="pill">${x.active?'AKTIF':'NONAKTIF'}</span></div><div class="row"><button data-editpromo="${x.id}">Edit</button><button data-delpromo="${x.id}" class="dangerbtn">Hapus</button></div></div><div class="requestbody"><div class="promogrid"><div><b>Keyword</b><p>${esc((x.keywords||[]).join(', ')||'-')}</p></div><div><b>Min Deposit</b><p>${esc(x.min_deposit||'-')}</p></div><div><b>Maks Bonus</b><p>${esc(x.max_bonus||'-')}</p></div><div><b>Turnover</b><p>${esc(x.turnover||'-')}</p></div><div><b>Batas Klaim</b><p>${esc(x.claim_limit||'-')}</p></div><div><b>Jam</b><p>${esc(x.active_hours||'-')}</p></div><div><b>Game</b><p>${esc(x.game_scope||'-')}</p></div></div><p><b>Rules:</b><br>${esc(x.rules||'-')}</p><p><b>Template:</b><br>${esc(x.reply_template||'-')}</p></div></div>`).join('')||'<div class="panel">Belum ada bonus/promo.</div>';$$('[data-editpromo]').forEach(b=>b.onclick=()=>{const x=promoCache.find(y=>String(y.id)===String(b.dataset.editpromo));if(!x)return;editingPromoId=x.id;$('#promoName').value=x.name||'';$('#promoKeywords').value=(x.keywords||[]).join(', ');$('#promoMinDeposit').value=x.min_deposit||'';$('#promoMaxBonus').value=x.max_bonus||'';$('#promoTurnover').value=x.turnover||'';$('#promoClaimLimit').value=x.claim_limit||'';$('#promoHours').value=x.active_hours||'';$('#promoGameScope').value=x.game_scope||'';$('#promoRules').value=x.rules||'';$('#promoTemplate').value=x.reply_template||'';$('#promoActive').checked=Boolean(x.active);$('#savePromo').textContent='Update Promo';$('#cancelPromoEdit').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})});$$('[data-delpromo]').forEach(b=>b.onclick=async()=>{if(!confirm('Hapus promo ini?'))return;await api('/api/promos/'+b.dataset.delpromo,{method:'DELETE'});loadPromos()})}
if($('#savePromo'))$('#savePromo').onclick=async()=>{const data=promoFormData();if(!data.name)return alert('Nama promo wajib diisi.');const url=editingPromoId?'/api/promos/'+editingPromoId:'/api/promos';await api(url,{method:editingPromoId?'PUT':'POST',body:JSON.stringify(data)});resetPromoForm();loadPromos()};
if($('#cancelPromoEdit'))$('#cancelPromoEdit').onclick=resetPromoForm;
if($('#refreshPromos'))$('#refreshPromos').onclick=loadPromos;


function importantTypeLabel(t){return {PROMO:'Promo & Event',LINK:'Link Akses',RTP:'RTP',PREDIKSI_TOGEL:'Prediksi Togel',REKENING:'Rekening / Wallet',INFO_PENTING:'Info Penting'}[t]||t}
function importantFormData(){return {itemType:$('#importantType').value,itemKey:$('#importantKey').value.trim(),title:$('#importantTitle').value.trim(),content:$('#importantContent').value.trim(),aliases:$('#importantAliases').value.split(',').map(x=>x.trim()).filter(Boolean),priority:Number($('#importantPriority').value||100),active:$('#importantActive').checked}}
function resetImportantForm(){editingImportantId=null;$('#importantType').value='PROMO';$('#importantKey').value='';$('#importantTitle').value='';$('#importantContent').value='';$('#importantAliases').value='';$('#importantPriority').value='100';$('#importantActive').checked=true;$('#saveImportant').textContent='Simpan Data';$('#cancelImportantEdit').classList.add('hidden')}
function renderImportant(){if(!$('#importantList'))return;const q=String($('#importantSearch')?.value||'').toLowerCase();const rows=importantCache.filter(x=>(importantFilter==='ALL'||x.item_type===importantFilter)&&(!q||`${x.item_type} ${x.item_key} ${x.title} ${x.content} ${(x.aliases||[]).join(' ')}`.toLowerCase().includes(q)));$('#importantList').innerHTML=rows.map(x=>`<div class="request importantCard"><div class="requesthead"><div><span class="pill">${esc(importantTypeLabel(x.item_type))}</span> <b>${esc(x.title)}</b> <span class="pill">${x.active?'AKTIF':'NONAKTIF'}</span></div><div class="row"><button data-editimportant="${x.id}">Edit</button><button data-delimportant="${x.id}" class="dangerbtn">Hapus</button></div></div><div class="requestbody"><small class="muted">Kode: ${esc(x.item_key)} · Prioritas ${esc(x.priority||100)}</small><p>${esc(x.content)}</p>${(x.aliases||[]).length?`<small><b>Kata dikenali:</b> ${esc(x.aliases.join(', '))}</small>`:''}</div></div>`).join('')||'<div class="panel">Belum ada data pada kategori ini.</div>';$$('[data-editimportant]').forEach(b=>b.onclick=()=>{const x=importantCache.find(y=>String(y.id)===String(b.dataset.editimportant));if(!x)return;editingImportantId=x.id;$('#importantType').value=x.item_type;$('#importantKey').value=x.item_key||'';$('#importantTitle').value=x.title||'';$('#importantContent').value=x.content||'';$('#importantAliases').value=(x.aliases||[]).join(', ');$('#importantPriority').value=x.priority||100;$('#importantActive').checked=Boolean(x.active);$('#saveImportant').textContent='Update Data';$('#cancelImportantEdit').classList.remove('hidden');$('#importantType').scrollIntoView({behavior:'smooth',block:'center'})});$$('[data-delimportant]').forEach(b=>b.onclick=async()=>{if(!confirm('Hapus data penting ini?'))return;await api('/api/important-info/'+b.dataset.delimportant,{method:'DELETE'});await loadImportant()})}
async function loadImportant(){if(!$('#importantList'))return;const d=await api('/api/important-info');importantCache=d.items||[];renderImportant()}
if($('#saveImportant'))$('#saveImportant').onclick=async()=>{const data=importantFormData();if(!data.itemKey||!data.title||!data.content)return alert('Kode unik, Judul, dan Isi Resmi wajib diisi.');const url=editingImportantId?'/api/important-info/'+editingImportantId:'/api/important-info';try{await api(url,{method:editingImportantId?'PUT':'POST',body:JSON.stringify(data)});resetImportantForm();await loadImportant()}catch(e){alert('Gagal menyimpan: '+e.message)}};
if($('#cancelImportantEdit'))$('#cancelImportantEdit').onclick=resetImportantForm;
if($('#refreshImportant'))$('#refreshImportant').onclick=loadImportant;
if($('#importantSearch'))$('#importantSearch').oninput=renderImportant;
$$('.importantFilter').forEach(b=>b.onclick=()=>{importantFilter=b.dataset.importantFilter||'ALL';$$('.importantFilter').forEach(x=>x.classList.toggle('active',x===b));renderImportant()});

// v1.31 — Website Profile + portable Brain backup/import
function downloadJsonFile(name,data){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadBrain(section='all'){
  const r=await fetch('/api/brain/export?section='+encodeURIComponent(section));
  if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'EXPORT_FAILED')}
  const data=await r.json();
  downloadJsonFile(`livechat-brain-${section}-${new Date().toISOString().slice(0,10)}.json`,data);
}
async function importBrainFile(file,{mode='merge'}={}){
  if(!file) return;
  let data; try{data=JSON.parse(await file.text())}catch{throw new Error('FILE_JSON_TIDAK_VALID')}
  const replace=mode==='replace';
  const d=await api('/api/brain/import',{method:'POST',body:JSON.stringify({mode,data,confirmReplace:replace})});
  await Promise.all([loadWebsiteProfile(),loadRules(),loadKb(),loadCanned()]);
  return d;
}
function altLinkRow(x={}){
  const div=document.createElement('div');div.className='altLinkRow';
  div.innerHTML=`<input class="altLabel" placeholder="Link Alternatif" value="${esc(x.label||'')}"><input class="altUrl" placeholder="https://..." value="${esc(x.url||'')}"><input class="altPriority" type="number" value="${Number(x.priority??100)}" title="Prioritas"><label class="switchline compact">Aktif <input class="altActive" type="checkbox" ${x.active===false?'':'checked'}></label><button type="button" class="dangerbtn altRemove">Hapus</button>`;
  div.querySelector('.altRemove').onclick=()=>div.remove();
  return div;
}
function addAltLink(x={}){$('#altLinks')?.appendChild(altLinkRow(x))}
function websiteFormData(){
  return {siteName:$('#siteName')?.value.trim()||'',botDisplayName:$('#botDisplayName')?.value.trim()||'',mainUrl:$('#siteMainUrl')?.value.trim()||'',registerUrl:$('#siteRegisterUrl')?.value.trim()||'',rtpUrl:$('#siteRtpUrl')?.value.trim()||'',telegramUrl:$('#siteTelegramUrl')?.value.trim()||'',whatsappUrl:$('#siteWhatsappUrl')?.value.trim()||'',notes:$('#siteNotes')?.value.trim()||'',alternativeLinks:$$('.altLinkRow').map(r=>({label:r.querySelector('.altLabel').value.trim(),url:r.querySelector('.altUrl').value.trim(),priority:Number(r.querySelector('.altPriority').value||100),active:r.querySelector('.altActive').checked})).filter(x=>x.url)};
}
async function loadWebsiteProfile(){
  if(!$('#siteName'))return; const d=await api('/api/website-profile');const p=d.profile||{};
  $('#siteName').value=p.siteName||'';$('#botDisplayName').value=p.botDisplayName||'';$('#siteMainUrl').value=p.mainUrl||'';$('#siteRegisterUrl').value=p.registerUrl||'';$('#siteRtpUrl').value=p.rtpUrl||'';$('#siteTelegramUrl').value=p.telegramUrl||'';$('#siteWhatsappUrl').value=p.whatsappUrl||'';$('#siteNotes').value=p.notes||'';
  $('#altLinks').innerHTML='';(Array.isArray(p.alternativeLinks)?p.alternativeLinks:[]).forEach(addAltLink);if(!p.alternativeLinks?.length)addAltLink({label:'Link Alternatif 1',active:true,priority:100});
}
if($('#addAltLink'))$('#addAltLink').onclick=()=>addAltLink({label:`Link Alternatif ${$$('.altLinkRow').length+1}`,active:true,priority:100-$$('.altLinkRow').length});
if($('#saveWebsiteProfile'))$('#saveWebsiteProfile').onclick=async()=>{try{await api('/api/website-profile',{method:'PUT',body:JSON.stringify(websiteFormData())});$('#websiteSaved').textContent='Tersimpan · bot langsung memakai data terbaru';setTimeout(()=>{$('#websiteSaved').textContent=''},3000)}catch(e){alert(e.message)}};
$$('[data-brain-export]').forEach(b=>b.onclick=async()=>{try{await downloadBrain(b.dataset.brainExport)}catch(e){alert(e.message)}});
$$('[data-brain-import]').forEach(b=>b.onclick=()=>$('#brainFile-'+b.dataset.brainImport)?.click());
['rules','knowledge','responses'].forEach(section=>{const f=$('#brainFile-'+section);if(f)f.onchange=async()=>{if(!f.files?.[0])return;try{const d=await importBrainFile(f.files[0],{mode:'merge'});alert(`Import selesai: ${JSON.stringify(d.imported||{})}`)}catch(e){alert(e.message)}finally{f.value=''}}});
if($('#downloadBrainAll'))$('#downloadBrainAll').onclick=async()=>{try{await downloadBrain('all')}catch(e){alert(e.message)}};
if($('#uploadBrainAll'))$('#uploadBrainAll').onclick=()=>$('#brainFileAll')?.click();
if($('#brainFileAll'))$('#brainFileAll').onchange=async()=>{const f=$('#brainFileAll');if(!f.files?.[0])return;try{const replace=confirm('OK = MERGE aman dengan data sekarang.\nCancel = batal import.\nUntuk replace penuh gunakan file backup lalu pilih Replace dari prompt berikutnya.');if(!replace)return;const useReplace=confirm('Apakah ingin REPLACE data Rules/Knowledge/Responses yang ada?\nOK = REPLACE, Cancel = MERGE.');const d=await importBrainFile(f.files[0],{mode:useReplace?'replace':'merge'});alert(`Restore selesai: ${JSON.stringify(d.imported||{})}`)}catch(e){alert(e.message)}finally{f.value=''}};
