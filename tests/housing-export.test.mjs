import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {connect,PUBLIC_SCHEMA} from '../server/storage.mjs';
import {APARTMENT_MASTER_SCHEMA} from '../server/apartment-master-schema.mjs';
import {normalize} from '../server/collector.mjs';
import {rebuildHousingIdentity} from '../server/housing-identity.mjs';
import {exportData,sha256} from '../server/export.mjs';
import {readTradeSnapshot,verifyTradeExport} from '../server/verify-trade-export.mjs';
import {browserPayloads,checkBrowserData,readHousingPayload} from '../server/browser-export.mjs';
import {buildSearchIndex} from '../src/search-index.mjs';
import {validateIdentitySearch} from '../src/apartment-identity.mjs';
import {loadDistrict} from '../src/data.js';
import {sourceIdentityId,selectIdentityRows} from '../src/housing-identity.mjs';
const read=file=>JSON.parse(fs.readFileSync(file));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
const raw={aptNm:'원본단지',umdNm:'시험동',jibun:'001-2',dealAmount:'100,000',excluUseAr:'84.5',dealYear:'2026',dealMonth:'01',dealDay:'09',sggCd:'11110',floor:'3',buildYear:'2000',cdealType:'',cdealDay:'',untouched:'original'};
function fixture(t,{legacyInventory=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'home-housing-export-'));t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('home-housing-export-'));fs.rmSync(root,{recursive:true,force:true});});
 const source=path.join(root,'working.sqlite3'),target=path.join(root,'public/data'),queries=path.join(root,'public/query-data'),secretsFile=path.join(root,'.env');fs.writeFileSync(secretsFile,'');
 const db=connect(source);db.exec(PUBLIC_SCHEMA);db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run('dong_11110101','시험동','11110','서울특별시 종로구','["시험동"]',null,null);
 const insert=db.prepare('INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');for(const id of [1,2])insert.run(id,...normalize(raw,'11110','202601'));
 if(legacyInventory){db.exec(APARTMENT_MASTER_SCHEMA);db.prepare('INSERT INTO apartment_inventory_regions(region_id,legal_code,dong,status) VALUES(?,?,?,?)').run('dong_11110101','1111010100','시험동','scanned');}
 else rebuildHousingIdentity(db,{scopes:[]});
 db.close();
 const options={source,target,secretsFile,favorites:path.join(root,'absent.json')};const manifest=exportData(options);
 return {root,source,target,queries,manifest};
}
test('export migrates a restored scanned inventory without housing tables before creating source routes',t=>{
 const f=fixture(t,{legacyInventory:true});assert(f.manifest.housing);
 const payload=readHousingPayload(f.target,f.manifest);assert.equal(payload.assignments.length,2);
 const catalog=read(path.join(f.root,'public/apartment-identity/catalog.json')),index=read(path.join(f.queries,f.manifest.districts['11110'].browser.file));
 const search=buildSearchIndex(new Map([['11110',index.catalog]]),f.manifest.regions,catalog.apartments);
 assert.equal(search.length,1);assert.equal(search[0].identity_default_sources.length,1);
 const again=exportData({source:f.source,target:f.target,secretsFile:path.join(f.root,'.env'),favorites:path.join(f.root,'absent.json')});
 assert.equal(again.housing.sha256,f.manifest.housing.sha256);assert.equal(verifyTradeExport({target:f.target,source:f.source}).rows,2);
});
test('export keeps original district and duplicate contracts intact while publishing packed identity and exact compact selections',async t=>{
 const f=fixture(t),rawRows=read(path.join(f.target,f.manifest.districts['11110'].file));
 assert.equal(rawRows.length,2);assert.deepEqual(rawRows.map(row=>row.raw),[raw,raw]);assert(rawRows.every(row=>!('identity' in row)));
 const payload=readHousingPayload(f.target,f.manifest);assert.equal(payload.assignments.length,2);assert.equal(payload.dictionary.length,1);assert.equal(payload.dictionary[0].precision,'unresolved');
 const index=read(path.join(f.queries,f.manifest.districts['11110'].browser.file)),monthly=read(path.join(f.queries,index.months['202601']));
 assert.deepEqual(monthly.map(row=>row.id),[2,1]);assert(monthly.every(row=>row.identity.entity_id===sourceIdentityId(row)));assert(monthly.every(row=>!('untouched' in row.raw)));
 const catalog=read(path.join(f.root,'public/apartment-identity/catalog.json'));const search=buildSearchIndex(new Map([['11110',index.catalog]]),f.manifest.regions,catalog.apartments);
 assert.equal(validateIdentitySearch(search,catalog).length,1);assert.equal(search[0].identity_ref.kind,'source');assert.equal(selectIdentityRows(monthly,search[0]).length,2);
 assert.equal(verifyTradeExport({target:f.target,source:f.source}).rows,2);checkBrowserData(f.queries,f.manifest);
 const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});globalThis.fetch=async url=>({ok:true,text:async()=>fs.readFileSync(path.join(f.root,'public',url.replace(/^\//,'')),'utf8')});
 const loaded=await loadDistrict(f.manifest,'11110');assert.deepEqual(loaded.rows,monthly);
 const rawManifest=structuredClone(f.manifest);delete rawManifest.districts['11110'].browser;assert.equal((await loadDistrict(rawManifest,'11110')).filter(row=>row.identity).length,2);
});
test('a rehashed forged binding cannot pass the working database audit or compact identity validation',t=>{
 const f=fixture(t),meta=f.manifest.housing,payload=read(path.join(f.target,meta.file));payload.dictionary[0].precision='complex';
 const bytes=Buffer.from(JSON.stringify(payload)),sha=sha256(bytes),file=`housing-${sha.slice(0,12)}.json`;fs.writeFileSync(path.join(f.target,file),bytes);
 f.manifest.housing={...meta,file,sha256:sha,bytes:bytes.length};write(path.join(f.target,'manifest.json'),f.manifest);
 assert.throws(()=>verifyTradeExport({target:f.target,source:f.source}),/작업 DB 배정/);
 const registry=read(path.join(f.queries,'manifest.json'));registry.housing_sha256=sha;write(path.join(f.queries,'manifest.json'),registry);
 assert.throws(()=>checkBrowserData(f.queries,f.manifest),/조회 목록 버전/);
});
test('stale original snapshots and source hashes are rejected even with valid sidecar bytes',t=>{
 const f=fixture(t),snapshot=readTradeSnapshot(f.source);snapshot.rows[0].raw_json=JSON.stringify({...raw,untouched:'changed'});
 assert.throws(()=>verifyTradeExport({target:f.target,snapshot}),/데이터 검증 실패/);
 f.manifest.housing.sources['11110']='0'.repeat(64);assert.throws(()=>readHousingPayload(f.target,f.manifest),/원본 버전/);
});
test('modern search uses one explicit source route and never grants stale trade keys authority',()=>{
 const source={region_code:'11110',dong:'시험동',jibun:'1',apartment:'공유원본',deal_date:'2026-01-01'},entity=sourceIdentityId(source),region={region_code:'11110',region_name:'서울특별시 종로구'};
 const rawFavorite={...source,id:entity,key:JSON.stringify([source.dong,source.jibun,source.apartment]),identity_ref:{kind:'source',id:entity},identity_default_sources:[entity]};
 const masters=[{...rawFavorite,id:'hub:a',master_id:'hub:a',identity_ref:{kind:'root',id:'hub:a'},identity_default_sources:[],trade_keys:[rawFavorite.key]},{...rawFavorite,id:'hub:b',master_id:'hub:b',identity_ref:{kind:'root',id:'hub:b'},identity_default_sources:[],trade_keys:[rawFavorite.key]},rawFavorite];
 assert.equal(buildSearchIndex(new Map([['11110',[source]]]),[region],masters)[0].id,entity);
 assert.throws(()=>buildSearchIndex(new Map([['11110',[source]]]),[region],[...masters,{...rawFavorite,id:'hub:c'}]),/중복/);
 assert.throws(()=>buildSearchIndex(new Map([['11110',[source]]]),[region],masters.slice(0,2)),/없습니다/);
});
test('compact phase data retains precise building assignments and honest shared history without duplicating contracts',()=>{
 const root='hub:phases',two='cohort:hub:phases:two',six='cohort:hub:phases:six';
 const base={id:1,region_code:'11110',dong:'시험동',jibun:'1',apartment:'역사적공유명',deal_date:'2026-01-01',deal_month:'202601',cancelled:0},entity=sourceIdentityId(base);
 const bind=(precision,cohort_id=null,building_id=null)=>({entity_id:entity,precision,root_id:cohort_id?root:null,cohort_id,building_id});
 const rows=[{...base,identity:bind('building',two,'201')},{...base,id:2,identity:bind('cohort',six)},{...base,id:3,identity:bind('complex')},{...base,id:4,identity:bind('unresolved')}];
 const packed=browserPayloads(new Map([['11110',rows]]));const index=JSON.parse(packed.payloads.get(packed.districts['11110'].file)),compact=JSON.parse(packed.payloads.get(index.months['202601']));
 assert.deepEqual(compact.map(row=>row.identity),rows.map(row=>row.identity));assert.equal(index.catalog[0].id,4);
 const favorite=cohort=>({identity_ref:{kind:'cohort',id:cohort},identity_coverage:{entity_ids:[],cohort_ids:[cohort],root_ids:[root]}});
 assert.deepEqual(selectIdentityRows(compact,favorite(two)).map(row=>row.id),[1]);assert.deepEqual(selectIdentityRows(compact,favorite(six)).map(row=>row.id),[2]);
 assert.deepEqual(selectIdentityRows(compact,{identity_ref:{kind:'source',id:entity}}).map(row=>row.id),[1,2,3,4]);
});
