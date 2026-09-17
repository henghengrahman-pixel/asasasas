import {createLearningWorker} from '../src/learning-worker.js';
const TOTAL=100_000,BATCH=200;
let remaining=TOTAL,scanned=0,maxConcurrent=0,concurrent=0,lockHeld=false,lockMisses=0;
const w=createLearningWorker({initialDelayMs:999999,batchSize:BATCH,maxRuntimeMs:15000,logger:{info(){},warn(){},error(){}},
  withLock:async fn=>{if(lockHeld){lockMisses++;return{acquired:false}}lockHeld=true;try{return{acquired:true,result:await fn()}}finally{lockHeld=false}},
  runBatch:async()=>{concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);const n=Math.min(BATCH,remaining);remaining-=n;scanned+=n;await new Promise(r=>setImmediate(r));concurrent--;return{scanned:n,created:Math.floor(n*.08),skipped:n-Math.floor(n*.08),failed:0,cursor:scanned};}
});
const started=Date.now();let cycles=0;
while(remaining>0){await w.runNow();cycles++;}
await w.stop({waitMs:100});
const result={ok:remaining===0&&scanned===TOTAL&&maxConcurrent===1,totalMessages:TOTAL,batchSize:BATCH,cycles,scanned,maxConcurrent,lockMisses,durationMs:Date.now()-started,metrics:w.status()};
console.log(JSON.stringify(result,null,2));if(!result.ok)process.exit(1);
