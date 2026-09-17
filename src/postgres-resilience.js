const TRANSIENT_PG_CODES=new Set([
  '57P01','57P02','57P03','53300','53400',
  '08000','08001','08003','08004','08006','08007','08P01',
  'ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN'
]);

function errorText(error){
  return `${error?.message||''} ${error?.cause?.message||''}`.trim().toLowerCase();
}

export function isTransientPostgresError(error){
  const code=String(error?.code||error?.cause?.code||'').toUpperCase();
  if(TRANSIENT_PG_CODES.has(code)) return true;
  if(code.startsWith('08')) return true;
  const text=errorText(error);
  return [
    'terminating connection due to administrator command',
    'connection terminated due to connection timeout',
    'connection terminated unexpectedly',
    'connection timeout',
    'timeout expired',
    'server closed the connection unexpectedly',
    'the database system is starting up',
    'the database system is shutting down',
    'cannot connect now'
  ].some(part=>text.includes(part));
}

function safePgError(error){
  return {
    code:String(error?.code||error?.cause?.code||'UNKNOWN'),
    severity:error?.severity||error?.cause?.severity||null,
    message:String(error?.message||'PostgreSQL connection error').slice(0,500),
    transient:isTransientPostgresError(error)
  };
}

export function attachPoolErrorHandler(target,{name='postgres',logger=console}={}){
  if(!target || typeof target.on!=='function') return false;
  const marker=Symbol.for(`livechat-ai.pg-pool-handler.${name}`);
  if(target[marker]) return false;
  Object.defineProperty(target,marker,{value:true,enumerable:false,configurable:false});
  target.on('error',(error)=>{
    // pg-pool emits errors from idle clients through the Pool itself. Without an
    // error listener Node treats this as an unhandled EventEmitter error and exits.
    // The pool already evicts the broken client; logging is enough and the next
    // checkout will create a fresh connection when PostgreSQL is available again.
    const payload={
      timestamp:new Date().toISOString(),
      level:'error',
      module:'postgres',
      event:'POOL_IDLE_CLIENT_ERROR',
      pool:name,
      ...safePgError(error)
    };
    logger.error?.(JSON.stringify(payload));
  });
  return true;
}

export async function withPostgresStartupRetry(label,operation,{
  attempts=30,
  minDelayMs=1000,
  maxDelayMs=5000,
  logger=console,
  sleepFn=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
  let lastError=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      return await operation();
    }catch(error){
      lastError=error;
      if(!isTransientPostgresError(error) || attempt>=attempts) throw error;
      const delay=Math.min(maxDelayMs,minDelayMs*Math.max(1,attempt));
      const payload={
        timestamp:new Date().toISOString(),
        level:'warn',
        module:'postgres',
        event:'STARTUP_DB_RETRY',
        step:String(label||'database-startup'),
        attempt,
        attempts,
        retryInMs:delay,
        ...safePgError(error)
      };
      logger.warn?.(JSON.stringify(payload));
      await sleepFn(delay);
    }
  }
  throw lastError||new Error('POSTGRES_STARTUP_RETRY_EXHAUSTED');
}
