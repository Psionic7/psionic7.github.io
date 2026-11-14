import {createHash} from 'node:crypto';
import {MOLIT_SOURCE_SCHEMA} from './storage.mjs';
import {normalizedTradeFields} from './trade-integrity.mjs';
import {normalize} from './collector.mjs';
import {sourceIdentityId} from '../src/housing-identity.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const contract=row=>JSON.stringify(normalizedTradeFields.map(field=>row[field]));
const has=(db,name)=>Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name));
const assertLocal=db=>{if(has(db,'local_apartment_baseline'))throw Error('공식 단지 연결은 편집 가능한 로컬 원본 DB에서만 확정하세요.');};

export function approvedMolitProviders(db){
 const providers={};
 if(!has(db,'apartment_molit_sources'))return providers;
 for(const row of db.prepare('SELECT * FROM apartment_molit_sources ORDER BY provider_apartment_id,source_entity_id').all()){
  let source,evidence;
  try{source=JSON.parse(row.source_entity_id);evidence=JSON.parse(row.evidence_json);}catch{throw Error('로컬 공식 단지 연결 근거가 손상됐습니다.');}
  if(!Array.isArray(source)||source.length!==4||source.some(value=>typeof value!=='string')||!/^\d{5}$/.test(source[0])||!row.provider_apartment_id.startsWith(source[0]+'-')||!evidence?.contract_sha256||!/^[a-f0-9]{64}$/.test(evidence.contract_sha256)||!Number.isFinite(Date.parse(row.verified_at)))throw Error('로컬 공식 단지 연결의 범위·근거가 올바르지 않습니다.');
  providers[row.provider_apartment_id]??=[];providers[row.provider_apartment_id].push(row.source_entity_id);
 }
 return providers;
}

export function planMolitSourceConnections(db,observations,{sourceHash='local-source'}={}){
 assertLocal(db);
 const local=db.prepare('SELECT * FROM trades ORDER BY id').all(),witnesses=new Map();
 for(const row of local)witnesses.set(contract(row),row);
 const known=approvedMolitProviders(db),byProvider=new Map(),bySource=new Map();
 const candidates=[...local.map(row=>({...row,raw:JSON.parse(row.raw_json)})),...observations];
 for(const row of candidates){
  const raw=row.raw||JSON.parse(row.raw_json),id=raw.aptSeq?.trim();if(!id)continue;
  const values=normalize(raw,row.region_code,row.deal_month);
  if(normalizedTradeFields.some((field,index)=>row[field]!==values[index])||!id.startsWith(row.region_code+'-'))throw Error('공식 단지 관측과 거래 정규화 값이 일치하지 않습니다.');
  const source=sourceIdentityId(row);
  if(!byProvider.has(id))byProvider.set(id,new Map());
  const sources=byProvider.get(id);if(!sources.has(source))sources.set(source,[]);sources.get(source).push(row);
  if(!bySource.has(source))bySource.set(source,new Set());bySource.get(source).add(id);
 }
 for(const [id,sources] of Object.entries(known))for(const source of sources){
  if(!bySource.has(source))bySource.set(source,new Set());bySource.get(source).add(id);
  const observed=byProvider.get(id);if(observed&&!observed.has(source))observed.set(source,[]);
 }
 const connections=[],held=[];
 for(const [id,sources] of [...byProvider].sort(([a],[b])=>a.localeCompare(b))){
  const entries=[...sources],source=entries[0]?.[0];
  if(entries.length!==1||bySource.get(source).size!==1){held.push({providerId:id,reason:'ambiguous_source',sources:entries.map(([key])=>key)});continue;}
  const observed=entries[0][1].find(row=>witnesses.has(contract(row))),witness=observed&&witnesses.get(contract(observed));
  if(!witness){held.push({providerId:id,reason:'no_exact_local_contract',sources:[source]});continue;}
  connections.push({provider_apartment_id:id,source_entity_id:source,existing:known[id]?.includes(source)||false,evidence:{kind:'exact_local_contract',contract_sha256:hash(contract(witness)),local_trade_id:witness.id,observed_row_sha256:hash(JSON.stringify(observed.raw||JSON.parse(observed.raw_json))),source_sha256:sourceHash,contract:Object.fromEntries(normalizedTradeFields.map(field=>[field,witness[field]]))}});
 }
 return {version:1,connections,held};
}

export function applyMolitSourceConnections(db,plan,{now=new Date().toISOString()}={}){
 assertLocal(db);db.exec(MOLIT_SOURCE_SCHEMA+';SAVEPOINT molit_source_approval');
 let added=0;
 try{
  const insert=db.prepare('INSERT OR IGNORE INTO apartment_molit_sources VALUES(?,?,?,?)');
  for(const entry of plan.connections){
   const witness=db.prepare('SELECT * FROM trades WHERE id=?').get(entry.evidence.local_trade_id);
   if(!witness||sourceIdentityId(witness)!==entry.source_entity_id||hash(contract(witness))!==entry.evidence.contract_sha256)throw Error('로컬 거래 근거가 달라졌습니다. 공식 단지 연결을 다시 검토하세요.');
   added+=Number(insert.run(entry.provider_apartment_id,entry.source_entity_id,JSON.stringify(entry.evidence),now).changes);
  }
  approvedMolitProviders(db);db.exec('RELEASE molit_source_approval');
 }catch(error){db.exec('ROLLBACK TO molit_source_approval; RELEASE molit_source_approval');throw error;}
 return {added,total:db.prepare('SELECT count(*) AS n FROM apartment_molit_sources').get().n,held:plan.held.length};
}
