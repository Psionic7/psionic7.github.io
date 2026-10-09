import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {exportApartmentMap} from '../server/export-apartment-map.mjs';import {validateApartmentMap,mapCollectedApartments} from '../src/apartment-map-data.js';
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {parseRegistryPage,readRegistryRegion,fetchRegistryPage,REGISTRY_DATASETS,buildingClassification,parcel} from '../server/building-registry.mjs';
import {initializeApartmentMaster,startMasterRun,saveRegistrySnapshot,rebuildApartmentMaster,masterStats,linkMasterTrades,masterMapData} from '../server/apartment-master.mjs';
import {enrichApartmentMaster,parseParcelResult,parseMasterEntrances,VWORLD_LAYERS} from '../server/apartment-master-enrichment.mjs';
import {enrichVworldApartmentData,fetchVworldLayer,geometryWkt} from '../server/vworld-apartment-data.mjs';
const scope={region_id:'dong_41117102',legal_code:'4111710200',region_code:'41117',region_name:'경기도 수원시 영통구',dong:'원천동'};
const title=(id,name='거래없는아파트',changes={})=>({mgmBldrgstPk:id,sigunguCd:'41117',bjdongCd:'10200',platGbCd:'0',bun:'0001',ji:'0000',bldNm:name,dongNm:id,mainAtchGbCd:'0',mainPurpsCd:'02000',mainPurpsCdNm:'공동주택',etcPurps:'아파트',newPlatPlc:'경기도 수원시 영통구 시험로 1',useAprDay:'20000103',hhldCnt:'50',grndFlrCnt:'15',naRoadCd:'411173012345',naBjdongCd:'10200',naUgrndCd:'0',naMainBun:'1',naSubBun:'0',...changes});
const snapshot=(titles,basis=[],recap=[],attached=[],floors=[])=>Object.fromEntries(REGISTRY_DATASETS.map((key,i)=>{const items=[titles,basis,recap,attached,floors][i];return[key,{total:items.length,items,pages:[{page:1,total:items.length,items}]}];}));
function fixture(){const db=new DatabaseSync(':memory:');initializeApartmentMaster(db);return db;}
function populate(db,s=snapshot([title('b1'),title('b2')],[{mgmBldrgstPk:'b1',mgmUpBldrgstPk:'root'},{mgmBldrgstPk:'b2',mgmUpBldrgstPk:'root'}],[{mgmBldrgstPk:'root',bldNm:'독립단지',hhldCnt:'100',useAprDay:'20000103'}],[{mgmBldrgstPk:'root',atchSigunguCd:'41117',atchBjdongCd:'10200',atchPlatGbCd:'0',atchBun:'0002',atchJi:'0000'}])){const run=startMasterRun(db,[scope]);saveRegistrySnapshot(db,run,scope,s);rebuildApartmentMaster(db);db.prepare("UPDATE apartment_inventory_runs SET status='needs_review' WHERE id=?").run(run);return run;}
const polygon={type:'Polygon',coordinates:[[[127,37],[127.01,37],[127.01,37.01],[127,37.01],[127,37]]]};
test('registry JSON/XML keeps identifiers, validates auth and accepts an empty complete region',()=>{
 assert.equal(parseRegistryPage(JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:1,items:{item:title('b1')}}}})).items[0].bun,'0001');
 assert.equal(parseRegistryPage('<response><header><resultCode>00</resultCode></header><body><totalCount>0</totalCount><items/></body></response>').total,0);
 assert.throws(()=>parseRegistryPage('{"response":{"header":{"resultCode":"20"}}}'),/승인/);assert.throws(()=>parseRegistryPage('<!DOCTYPE x><response/>'));
});
test('whole-region collection rejects missing/repeated pages and changing totals',async()=>{
 await assert.rejects(readRegistryRegion('test',scope.legal_code,{pause:0,fetcher:async(_k,_c,_d,p)=>({total:2,items:p===1?[title('b1')]:[]})}),/누락/);
 await assert.rejects(readRegistryRegion('test',scope.legal_code,{pause:0,fetcher:async()=>({total:2,items:[title('b1')]})}),/반복/);
 await assert.rejects(readRegistryRegion('test',scope.legal_code,{pause:0,fetcher:async(_k,_c,_d,p)=>({total:p===1?2:3,items:[title('b'+p)]})}),/변경/);
});
test('floor usage finds apartments inside mixed use buildings and generic housing remains a review item',()=>{
 assert.equal(buildingClassification(title('b',{},{mainPurpsCdNm:'근린생활시설',etcPurps:''}),[{mainPurpsCdNm:'공동주택',etcPurps:'아파트'}]),'apartment');
 assert.equal(buildingClassification(title('b','',{etcPurps:''})),'review');assert.equal(buildingClassification(title('b','',{etcPurps:'다세대주택'})),'other');
 assert.equal(parcel(title('b')).pnu,'4111710200100010000');assert.equal(parcel(title('b','',{platGbCd:'2'})),null);
});
test('independent registry master includes no-trade apartments, buildings and attached land',()=>{
 const db=fixture();try{populate(db);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='trades'").get(),undefined);const apt=db.prepare('SELECT * FROM apartment_complexes').get();assert.equal(apt.name,'독립단지');assert.equal(apt.build_year,2000);assert.equal(apt.household_count,100);assert.equal(apt.building_count,2);assert.equal(db.prepare('SELECT count(*) AS n FROM apartment_parcels').get().n,2);assert.equal(masterStats(db,[scope.region_id]).complete,false);}finally{db.close();}
});
test('resume preserves regions already marked scanned',()=>{
 const db=fixture();try{const run=populate(db);db.prepare("UPDATE apartment_inventory_regions SET status='scanned' WHERE region_id=?").run(scope.region_id);startMasterRun(db,[scope],{preserveScanned:true});assert.equal(db.prepare('SELECT status FROM apartment_inventory_regions WHERE region_id=?').get(scope.region_id).status,'scanned');assert.ok(db.prepare('SELECT id FROM apartment_inventory_runs WHERE id>?').get(run));}finally{db.close();}
});
test('missing dates and unclassified housing remain visible as issues rather than manufactured years',()=>{
 const db=fixture();try{populate(db,snapshot([title('b1','신규',{useAprDay:''}),title('b2','용도모름',{etcPurps:''})]));assert.equal(db.prepare("SELECT build_year FROM apartment_complexes WHERE apartment_id='hub:b1'").get().build_year,null);const codes=masterStats(db).issueList.map(i=>i.code);assert.ok(codes.includes('missing_approval'));assert.ok(codes.includes('use_review'));}finally{db.close();}
});
test('coordinate enrichment groups common address codes and preserves all entrances, including multi-entrance results',async()=>{
 const db=fixture();try{populate(db);let requests=0;await enrichApartmentMaster(db,{coordinateKey:'local-key',vworldKey:'local-vworld',pause:0,coordinateFetcher:async()=>{requests++;return[{latitude:37.005,longitude:127.005,entX:950000,entY:1950000},{latitude:37.006,longitude:127.006,entX:950001,entY:1950001}];},parcelFetcher:async()=>polygon});assert.equal(requests,1);assert.equal(db.prepare('SELECT count(*) AS n FROM apartment_entrances').get().n,4);assert.equal(masterStats(db,[scope.region_id]).readyToComplete,false);assert.equal(masterStats(db,[scope.region_id]).complete,false);db.prepare("UPDATE apartment_inventory_runs SET status='complete'").run();assert.equal(masterStats(db,[scope.region_id]).complete,false);const data=masterMapData(db,[scope],[scope.region_id]);assert.equal(data.apartments.length,1);assert.equal(data.apartments[0].trade_keys.length,0);assert.equal(data.boundaries.features.length,2);assert.equal(data.apartments[0].build_year,2000);}finally{db.close();}
});
test('transient geometry failures preserve previously verified data',async()=>{
 const db=fixture();try{populate(db);await enrichApartmentMaster(db,{coordinateKey:'k',vworldKey:'v',pause:0,coordinateFetcher:async()=>[{latitude:37,longitude:127,entX:950000,entY:1950000}],parcelFetcher:async()=>polygon});const before=db.prepare('SELECT geometry_json FROM apartment_parcels').get().geometry_json;await assert.rejects(enrichApartmentMaster(db,{coordinateKey:'k',vworldKey:'v',pause:0,refresh:true,coordinateFetcher:async()=>[{latitude:37,longitude:127,entX:950000,entY:1950000}],parcelFetcher:async()=>{throw new Error('HTTP 503');}}));assert.equal(db.prepare('SELECT geometry_json FROM apartment_parcels').get().geometry_json,before);}finally{db.close();}
});
test('parcel parser checks PNU, closed geometry and distinguishes explicit absence from provider errors',()=>{
 const pnu='4111710200100010000',payload={response:{status:'OK',result:{featureCollection:{features:[{properties:{pnu},geometry:polygon}]}}}};assert.deepEqual(parseParcelResult(payload,pnu),polygon);assert.throws(()=>parseParcelResult(payload,'4111710200100020000'));assert.throws(()=>parseParcelResult({response:{status:'ERROR'}},pnu));assert.equal(parseParcelResult({response:{status:'NOT_FOUND'}},pnu),null);
 const codes={admCd:'4111710200'};assert.equal(parseMasterEntrances({results:{common:{errorCode:'0',totalCount:2},juso:[{entX:'950000',entY:'1950000'},{entX:'950010',entY:'1950010'}]}},codes).length,2);
});
test('separate trade links match verified parcels and retain renamed/historical mismatches for review',()=>{
 const db=fixture();try{populate(db);db.exec('CREATE TABLE trades(region_code TEXT,dong TEXT,jibun TEXT,apartment TEXT,build_year INTEGER)');const insert=db.prepare('INSERT INTO trades VALUES(?,?,?,?,?)');insert.run('41117','원천동','1','거래없는아파트',2000);insert.run('41117','원천동','2','독립단지',2000);insert.run('41117','원천동','1','철거된옛단지',1980);const r=linkMasterTrades(db);assert.equal(r.matched,2);assert.equal(r.unmatched,1);assert.equal(db.prepare('SELECT count(*) AS n FROM apartment_complexes WHERE active=1').get().n,1);}finally{db.close();}
});

test('empty HTTP 200 responses retry in alternate formats and preserve large registry identifiers',async()=>{let calls=0,diagnostics=0;const raw='{"response":{"header":{"resultCode":"00"},"body":{"totalCount":1,"items":{"item":{"mgmBldrgstPk":9999999999999999999}}}}}';const p=await fetchRegistryPage('fixture-key',scope.legal_code,'getBrTitleInfo',1,{retryDelay:1,onDiagnostic:()=>diagnostics++,fetcher:async(_url,options)=>{assert.equal(options.headers.Connection,'close');calls++;return new Response(calls===1?'':raw,{status:200});}});assert.equal(calls,2);assert.equal(diagnostics,1);assert.equal(p.items[0].mgmBldrgstPk,'9999999999999999999');});

test('a failing page batch waits for every in-flight cache write before returning',async()=>{let completed=false;await assert.rejects(readRegistryRegion('test',scope.legal_code,{pause:0,fetcher:async(_k,_c,_d,p)=>{if(p===1)return{total:3,items:[title('b1')]};if(p===2)throw new Error('page failed');await new Promise(r=>setTimeout(r,15));completed=true;return{total:3,items:[title('b3')]};}}),/page failed/);assert.equal(completed,true);});
test('master export includes apartments without a trade table and preserves published data while incomplete',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'home-master-export-'));t.after(()=>{const resolved=path.resolve(root);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('home-master-export-'));fs.rmSync(resolved,{recursive:true,force:true});});
 const source=path.join(root,'master.sqlite3'),target=path.join(root,'map'),favorites=path.join(root,'regions.json'),secretsFile=path.join(root,'.env');fs.writeFileSync(favorites,JSON.stringify({version:1,regions:[{region_id:scope.region_id}]}));fs.writeFileSync(secretsFile,'VWORLD_API_KEY=privatefixturemasterkey');const db=new DatabaseSync(source);initializeApartmentMaster(db);db.exec('CREATE TABLE regions(region_id TEXT,label TEXT,region_code TEXT,region_name TEXT,dongs_json TEXT,lat REAL,lon REAL)');db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run(scope.region_id,'원천동',scope.region_code,scope.region_name,JSON.stringify([scope.dong]),37,127);populate(db);await enrichApartmentMaster(db,{coordinateKey:'k',vworldKey:'v',pause:0,coordinateFetcher:async()=>[{latitude:37.005,longitude:127.005,entX:950000,entY:1950000}],parcelFetcher:async()=>polygon});db.prepare("UPDATE apartment_inventory_runs SET status='complete'").run();db.prepare("UPDATE apartment_inventory_regions SET status='scanned' WHERE region_id=?").run(scope.region_id);db.prepare("UPDATE apartment_parcels SET attributes_json=?,spatial_status='complete'").run(JSON.stringify({jiga:'50000'}));db.prepare('INSERT INTO apartment_region_boundaries VALUES(?,?,?,?,?,?)').run(scope.region_id,scope.legal_code,JSON.stringify(polygon),JSON.stringify({emd_cd:'41117102'}),'V-World','today');db.prepare('INSERT INTO apartment_district_boundaries VALUES(?,?,?,?,?)').run(scope.region_code,JSON.stringify(polygon),JSON.stringify({sig_cd:scope.region_code}),'V-World','today');db.close();const result=exportApartmentMap({source,target,favorites,secretsFile});assert.equal(result.version,2);assert.equal(result.count,1);assert.equal(result.coverage.complete,true);const apartments=JSON.parse(fs.readFileSync(path.join(target,result.apartments.file))),boundaries=JSON.parse(fs.readFileSync(path.join(target,result.boundaries.file)));assert.equal(validateApartmentMap({apartments,boundaries}).apartments[0].master_id,'hub:root');assert.equal(mapCollectedApartments(apartments,{favorite_region_ids:[scope.region_id],regions:[{...scope,dongs:[scope.dong]}],districts:{}}).length,1);assert(!JSON.stringify({apartments,boundaries,result}).includes('privatefixturemasterkey'));const prior=fs.readFileSync(path.join(target,'manifest.json'));const pending=new DatabaseSync(source);pending.prepare("UPDATE apartment_inventory_regions SET status='pending'").run();pending.close();assert.equal(exportApartmentMap({source,target,favorites,secretsFile}),null);assert(prior.equals(fs.readFileSync(path.join(target,'manifest.json'))));
});

test('V-World geometry filters preserve polygon holes and multipart parcel boundaries',()=>{
 assert.equal(geometryWkt(polygon).startsWith('POLYGON(('),true);
 const multi={type:'MultiPolygon',coordinates:[polygon.coordinates,polygon.coordinates]};
 assert.equal(geometryWkt(multi).startsWith('MULTIPOLYGON((('),true);
 assert.equal(VWORLD_LAYERS.buildings,'LT_C_BLDGINFO');
 assert.equal(VWORLD_LAYERS.zoning,'LT_C_UQ111');
});
test('V-World building pages are complete before they are saved and duplicate footprints are deduplicated',async()=>{
 let calls=0;
 const feature={type:'Feature',geometry:polygon,properties:{bld_nm:'테스트동',usability:'02001'}};
 const result=await fetchVworldLayer('local','LT_C_BLDGINFO',polygon,{pause:0,fetcher:async url=>{
  calls++;const page=Number(new URL(url).searchParams.get('page'));
  return new Response(JSON.stringify({response:{status:'OK',record:{total:'1001'},result:{featureCollection:{features:page===1?Array.from({length:1000},()=>feature):[feature]}}}}));
 }});
 assert.equal(calls,2);assert.equal(result.length,1);
});
test('V-World shortens only oversized query geometry after HTTP 414',async()=>{
 const ring=[];for(let i=0;i<209;i++){const angle=2*Math.PI*i/208;ring.push([Number((127+Math.cos(angle)*0.001).toFixed(12)),Number((37+Math.sin(angle)*0.001).toFixed(12))]);}ring[208]=ring[0];
 const large={type:'Polygon',coordinates:[ring]},original=JSON.stringify(large);let calls=0,lengths=[];
 const features=await fetchVworldLayer('local','LT_C_BLDGINFO',large,{pause:0,fetcher:async url=>{calls++;lengths.push(url.href.length);if(calls===1)return new Response('too long',{status:414});return new Response(JSON.stringify({response:{status:'NOT_FOUND',record:{total:'0'},result:{featureCollection:{features:[]}}}}));}});
 assert.equal(calls,2);assert.ok(lengths[1]<lengths[0]);assert.equal(JSON.stringify(large),original);assert.deepEqual(features,[]);
});
test('V-World retries transient connection errors before failing a parcel',async()=>{
 let calls=0;
 const feature={type:'Feature',geometry:polygon,properties:{bld_nm:'테스트'}};
 const result=await fetchVworldLayer('local','LT_C_BLDGINFO',polygon,{pause:0,retryDelay:1,fetcher:async()=>{
  calls++;if(calls<3)throw Object.assign(new Error('temporary'),{code:'ECONNRESET'});
  return new Response(JSON.stringify({response:{status:'OK',record:{total:'1'},result:{featureCollection:{features:[feature]}}}}));
 }});
 assert.equal(calls,3);assert.equal(result.length,1);
});
test('V-World enriches apartment parcels in restartable batches before loading boundaries',async()=>{
 const db=fixture();
 try{
  populate(db);
  db.prepare("UPDATE apartment_inventory_regions SET status='scanned' WHERE region_id=?").run(scope.region_id);
  db.prepare("UPDATE apartment_parcels SET geometry_json=?,boundary_status='exact',attributes_json=?").run(JSON.stringify(polygon),JSON.stringify({pnu:'p',jiga:'50500',gosi_year:'2026',gosi_month:'01'}));
  const building={type:'Feature',geometry:polygon,properties:{bld_nm:'공식단지',dong_nm:'101동',usability:'02001',grnd_flr:'20',archarea:'800',totalarea:'25000',useapr_day:'20000103'}};
  const zoning={type:'Feature',geometry:polygon,properties:{uname:'제2종일반주거지역',dyear:'2020'}};
  let calls=0;
  const fetcher=async url=>{
   calls++;const q=new URL(url).searchParams,layer=q.get('data'),filter=q.get('attrFilter');
   let features=layer===VWORLD_LAYERS.buildings?[building]:layer===VWORLD_LAYERS.zoning?[zoning]:layer===VWORLD_LAYERS.administrativeDistricts?[{type:'Feature',geometry:polygon,properties:{sig_cd:scope.region_code,sig_kor_nm:'영통구'}}]:[{type:'Feature',geometry:polygon,properties:{emd_cd:'41117102',emd_kor_nm:'원천동',full_nm:'수원시 영통구 원천동'}}];
   if(filter?.startsWith('emd_cd')&&features[0].properties.emd_cd!=='41117102')features=[];
   return new Response(JSON.stringify({response:{status:features.length?'OK':'NOT_FOUND',record:{total:String(features.length)},result:{featureCollection:{features}}}}));
  };
  db.prepare('INSERT INTO apartment_entrances VALUES(?,?,?,?,?,?,?,?)').run('b1',0,37.005,127.005,950000,1950000,'test','today');
  const firstBatch=await enrichVworldApartmentData(db,{key:'fixture',pause:0,maxParcels:1,fetcher});
  assert.equal(firstBatch.remaining,1);assert.equal(db.prepare('SELECT count(*) AS n FROM apartment_region_boundaries').get().n,0);assert.equal(calls,2);
  await enrichVworldApartmentData(db,{key:'fixture',pause:0,maxParcels:1,fetcher});
  assert.equal(calls,6);
  assert.equal(db.prepare('SELECT count(*) AS n FROM apartment_building_footprints').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM apartment_zoning_features').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM apartment_region_boundaries').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM apartment_district_boundaries').get().n,1);
  const stats=masterStats(db,[scope.region_id]);
  assert.equal(stats.vworldDataComplete,true);assert.equal(stats.withDistrictBoundary,1);assert.equal(stats.withFootprints,1);assert.equal(stats.withLandPrice,1);assert.equal(stats.withZoning,1);
  const data=masterMapData(db,[scope],[scope.region_id]);
  assert.equal(data.apartments[0].land_price_per_m2,50500);
  assert.deepEqual(data.apartments[0].zoning_names,['제2종일반주거지역']);
  assert.equal(data.boundaries.features.length,3);
  assert.ok(data.boundaries.features.some(feature=>feature.properties.boundary_kind==='building_footprint'));
 }finally{db.close();}
});