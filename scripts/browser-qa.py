#!/usr/bin/env python3
import base64,json,os,subprocess,tempfile,threading,time,urllib.parse,urllib.request
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
import websocket
ROOT=Path(__file__).resolve().parents[1];PORT=18777;CHROME_PORT=19222
LOGDIR=ROOT/'audit-logs';LOGDIR.mkdir(exist_ok=True)
CHATS=[
 {'chat_id':'A','customer_name':'Alpha','customer_email':'a@example.test','status':'active','visible_in_inbox':True,'handling_mode':'AI','last_event_at':'2026-09-15T08:00:01Z','last_message':'alpha hello','needs_reply':True},
 {'chat_id':'B','customer_name':'Beta','customer_email':'b@example.test','status':'active','visible_in_inbox':True,'handling_mode':'HUMAN','last_event_at':'2026-09-15T08:00:02Z','last_message':'beta help','needs_reply':True},
 {'chat_id':'C','customer_name':'Charlie','customer_email':'c@example.test','status':'active','visible_in_inbox':True,'handling_mode':'AI','last_event_at':'2026-09-15T08:00:03Z','last_message':'charlie ok','needs_reply':False},]
MSGS={k:[{'id':i+1,'event_id':f'{k}-{i+1}','sender_type':'customer' if i%2==0 else 'ai','text':f'{k} message {i+1}','created_at':f'2026-09-15T08:00:{i+1:02d}Z','attachments':[]} for i in range(4)] for k in 'ABC'}
ARCH=[{'archive_id':str(i),'id':i,'chat_id':f'ARCH{i}','session_key':f'thread:{i}','customer_name':f'Archived {i}','customer_email':'','handling_mode':'AI' if i%2 else 'HUMAN','started_at':'2026-09-14T08:00:00Z','ended_at':f'2026-09-15T{(i%20):02d}:00:00Z','archived_at':'2026-09-15T20:00:00Z','close_reason':'END_CHAT','last_message':f'archive message {i}','last_sender_type':'customer','agent_name':'AI LIVECHAT 8008','message_count':240} for i in range(1,76)]
AMSG={str(a['id']):[{'id':i,'event_id':f"AR{a['id']}-{i}",'sender_type':'customer' if i%2 else 'ai','text':f"archive {a['id']} message {i}",'created_at':f"2026-09-15T08:{(i//60)%60:02d}:{i%60:02d}Z",'attachments':[]} for i in range(1,241)] for a in ARCH}
class H(BaseHTTPRequestHandler):
 def log_message(self,*a): pass
 def sendj(self,obj,status=200):
  b=json.dumps(obj).encode();self.send_response(status);self.send_header('content-type','application/json');self.send_header('content-length',str(len(b)));self.end_headers();self.wfile.write(b)
 def file(self,path,ctype=None):
  if not path.exists():return self.send_error(404)
  b=path.read_bytes();types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};self.send_response(200);self.send_header('content-type',ctype or types.get(path.suffix.lower(),'application/octet-stream'));self.send_header('content-length',str(len(b)));self.end_headers();self.wfile.write(b)
 def do_GET(self):
  u=urllib.parse.urlparse(self.path);p=u.path;q=urllib.parse.parse_qs(u.query)
  if p=='/api/me':return self.sendj({'ok':True,'user':'qa-admin'})
  if p=='/api/status':return self.sendj({'ok':True,'db':True,'brainDb':True,'systemEnabled':True,'humanBridge':{'configured':True,'enabled':True}})
  if p=='/api/ops/health':return self.sendj({'ok':True})
  if p=='/api/conversations':
   time.sleep(.12 if q.get('q',[''])[0]=='' else .02);items=[x for x in CHATS if x.get('visible_in_inbox',True) and x['status']!='closed'];needle=(q.get('q',[''])[0] or '').lower();fil=(q.get('filter',['ALL'])[0] or 'ALL').upper()
   if needle:items=[x for x in items if needle in x['customer_name'].lower() or needle in x['last_message'].lower()]
   if fil=='HUMAN':items=[x for x in items if x['handling_mode']=='HUMAN']
   if fil=='AI':items=[x for x in items if x['handling_mode']=='AI']
   if fil=='NEEDS_REPLY':items=[x for x in items if x['needs_reply']]
   return self.sendj({'ok':True,'items':items,'page':{'hasMore':False,'nextCursor':None}})
  if p.startswith('/api/canned/shortcut'):return self.sendj({'ok':True,'items':[{'source_id':'1','shortcut':'#halo','title':'Halo','content':'Halo bosku, ada yang bisa dibantu?'}]})
  if p=='/api/archives':
   needle=(q.get('q',[''])[0] or '').lower();fil=(q.get('filter',['ALL'])[0] or 'ALL').upper();rows=[x for x in sorted(ARCH,key=lambda z:(z['ended_at'],z['archive_id']),reverse=True) if not needle or needle in x['customer_name'].lower() or needle in x['chat_id'].lower() or needle in x['last_message'].lower()]
   if fil=='HUMAN':rows=[x for x in rows if x['handling_mode']=='HUMAN']
   if fil=='AI':rows=[x for x in rows if x['handling_mode']!='HUMAN']
   cur=q.get('cursor',[None])[0]
   if cur:
    try:last=json.loads(base64.urlsafe_b64decode(cur+'='*(-len(cur)%4)));idx=next((i for i,x in enumerate(rows) if x['archive_id']==last['archive_id']),-1);rows=rows[idx+1:] if idx>=0 else rows
    except:pass
   lim=int(q.get('limit',['50'])[0]);items=rows[:lim];more=len(rows)>lim;nextc=None
   if more and items:nextc=base64.urlsafe_b64encode(json.dumps({'ended_at':items[-1]['ended_at'],'archive_id':items[-1]['archive_id']}).encode()).decode().rstrip('=')
   return self.sendj({'ok':True,'items':items,'page':{'hasMore':more,'nextCursor':nextc}})
  if p.startswith('/api/archives/'):
   parts=p.strip('/').split('/');aid=parts[2]
   a=next((x for x in ARCH if x['archive_id']==aid),None)
   if not a:return self.sendj({'ok':False,'error':'ARCHIVE_NOT_FOUND'},404)
   if len(parts)>=4 and parts[3]=='messages':
    rows=AMSG[aid];before=q.get('before',[None])[0]
    if before:rows=[m for m in rows if m['id']<int(before)]
    lim=int(q.get('limit',['100'])[0]);desc=list(reversed(rows))[:lim+1];more=len(desc)>lim;desc=desc[:lim];items=list(reversed(desc));nb=str(desc[-1]['id']) if more and desc else None
    return self.sendj({'ok':True,'items':items,'page':{'hasMore':more,'nextBefore':nb}})
   time.sleep({'1':.40,'2':.18,'3':.02}.get(aid,0));return self.sendj({'ok':True,'item':a})
  if p.startswith('/api/conversations/'):
   parts=p.split('/');cid=parts[3] if len(parts)>3 else '';c=next((x for x in CHATS if x['chat_id']==cid),None)
   if not c:return self.sendj({'ok':False,'error':'NOT_FOUND'},404)
   if p.endswith('/messages'):
    after=int(q.get('afterId',['0'])[0]);items=[m for m in MSGS[cid] if m['id']>after];return self.sendj({'ok':True,'chatId':cid,'conversation':c,'state':{'workflow_type':'QA','workflow_state':'READY'},'items':items})
   time.sleep({'A':.45,'B':.20,'C':.03}.get(cid,0));items=MSGS[cid];return self.sendj({'ok':True,'chatId':cid,'conversation':c,'state':{'workflow_type':'QA','workflow_state':'READY'},'items':items,'messages':{'hasOlder':False,'beforeId':None,'lastId':items[-1]['id']}})
  if p=='/health':return self.sendj({'ok':True,'service':'livechat-ai'})
  if p=='/' or p=='/login':return self.file(ROOT/'public/index.html','text/html')
  if p.startswith('/static/'):return self.file(ROOT/'public/assets'/p[len('/static/'):])
  f=ROOT/'public/pages'/(p.strip('/')+'.html')
  if f.exists():return self.file(f,'text/html')
  self.send_error(404)
 def do_POST(self):
  p=urllib.parse.urlparse(self.path).path
  if p in ['/api/logout','/api/session/touch']:return self.sendj({'ok':True})
  if p.endswith('/takeover'):
   cid=p.split('/')[3];next(x for x in CHATS if x['chat_id']==cid)['handling_mode']='HUMAN';return self.sendj({'ok':True,'mode':'HUMAN'})
  if p.endswith('/enable-ai'):
   cid=p.split('/')[3];next(x for x in CHATS if x['chat_id']==cid)['handling_mode']='AI';return self.sendj({'ok':True,'mode':'AI'})
  if p.endswith('/end'):
   cid=p.split('/')[3];next(x for x in CHATS if x['chat_id']==cid).update(status='closed',visible_in_inbox=False);return self.sendj({'ok':True})
  if p.endswith('/send'):return self.sendj({'ok':True,'sent':{'event_id':'sent-1'}})
  return self.sendj({'ok':True})
def wait_http(url,timeout=8):
 end=time.time()+timeout
 while time.time()<end:
  try:urllib.request.urlopen(url,timeout=.4).read();return True
  except:time.sleep(.1)
 return False
class CDP:
 def __init__(self,wsurl):self.ws=websocket.create_connection(wsurl,timeout=5);self.i=0;self.console=[];self.network=[];self.exceptions=[]
 def event(self,r):
  m=r.get('method','');p=r.get('params',{})
  if m=='Runtime.consoleAPICalled' and p.get('type') in ('error','warning'):self.console.append({'type':p.get('type'),'args':[a.get('value',a.get('description','')) for a in p.get('args',[])]})
  if m=='Runtime.exceptionThrown':self.exceptions.append(p.get('exceptionDetails',{}))
  if m=='Network.loadingFailed':self.network.append({'url':p.get('requestId'),'error':p.get('errorText')})
 def call(self,method,params=None):
  self.i+=1;i=self.i;self.ws.send(json.dumps({'id':i,'method':method,'params':params or {}}))
  while True:
   r=json.loads(self.ws.recv())
   if r.get('id')==i:
    if 'error' in r:raise RuntimeError(f"CDP {method}: {r['error']}")
    return r.get('result',{})
   self.event(r)
 def eval(self,expr):
  r=self.call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True})
  if r.get('exceptionDetails'):raise RuntimeError('Runtime.evaluate: '+json.dumps(r['exceptionDetails'],default=str)[:1200])
  ro=r.get('result',{})
  if ro.get('subtype')=='error':raise RuntimeError(ro.get('description','Runtime error'))
  return ro.get('value')
 def wait(self,expr,timeout=8):
  end=time.time()+timeout;last=None
  while time.time()<end:
   try:
    last=self.eval(expr)
    if last:return last
   except Exception as e:last=str(e)
   time.sleep(.08)
  raise RuntimeError(f'wait timeout: {expr}; last={last}')
 def shot(self,path):
  data=self.call('Page.captureScreenshot',{'format':'png','fromSurface':True}).get('data','');Path(path).write_bytes(base64.b64decode(data))
def nav(c,url,ready):
 c.call('Page.navigate',{'url':url});c.wait("document.readyState==='complete' || document.readyState==='interactive'",5);return c.wait(ready,8)
def main():
 srv=ThreadingHTTPServer(('127.0.0.1',PORT),H);threading.Thread(target=srv.serve_forever,daemon=True).start();profile=tempfile.mkdtemp(prefix='lc8008-chrome-');chrome=subprocess.Popen(['chromium','--headless=new','--no-sandbox','--disable-gpu',f'--remote-debugging-port={CHROME_PORT}','--remote-allow-origins=*',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 out={'ok':False,'viewports':[],'checks':{},'consoleErrors':[],'networkErrors':[],'exceptions':[]}
 try:
  if not wait_http(f'http://127.0.0.1:{CHROME_PORT}/json/version'):raise RuntimeError('chromium did not start')
  targets=json.load(urllib.request.urlopen(f'http://127.0.0.1:{CHROME_PORT}/json'));page=next(x for x in targets if x['type']=='page');c=CDP(page['webSocketDebuggerUrl']);c.call('Page.enable');c.call('Runtime.enable');c.call('Network.enable')
  # login artifact
  c.call('Emulation.setDeviceMetricsOverride',{'width':1366,'height':768,'deviceScaleFactor':1,'mobile':False});nav(c,f'http://127.0.0.1:{PORT}/',"!!document.querySelector('body')");c.shot(LOGDIR/'login.png')
  for width,height in [(1920,1080),(1600,900),(1440,900),(1366,768),(1280,720)]:
   c.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False});nav(c,f'http://127.0.0.1:{PORT}/conversations',"!!document.querySelector('.composer-shell') && document.querySelectorAll('.chat-row').length>=3")
   geom=c.eval("(()=>{const d=document.documentElement,x=document.querySelector('.composer-shell'),r=x&&x.getBoundingClientRect();return {sw:d.scrollWidth,cw:d.clientWidth,composer:!!x,rect:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null}})()") or {}
   out['viewports'].append({'viewport':f'{width}x{height}','overflow':geom.get('sw',0)>geom.get('cw',0),'composerVisible':bool(geom.get('composer') and geom.get('rect') and geom['rect']['bottom']<=height+1 and geom['rect']['top']>=0)})
   if width==1366:c.shot(LOGDIR/'conversations-1366.png')
  c.call('Emulation.setDeviceMetricsOverride',{'width':1366,'height':768,'deviceScaleFactor':1,'mobile':False});nav(c,f'http://127.0.0.1:{PORT}/conversations',"document.querySelectorAll('.chat-row').length>=3");c.eval("window.confirm=()=>true")
  c.eval("(()=>{const r=[...document.querySelectorAll('.chat-row')];r[0].click();setTimeout(()=>r[1].click(),20);setTimeout(()=>r[2].click(),40);return true})()");time.sleep(.8);rapid=c.eval("({name:document.querySelector('#chatName')?.textContent,session:document.querySelector('#chatSession')?.textContent,bubbles:[...document.querySelectorAll('.bubble .message-text')].map(x=>x.textContent)})") or {};out['checks']['rapidSwitch']=rapid.get('session')=='C' and rapid.get('name')=='Charlie' and all(str(x).startswith('C message') for x in rapid.get('bubbles',[]))
  c.eval("(()=>{document.querySelector('#refreshChats').click();const i=document.querySelector('#chatSearch');i.value='Beta';i.dispatchEvent(new Event('input',{bubbles:true}));return true})()");time.sleep(.6);out['checks']['searchDuringPoll']=c.eval("[...document.querySelectorAll('.chat-row .chat-title b')].map(x=>x.textContent)")==['Beta']
  c.eval("document.querySelector('#chatSearch').value='';document.querySelector('#chatSearch').dispatchEvent(new Event('input',{bubbles:true}))");time.sleep(.4);c.eval("document.querySelector('[data-filter=HUMAN]').click()");time.sleep(.4);out['checks']['filterDuringPoll']=c.eval("[...document.querySelectorAll('.chat-row .mode-text')].every(x=>x.textContent==='HUMAN')")
  c.eval("document.querySelector('[data-filter=ALL]').click()");time.sleep(.35);c.eval("document.querySelector('#refreshChats').click()");time.sleep(.35);out['checks']['manualRefresh']=c.eval("document.querySelectorAll('.chat-row').length")>=3
  c.eval("document.querySelector('.chat-row[data-id=\"A\"]')?.click()");time.sleep(.55);c.eval("document.querySelector('#takeoverBtn')?.click()");time.sleep(.5);out['checks']['takeover']=not c.eval("document.querySelector('#composerText')?.disabled")
  c.eval("document.querySelector('#returnAiBtn')?.click()");time.sleep(.5);out['checks']['returnAI']=bool(c.eval("document.querySelector('#composerText')?.disabled"))
  c.eval("document.querySelector('.chat-row[data-id=\"B\"]')?.click()");time.sleep(.35);c.eval("(()=>{const t=document.querySelector('#composerText');t.value='#h';t.dispatchEvent(new Event('input',{bubbles:true}));return true})()");time.sleep(.35);out['checks']['canned']=c.eval("document.querySelectorAll('.shortcut-item').length")>=1
  # delta + dedup: poll same messages repeatedly should not duplicate event ids
  before=c.eval("document.querySelectorAll('.bubble').length");time.sleep(2.5);after=c.eval("document.querySelectorAll('.bubble').length");out['checks']['messageDeltaDedup']=after==before
  c.eval("document.querySelector('#endBtn')?.click()");time.sleep(.45);out['checks']['endChat']=not bool(c.eval("document.querySelector('.chat-row[data-id=\"B\"]')"))
  # archives desktop + rapid switch + pagination + independent scroll
  nav(c,f'http://127.0.0.1:{PORT}/archives',"document.querySelectorAll('.archive-row').length>=3");c.shot(LOGDIR/'archives-1366.png');scroll=c.eval("(()=>{const l=document.querySelector('.archive-list'),m=document.querySelector('.archive-messages'),d=document.documentElement;return {listOverflow:l.scrollHeight>l.clientHeight,listOwn:getComputedStyle(l).overflowY,detailOwn:getComputedStyle(m).overflowY,pageOverflow:d.scrollHeight>d.clientHeight}})()") or {};out['checks']['archivesIndependentScroll']=scroll.get('listOwn') in ('auto','scroll') and scroll.get('detailOwn') in ('auto','scroll') and not scroll.get('pageOverflow')
  c.eval("(()=>{const r=[...document.querySelectorAll('.archive-row')];r.find(x=>x.dataset.id==='1')?.click();setTimeout(()=>r.find(x=>x.dataset.id==='2')?.click(),20);setTimeout(()=>r.find(x=>x.dataset.id==='3')?.click(),40);return true})()");time.sleep(.75);out['checks']['archiveRapidSwitch']=c.eval("document.querySelector('#archiveName')?.textContent")=='Archived 3'
  count0=c.eval("document.querySelectorAll('.archive-bubble').length");c.eval("document.querySelector('#archiveMessages').scrollTop=0");time.sleep(.45);count1=c.eval("document.querySelectorAll('.archive-bubble').length");out['checks']['archiveMessagePagination']=count0==100 and count1>count0
  c.eval("(()=>{const i=document.querySelector('#archiveSearch');i.value='Archived 7';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#refreshArchives').click();return true})()");time.sleep(.5);out['checks']['archiveSearchRace']=all('Archived 7' in x for x in (c.eval("[...document.querySelectorAll('.archive-row b')].map(x=>x.textContent)") or []))
  # mobile list -> detail -> back and preserve scroll
  c.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True});nav(c,f'http://127.0.0.1:{PORT}/archives',"document.querySelectorAll('.archive-row').length>=3");c.eval("document.querySelector('#archiveList').scrollTop=120");c.eval("document.querySelector('.archive-row')?.click()");time.sleep(.5);out['checks']['archiveMobileDetail']=bool(c.eval("document.querySelector('.archives-shell').classList.contains('detail-open')"));c.shot(LOGDIR/'archives-mobile.png');c.eval("document.querySelector('#archiveBack')?.click()");time.sleep(.2);out['checks']['archiveMobileBack']=not bool(c.eval("document.querySelector('.archives-shell').classList.contains('detail-open')"))
  out['consoleErrors']=c.console;out['networkErrors']=c.network;out['exceptions']=c.exceptions
  out['ok']=all(not x['overflow'] and x['composerVisible'] for x in out['viewports']) and all(out['checks'].values()) and not c.exceptions and not [x for x in c.console if x.get('type')=='error']
 except Exception as e:
  out['error']=str(e)
  try:c.shot(LOGDIR/'browser-qa-failed.png')
  except:pass
 finally:
  (LOGDIR/'browser-qa.json').write_text(json.dumps(out,indent=2,default=str));print(json.dumps(out,indent=2,default=str));srv.shutdown();chrome.terminate();
  try:chrome.wait(timeout=3)
  except:chrome.kill()
 if not out.get('ok'):raise SystemExit(2)
if __name__=='__main__':main()
