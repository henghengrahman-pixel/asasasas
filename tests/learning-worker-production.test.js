import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createLearningWorker,nextLearningDelay} from '../src/learning-worker.js';

const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const canned=fs.readFileSync(new URL('../src/canned-sync.js',import.meta.url),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function worker(opts={}){return createLearningWorker({initialDelayMs:999999,idleDelayMs:60000,activeDelayMs:30000,catchupDelayMs:5000,errorDelayMs:30000,runBatch:async()=>({scanned:0,created:0,skipped:0,failed:0,cursor:1}),withLock:async fn=>({acquired:true,result:await fn()}),...opts});}

test('1 single scheduler replaces parallel initial and regular learning workers',()=>{assert.match(server,/learningWorker\.start\(\)/);assert.doesNotMatch(server,/initialLearningTimer/);});
test('2 two regular invocations are single-flight',async()=>{let n=0;const w=worker({runBatch:async()=>{n++;await sleep(20);return{scanned:0}}});await Promise.all([w.runNow(),w.runNow()]);assert.equal(n,1);await w.stop();});
test('3 advisory lock failure skips safely',async()=>{let n=0;const w=worker({withLock:async()=>({acquired:false}),runBatch:async()=>{n++;return{}}});const r=await w.runNow();assert.equal(r.skipped,'advisory_lock_busy');assert.equal(n,0);await w.stop();});
test('4 cursor persistence is monotonic in SQL',()=>{assert.match(db,/GREATEST\(COALESCE\(\(app_settings\.value #>> '\{\}'\)::bigint,0\),\$1::bigint\)/);});
test('5 scanned one uses active delay not catchup delay',()=>assert.equal(nextLearningDelay({scanned:1,batchSize:200,activeDelayMs:30000,catchupDelayMs:5000,idleDelayMs:60000}),30000));
test('6 full batch uses catch-up delay',()=>assert.equal(nextLearningDelay({scanned:200,batchSize:200,activeDelayMs:30000,catchupDelayMs:5000,idleDelayMs:60000}),5000));
test('7 idle uses slow delay',()=>assert.equal(nextLearningDelay({scanned:0,batchSize:200,idleDelayMs:60000}),60000));
test('8 transient DB failures back off',()=>{const e=Object.assign(new Error('connection terminated'),{code:'57P01'});assert.equal(nextLearningDelay({error:e,failures:3,errorDelayMs:30000}),120000);});
test('9 permanent failure surfaces ERROR status',async()=>{const w=worker({runBatch:async()=>{throw new Error('syntax error at or near X')}});await w.runNow();assert.equal(w.status().status,'ERROR');assert.match(w.status().last_error,/syntax error/);await w.stop();});
test('10 shutdown path clears background timers',()=>{assert.match(server,/clearTimeout\(archiveRetryTimer\)/);assert.match(server,/stopPoller\(\{waitMs:5000\}\)/);assert.match(server,/stopCannedSync\(\{waitMs:5000\}\)/);assert.match(server,/stopHumanBridge\(\{waitMs:7000\}\)/);});
test('11 scheduler does not create new learning timer after stop',async()=>{let calls=0;const w=worker({setTimer:(fn,ms)=>{calls++;return setTimeout(fn,ms)}});w.start();await w.stop({waitMs:5});const before=calls;await sleep(5);assert.equal(calls,before);});
test('12 active worker gets bounded graceful finish',async()=>{let done=false;const w=worker({runBatch:async()=>{await sleep(15);done=true;return{scanned:0}}});const p=w.runNow();await w.stop({waitMs:100});await p;assert.equal(done,true);});
test('13 archive retry is recursive timeout single-flight',()=>{assert.match(server,/archiveRetryRunning/);assert.match(server,/scheduleArchiveRetry/);assert.doesNotMatch(server,/archiveRetryTimer=setInterval/);});
test('14 learning logs are one-line structured JSON',()=>{const src=fs.readFileSync(new URL('../src/learning-worker.js',import.meta.url),'utf8');assert.match(src,/JSON\.stringify\(obj\)/);assert.match(src,/event:'learning_batch'/);});
test('15 no-op batches are heartbeat sampled',()=>{const src=fs.readFileSync(new URL('../src/learning-worker.js',import.meta.url),'utf8');assert.match(src,/learning_heartbeat/);assert.match(src,/heartbeatMs/);});
test('16 manual Run Now uses same scheduler',()=>{assert.match(server,/learningWorker\.runNow\(\)/);assert.doesNotMatch(server,/backfillHumanLearningAll\(\{batchSize:2000/);});
test('17 learning disabled does not scan',async()=>{let n=0;const w=worker({enabled:false,runBatch:async()=>{n++;return{}}});const r=await w.runNow();assert.equal(r.skipped,'disabled_or_stopping');assert.equal(n,0);});
test('18 enabled learning preserves cursor-backed scanner',()=>{assert.match(db,/learning_backfill_cursor/);assert.match(db,/m\.id>\$2/);});
test('19 two replica simulation only lock holder scans',async()=>{let held=false,scans=0;const lock=async fn=>{if(held)return{acquired:false};held=true;try{return{acquired:true,result:await fn()}}finally{held=false}};const mk=()=>worker({withLock:lock,runBatch:async()=>{scans++;await sleep(20);return{scanned:0}}});const a=mk(),b=mk();const [ra,rb]=await Promise.all([a.runNow(),b.runNow()]);assert.equal(scans,1);assert.ok([ra.skipped,rb.skipped].includes('advisory_lock_busy'));await a.stop();await b.stop();});
test('20 boot starts user-facing server before low-priority learning scheduler',()=>{assert.ok(server.indexOf('app.listen(config.port')<server.indexOf('learningWorker.start()'));});
test('canned sync exposes timer stop for graceful shutdown',()=>assert.match(canned,/export async function stopCannedSync/));
test('database advisory lock uses dedicated pooled session and unlocks in finally',()=>{assert.match(db,/pool\.connect\(\)/);assert.match(db,/pg_try_advisory_lock/);assert.match(db,/pg_advisory_unlock/);assert.match(db,/client\.release\(\)/);});
test('regular learning has bounded time budget and sequential processing',()=>{assert.match(db,/maxRuntimeMs/);assert.match(db,/for\(const m of rows\.rows\)/);assert.doesNotMatch(db,/Promise\.all\(rows\.rows/);});
