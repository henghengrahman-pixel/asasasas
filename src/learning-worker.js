import { isTransientPostgresError } from './postgres-resilience.js';

const iso=ms=>ms?new Date(ms).toISOString():null;
export function nextLearningDelay({scanned=0,batchSize=200,failures=0,error=null,catchupDelayMs=5000,activeDelayMs=30000,idleDelayMs=60000,errorDelayMs=30000}){
  if(error){
    const base=Math.max(1000,errorDelayMs); return Math.min(15*60_000,base*(2**Math.min(5,Math.max(0,failures-1))));
  }
  if(scanned>=batchSize) return Math.max(1000,catchupDelayMs);
  if(scanned>0) return Math.max(5000,activeDelayMs);
  return Math.max(10000,idleDelayMs);
}
export function createLearningWorker({enabled=true,batchSize=200,maxRuntimeMs=15000,heartbeatMs=900000,initialDelayMs=15000,catchupDelayMs=5000,activeDelayMs=30000,idleDelayMs=60000,errorDelayMs=30000,runBatch,withLock,isBusy=()=>false,logger=console,now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let timer=null,running=false,stopping=false,activePromise=null,lastHeartbeat=0;
  const metrics={status:enabled?'IDLE':'DISABLED',last_run_at:null,last_success_at:null,last_cursor:null,scanned_total:0,created_total:0,skipped_total:0,failed_total:0,duration_ms:0,consecutive_failures:0,next_run_at:null,worker_running:false,lock_acquired:false,last_batch_scanned:0,last_batch_created:0,last_error:null,duplicateSkipped:0,unsafeSkipped:0,noCustomerContextSkipped:0,staleSkipped:0,emptySkipped:0,otherSkipped:0,learned_today:0,skipped_today:0,metrics_day:new Date(now()).toISOString().slice(0,10)};
  const log=(level,obj)=>{try{logger[level]?.(JSON.stringify(obj));}catch{}};
  const schedule=(delay)=>{if(stopping||!enabled)return; if(timer)clearTimer(timer); const d=Math.max(0,delay);metrics.next_run_at=iso(now()+d);timer=setTimer(()=>{timer=null;void trigger('scheduled');},d);timer?.unref?.();};
  async function execute(reason){
    if(stopping||!enabled)return {ok:true,skipped:'disabled_or_stopping'};
    if(running)return {ok:true,skipped:'already_running'};
    if(isBusy()&&reason!=='manual'){schedule(activeDelayMs);return {ok:true,skipped:'system_busy'};}
    const today=new Date(now()).toISOString().slice(0,10);if(metrics.metrics_day!==today){metrics.metrics_day=today;metrics.learned_today=0;metrics.skipped_today=0;}
    running=true;metrics.worker_running=true;metrics.status='RUNNING';metrics.last_run_at=iso(now());metrics.next_run_at=null;const started=now();
    try{
      const locked=await withLock(async()=>{
        metrics.lock_acquired=true;
        return runBatch({batchSize,maxRuntimeMs,reason});
      });
      if(!locked?.acquired){metrics.lock_acquired=false;metrics.status='IDLE';schedule(activeDelayMs);return {ok:true,skipped:'advisory_lock_busy'};}
      const r=locked.result||{};const duration=now()-started;
      Object.assign(metrics,{status:'IDLE',last_success_at:iso(now()),last_cursor:r.cursor??metrics.last_cursor,last_batch_scanned:Number(r.scanned||0),last_batch_created:Number(r.created||0),duration_ms:duration,consecutive_failures:0,last_error:null});
      for(const k of ['scanned','created','skipped','failed'])metrics[`${k}_total`]+=Number(r[k]||0);
      metrics.learned_today+=Number(r.created||0);metrics.skipped_today+=Number(r.skipped||0);
      for(const k of ['duplicateSkipped','unsafeSkipped','noCustomerContextSkipped','staleSkipped','emptySkipped','otherSkipped'])metrics[k]+=Number(r[k]||0);
      const shouldInfo=Number(r.created||0)>0;const heartbeat=(now()-lastHeartbeat)>=heartbeatMs;
      const payload={event:'learning_batch',reason,scanned:Number(r.scanned||0),created:Number(r.created||0),skipped:Number(r.skipped||0),failed:Number(r.failed||0),cursor:r.cursor??null,durationMs:duration};
      if(Number(r.failed||0)>0)log('warn',payload);else if(shouldInfo){log('info',payload);lastHeartbeat=now();}else if(heartbeat){log('info',{event:'learning_heartbeat',...payload});lastHeartbeat=now();}
      schedule(nextLearningDelay({scanned:Number(r.scanned||0),batchSize,catchupDelayMs,activeDelayMs,idleDelayMs,errorDelayMs}));
      return {ok:true,...r,durationMs:duration};
    }catch(e){
      const duration=now()-started;metrics.duration_ms=duration;metrics.consecutive_failures++;metrics.last_error=String(e?.message||e);metrics.status=isTransientPostgresError(e)?'DEGRADED':'ERROR';
      log(isTransientPostgresError(e)?'warn':'error',{event:'learning_worker_error',transient:isTransientPostgresError(e),error:metrics.last_error,failures:metrics.consecutive_failures,durationMs:duration});
      schedule(nextLearningDelay({error:e,failures:metrics.consecutive_failures,errorDelayMs,batchSize,catchupDelayMs,activeDelayMs,idleDelayMs}));
      return {ok:false,error:metrics.last_error,transient:isTransientPostgresError(e)};
    }finally{metrics.worker_running=false;metrics.lock_acquired=false;running=false;}
  }
  function trigger(reason='manual'){if(activePromise)return activePromise;activePromise=execute(reason).finally(()=>{activePromise=null;});return activePromise;}
  function start(){if(!enabled){metrics.status='DISABLED';return;}stopping=false;schedule(initialDelayMs);}
  async function stop({waitMs=15000}={}){stopping=true;if(timer)clearTimer(timer);timer=null;metrics.next_run_at=null;if(activePromise)await Promise.race([activePromise,new Promise(r=>setTimer(r,waitMs))]);metrics.worker_running=false;if(metrics.status==='RUNNING')metrics.status='IDLE';}
  return {start,stop,runNow:()=>trigger('manual'),status:()=>({...metrics}),_trigger:trigger};
}
