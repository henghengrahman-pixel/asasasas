export class ApiError extends Error{
  constructor(message,{status=0,code='REQUEST_FAILED',requestId='',cause=null}={}){super(message);this.name='ApiError';this.status=status;this.code=code;this.requestId=requestId;this.cause=cause}
}
function combineSignals(signal,timeoutMs){
  const controller=new AbortController();let timedOut=false;
  const relay=()=>controller.abort(signal?.reason||new DOMException('Aborted','AbortError'));
  if(signal){if(signal.aborted)relay();else signal.addEventListener('abort',relay,{once:true})}
  const timer=timeoutMs>0?setTimeout(()=>{timedOut=true;controller.abort(new DOMException('Timeout','TimeoutError'))},timeoutMs):null;
  return {signal:controller.signal,timedOut:()=>timedOut,cleanup:()=>{if(timer)clearTimeout(timer);signal?.removeEventListener?.('abort',relay)}};
}
export async function api(url,options={}){
  const {timeout=8000,signal,headers={},...rest}=options;const combo=combineSignals(signal,timeout);
  try{
    const res=await fetch(url,{credentials:'same-origin',headers:{...(rest.body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},...rest,signal:combo.signal});
    const requestId=res.headers.get('x-request-id')||'';let data={};const text=await res.text();if(text){try{data=JSON.parse(text)}catch{data={raw:text}}}
    if(res.status===401){if(location.pathname!=='/')location.replace('/');throw new ApiError('Sesi berakhir. Silakan masuk kembali.',{status:401,code:'UNAUTHORIZED',requestId})}
    if(!res.ok)throw new ApiError(data.message||data.error||`HTTP_${res.status}`,{status:res.status,code:data.error||`HTTP_${res.status}`,requestId});
    return data;
  }catch(e){
    if(e instanceof ApiError)throw e;
    if(combo.timedOut())throw new ApiError('Permintaan terlalu lama. Coba lagi.',{code:'REQUEST_TIMEOUT',cause:e});
    if(e?.name==='AbortError')throw e;
    throw new ApiError(e?.message||'Koneksi ke server gagal.',{code:'NETWORK_ERROR',cause:e});
  }finally{combo.cleanup()}
}
let compatibilityController=null;
export async function apiCancelable(url,options={}){compatibilityController?.abort();compatibilityController=new AbortController();return api(url,{...options,signal:compatibilityController.signal})}
