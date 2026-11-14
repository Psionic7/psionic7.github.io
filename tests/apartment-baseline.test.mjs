import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {connect,PUBLIC_SCHEMA,LOCAL_SCHEMA,initialize} from '../server/storage.mjs';
import {NAVER_LISTING_SCHEMA} from '../server/naver-listing-schema.mjs';
import {BASELINE_COLUMNS,baselineHash,baselineScopeHash,baselineConnections,readBaselineTable,loadApartmentBaseline,installApartmentBaseline,assertInstalledBaseline} from '../server/apartment-baseline-state.mjs';
import {baselinePattern,baselineTradeBinding,deriveBaselineHousing,baselineApartmentInformation} from '../server/apartment-baseline-runtime.mjs';
import {sourceIdentityId} from '../src/housing-identity.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {housingQueryInformation,packHousingIdentity} from '../server/housing-export.mjs';
import {housingIdentityCatalog,housingTradeBindings} from '../server/housing-identity.mjs';
import {housingBindingsMap} from '../src/housing-wire.mjs';
import {dailyListingTargets,collectDailyListings,listingExport} from '../server/daily-naver-listings.mjs';
import {synchronizeNaverMatches,recordNaverMatch,naverMatchScope} from '../server/apartment-naver-matches.mjs';
import {listingSnapshot,complexUrl} from '../src/naver-listings.mjs';
import {exportData} from '../server/export.mjs';
import {verifyTradeExport} from '../server/verify-trade-export.mjs';
import {collectMonth,parsePage} from '../server/collector.mjs';
import {collectConfigured} from '../scripts/automation.mjs';
import {planMolitSourceConnections,applyMolitSourceConnections} from '../server/molit-source-connections.mjs';

const config={version:1,time_kst:'01:00',recent_months:1,address_limit:1000,region_ids:['dong_11110101']};
const raw={aptNm:'검증단지',aptSeq:'11110-7',aptDong:'101',umdNm:'청운동',jibun:'1',dealAmount:'10,000',excluUseAr:'84',floor:'3',buildYear:'2000',dealYear:'2026',dealMonth:'11',dealDay:'01'};
const xml=items=>'<response><header><resultCode>000</resultCode></header><body><items>'+items.map(row=>'<item>'+Object.entries(row).map(([key,value])=>`<${key}>${value}</${key}>`).join('')+'</item>').join('')+`</items><totalCount>${items.length}</totalCount></body></response>`;
const collect=(db,items)=>collectMonth(db,'fixture','11110','202611','서울특별시 종로구',{pause:0,fetcher:async()=>({...parsePage(xml(items)),xml:xml(items)})});
const unresolved={precision:'unresolved',root_id:null,cohort_id:null,building_id:null};
function envelope(payload){
 const bytes=Buffer.from(JSON.stringify(payload)),packed=gzipSync(bytes),generation=baselineHash(bytes);
 return {payload,packed,manifest:{version:1,generation,scope_sha256:baselineScopeHash(config),connections_sha256:baselineHash(baselineConnections(payload)),payload:{file:'baseline-'+generation.slice(0,12)+'.json.gz',bytes:packed.length,sha256:baselineHash(packed),uncompressed_bytes:bytes.length,uncompressed_sha256:generation},targets:0,verifiedTargets:0}};
}
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'home-baseline-'));
 t.after(()=>{db.close();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('home-baseline-'));fs.rmSync(root,{recursive:true,force:true});});
 const source=path.join(root,'working.sqlite3'),db=connect(source);
 db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA+NAVER_LISTING_SCHEMA);
 db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run(config.region_ids[0],'청운동','11110','서울특별시 종로구','["청운동"]',37.5,127);
 await collect(db,[raw]);
 const row=db.prepare('SELECT * FROM trades').get(),id=sourceIdentityId(row),favorite=makeApartmentFavorite({...row,identity_ref:{kind:'source',id}},{...row,region_name:'서울특별시 종로구'});
 applyMolitSourceConnections(db,planMolitSourceConnections(db,[]));
 const housing={version:1,entities:[{entity_id:id,favorite,state:'insufficient',method:'local_review',cohort_ids:[],root_ids:[],legal_types:[],row_count:0,precision_counts:{building:0,cohort:0,complex:0,unresolved:0}}],cohorts:[],roots:[]};
 const apartments=housingQueryInformation({apartments:[]},housing).apartments.map(item=>({...item,selection_id:item.id,scope_kind:'source',root_ids:[],active:true,residential_status:'unresolved',map_visible:false,map_member_refs:[],location:{status:'missing',precision:'unknown',latitude:null,longitude:null,anchors:[]},area:{identity_ref:item.identity_ref,geometry_scope:null,region_ids:[],parcels:[],boundary_refs:[],boundary_ids:[],bbox:null,zoning_refs:[]}}));
 const information={version:1,schema_version:2,generation:baselineHash(apartments),apartments};
 const payload={version:1,scope:{region_ids:config.region_ids},tables:Object.fromEntries(Object.keys(BASELINE_COLUMNS).map(name=>[name,readBaselineTable(db,name)])),information,housing,targets:[],providers:{molit:{[raw.aptSeq]:[id]}},rules:{[id]:{default:unresolved,patterns:{[baselinePattern(row)]:{...unresolved,precision:'complex'}},exceptions:{}}},map:{manifest:{version:2,data_mode:'registry_master',scope_region_ids:config.region_ids,count:0},apartments:[],boundaries:{type:'FeatureCollection',features:[]}},memberships:[],links:[]};
 const baseline=envelope(payload),directory=path.join(root,'baseline');fs.mkdirSync(directory);
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(baseline.manifest));fs.writeFileSync(path.join(directory,baseline.manifest.payload.file),baseline.packed);
 return {root,source,db,row,id,baseline,directory};
}

test('baseline installation preserves market observations and history, is repeatable, and guards authoritative tables',async t=>{
 const f=await fixture(t),names=['trades','collection_runs','api_pages','molit_trade_id_ledger','molit_trade_revisions','molit_trade_run_rows','molit_trade_runs','molit_trade_heads','molit_apartments','naver_listing_snapshots','naver_listing_days'];
 const snapshot=()=>Object.fromEntries(names.filter(name=>f.db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name)).map(name=>[name,baselineHash(f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all())]));
 const before=snapshot();f.db.exec("UPDATE regions SET label='오래된 기준'");
 installApartmentBaseline(f.db,loadApartmentBaseline({directory:f.directory,config}),{config});
 assert.equal(f.db.prepare('SELECT label FROM regions').get().label,'청운동');assert.deepEqual(snapshot(),before);
 deriveBaselineHousing(f.db);installApartmentBaseline(f.db,f.baseline,{config});deriveBaselineHousing(f.db);assertInstalledBaseline(f.db,{expected:f.baseline,config});assert.deepEqual(snapshot(),before);
 assert.throws(()=>f.db.exec("UPDATE regions SET label='변조'"),/로컬 확정/);
 assert.throws(()=>f.db.exec('DELETE FROM regions'),/로컬 확정/);
 assert.throws(()=>f.db.exec('DELETE FROM apartment_molit_sources'),/로컬 확정/);
 await initialize({db:f.source,favorites:path.join(f.root,'absent.json'),env:path.join(f.root,'absent.env'),legacy:path.join(f.root,'absent')});
 f.db.exec('DROP TRIGGER baseline_readonly_regions_update');f.db.exec("UPDATE regions SET label='변조'");assert.throws(()=>assertInstalledBaseline(f.db),/로컬 확정 값 변경/);
});

test('missing, mixed, damaged or out-of-scope baseline is rejected before authority changes',async t=>{
 const f=await fixture(t);
 assert.throws(()=>loadApartmentBaseline({directory:f.directory,config:{region_ids:['different']}}),/범위 불일치/);
 fs.appendFileSync(path.join(f.directory,f.baseline.manifest.payload.file),'damage');assert.throws(()=>loadApartmentBaseline({directory:f.directory}),/해시 불일치/);
 fs.unlinkSync(path.join(f.directory,f.baseline.manifest.payload.file));assert.throws(()=>loadApartmentBaseline({directory:f.directory}),/파일 누락/);
 const bad=structuredClone(f.baseline.payload);bad.providers.molit={};assert.throws(()=>installApartmentBaseline(f.db,{payload:bad,manifest:f.baseline.manifest}),/해시 불일치/);
 const inconsistent=structuredClone(f.baseline.payload);inconsistent.providers.molit['11110-new']=[f.id];assert.throws(()=>installApartmentBaseline(f.db,envelope(inconsistent)),/공식 단지 연결표/);
 installApartmentBaseline(f.db,f.baseline);
 const invalid=structuredClone(f.baseline.payload);invalid.tables.regions.rows.push(invalid.tables.regions.rows[0]);
 assert.throws(()=>installApartmentBaseline(f.db,envelope(invalid)),/UNIQUE/);assertInstalledBaseline(f.db,{expected:f.baseline});
 assert.throws(()=>f.db.exec("UPDATE regions SET label='변조'"),/로컬 확정/);
});

test('official ID controls source selection; unseen building or year never inherits approved scope',async t=>{
 const f=await fixture(t),row=(changes,normal={})=>({...f.row,...normal,raw_json:JSON.stringify({...raw,...changes})});
 assert.equal(baselineTradeBinding(f.baseline.payload,f.row).precision,'complex');
 assert.equal(baselineTradeBinding(f.baseline.payload,row({aptDong:'999'})).precision,'unresolved');
 assert.equal(baselineTradeBinding(f.baseline.payload,row({buildYear:'2001'},{build_year:2001})).precision,'unresolved');
 assert.equal(baselineTradeBinding(f.baseline.payload,row({aptSeq:'11110-unapproved'})).precision,'unresolved');
 assert.equal(baselineTradeBinding(f.baseline.payload,row({jibun:'2'},{jibun:'2'})).precision,'unresolved');
 const conflicting=structuredClone(f.baseline.payload),otherId=sourceIdentityId({...f.row,apartment:'다른 승인 단지'});conflicting.rules[otherId]=structuredClone(conflicting.rules[f.id]);
 assert.equal(baselineTradeBinding(conflicting,row({aptNm:'다른 승인 단지'},{apartment:'다른 승인 단지'})).precision,'unresolved');
 const renamed=row({aptNm:'새 표기'},{apartment:'새 표기'});assert.equal(baselineTradeBinding(f.baseline.payload,renamed).entity_id,f.id);
 installApartmentBaseline(f.db,f.baseline);await collect(f.db,[raw,{...raw,aptNm:'새 표기'},{...raw,aptNm:'미승인 단지',aptSeq:'11110-999',jibun:'999'}]);deriveBaselineHousing(f.db);
 const rows=f.db.prepare('SELECT * FROM trades').all(),packed=packHousingIdentity(housingIdentityCatalog(f.db),housingTradeBindings(f.db),rows);
 const decoded=housingBindingsMap(packed);assert.equal(decoded.get(rows[1].id).provider_apartment_id,raw.aptSeq);
 const bad=structuredClone(packed);bad.provider_sources={};assert.throws(()=>housingBindingsMap(bad),/공식 단지 ID/);
 const info=baselineApartmentInformation(f.db),rebuilt=housingQueryInformation(info,housingIdentityCatalog(f.db));
 for(const item of info.apartments)assert.deepEqual(item.identity_default_sources,rebuilt.apartments.find(other=>other.id===item.id).identity_default_sources);
 assert.equal(info.apartments.length,2);assert.deepEqual(dailyListingTargets(f.db,config),[]);
});

test('frozen export and search handle renamed official IDs and new unapproved sources without registry inference',async t=>{
 const f=await fixture(t);installApartmentBaseline(f.db,f.baseline);await collect(f.db,[raw,{...raw,aptNm:'새 표기'},{...raw,aptNm:'미승인 단지',aptSeq:'11110-999',jibun:'999'}]);deriveBaselineHousing(f.db);
 const publicRoot=path.join(f.root,'public'),target=path.join(publicRoot,'data'),options={source:f.source,target,favorites:path.join(f.root,'absent.json'),secretsFile:path.join(f.root,'absent.env'),compressAbove:0};
 const manifest=exportData(options);assert.equal(manifest.apartment_baseline.generation,f.baseline.manifest.generation);
 const prepared=spawnSync(process.execPath,['scripts/prepare-browser-data.mjs','--public-root',publicRoot],{cwd:process.cwd(),encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);
 assert.equal(verifyTradeExport({source:f.source,target,requireSearch:true}).rows,3);
 const file=path.join(publicRoot,'apartment-map/manifest.json'),meta=JSON.parse(fs.readFileSync(file));meta.apartment_baseline.generation='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(meta));
 assert.throws(()=>verifyTradeExport({source:f.source,target,requireSearch:true}),/지도와 아파트 기준본/);
});

test('unapproved official ID enrichment cannot publish a loss of existing query coverage',async t=>{
 const f=await fixture(t);installApartmentBaseline(f.db,f.baseline);
 const target=path.join(f.root,'public/data'),options={source:f.source,target,favorites:path.join(f.root,'none.json'),secretsFile:path.join(f.root,'none.env')};
 exportData(options);const before=fs.readFileSync(path.join(target,'manifest.json'));
 await collect(f.db,[{...raw,aptSeq:'11110-unapproved'}]);
 assert.throws(()=>exportData(options),error=>error.code==='molit_source_coverage'&&error.report.regressions[0].rows===1);
 assert.deepEqual(fs.readFileSync(path.join(target,'manifest.json')),before);
});

test('a known provider reported outside its local parcel scope also blocks publication',async t=>{
 const f=await fixture(t);installApartmentBaseline(f.db,f.baseline);await collect(f.db,[{...raw,jibun:'2'}]);
 const options={source:f.source,target:path.join(f.root,'public/data'),favorites:path.join(f.root,'none.json'),secretsFile:path.join(f.root,'none.env')};
 assert.throws(()=>exportData(options),error=>error.code==='molit_source_coverage'&&error.report.regressions[0].reason==='provider_scope_conflict');
});

test('an older derived binding cache is rebuilt even when the approved baseline generation is unchanged',async t=>{
 const f=await fixture(t);installApartmentBaseline(f.db,f.baseline);deriveBaselineHousing(f.db);
 f.db.prepare("UPDATE housing_identity_bindings SET precision='unresolved' WHERE trade_id=?").run(f.row.id);
 f.db.exec("UPDATE housing_identity_meta SET value=json_remove(value,'$.binding_version') WHERE key='generation'");
 deriveBaselineHousing(f.db);assert.equal(housingTradeBindings(f.db).get(f.row.id).precision,'complex');
});

test('cloud collection leaves address and authority collection to the local baseline',async t=>{
 const f=await fixture(t);installApartmentBaseline(f.db,f.baseline);let addresses=0,trades=0;
 const result=await collectConfigured(f.db,config,{now:new Date('2026-11-11T00:00:00Z'),tradeKey:'fixture',jusoKey:'',collector:async()=>{trades++;return 1;},addressCollector:async()=>{addresses++;throw Error('주소 재수집 금지');},onProgress:()=>{}});
 assert.equal(addresses,0);assert(trades>0);assert.equal(Object.hasOwn(result,'listings'),false);assert.equal(result.addresses.source,'local_baseline');assertInstalledBaseline(f.db);
});

async function listingFixture(t){
 const f=await fixture(t),info=f.baseline.payload.information.apartments[0],target={favorite:makeApartmentFavorite(info,info),regionId:config.region_ids[0],query:'청운동 검증단지'};
 const at='2026-11-11T08:00:00.000Z',observation={complex_no:'77',name:'검증단지',road_address:'',parcel_address:'서울특별시 종로구 청운동 1',latitude:37.5,longitude:127,coordinate_role:'provider_label',source_url:complexUrl('77'),observed_at:at};
 synchronizeNaverMatches(f.db,[target],f.baseline.payload.housing);recordNaverMatch(f.db,target,{complexNo:'77',observation});
 const payload=structuredClone(f.baseline.payload);payload.targets=[target];for(const name of Object.keys(BASELINE_COLUMNS))payload.tables[name]=readBaselineTable(f.db,name);
 f.baseline=envelope(payload);installApartmentBaseline(f.db,f.baseline);deriveBaselineHousing(f.db);
 const group={favorite:target.favorite,complexNo:'77',complexName:'검증단지',tradeType:'A1',status:'ready',attemptedAt:at,collectedAt:at,errorCode:null,articles:[],collectionMethod:'browser',coverage:'complete',pageCount:1,sourceUrl:complexUrl('77'),observation};
 return {...f,target,group};
}

test('restored market observation wins over an older checkout snapshot with a later failed attempt',async t=>{
 const f=await listingFixture(t),old={...f.group,status:'failed',errorCode:'timeout',collectedAt:'2026-11-10T08:00:00.000Z',attemptedAt:'2026-11-11T10:00:00.000Z'};
 f.db.prepare('INSERT INTO naver_listing_snapshots VALUES(?,?,?)').run(f.target.favorite.id,f.group.collectedAt,JSON.stringify(f.group));
 const snapshot=listingExport(f.db,{initialSnapshot:listingSnapshot([old])});assert.equal(snapshot.groups.length,1);assert.equal(snapshot.groups[0].collectedAt,f.group.collectedAt);assert.equal(snapshot.groups[0].status,'ready');
 const wrong={...f.group,complexNo:'88',sourceUrl:complexUrl('88'),observation:{...f.group.observation,complex_no:'88',source_url:complexUrl('88')}};
 f.db.prepare('UPDATE naver_listing_snapshots SET group_json=?').run(JSON.stringify(wrong));
 assert.equal(listingExport(f.db,{initialSnapshot:listingSnapshot([old])}).groups[0].complexNo,'77');
});

test('explicit shared provider scopes use the newest complete observation while preserving attempts and source snapshots',async t=>{
 const f=await listingFixture(t),payload=structuredClone(f.baseline.payload),first=payload.targets[0];
 const addTarget=(lot,shared)=>{
  const favorite=makeApartmentFavorite({...first.favorite,identity_ref:undefined,id:undefined,key:undefined,jibun:lot},first.favorite);
  const target={...first,favorite,...(shared?{location:{shared_provider:{complexNo:'77',representative:first}}}:{})};
  const table=payload.tables.apartment_naver_matches,original=table.rows[0],row=[...original];
  row[table.columns.indexOf('target_id')]=favorite.id;row[table.columns.indexOf('favorite_json')]=JSON.stringify(favorite);row[table.columns.indexOf('scope_hash')]=naverMatchScope(target);table.rows.push(row);payload.targets.push(target);return target;
 };
 const second=addTarget('2',true),unlinked=addTarget('3',false);installApartmentBaseline(f.db,envelope(payload));
 const article=id=>({id,tradeType:'A1',name:'검증단지',priceText:'1억',rentText:'',priceMan:10000,rentMan:0,areaM2:84,supplyAreaM2:null,floor:'3',building:'101',direction:'남',description:'',realtor:'중개사',confirmedOn:'2026-11-11'});
 const old={...f.group,status:'failed',errorCode:'timeout',attemptedAt:'2026-11-11T11:00:00.000Z',articles:[article('1')]};
 const latest={...f.group,favorite:second.favorite,collectedAt:'2026-11-11T10:00:00.000Z',attemptedAt:'2026-11-11T10:00:00.000Z',articles:[article('1'),article('2')]};
 const unrelated={...f.group,favorite:unlinked.favorite,articles:[article('3')]};
 for(const group of [old,latest,unrelated])f.db.prepare('INSERT INTO naver_listing_snapshots VALUES(?,?,?)').run(group.favorite.id,group.collectedAt,JSON.stringify(group));
 const before=f.db.prepare('SELECT * FROM naver_listing_snapshots ORDER BY apartment_id').all(),result=listingExport(f.db),byId=new Map(result.groups.map(group=>[group.favorite.id,group]));
 assert.deepEqual(byId.get(first.favorite.id).articles,latest.articles);assert.equal(byId.get(first.favorite.id).collectedAt,latest.collectedAt);assert.equal(byId.get(first.favorite.id).attemptedAt,old.attemptedAt);assert.equal(byId.get(first.favorite.id).status,'failed');
 assert.deepEqual(byId.get(unlinked.favorite.id).articles,unrelated.articles);assert.deepEqual(f.db.prepare('SELECT * FROM naver_listing_snapshots ORDER BY apartment_id').all(),before);
});

test('daily attempts resume only under the same local baseline generation without resolving providers',async t=>{
 const f=await listingFixture(t);let collects=0;
 const options={now:()=>Date.parse(f.group.attemptedAt),sourceFactory:async()=>({close:async()=>{},resolve:async()=>{throw Error('수집 중 연결 재검색 금지');},collect:async()=>{collects++;return f.group;}})};
 assert.equal((await collectDailyListings(f.db,config,options)).successCount,1);
 assert.equal((await collectDailyListings(f.db,config,options)).alreadyCollected,true);assert.equal(collects,1);
 const payload=structuredClone(f.baseline.payload);payload.tables.apartment_molit_sources.rows[0][3]='2026-11-12T00:00:00Z';installApartmentBaseline(f.db,envelope(payload));
 assert.equal((await collectDailyListings(f.db,config,options)).successCount,1);assert.equal(collects,2);assertInstalledBaseline(f.db);
});
