import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {connect} from './storage.mjs';
import {normalize,verifyCollectionHistory} from './collector.mjs';
import {normalizedTradeFields,assertTradeRows,assertSameValues} from './trade-integrity.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=row=>JSON.stringify([row.dong,row.jibun,row.apartment]);
const fail=message=>{throw new Error('데이터 검증 실패: '+message);};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sameSet=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
function checkedJson(folder,meta,pattern) {
  if(!meta||!pattern.test(meta.file||''))fail('데이터 파일 경로 오류');
  const bytes=fs.readFileSync(path.join(folder,meta.file));
  if(hash(bytes)!==meta.sha256||(meta.bytes!==undefined&&bytes.length!==meta.bytes))fail('데이터 체크섬 불일치');
  return JSON.parse(bytes);
}

export function readTradeSnapshot(source,{verifyHistory=true}={}) {
  const db=connect(source,true);
  try {
    db.exec('BEGIN');
    if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')fail('원본 DB 무결성 오류');
    const history=verifyHistory?verifyCollectionHistory(db):null;
    if(verifyHistory&&db.prepare("SELECT name FROM sqlite_master WHERE name='collection_runs'").get()){
      const missing=db.prepare('SELECT DISTINCT t.region_code,t.deal_month FROM (SELECT DISTINCT region_code,deal_month FROM trades) t WHERE NOT EXISTS(SELECT 1 FROM collection_runs r WHERE r.region_code=t.region_code AND r.deal_month=t.deal_month) LIMIT 1').get();
      if(missing)fail(`원천 수집 이력이 없는 계약월 ${missing.region_code}/${missing.deal_month}`);
    }
    const rows=db.prepare('SELECT * FROM trades ORDER BY deal_date DESC,id DESC').all();
    for(const row of rows){
      const values=normalize(JSON.parse(row.raw_json),row.region_code,row.deal_month);
      if(normalizedTradeFields.some((field,index)=>row[field]!==values[index]))fail(`원천 필드와 DB 값 불일치 ${row.region_code}/${row.deal_month}`);
    }
    const hasLinks=db.prepare("SELECT name FROM sqlite_master WHERE name='apartment_trade_links'").get();
    const hasInventory=db.prepare("SELECT name FROM sqlite_master WHERE name='apartment_building_inventory'").get();
    return {rows,regions:db.prepare('SELECT * FROM regions ORDER BY rowid').all(),roads:db.prepare('SELECT * FROM road_addresses ORDER BY region_code,dong,jibun').all(),publishedAt:db.prepare("SELECT value FROM metadata WHERE key='published_at'").get()?.value,history,
      memberships:hasInventory?db.prepare('SELECT DISTINCT c.apartment_id,i.region_id FROM apartment_complexes c JOIN apartment_buildings b USING(apartment_id) JOIN apartment_building_inventory i USING(building_id) WHERE c.active=1 AND i.active=1').all():[],
      links:hasLinks?db.prepare("SELECT * FROM apartment_trade_links WHERE status IN ('matched','ambiguous')").all():[]};
  } finally {db.close();}
}

// With no working DB (e.g. a fresh checkout), the public SQLite is the independent
// reference. Export itself always supplies the original working-DB snapshot.
export function verifyTradeExport({target,snapshot,source,requireSearch=false}={}) {
  const startedAt=new Date().toISOString(),manifest=json(path.join(target,'manifest.json'));
  const folder=path.resolve(target),queryFolder=path.join(path.dirname(folder),'query-data');
  const database=manifest.database;
  if(!database||!['public.sqlite3','public.sqlite3.gz'].includes(database.file)||!['sqlite3','sqlite3+gzip'].includes(database.format))fail('공개 SQLite 경로·형식 오류');
  const packed=fs.readFileSync(path.join(folder,database.file));
  if(hash(packed)!==database.sha256||packed.length!==database.bytes)fail('공개 SQLite 체크섬 불일치');
  if(!Number.isSafeInteger(database.uncompressed_bytes)||database.uncompressed_bytes<=0||database.uncompressed_bytes>1024*1024*1024)fail('공개 SQLite 크기 오류');
  const raw=database.format==='sqlite3+gzip'?gunzipSync(packed,{maxOutputLength:database.uncompressed_bytes}):packed;
  if(hash(raw)!==database.uncompressed_sha256||raw.length!==database.uncompressed_bytes)fail('공개 SQLite 압축 해제 검증 오류');
  const temporary=database.format==='sqlite3+gzip'?path.join(os.tmpdir(),`home-trade-check-${randomUUID()}.sqlite3`):null;
  let publicDb;
  try {
    if(temporary)fs.writeFileSync(temporary,raw,{flag:'wx'});
    const publicFile=temporary||path.join(folder,database.file);
    const expected=snapshot||(source?readTradeSnapshot(source):readTradeSnapshot(publicFile,{verifyHistory:false}));
    publicDb=connect(publicFile,true);
    if(Object.values(publicDb.prepare('PRAGMA integrity_check').get())[0]!=='ok')fail('공개 SQLite 무결성 오류');
    const tables=publicDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
    if(!sameSet(tables,['metadata','regions','road_addresses','trades']))fail('공개 SQLite 테이블 오류');
    assertTradeRows(expected.rows,publicDb.prepare('SELECT * FROM trades').iterate(),{scope:'작업 DB → 공개 SQLite'});
    assertSameValues(expected.regions,publicDb.prepare('SELECT * FROM regions').all(),'공개 SQLite 지역 목록');
    assertSameValues(expected.roads,publicDb.prepare('SELECT * FROM road_addresses').all(),'공개 SQLite 주소');
    const publishedAt=publicDb.prepare("SELECT value FROM metadata WHERE key='published_at'").get()?.value;
    if(publishedAt!==manifest.published_at||(expected.publishedAt&&expected.publishedAt!==publishedAt))fail('자료 기준 시각 불일치');
    const catalog=expected.regions.map(({dongs_json,...region})=>({...region,dongs:JSON.parse(dongs_json)}));
    assertSameValues(catalog,manifest.regions,'공개 지역 목록');
    const addresses=new Map(expected.roads.map(row=>[JSON.stringify([row.region_code,row.dong,row.jibun]),row.road_address]));
    const groups=new Map();
    for(const row of expected.rows){if(!/^\d{5}$/.test(row.region_code))fail('시군구 코드 오류');const rows=groups.get(row.region_code)||[];rows.push(row);groups.set(row.region_code,rows);}
    if(!sameSet(groups.keys(),Object.keys(manifest.districts))||manifest.count!==expected.rows.length)fail('공개 지역·전체 건수 불일치');
    if(!sameSet(new Set(expected.rows.map(row=>row.deal_month)),manifest.months))fail('공개 계약월 누락');
    const registry=json(path.join(queryFolder,'manifest.json'));
    if(registry.version!==1)fail('조회 자료 형식 오류');
    if(!sameSet(groups.keys(),Object.keys(registry.districts)))fail('조회용 지역 누락');
    let months=0;
    const publicGroups=new Map();
    for(const [code,rows] of groups){
      const meta=manifest.districts[code],full=checkedJson(folder,meta,new RegExp(`^trades-${code}-[a-f0-9]{12}\\.json$`));
      publicGroups.set(code,full);
      const expectedJson=rows.map(row=>({...row,road_address:addresses.get(JSON.stringify([code,row.dong,row.jibun]))||''}));
      assertTradeRows(expectedJson,full,{scope:`작업 DB → JSON ${code}`,includeAddress:true});
      if(meta.count!==rows.length||!sameSet(new Set(rows.map(row=>row.deal_month)),meta.months)||!sameSet(new Set(rows.map(row=>row.dong)),meta.dongs))fail(`지역별 범위·건수 불일치 ${code}`);
      const queryMeta=registry.districts[code];
      if(queryMeta.source_sha256!==meta.sha256||!meta.browser||queryMeta.file!==meta.browser.file||queryMeta.sha256!==meta.browser.sha256)fail(`조회 자료 버전 불일치 ${code}`);
      const index=checkedJson(queryFolder,queryMeta,new RegExp(`^catalog-${code}-[a-f0-9]{12}\\.json$`));
      if(index.version!==1||!Array.isArray(index.catalog)||!Array.isArray(index.latest))fail('조회 목록 형식 오류');
      const byMonth=new Map(),latest=new Map(),valid=new Map();
      for(const row of full){
        const list=byMonth.get(row.deal_month)||[];list.push(row);byMonth.set(row.deal_month,list);
        const identity=key(row),newer=previous=>!previous||row.deal_date>previous.deal_date||(row.deal_date===previous.deal_date&&row.id>previous.id);
        if(newer(latest.get(identity)))latest.set(identity,row);
        if(row.cancelled===0&&newer(valid.get(identity)))valid.set(identity,row);
      }
      if(!sameSet(byMonth.keys(),Object.keys(index.months)))fail(`월별 조회 파일 누락 ${code}`);
      for(const [month,expectedRows] of byMonth){
        const file=index.months[month];if(!new RegExp(`^month-${code}-${month}-[a-f0-9]{12}\\.json$`).test(file))fail('월별 조회 경로 오류');
        const bytes=fs.readFileSync(path.join(queryFolder,file));if(!file.endsWith(hash(bytes).slice(0,12)+'.json'))fail('월별 조회 체크섬 불일치');
        assertTradeRows(expectedRows,JSON.parse(bytes),{scope:`JSON → 월별 조회 ${code}/${month}`,compact:true});months++;
      }
      assertTradeRows(latest.values(),index.catalog,{scope:`검색 목록 ${code}`,compact:true});
      assertTradeRows(valid.values(),index.latest,{scope:`최근 유효 거래 ${code}`,compact:true});
    }
    let searchIdentities=0;
    if(requireSearch||registry.search){
      if(!registry.search)fail('통합 검색 자료 없음. 조회 자료를 다시 준비하세요.');
      const search=checkedJson(queryFolder,registry.search,/^search-[a-f0-9]{12}\.json$/),matches=new Map();
      if(!Array.isArray(search)||new Set(search.map(item=>item.id)).size!==search.length)fail('통합 검색 식별자 중복');
      for(const [code,meta] of Object.entries(manifest.districts))if(registry.search.sources?.[code]!==meta.sha256)fail('통합 검색 버전 불일치');
      for(const item of search)for(const identity of item.master_id?item.trade_keys:[item.key]){const id=item.region_code+'|'+identity;matches.set(id,(matches.get(id)||0)+1);}
      for(const [code,rows] of publicGroups)for(const identity of new Set(rows.map(key))){if(matches.get(code+'|'+identity)!==1)fail(`통합 검색 거래 누락·중복 ${code}`);searchIdentities++;}
      const mapFolder=path.join(path.dirname(folder),'apartment-map'),mapMeta=json(path.join(mapFolder,'manifest.json'));
      const masters=checkedJson(mapFolder,mapMeta.apartments,/^apartments-[a-f0-9]{12}\.json$/),byId=new Map(masters.map(item=>[item.id,item]));
      const scopes=new Set(mapMeta.scope_region_ids||[]),expectedMasters=new Set((expected.memberships||[]).filter(row=>scopes.has(row.region_id)).map(row=>row.apartment_id));
      if(expectedMasters.size&&!sameSet(expectedMasters,byId.keys()))fail('지도 수집 범위의 단지 누락·초과');
      for(const item of search)if(item.master_id&&!byId.has(item.master_id))fail('통합 검색 지도 단지 누락');
      for(const link of expected.links||[]){
        if(link.status==='ambiguous'){
          if(JSON.parse(link.candidates_json).some(id=>byId.has(id)))fail(`지도 단지 거래 연결 미확인 ${link.region_code}`);
          continue;
        }
        const ids=link.method==='shared_registry_address'?JSON.parse(link.candidates_json):[link.apartment_id];
        for(const id of ids){const master=byId.get(id);if(master&&!(master.region_code===link.region_code&&master.trade_keys.includes(JSON.stringify([link.dong,link.jibun,link.trade_name]))))fail(`지도 단지의 확인된 거래 연결 누락 ${link.region_code}`);}
      }
    }
    return {status:'passed',started_at:startedAt,finished_at:new Date().toISOString(),published_at:manifest.published_at,source:source?'working_database':snapshot?'export_snapshot':'public_sqlite',rows:expected.rows.length,districts:groups.size,months,search_identities:searchIdentities,source_history:expected.history};
  } finally {publicDb?.close();if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
