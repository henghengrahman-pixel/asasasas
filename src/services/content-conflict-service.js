import crypto from 'node:crypto';
import {brainPool,pool} from '../db.js';
import {normalizeTextValue,stableJson} from './content-normalizer.js';

function severityFor(a,b){if(a.stop_processing||b.stop_processing)return 'HIGH';if((a.priority||100)===(b.priority||100))return 'HIGH';return 'MEDIUM';}
function conditionKey(rule){return normalizeTextValue(`${rule.intent||'GENERAL'}|${stableJson(rule.conditions||{})}`).toLowerCase();}
function actionKey(rule){return normalizeTextValue(`${rule.rule_type||''}|${stableJson(rule.action||{})}|${rule.content||''}`).toLowerCase();}
export async function scanLogicConflicts(){
  const rules=(await brainPool.query(`SELECT id,category,rule_type,content,intent,conditions,action,priority,stop_processing,active FROM ai_rules WHERE active=true ORDER BY priority DESC,id DESC`)).rows;
  const found=[];
  for(let i=0;i<rules.length;i++)for(let j=i+1;j<rules.length;j++){
    const a=rules[i],b=rules[j]; if(conditionKey(a)!==conditionKey(b) || actionKey(a)===actionKey(b))continue;
    const reason='Kedua rule memiliki intent/condition yang sama tetapi action/instruction berbeda.';
    const fp=crypto.createHash('sha256').update(`rules:${[a.id,b.id].sort().join(':')}:${conditionKey(a)}`).digest('hex');
    const row={fingerprint:fp,source_a:'AI Rules',source_a_id:String(a.id),source_b:'AI Rules',source_b_id:String(b.id),reason,severity:severityFor(a,b),recommendation:'Pertahankan satu action yang menjadi sumber kebenaran atau bedakan condition/priority agar workflow tidak ambigu.'};
    found.push(row);
    await pool.query(`INSERT INTO logic_conflicts(fingerprint,source_a,source_a_id,source_b,source_b_id,reason,severity,recommendation,status,detected_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'UNRESOLVED',now()) ON CONFLICT(fingerprint) DO UPDATE SET reason=excluded.reason,severity=excluded.severity,recommendation=excluded.recommendation,detected_at=now()`,Object.values(row));
  }
  return {scanned:rules.length,conflicts:found.length,items:found};
}
export async function listLogicConflicts(status=''){const q=status?await pool.query(`SELECT * FROM logic_conflicts WHERE status=$1 ORDER BY severity='HIGH' DESC,detected_at DESC LIMIT 1000`,[status]):await pool.query(`SELECT * FROM logic_conflicts ORDER BY status='UNRESOLVED' DESC,severity='HIGH' DESC,detected_at DESC LIMIT 1000`);return q.rows;}
export async function resolveLogicConflict(id,resolved=true){const r=await pool.query(`UPDATE logic_conflicts SET status=$2,resolved_at=CASE WHEN $2='RESOLVED' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,[id,resolved?'RESOLVED':'UNRESOLVED']);return r.rows[0]||null;}
