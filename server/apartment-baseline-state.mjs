import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {PUBLIC_SCHEMA,ROOT} from './storage.mjs';
import {NAVER_LISTING_SCHEMA} from './naver-listing-schema.mjs';

export const BASELINE_DIRECTORY=path.join(ROOT,'automation/apartment-baseline');
export const BASELINE_COLUMNS={
 regions:['region_id','label','region_code','region_name','dongs_json','latitude','longitude'],
 road_addresses:['region_code','dong','jibun','road_address'],
 apartment_naver_matches:['target_id','scope_hash','favorite_json','state','complex_no','observation_json','evidence_json','first_matched_at','last_verified_at','last_attempted_at','reason','active'],
 apartment_naver_sources:['source_entity_id','target_id','scope_json','registry_state','active'],
};
export const baselineHash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const baselineScopeHash=config=>baselineHash([...config.region_ids].sort());
export const baselineConnections=payload=>({providers:payload.providers,rules:payload.rules,targets:payload.targets,matches:payload.tables.apartment_naver_matches,sources:payload.tables.apartment_naver_sources});
const cache=new WeakMap();
const exists=(db,name)=>Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name));
const fail=message=>{throw Error('아파트 기준본 검증 실패: '+message);};

export function readBaselineTable(db,name){
 const columns=BASELINE_COLUMNS[name];
 return {columns,rows:db.prepare('SELECT '+columns.join(',')+' FROM '+name+' ORDER BY rowid').all().map(row=>columns.map(column=>row[column]))};
}

function validatePayload(manifest,payload,config){
 if(manifest?.version!==1||payload?.version!==1||baselineHash(payload)!==manifest.generation||manifest.payload?.uncompressed_sha256!==manifest.generation)fail('지원 버전 또는 내용 해시 불일치');
 if(manifest.scope_sha256!==baselineScopeHash(payload.scope)||config&&manifest.scope_sha256!==baselineScopeHash(config))fail('수집 지역 범위 불일치');
 if(baselineHash(baselineConnections(payload))!==manifest.connections_sha256)fail('공급자 연결 버전 불일치');
 if(Object.keys(payload.tables||{}).sort().join('|')!==Object.keys(BASELINE_COLUMNS).sort().join('|'))fail('기준 테이블 목록 오류');
 for(const [name,columns] of Object.entries(BASELINE_COLUMNS)){
  const table=payload.tables[name];
  if(JSON.stringify(columns)!==JSON.stringify(table?.columns)||!Array.isArray(table.rows)||table.rows.some(row=>!Array.isArray(row)||row.length!==columns.length))fail('기준 테이블 열 또는 행 오류');
 }
 if(!Array.isArray(payload.targets)||!Array.isArray(payload.information?.apartments)||!Array.isArray(payload.housing?.entities)||!payload.rules||!payload.map||!Array.isArray(payload.memberships)||!Array.isArray(payload.links))fail('기준 카탈로그 또는 수집 대상 누락');
 return {manifest,payload};
}

export function loadApartmentBaseline({directory=BASELINE_DIRECTORY,config}={}){
 if(!fs.existsSync(path.join(directory,'manifest.json')))fail('manifest.json 파일 누락');
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 const meta=manifest.payload;
 if(!/^baseline-[a-f0-9]{12}\.json\.gz$/.test(meta?.file||'')||!Number.isSafeInteger(meta.bytes)||meta.bytes<=0||meta.bytes>95*1024*1024||!Number.isSafeInteger(meta.uncompressed_bytes)||meta.uncompressed_bytes>95*1024*1024)fail('파일 경로 또는 크기 오류');
 if(!fs.existsSync(path.join(directory,meta.file)))fail('압축 기준 파일 누락');
 const packed=fs.readFileSync(path.join(directory,meta.file));
 if(packed.length!==meta.bytes||baselineHash(packed)!==meta.sha256)fail('압축 파일 누락 또는 해시 불일치');
 const bytes=gunzipSync(packed,{maxOutputLength:95*1024*1024});
 if(bytes.length!==meta.uncompressed_bytes||baselineHash(bytes)!==meta.uncompressed_sha256)fail('원본 크기 또는 해시 불일치');
 return validatePayload(manifest,JSON.parse(bytes.toString('utf8')),config);
}

export function readInstalledBaseline(db){
 if(!exists(db,'local_apartment_baseline'))return null;
 const metadata=db.prepare('SELECT generation,manifest_json FROM local_apartment_baseline WHERE id=1').get();
 if(!metadata)fail('설치 표식 누락');
 const saved=cache.get(db);
 if(saved?.manifest.generation===metadata.generation&&JSON.stringify(saved.manifest)===metadata.manifest_json)return saved;
 const payload=JSON.parse(db.prepare('SELECT payload_json FROM local_apartment_baseline WHERE id=1').get().payload_json);
 const result=validatePayload(JSON.parse(metadata.manifest_json),payload);
 if(result.manifest.generation!==metadata.generation)fail('설치 버전 불일치');
 cache.set(db,result);return result;
}

export function assertInstalledBaseline(db,{expected,config}={}){
 cache.delete(db);
 const baseline=readInstalledBaseline(db);
 if(!baseline)fail('로컬 확정 기준본 미설치');
 if(expected&&baseline.manifest.generation!==expected.manifest.generation)fail('체크아웃과 복원 DB의 기준 버전 불일치');
 validatePayload(baseline.manifest,baseline.payload,config);
 for(const name of Object.keys(BASELINE_COLUMNS))if(baselineHash(readBaselineTable(db,name))!==baselineHash(baseline.payload.tables[name]))fail(name+'의 로컬 확정 값 변경');
 return baseline;
}

function protect(db,enable){
 for(const name of [...Object.keys(BASELINE_COLUMNS),'local_apartment_baseline'])for(const operation of ['INSERT','UPDATE','DELETE']){
  const trigger='baseline_readonly_'+name+'_'+operation.toLowerCase();
  db.exec('DROP TRIGGER IF EXISTS '+trigger);
  if(enable)db.exec(`CREATE TRIGGER ${trigger} BEFORE ${operation} ON ${name} BEGIN SELECT RAISE(ABORT,'로컬 확정 아파트 기준본은 가져오기 명령으로 갱신하세요.'); END`);
 }
}

export function installApartmentBaseline(db,baseline,{config}={}){
 const {manifest,payload}=validatePayload(baseline.manifest,baseline.payload,config);
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(PUBLIC_SCHEMA+NAVER_LISTING_SCHEMA+`CREATE TABLE IF NOT EXISTS local_apartment_baseline(id INTEGER PRIMARY KEY CHECK(id=1),generation TEXT NOT NULL,manifest_json TEXT NOT NULL,payload_json TEXT NOT NULL)`);
  protect(db,false);
  for(const name of Object.keys(BASELINE_COLUMNS).reverse())db.exec('DELETE FROM '+name);
  for(const [name,{columns,rows}] of Object.entries(payload.tables)){
   const insert=db.prepare('INSERT INTO '+name+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
   for(const row of rows)insert.run(...row);
  }
  db.prepare('INSERT OR REPLACE INTO local_apartment_baseline VALUES(1,?,?,?)').run(manifest.generation,JSON.stringify(manifest),JSON.stringify(payload));
  cache.delete(db);assertInstalledBaseline(db,{expected:baseline,config});
  protect(db,true);db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');cache.delete(db);throw error;}
 return manifest;
}
