import crypto from 'node:crypto';
import {brainPool,pool} from '../db.js';
import {getCollection} from './content-registry.js';
import {contentFingerprint,normalizeTextValue,stableJson} from './content-normalizer.js';

const jsonCols=new Set(['examples','tags','conditions','action','aliases','meta','keywords']);
const boolCols=new Set(['active','enabled','stop_processing']);
const intCols=new Set(['priority']);
function cleanValue(k,v){
  if(jsonCols.has(k)) return typeof v==='string'?(()=>{try{return JSON.parse(v)}catch{return []}})():v;
  if(boolCols.has(k)) return Boolean(v);
  if(intCols.has(k)) return Number.isFinite(Number(v))?Number(v):100;
  return v==null?null:normalizeTextValue(v);
}
function requiredOk(name,x){
  if(name==='knowledge') return Boolean(x.title&&x.content);
  if(name==='responses') return Boolean(x.name&&x.response_text);
  if(name==='rules') return Boolean(x.content);
  if(name==='important') return Boolean(x.item_key&&x.title&&x.content);
  if(name==='supplies') return Boolean(x.name);
  return false;
}
function normalizedRecord(name,input={}){
  const c=getCollection(name);const out={};for(const k of c.columns) if(Object.hasOwn(input,k)) out[k]=cleanValue(k,input[k]);
  if(name==='knowledge'){out.category||='GENERAL';out.examples??=[];out.tags??=[];out.priority??=100;out.active??=true;}
  if(name==='responses'){out.intent||='GENERAL';out.priority??=100;out.enabled??=true;}
  if(name==='rules'){out.category||='GLOBAL';out.rule_type||='REQUIRE';out.intent||='GENERAL';out.conditions??={};out.action??={};out.priority??=100;out.stop_processing??=false;out.active??=true;}
  if(name==='important'){out.item_type||='INFO_PENTING';out.aliases??=[];out.meta??={};out.priority??=100;out.active??=true;}
  if(name==='supplies'){out.keywords??=[];out.active??=true;}
  return out;
}
function fingerprintShape(name,x){
  if(name==='knowledge') return {category:x.category,title:x.title,content:x.content,examples:x.examples,tags:x.tags};
  if(name==='responses') return {name:x.name,intent:x.intent,trigger_text:x.trigger_text,response_text:x.response_text};
  if(name==='rules') return {intent:x.intent,conditions:x.conditions,action:x.action,content:x.content,rule_type:x.rule_type};
  if(name==='important') return {item_type:x.item_type,item_key:x.item_key,title:x.title,content:x.content,aliases:x.aliases};
  return x;
}
export function prepareRecord(name,input){const x=normalizedRecord(name,input);if(!requiredOk(name,x)){const e=new Error('INVALID_RECORD');e.status=400;throw e;}return {...x,content_hash:contentFingerprint(name,fingerprintShape(name,x))};}
async function bumpMeta(name,source='admin'){
  const c=getCollection(name);const p=brainPool;const count=(await p.query(`SELECT count(*)::bigint n FROM ${c.table}`)).rows[0].n;
  const hashes=(await p.query(`SELECT content_hash FROM ${c.table} WHERE content_hash IS NOT NULL ORDER BY content_hash`)).rows.map(x=>x.content_hash).join('|');
  const checksum=crypto.createHash('sha256').update(hashes).digest('hex');
  await pool.query(`INSERT INTO content_collection_meta(collection_type,version,record_count,checksum,last_updated,last_synced,source) VALUES($1,1,$2,$3,now(),now(),$4) ON CONFLICT(collection_type) DO UPDATE SET version=content_collection_meta.version+1,record_count=excluded.record_count,checksum=excluded.checksum,last_updated=now(),last_synced=now(),source=excluded.source`,[name,count,checksum,source]);
  return getMeta(name);
}
export async function getMeta(name){const r=await pool.query('SELECT * FROM content_collection_meta WHERE collection_type=$1',[name]);return r.rows[0]||{collection_type:name,version:0,record_count:0,checksum:null,last_updated:null,last_synced:null,source:'database'};}
export async function listRecords(name,{limit=500,offset=0}={}){const c=getCollection(name);const r=await brainPool.query(`SELECT * FROM ${c.table} ORDER BY ${c.table==='bot_promo_rules'?'updated_at':'COALESCE(priority,100)'} DESC,id DESC LIMIT $1 OFFSET $2`,[Math.min(2000,Math.max(1,Number(limit)||500)),Math.max(0,Number(offset)||0)]);return r.rows;}
export async function createRecord(name,input){const c=getCollection(name);const x=prepareRecord(name,input);const exists=(await brainPool.query(`SELECT id FROM ${c.table} WHERE content_hash=$1 LIMIT 1`,[x.content_hash])).rows[0];if(exists){const e=new Error('DUPLICATE_REJECTED');e.status=409;e.existingId=exists.id;throw e;}const keys=Object.keys(x);const vals=keys.map(k=>jsonCols.has(k)?JSON.stringify(x[k]):x[k]);const sql=`INSERT INTO ${c.table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}${jsonCols.has(keys[i])?'::jsonb':''}`).join(',')}) RETURNING *`;const row=(await brainPool.query(sql,vals)).rows[0];await bumpMeta(name);return row;}
export async function updateRecord(name,id,input){const c=getCollection(name);const old=(await brainPool.query(`SELECT * FROM ${c.table} WHERE id=$1`,[id])).rows[0];if(!old)return null;const x=prepareRecord(name,{...old,...input});const dup=(await brainPool.query(`SELECT id FROM ${c.table} WHERE content_hash=$1 AND id<>$2 LIMIT 1`,[x.content_hash,id])).rows[0];if(dup){const e=new Error('DUPLICATE_REJECTED');e.status=409;throw e;}const keys=Object.keys(x);const vals=[id,...keys.map(k=>jsonCols.has(k)?JSON.stringify(x[k]):x[k])];const sets=keys.map((k,i)=>`${k}=$${i+2}${jsonCols.has(k)?'::jsonb':''}`).join(',');const row=(await brainPool.query(`UPDATE ${c.table} SET ${sets},updated_at=now() WHERE id=$1 RETURNING *`,vals)).rows[0];await bumpMeta(name);return row;}
export async function deleteRecord(name,id){const c=getCollection(name);const r=await brainPool.query(`DELETE FROM ${c.table} WHERE id=$1`,[id]);if(r.rowCount)await bumpMeta(name);return Boolean(r.rowCount);}
export async function deleteAllRecords(name,{actor='admin',requestId=''}={}){const c=getCollection(name);const client=await brainPool.connect();try{await client.query('BEGIN');const r=await client.query(`DELETE FROM ${c.table}`);await client.query('COMMIT');await bumpMeta(name);await pool.query(`INSERT INTO admin_audit_log(actor,action,resource,request_id,meta) VALUES($1,'DELETE_ALL',$2,$3,$4::jsonb)`,[actor,name,requestId,JSON.stringify({deleted:r.rowCount})]);return r.rowCount;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
export async function exportRecords(name){const items=await listRecords(name,{limit:2000});const meta=await getMeta(name);return {schemaVersion:1,collection:name,exportedAt:new Date().toISOString(),meta,items};}
export async function importRecords(name,items,{fileName='upload.json'}={}){if(!Array.isArray(items))throw Object.assign(new Error('INVALID_IMPORT_FORMAT'),{status:400});const c=getCollection(name);const client=await brainPool.connect();let added=0,duplicate=0,invalid=0;try{await client.query('BEGIN');for(const raw of items.slice(0,5000)){let x;try{x=prepareRecord(name,raw)}catch{invalid++;continue;}const ex=(await client.query(`SELECT 1 FROM ${c.table} WHERE content_hash=$1 LIMIT 1`,[x.content_hash])).rowCount;if(ex){duplicate++;continue;}const keys=Object.keys(x);const vals=keys.map(k=>jsonCols.has(k)?JSON.stringify(x[k]):x[k]);await client.query(`INSERT INTO ${c.table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}${jsonCols.has(keys[i])?'::jsonb':''}`).join(',')})`,vals);added++;}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  const status=added?'IMPORTED':(duplicate?'DUPLICATE_REJECTED':'NO_VALID_RECORDS');await bumpMeta(name,'import');await pool.query(`INSERT INTO content_import_history(collection_type,file_name,uploaded,added,duplicate_skipped,invalid,status) VALUES($1,$2,$3,$4,$5,$6,$7)`,[name,fileName,items.length,added,duplicate,invalid,status]);return {uploaded:items.length,added,duplicateSkipped:duplicate,invalid,status};
}
export async function syncAllCollections(){const result={};for(const name of ['knowledge','responses','rules','important','supplies']) result[name]=await bumpMeta(name,'sync_all');return result;}
