import { config } from './config.js';

function asArray(v){ return Array.isArray(v) ? v : []; }
function firstText(...vals){ for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim(); return ''; }

export class LiveChatCannedClient {
  constructor(overrides={}) {
    this.base = (overrides.base || config.lcCannedApiBase).replace(/\/$/, '');
    this.accountId = overrides.accountId || config.lcAccountId;
    this.pat = overrides.pat || config.lcPat;
    this.timeoutMs = overrides.timeoutMs || 15000;
  }
  ready(){ return Boolean(this.base && this.accountId && this.pat); }
  authHeader(){ return 'Basic ' + Buffer.from(`${this.accountId}:${this.pat}`).toString('base64'); }
  async call(action, body={}) {
    if (!this.ready()) throw new Error('LIVECHAT_CANNED_CREDENTIALS_MISSING');
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), this.timeoutMs);
    try {
      const r = await fetch(`${this.base}/${action}`, {
        method:'POST',
        headers:{Authorization:this.authHeader(),'Content-Type':'application/json'},
        body:JSON.stringify(body),
        signal:ctrl.signal
      });
      const txt = await r.text();
      let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data={raw:txt}; }
      if (!r.ok) {
        const err = new Error(`LIVECHAT_CANNED_${r.status}: ${data?.error?.message || data?.message || txt.slice(0,300)}`);
        err.status=r.status; err.data=data; throw err;
      }
      return data;
    } finally { clearTimeout(timer); }
  }

  normalizeList(data){
    const candidates = [
      ['canned_responses', data?.canned_responses],
      ['responses', data?.responses],
      ['items', data?.items],
      ['result.canned_responses', data?.result?.canned_responses],
      ['result.items', data?.result?.items]
    ];
    for (const [source,v] of candidates) if (Array.isArray(v)) return {items:v,source};
    if (Array.isArray(data)) return {items:data,source:'root-array'};
    return {items:[],source:'none'};
  }

  normalizeItem(item, index=0){
    const id = String(item?.id ?? item?.response_id ?? item?.canned_response_id ?? item?.uuid ?? `idx-${index}`);
    const shortcut = firstText(item?.shortcut, item?.name, item?.title, item?.tag, item?.key);
    let text = firstText(item?.text, item?.content, item?.response, item?.message, item?.body);
    if (!text && Array.isArray(item?.content)) {
      text = item.content.map(x=>firstText(x?.text,x?.content,x?.value)).filter(Boolean).join('\n');
    }
    if (!text && item?.response && typeof item.response === 'object') text = firstText(item.response.text,item.response.content,item.response.message);
    const tags = [...asArray(item?.tags), ...asArray(item?.groups)].map(x=>typeof x==='string'?x:(x?.name||x?.id||'')).filter(Boolean);
    const scope = firstText(item?.scope, item?.visibility, item?.type) || null;
    const updatedAt = firstText(item?.updated_at, item?.modified_at, item?.last_modified_at) || null;
    return { id, shortcut, text, tags, scope, updatedAt, raw:item };
  }

  async listAll(){
    // Text/LiveChat installations can expose canned responses from the Configuration API.
    // Try conservative payload variants so older/current account shapes both work.
    const actions = ['list_canned_responses','get_canned_responses'];
    const bodies = [{}, {limit:1000}, {filters:{}}];
    let lastErr=null;
    for (const action of actions) {
      for (const body of bodies) {
        try {
          const data=await this.call(action,body);
          const norm=this.normalizeList(data);
          if (norm.source!=='none') {
            const items=norm.items.map((x,i)=>this.normalizeItem(x,i)).filter(x=>x.text);
            return {ok:true,action,source:norm.source,items,rawCount:norm.items.length};
          }
          // successful endpoint with no recognized list should still be returned for diagnostics
          if (data && Object.keys(data).length) return {ok:true,action,source:'unrecognized',items:[],rawCount:0,keys:Object.keys(data).slice(0,30)};
        } catch(e) {
          lastErr=e;
          if (![400,404,405].includes(e?.status)) throw e;
        }
      }
    }
    if (lastErr) throw lastErr;
    return {ok:true,action:null,source:'none',items:[],rawCount:0};
  }

  async test(){
    const started=Date.now();
    const r=await this.listAll();
    return {ok:true,latencyMs:Date.now()-started,action:r.action,source:r.source,count:r.items.length,rawCount:r.rawCount,keys:r.keys||null,sample:r.items.slice(0,3).map(x=>({id:x.id,shortcut:x.shortcut,text:x.text.slice(0,120)}))};
  }
}
