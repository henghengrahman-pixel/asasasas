import express from 'express';
import {exportRecords,importRecords,listRecords,createRecord,updateRecord,deleteRecord,deleteAllRecords,getMeta,syncAllCollections} from '../services/content-service.js';
import {scanLogicConflicts,listLogicConflicts,resolveLogicConflict} from '../services/content-conflict-service.js';
import {pool,brainPool,getSetting} from '../db.js';

export function createModularApiRouter({requireAdmin,config}){
  const router=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  for(const name of ['knowledge','responses','rules','important','supplies']){
    router.get(`/content/${name}`,requireAdmin,wrap(async(req,res)=>res.json({ok:true,items:await listRecords(name,{limit:req.query.limit,offset:req.query.offset}),meta:await getMeta(name)})));
    router.post(`/content/${name}`,requireAdmin,wrap(async(req,res)=>res.status(201).json({ok:true,item:await createRecord(name,req.body||{})})));
    router.put(`/content/${name}/:id`,requireAdmin,wrap(async(req,res)=>{const item=await updateRecord(name,req.params.id,req.body||{});if(!item)return res.status(404).json({ok:false,error:'NOT_FOUND',message:'Data tidak ditemukan.'});res.json({ok:true,item});}));
    router.delete(`/content/${name}/:id`,requireAdmin,wrap(async(req,res)=>res.json({ok:await deleteRecord(name,req.params.id)})));
    router.get(`/content/${name}/export`,requireAdmin,wrap(async(req,res)=>{res.setHeader('Content-Disposition',`attachment; filename="${name}-${Date.now()}.json"`);res.json(await exportRecords(name));}));
    router.post(`/content/${name}/import`,requireAdmin,wrap(async(req,res)=>{const items=Array.isArray(req.body)?req.body:req.body?.items;res.json({ok:true,...await importRecords(name,items,{fileName:String(req.body?.fileName||'upload.json')})});}));
    router.delete(`/content/${name}`,requireAdmin,wrap(async(req,res)=>{const expected=`HAPUS SEMUA ${name==='knowledge'?'KNOWLEDGE':name.toUpperCase()}`;if(String(req.body?.confirm||'')!==expected)return res.status(400).json({ok:false,error:'CONFIRMATION_REQUIRED',message:`Ketik: ${expected}`});res.json({ok:true,deleted:await deleteAllRecords(name,{actor:'admin',requestId:req.requestId||''})});}));
  }
  router.post('/sync/all',requireAdmin,wrap(async(req,res)=>{const collections=await syncAllCollections();const profile=await getSetting('website_profile',{});const cta=(await pool.query('SELECT count(*)::int n,max(updated_at) updated_at FROM telegram_cta_configs')).rows[0];res.json({ok:true,collections,websiteProfile:{status:'OK',record_count:profile&&Object.keys(profile).length?1:0,updated_at:new Date().toISOString()},telegramCta:{status:'OK',record_count:cta.n,updated_at:cta.updated_at}});}));
  router.get('/conflicts',requireAdmin,wrap(async(req,res)=>res.json({ok:true,items:await listLogicConflicts(String(req.query.status||'').toUpperCase())})));
  router.post('/conflicts/scan',requireAdmin,wrap(async(req,res)=>res.json({ok:true,...await scanLogicConflicts()})));
  router.post('/conflicts/:id/resolve',requireAdmin,wrap(async(req,res)=>res.json({ok:true,item:await resolveLogicConflict(req.params.id,req.body?.resolved!==false)})));
  router.get('/ai-settings/overview',requireAdmin,wrap(async(req,res)=>{
    const [db,brain,queue]=await Promise.all([pool.query('SELECT now() now'),brainPool.query('SELECT now() now'),pool.query(`SELECT count(*) FILTER(WHERE status='OPEN')::int open_requests,count(*) FILTER(WHERE status='PENDING')::int dead_letters FROM human_requests LEFT JOIN dead_letters ON false`).catch(()=>({rows:[{open_requests:0,dead_letters:0}]}))]);
    res.json({ok:true,status:{database:'OK',brainDatabase:'OK',livechat:config.lcAccountId&&config.lcPat?'CONFIGURED':'MISSING',openai:config.openaiKey?'CONFIGURED':'MISSING',telegram:config.telegramEnabled?'ENABLED':'DISABLED'},queue:queue.rows[0]||{},timestamp:new Date().toISOString()});
  }));
  return router;
}
