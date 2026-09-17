import { config } from './config.js';
import { LiveChatCannedClient } from './canned.js';
import * as db from './db.js';

const client=new LiveChatCannedClient();
let timer=null,running=false,lastResult=null,lastError=null,lastRun=null;
export function cannedSyncStatus(){return {enabled:config.lcCannedSyncEnabled,running,lastResult,lastError,lastRun,intervalMinutes:config.lcCannedSyncMinutes,configured:client.ready()};}
export async function syncCannedNow({manual=false}={}){
  if(!manual){const enabled=Boolean(await db.getSetting('system_enabled',true));if(!enabled)return {ok:true,paused:true,skipped:'system_off'};}
  if(running)return {ok:true,skipped:'already_running'};
  running=true;lastError=null;
  try{
    const data=await client.listAll();
    const saved=await db.syncCannedResponses(data.items);
    lastRun=new Date().toISOString();
    lastResult={ok:true,source:data.source,action:data.action,received:data.items.length,...saved};
    return lastResult;
  }catch(e){lastError=e.message;await db.logError('canned','SYNC_FAILED',e.message);throw e;}finally{running=false;}
}
export function startCannedSync(){
  if(!config.lcCannedSyncEnabled)return;
  const run=async()=>{try{await syncCannedNow();}catch{}finally{if(timer!==null)timer=setTimeout(run,config.lcCannedSyncMinutes*60_000);}};
  timer=setTimeout(run,5000);
}
export async function stopCannedSync({waitMs=5000}={}){if(timer)clearTimeout(timer);timer=null;const until=Date.now()+waitMs;while(running&&Date.now()<until)await new Promise(r=>setTimeout(r,50));return !running;}
export { client as cannedClient };
