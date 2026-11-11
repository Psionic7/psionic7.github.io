import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {connect,PUBLIC_SCHEMA,LOCAL_SCHEMA} from '../server/storage.mjs';
import {collectMonth,parsePage,verifyCollectionHistory,fetchMolitPage} from '../server/collector.mjs';
import {checkMolitAccess} from '../scripts/check-molit-access.mjs';
import {compareMolitMonth} from '../scripts/compare-molit-detailed.mjs';
import {exportData,databasePayload,sha256} from '../server/export.mjs';
import {verifyTradeExport,readTradeSnapshot} from '../server/verify-trade-export.mjs';
import {buildSearchIndex} from '../src/search-index.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {buildPublic} from '../scripts/build.mjs';

const raw={aptNm:'아파트',umdNm:'청운동',jibun:'001-2',dealAmount:'100,000',excluUseAr:'84.5',dealYear:'2026',dealMonth:'01',dealDay:'09',sggCd:'11110',floor:'3',buildYear:'2000',cdealType:'',cdealDay:'',newField:'0001'};
const xml=(items,total=items.length)=>`<response><header><resultCode>000</resultCode></header><body><items>${items.map(item=>'<item>'+Object.entries(item).map(([k,v])=>`<${k}>${v}</${k}>`).join('')+'</item>').join('')}</items><totalCount>${total}</totalCount></body></response>`;
const gateway30=key=>`<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</errMsg><returnAuthMsg>${key}</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

test('basic access can succeed while detailed service rejects registration, without leaking the key or retrying the denial',async()=>{
 const key='fixture-secret-0123456789',calls=[];
 const result=await checkMolitAccess({key,code:'11110',month:'202601',fetcher:async(url,options)=>{
  const request=new URL(url);assert.equal(request.hostname,'apis.data.go.kr');assert.equal(options.redirect,'error');assert.equal(request.searchParams.get('serviceKey'),key);assert.equal(request.searchParams.get('numOfRows'),'1');calls.push(request.pathname);
  return request.pathname.includes('AptTradeDev')?new Response(gateway30(key),{status:403}):new Response(xml([raw]));
 }});
 assert.equal(calls.length,2);assert.equal(result.results[0].status,'ready');assert.equal(result.results[0].officialIdRows,0);assert.equal(result.detailedIdStatus,'unavailable');
 const denied=result.results[1];assert.equal(denied.code,'service_key_not_registered');assert.equal(denied.providerCode,'30');assert.equal(denied.httpStatus,403);assert(!JSON.stringify(result).includes(key));
});

test('gateway errors over HTTP 200 still fail and detailed provider IDs remain source strings',async()=>{
 const request={service:'detailed',key:'fixture-key-0123456789',code:'11110',month:'202601'};
 await assert.rejects(fetchMolitPage({...request,fetcher:async()=>new Response(gateway30(request.key))}),error=>error.code==='service_key_not_registered'&&error.httpStatus===200);
 const response=await fetchMolitPage({...request,fetcher:async()=>new Response(xml([{...raw,aptSeq:'11110-000007'}]))});
 assert.equal(response.items[0].aptSeq,'11110-000007');assert(response.xml.includes('<aptSeq>11110-000007</aptSeq>'));
});
const read=file=>JSON.parse(fs.readFileSync(file));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
const hashed=(folder,prefix,value)=>{const bytes=Buffer.from(JSON.stringify(value)),hash=sha256(bytes),file=prefix+'-'+hash.slice(0,12)+'.json';fs.writeFileSync(path.join(folder,file),bytes);return{file,sha256:hash,bytes:bytes.length};};
async function fixture(t,{empty=false}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'home-trade-integrity-')),source=path.join(root,'work.sqlite3'),target=path.join(root,'public/data'),queries=path.join(root,'public/query-data'),favorites=path.join(root,'favorites.json'),secretsFile=path.join(root,'.env');
  t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('home-trade-integrity-'));fs.rmSync(resolved,{recursive:true,force:true});});
  fs.writeFileSync(secretsFile,'MOLIT_SERVICE_KEY=fixture-private-integrity-key');fs.writeFileSync(favorites,JSON.stringify({version:1,regions:[]}));
  const db=connect(source);db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA);
  db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run('dong_11110101','서울특별시 종로구 청운동','11110','서울특별시 종로구','["청운동"]',37.5,127);
  const collect=(month,items,fetcher=async()=>({...parsePage(xml(items)),xml:xml(items)}))=>collectMonth(db,'fixture','11110',month,'서울특별시 종로구',{pause:0,fetcher});
  if(!empty){await collect('202601',[raw,raw,{...raw,cdealType:'O',cdealDay:'26.02.10'}]);await collect('202602',[{...raw,aptNm:'다른 단지',jibun:'2',dealMonth:'02',dealDay:'10'}]);}
  db.prepare('INSERT INTO road_addresses VALUES(?,?,?,?)').run('11110','청운동','001-2','서울특별시 종로구 시험로 1');db.close();
  const options={source,target,favorites,secretsFile,compressAbove:0};
  return {root,source,target,queries,options,export:()=>exportData(options),verify:opts=>verifyTradeExport({source,target,...opts})};
}

test('detailed comparison preserves existing row IDs and holds conflicting IDs, missing IDs and count differences for review',async t=>{
  const f=await fixture(t,{empty:true});
  const conflicting={...raw,aptNm:'단지번호 충돌'},missing={...raw,aptNm:'단지번호 없음'},unequal={...raw,aptNm:'건수 불일치'};
  const cancelled={...raw,cdealType:'O',cdealDay:'26.02.10'};
  const basicRows=[raw,raw,conflicting,conflicting,missing,unequal,unequal,cancelled];
  const db=connect(f.source);
  try {
    await collectMonth(db,'fixture','11110','202601','서울특별시 종로구',{pause:0,fetcher:async()=>({items:basicRows,total:basicRows.length,xml:xml(basicRows)})});
  }finally{db.close();}
  const original=sha256(fs.readFileSync(f.source));
  const detailedRows=[
    {...raw,aptSeq:'11110-000007',roadNm:'시험로'},
    {...raw,aptSeq:'11110-000007',roadNm:'시험로'},
    {...conflicting,aptSeq:'11110-000008'},
    {...conflicting,aptSeq:'11110-000009'},
    missing,
    {...unequal,aptSeq:'11110-000010'},
    {...raw,floor:'4',aptSeq:'11110-000007'},
  ];
  const pages=[detailedRows.slice(0,4),detailedRows.slice(4)];
  const result=await compareMolitMonth({database:f.source,key:'fixture',code:'11110',month:'202601',pause:0,fetcher:async url=>{
    const request=new URL(url);assert(request.pathname.includes('AptTradeDev'));
    return new Response(xml(pages[Number(request.searchParams.get('pageNo'))-1],detailedRows.length));
  }});
  assert.equal(result.comparison.existingRows,8);assert.equal(result.comparison.detailedRows,7);
  assert.deepEqual(result.comparison.candidates,[{tradeIds:[1,2],detailedRows:[1,2],provider:'molit',provider_apartment_id:'11110-000007'}]);
  assert.deepEqual(result.comparison.unresolved.map(row=>row.reason),['conflicting_apt_seq','missing_apt_seq','count_mismatch','basic_only','detailed_only']);
  assert.deepEqual(result.pages.map(page=>parsePage(page.xml).items.length),[4,3]);
  assert.equal(sha256(fs.readFileSync(f.source)),original);
});

function updateIndex(f,change) {
  const manifest=read(path.join(f.target,'manifest.json')),registry=read(path.join(f.queries,'manifest.json')),index=read(path.join(f.queries,registry.districts['11110'].file));
  change(index);
  const meta=hashed(f.queries,'catalog-11110',index);manifest.districts['11110'].browser=meta;
  registry.districts['11110']={...meta,source_sha256:manifest.districts['11110'].sha256};
  write(path.join(f.target,'manifest.json'),manifest);write(path.join(f.queries,'manifest.json'),registry);
}

test('an older cloud trade DB preserves the independently collected apartment identity catalog',async t=>{
  const f=await fixture(t);f.export();
  const file=path.join(path.dirname(f.target),'apartment-identity/catalog.json');
  const apartment={...makeApartmentFavorite({apartment:'공식단지',dong:'청운동',jibun:'001-2',master_id:'hub:retained',trade_keys:[]},{region_code:'11110',region_name:'서울특별시 종로구'}),name_aliases:['예전단지명'],postal_code:'03000',addresses:[]};
  const catalog={version:1,apartments:[apartment]};write(file,catalog);
  f.export();assert.deepEqual(read(file),catalog);f.verify();
});
test('a trade-only database cannot replace a previously collected registry map or its common generation',async t=>{
  const f=await fixture(t);f.export();
  const folder=path.join(f.root,'public/apartment-map');fs.mkdirSync(folder,{recursive:true});
  const file=path.join(folder,'manifest.json');write(file,{version:2,data_mode:'registry_master',count:400});
  const manifest=fs.readFileSync(path.join(f.target,'manifest.json')),map=fs.readFileSync(file);
  assert.throws(()=>f.export(),/전체 건축물대장/);
  assert(fs.readFileSync(path.join(f.target,'manifest.json')).equals(manifest));assert(fs.readFileSync(file).equals(map));
});
function addSearch(f,masters=[]) {
  const manifest=read(path.join(f.target,'manifest.json')),rows=read(path.join(f.target,manifest.districts['11110'].file));
  const folder=path.join(f.root,'public/apartment-map');fs.mkdirSync(folder,{recursive:true});
  const apartments=hashed(folder,'apartments',masters);write(path.join(folder,'manifest.json'),{apartments});
  const search=buildSearchIndex(new Map([['11110',rows]]),manifest.regions,masters),meta=hashed(f.queries,'search',search),registry=read(path.join(f.queries,'manifest.json'));
  registry.search={...meta,sources:{'11110':manifest.districts['11110'].sha256},apartment_information_generation:manifest.apartment_information?.generation};write(path.join(f.queries,'manifest.json'),registry);return search;
}

test('real collection and compressed export preserve duplicate contracts, cancellations, raw fields and addresses',async t=>{
  const f=await fixture(t);f.export();const before=sha256(fs.readFileSync(f.source)),result=f.verify();
  assert.equal(result.rows,4);assert.equal(result.months,2);assert.equal(result.source_history.months,2);assert.equal(result.source_history.rows,4);
  addSearch(f);assert.equal(f.verify({requireSearch:true}).search_identities,2);
  assert.equal(verifyTradeExport({target:f.target,requireSearch:true}).source,'public_sqlite');
  assert.equal(sha256(fs.readFileSync(f.source)),before);
});

test('stored-row loss or value changes roll back the month and its new source history',async t=>{
  const f=await fixture(t),db=connect(f.source),before=db.prepare('SELECT * FROM trades').all(),runs=db.prepare('SELECT count(*) n FROM collection_runs').get().n;
  try{for(const body of ["SELECT RAISE(IGNORE);","UPDATE trades SET cancelled=1 WHERE id=NEW.id;","UPDATE trades SET raw_json=json_set(raw_json,'$.newField','lost') WHERE id=NEW.id;"]){
    db.exec(`CREATE TEMP TRIGGER corrupt ${body.startsWith('SELECT')?'BEFORE':'AFTER'} INSERT ON trades BEGIN ${body} END;`);
    const items=[{...raw,dealAmount:'200,000'}];
    await assert.rejects(collectMonth(db,'fixture','11110','202601','종로구',{pause:0,fetcher:async()=>({...parsePage(xml(items)),xml:xml(items)})}),/데이터 검증 실패/);
    db.exec('DROP TRIGGER corrupt');assert.deepEqual(db.prepare('SELECT * FROM trades').all(),before);assert.equal(db.prepare('SELECT count(*) n FROM collection_runs').get().n,runs);
  }}finally{db.close();}
});

test('repeated pages fail before replacement; duplicates within a genuine page remain valid',async t=>{
  const f=await fixture(t),db=connect(f.source),before=db.prepare('SELECT * FROM trades').all();
  try{
    await assert.rejects(collectMonth(db,'fixture','11110','202601','종로구',{pause:0,fetcher:async()=>({total:2,items:[raw],xml:xml([raw],2)})}),/페이지가 반복/);
    assert.deepEqual(db.prepare('SELECT * FROM trades').all(),before);
  }finally{db.close();}
});

test('a nonempty month cannot be silently replaced by an unexpectedly empty API response',async t=>{
  const f=await fixture(t),db=connect(f.source),before=db.prepare('SELECT * FROM trades').all();
  try{
    await assert.rejects(collectMonth(db,'fixture','11110','202601','종로구',{pause:0,fetcher:async()=>({total:0,items:[],xml:xml([])})}),/원천 건수 급감/);
    assert.deepEqual(db.prepare('SELECT * FROM trades').all(),before);
  }finally{db.close();}
});

test('large unexplained drops are blocked while ordinary source corrections may reduce row counts',async t=>{
  const f=await fixture(t,{empty:true}),db=connect(f.source),items=Array.from({length:100},(_,floor)=>({...raw,floor:String(floor)}));
  const collect=next=>collectMonth(db,'fixture','11110','202601','종로구',{pause:0,fetcher:async()=>({total:next.length,items:next,xml:xml(next)})});
  try{
    await collect(items);await assert.rejects(collect(items.slice(0,49)),/원천 건수 급감/);assert.equal(db.prepare('SELECT count(*) n FROM trades').get().n,100);
    await collect(items.slice(0,99));assert.equal(db.prepare('SELECT count(*) n FROM trades').get().n,99);assert.equal(verifyCollectionHistory(db).rows,99);
  }finally{db.close();}
});

test('source XML with different contracts cannot pass merely by matching API and DB row counts',async t=>{
  const f=await fixture(t),db=connect(f.source),before=db.prepare('SELECT * FROM trades').all();
  try{
    await assert.rejects(collectMonth(db,'fixture','11110','202601','종로구',{pause:0,fetcher:async()=>({total:1,items:[raw],xml:xml([{...raw,dealAmount:'999,999'}])})}),/데이터 검증 실패/);
    assert.deepEqual(db.prepare('SELECT * FROM trades').all(),before);
  }finally{db.close();}
});

test('deleted months or source pages block extraction and preserve the previously published manifest',async t=>{
  const f=await fixture(t);f.export();const before=fs.readFileSync(path.join(f.target,'manifest.json')),db=connect(f.source);
  try{
    db.exec("DELETE FROM trades WHERE deal_month='202601'");assert.throws(()=>f.export(),/데이터 검증 실패/);assert(fs.readFileSync(path.join(f.target,'manifest.json')).equals(before));
    db.exec('DELETE FROM api_pages');assert.throws(()=>verifyCollectionHistory(db),/원천 페이지 없음/);
  }finally{db.close();}
});

test('same-count JSON replacements fail even after file names and checksums have been regenerated',async t=>{
  const f=await fixture(t);f.export();const manifest=read(path.join(f.target,'manifest.json')),rows=read(path.join(f.target,manifest.districts['11110'].file));
  rows[0].price_man++;const meta=hashed(f.target,'trades-11110',rows);manifest.districts['11110']={...manifest.districts['11110'],...meta};write(path.join(f.target,'manifest.json'),manifest);
  assert.throws(()=>f.verify(),/작업 DB → JSON.*초과·변경/);
});

test('official provider IDs survive export and cannot disappear from rehashed browser shards',async t=>{
 const f=await fixture(t,{empty:true}),db=connect(f.source),item={...raw,aptSeq:'11110-000007'};
 try{await collectMonth(db,'fixture','11110','202601','종로구',{pause:0,fetcher:async()=>({...parsePage(xml([item])),xml:xml([item]),service:'detailed'})});}finally{db.close();}
 const manifest=f.export();f.verify();
 const full=read(path.join(f.target,manifest.districts['11110'].file));assert.equal(full[0].raw.aptSeq,'11110-000007');
 const registry=read(path.join(f.queries,'manifest.json')),index=read(path.join(f.queries,registry.districts['11110'].file));
 const rows=read(path.join(f.queries,index.months['202601']));assert.equal(rows[0].raw.aptSeq,'11110-000007');
 delete rows[0].raw.aptSeq;const month=hashed(f.queries,'month-11110-202601',rows);
 updateIndex(f,next=>{next.months['202601']=month.file;});
 assert.throws(()=>f.verify(),/JSON → 월별 조회/);
});

test('duplicate loss, wrong cancellation dates, floor, area and address fail within otherwise valid month files',async t=>{
  const f=await fixture(t);f.export();
  const base=read(path.join(f.target,'manifest.json')),registry=read(path.join(f.queries,'manifest.json')),index=read(path.join(f.queries,registry.districts['11110'].file)),original=read(path.join(f.queries,index.months['202601']));
  for(const change of [rows=>rows.pop(),rows=>{rows[0].raw.cdealDay='26.03.01';},rows=>{rows[0].floor++;},rows=>{rows[0].area_m2++;},rows=>{rows[0].road_address='다른 주소';}]){
    write(path.join(f.target,'manifest.json'),base);write(path.join(f.queries,'manifest.json'),registry);
    const rows=structuredClone(original);change(rows);const monthMeta=hashed(f.queries,'month-11110-202601',rows);
    updateIndex(f,next=>{next.months['202601']=monthMeta.file;});assert.throws(()=>f.verify(),/JSON → 월별 조회/);
  }
});

test('omitting a required nullable field is rejected instead of silently treating omission as null',async t=>{
  const f=await fixture(t);f.export();updateIndex(f,index=>{delete index.catalog[0].floor;});assert.throws(()=>f.verify(),/거래 필수 필드 누락/);
});

test('same-count public SQLite corruption fails even with recomputed archive and uncompressed checksums',async t=>{
  const f=await fixture(t);f.export();const manifest=read(path.join(f.target,'manifest.json')),temporary=path.join(f.root,'corrupt.sqlite3');
  fs.writeFileSync(temporary,gunzipSync(fs.readFileSync(path.join(f.target,manifest.database.file))));
  const db=connect(temporary);db.exec('UPDATE trades SET cancelled=1 WHERE id=(SELECT min(id) FROM trades)');db.close();
  const payload=databasePayload(fs.readFileSync(temporary),[],0);fs.writeFileSync(path.join(f.target,payload.metadata.file),payload.bytes);manifest.database=payload.metadata;write(path.join(f.target,'manifest.json'),manifest);
  assert.throws(()=>f.verify(),/작업 DB → 공개 SQLite/);
});

test('catalog omissions and wrong latest-valid rows fail despite unchanged transaction shards',async t=>{
  const f=await fixture(t);f.export();updateIndex(f,index=>{index.catalog.pop();});assert.throws(()=>f.verify(),/검색 목록/);
  f.export();updateIndex(f,index=>{index.latest[0].cancelled=1;});assert.throws(()=>f.verify(),/최근 유효 거래/);
});

test('search omissions and lost verified master links block a finished build',async t=>{
  const f=await fixture(t);f.export();const search=addSearch(f),registry=read(path.join(f.queries,'manifest.json'));
  registry.search={...registry.search,...hashed(f.queries,'search',search.slice(1))};write(path.join(f.queries,'manifest.json'),registry);assert.throws(()=>f.verify({requireSearch:true}),/통합 검색 거래 누락/);
  // The remaining assertions exercise the pre-housing export contract.
  const legacyManifest=read(path.join(f.target,'manifest.json'));delete legacyManifest.apartment_information;write(path.join(f.target,'manifest.json'),legacyManifest);
  const tradeKey=JSON.stringify(['청운동','001-2','아파트']),master=makeApartmentFavorite({master_id:'hub:fixture',apartment:'공식 단지명',dong:'청운동',jibun:'001-2',trade_keys:[tradeKey]},{region_code:'11110',region_name:'서울특별시 종로구'});
  addSearch(f,[master]);
  const db=connect(f.source);db.exec('CREATE TABLE apartment_trade_links(region_code TEXT,dong TEXT,jibun TEXT,trade_name TEXT,apartment_id TEXT,status TEXT,method TEXT,candidates_json TEXT)');db.prepare('INSERT INTO apartment_trade_links VALUES(?,?,?,?,?,?,?,?)').run('11110','청운동','001-2','아파트',master.id,'matched','unique_registry_parcel','[]');db.close();
  assert.equal(f.verify({requireSearch:true}).status,'passed');
  const folder=path.join(f.root,'public/apartment-map'),meta=hashed(folder,'apartments',[{...master,trade_keys:[]}]);write(path.join(folder,'manifest.json'),{apartments:meta});assert.throws(()=>f.verify({requireSearch:true}),/지도 단지의 확인된 거래 연결 누락/);
  const work=connect(f.source);work.prepare('UPDATE apartment_trade_links SET status=?,candidates_json=?').run('ambiguous',JSON.stringify([master.id]));work.close();
  assert.throws(()=>f.verify({requireSearch:true}),/지도 단지 거래 연결 미확인/);
  const snapshot=readTradeSnapshot(f.source);snapshot.memberships=[{apartment_id:master.id,region_id:'dong_11110101'},{apartment_id:'hub:missing',region_id:'dong_11110101'}];
  write(path.join(folder,'manifest.json'),{apartments:meta,scope_region_ids:['dong_11110101']});
  assert.throws(()=>verifyTradeExport({target:f.target,snapshot,requireSearch:true}),/지도 수집 범위의 단지 누락/);
});

test('a staging fault is detected before either public manifest or the SQLite archive is replaced',async t=>{
  const f=await fixture(t);f.export();const files=[path.join(f.target,'manifest.json'),path.join(f.target,'public.sqlite3.gz'),path.join(f.queries,'manifest.json')],before=files.map(file=>sha256(fs.readFileSync(file))),rename=fs.renameSync;
  t.mock.method(fs,'renameSync',(from,to)=>{rename(from,to);if(String(to).includes('home-records-export-')&&path.basename(to).startsWith('trades-')){const rows=read(to);rows[0].price_man++;write(to,rows);}});
  assert.throws(()=>f.export(),/데이터 체크섬 불일치/);assert.deepEqual(files.map(file=>sha256(fs.readFileSync(file))),before);
});

test('CLI produces a failed report and nonzero exit code; successful empty source months are valid',async t=>{
  const f=await fixture(t,{empty:true}),db=connect(f.source);
  await collectMonth(db,'fixture','11110','202601','종로구',{pause:0,fetcher:async()=>({total:0,items:[],xml:xml([])})});db.close();f.export();
  assert.equal(f.verify().rows,0);assert.equal(f.verify().source_history.months,1);
  const report=path.join(f.root,'report.json'),args=['scripts/check-trade-data.mjs','--source',f.source,'--target',f.target,'--report',report];
  assert.equal(spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true}).status,0);assert.equal(read(report).status,'passed');
  const bad=connect(f.source);bad.exec('DELETE FROM api_pages');bad.close();
  const result=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});assert.equal(result.status,1);assert.equal(read(report).status,'failed');assert(!result.stderr.includes('fixture-private-integrity-key'));
});

test('both pre-build and post-build verification are required and stop completion when they fail',()=>{
  for(const target of ['public/data','docs/data']){
    const steps=[];assert.throws(()=>buildPublic({run:(_node,args)=>{steps.push(args);if(args[0]==='scripts/check-trade-data.mjs'&&args.includes(target))throw Error('validation failed');}}),/validation failed/);
    const compiled=steps.some(args=>args[0]==='node_modules/vite/bin/vite.js');assert.equal(compiled,target==='docs/data');
    assert.equal(steps.at(-1)[0],'scripts/check-trade-data.mjs');assert(steps.at(-1).includes('--require-search'));
  }
});
