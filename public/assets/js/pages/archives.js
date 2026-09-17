import {api} from '../core/api.js';
import {esc,toast} from '../core/ui.js';
const $=s=>document.querySelector(s);
const state={q:'',filter:'ALL',limit:50,items:[],cursor:null,hasMore:false,selected:null,listVersion:0,listAbort:null,detailVersion:0,detailAbort:null,messageAbort:null,messageBefore:null,messageHasMore:false,listScrollTop:0};
const list=$('#archiveList'),detail=$('#archiveDetail'),empty=$('#archiveEmpty'),messages=$('#archiveMessages');
const fmtAgo=v=>{if(!v)return'';const ms=Date.now()-new Date(v).getTime(),m=Math.max(0,Math.floor(ms/60000));if(m<1)return'now';if(m<60)return`${m} minutes ago`;const h=Math.floor(m/60);if(h<24)return h===1?'about 1 hour ago':`about ${h} hours ago`;const d=Math.floor(h/24);if(d<7)return d===1?'1 day ago':`${d} days ago`;return new Date(v).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})};
const fmtDate=v=>v?new Date(v).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'-';
const fmtTime=v=>v?new Date(v).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'';
function rowHtml(x){const name=x.customer_name||x.chat_id;return `<button class="archive-row${String(state.selected)===String(x.archive_id)?' active':''}" data-id="${esc(String(x.archive_id))}"><div class="archive-row-top"><b>${esc(name)}</b><time>${esc(fmtAgo(x.ended_at))}</time></div><div class="archive-agent">Agent: ${esc(x.agent_name||x.handling_mode||'AI LIVECHAT 8008')}</div><div class="archive-preview"><span>${esc(x.last_message||'Tidak ada pesan')}</span><i>${Number(x.message_count||0)}</i></div></button>`}
function render(){if(!state.items.length){list.innerHTML='<div class="archive-empty">Belum ada history chat yang diarsipkan.</div>';$('#archiveCount').textContent='0 chats';return}list.innerHTML=state.items.map(rowHtml).join('');list.querySelectorAll('.archive-row').forEach(b=>b.onclick=()=>openArchive(b.dataset.id));$('#archiveCount').textContent=`${state.items.length.toLocaleString('id-ID')} loaded`;$('#loadMoreArchives').classList.toggle('hidden',!state.hasMore)}
async function load({append=false,reason='user'}={}){
  const version=++state.listVersion;state.listAbort?.abort();const ctl=new AbortController();state.listAbort=ctl;
  try{
    const p=new URLSearchParams({q:state.q,filter:state.filter,limit:String(state.limit)});if(append&&state.cursor)p.set('cursor',state.cursor);
    const r=await api('/api/archives?'+p,{timeout:10000,signal:ctl.signal});if(version!==state.listVersion)return;
    const incoming=r.items||[];state.items=append?[...state.items,...incoming.filter(x=>!state.items.some(y=>String(y.archive_id)===String(x.archive_id)))]:incoming;state.cursor=r.page?.nextCursor||null;state.hasMore=Boolean(r.page?.hasMore);render();
  }catch(e){if(e.name==='AbortError')return;if(version!==state.listVersion)return;if(!append)list.innerHTML='<div class="archive-empty error">Gagal memuat archives.</div>';toast(`${reason}: ${e.message}`,'error')}
  finally{if(state.listAbort===ctl)state.listAbort=null}
}
function senderLabel(m){const t=String(m.sender_type||'').toLowerCase();if(t==='customer')return'MEMBER';if(t==='ai')return'BOT';if(t==='system')return'SYSTEM';return'CS HUMAN'}
function attachments(m){return (Array.isArray(m.attachments)?m.attachments:[]).map(a=>a?.isImage||/^image\//.test(a?.mime||'')?`<a class="archive-image" href="${esc(a.url||'#')}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(a.url||'')}" alt="${esc(a.name||'image')}"></a>`:`<a class="archive-file" href="${esc(a.url||'#')}" target="_blank" rel="noopener">${esc(a.name||'Attachment')}</a>`).join('')}
function messageHtml(m){const t=String(m.sender_type||'').toLowerCase(),side=t==='customer'?'in':t==='system'?'system':'out';return `<div class="archive-bubble ${side}" data-message-id="${esc(String(m.id||''))}"><div class="archive-sender">${senderLabel(m)}</div>${attachments(m)}${m.text?`<div class="archive-text">${esc(m.text)}</div>`:''}<div class="archive-time">${esc(fmtTime(m.created_at))}</div></div>`}
async function loadMessages(id,{older=false,version=state.detailVersion}={}){
  state.messageAbort?.abort();const ctl=new AbortController();state.messageAbort=ctl;const before=older?state.messageBefore:null;const oldHeight=messages.scrollHeight,oldTop=messages.scrollTop;
  try{const qs=new URLSearchParams({limit:'100'});if(before)qs.set('before',before);const r=await api(`/api/archives/${encodeURIComponent(id)}/messages?${qs}`,{timeout:12000,signal:ctl.signal});if(version!==state.detailVersion||String(state.selected)!==String(id))return;const rows=r.items||[];state.messageBefore=r.page?.nextBefore||null;state.messageHasMore=Boolean(r.page?.hasMore);if(older){const html=rows.map(messageHtml).join('');messages.insertAdjacentHTML('afterbegin',html);messages.scrollTop=oldTop+(messages.scrollHeight-oldHeight)}else{messages.innerHTML=rows.map(messageHtml).join('')||'<div class="archive-empty">Tidak ada pesan.</div>';messages.scrollTop=messages.scrollHeight}}
  catch(e){if(e.name!=='AbortError'&&version===state.detailVersion)toast(e.message,'error')}
  finally{if(state.messageAbort===ctl)state.messageAbort=null}
}
async function openArchive(id){
  state.listScrollTop=list.scrollTop;state.selected=id;render();empty.classList.add('hidden');detail.classList.remove('hidden');messages.innerHTML='<div class="archive-empty">Memuat history...</div>';state.detailAbort?.abort();state.messageAbort?.abort();const ctl=new AbortController(),version=++state.detailVersion;state.detailAbort=ctl;
  try{const r=await api('/api/archives/'+encodeURIComponent(id),{timeout:12000,signal:ctl.signal});if(version!==state.detailVersion||String(state.selected)!==String(id))return;const x=r.item||{};$('#archiveName').textContent=x.customer_name||x.chat_id||'-';$('#archiveAvatar').textContent=(x.customer_name||x.chat_id||'?').slice(0,1).toUpperCase();$('#archiveMeta').textContent=`${fmtDate(x.started_at)} — ${fmtDate(x.ended_at)} · ${Number(x.message_count||0)} pesan`;state.messageBefore=null;state.messageHasMore=false;await loadMessages(id,{version});if(innerWidth<900)document.querySelector('.archives-shell').classList.add('detail-open')}
  catch(e){if(e.name==='AbortError')return;if(version===state.detailVersion){messages.innerHTML='<div class="archive-empty error">History gagal dimuat.</div>';toast(e.message,'error')}}
  finally{if(state.detailAbort===ctl)state.detailAbort=null}
}
messages.addEventListener('scroll',()=>{if(messages.scrollTop<=80&&state.messageHasMore&&!state.messageAbort&&state.selected)loadMessages(state.selected,{older:true})});
let timer;$('#archiveSearch').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{state.q=e.target.value.trim();state.cursor=null;load({reason:'search'})},250)};$('#archiveFilter').onchange=e=>{state.filter=e.target.value;state.cursor=null;load({reason:'filter'})};$('#refreshArchives').onclick=()=>{state.cursor=null;load({reason:'refresh'})};$('#loadMoreArchives').onclick=()=>load({append:true,reason:'pagination'});$('#archiveBack').onclick=()=>{document.querySelector('.archives-shell').classList.remove('detail-open');requestAnimationFrame(()=>{list.scrollTop=state.listScrollTop})};
await load({reason:'initial'});
