import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';
import { normalizeImportantType, importantSearchScore, formatImportantForAI } from '../src/important-info.js';

test('v1.17 classifies dynamic important-info questions',()=>{
  assert.equal(detectIntent('link akses terbaru mana bos'),'LINK_ACCESS');
  assert.equal(detectIntent('rtp pragmatic hari ini'),'RTP_INFO');
  assert.equal(detectIntent('prediksi togel singapore'),'PREDIKSI_TOGEL');
});
test('v1.17 important info helper scores aliases and formats source',()=>{
  const row={item_type:'LINK',item_key:'LINK_UTAMA',title:'Link Utama',content:'https://example.test',aliases:['link terbaru'],meta:{kind:'primary'}};
  assert.ok(importantSearchScore(row,'minta link terbaru')>0);
  assert.match(formatImportantForAI([row]),/MENU PENTING:LINK/);
  assert.equal(normalizeImportantType('prediksi togel'),'PREDIKSI_TOGEL');
});
test('v1.17 source contains important menu CRUD and seeded promo catalog',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(db,/CREATE TABLE IF NOT EXISTS bot_important_info/);
  assert.match(db,/SCATTER_HITAM/);
  assert.match(db,/BONUS_NEW_MEMBER/);
  assert.match(server,/\/api\/important-info/);
  assert.match(html,/Menu Penting/);
  assert.match(html,/Prediksi Togel/);
  assert.match(html,/Rekening \/ Wallet/);
});

test('v1.17 builds search query before reading important data',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const q=src.indexOf('const query=`${normalized}');
  const info=src.indexOf('getRelevantImportantInfo(query,24)');
  assert.ok(q>=0 && info>q,'query must exist before important-info lookup');
});

test('v1.17 promo/event claim works without literal bonus word',()=>{
  assert.equal(detectIntent('claim scatter hitam bos'),'BONUS_REQUEST');
  assert.equal(detectIntent('event koi gate gimana'),'BONUS_INFO');
});
test('v1.17 engine answers current link RTP prediction from Menu Penting and generic promo lists active catalog',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/\['LINK_ACCESS','RTP_INFO','PREDIKSI_TOGEL'\]/);
  assert.match(src,/listImportantInfo\(\{activeOnly:true,type:'PROMO'/);
  assert.match(src,/IMPORTANT_PROMO/);
});
