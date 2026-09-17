import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachPoolErrorHandler, isTransientPostgresError, withPostgresStartupRetry } from '../src/postgres-resilience.js';

test('57P01 and connection timeout are classified as transient PostgreSQL errors',()=>{
  assert.equal(isTransientPostgresError({code:'57P01',message:'terminating connection due to administrator command'}),true);
  assert.equal(isTransientPostgresError(new Error('Connection terminated due to connection timeout')),true);
  assert.equal(isTransientPostgresError({code:'23505',message:'duplicate key value violates unique constraint'}),false);
});

test('pool error handler consumes idle client error without throwing',()=>{
  const pool=new EventEmitter();
  const logs=[];
  const logger={error:(line)=>logs.push(line)};
  assert.equal(attachPoolErrorHandler(pool,{name:'test',logger}),true);
  assert.doesNotThrow(()=>pool.emit('error',Object.assign(new Error('terminating connection due to administrator command'),{code:'57P01'})));
  assert.equal(logs.length,1);
  const parsed=JSON.parse(logs[0]);
  assert.equal(parsed.event,'POOL_IDLE_CLIENT_ERROR');
  assert.equal(parsed.code,'57P01');
  assert.equal(parsed.transient,true);
});

test('pool error handler is idempotent for the same pool/name',()=>{
  const pool=new EventEmitter();
  const logger={error:()=>{}};
  assert.equal(attachPoolErrorHandler(pool,{name:'runtime',logger}),true);
  assert.equal(attachPoolErrorHandler(pool,{name:'runtime',logger}),false);
  assert.equal(pool.listenerCount('error'),1);
});

test('startup retry retries transient DB errors and succeeds',async()=>{
  let calls=0;
  const sleeps=[];
  const result=await withPostgresStartupRetry('migration',async()=>{
    calls++;
    if(calls<3) throw Object.assign(new Error('database system is starting up'),{code:'57P03'});
    return 'ok';
  },{
    attempts:4,
    minDelayMs:1,
    maxDelayMs:2,
    logger:{warn:()=>{}},
    sleepFn:async(ms)=>{sleeps.push(ms);}
  });
  assert.equal(result,'ok');
  assert.equal(calls,3);
  assert.deepEqual(sleeps,[1,2]);
});

test('startup retry does not retry non-transient SQL errors',async()=>{
  let calls=0;
  await assert.rejects(()=>withPostgresStartupRetry('migration',async()=>{
    calls++;
    throw Object.assign(new Error('syntax error'),{code:'42601'});
  },{attempts:5,logger:{warn:()=>{}},sleepFn:async()=>{}}),/syntax error/);
  assert.equal(calls,1);
});
