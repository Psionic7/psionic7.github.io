import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {osmBoundaryFeatures,matchApartmentBoundaries,mapApartment} from '../server/apartment-boundaries.mjs';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA,connect} from '../server/storage.mjs';
import {exportApartmentMap} from '../server/export-apartment-map.mjs';
import {validateApartmentMap,mapCollectedApartments,mapVisibleApartments,loadApartmentMap} from '../src/apartment-map-data.js';
import {makeApartmentFavorite,sameApartmentFavorite,mapApartmentFavorite} from '../src/apartment-favorites.js';
const ring=[[127,37],[127.002,37],[127.002,37.002],[127,37.002],[127,37]];
const feature=(id='way/1',name='테스트아파트',coordinates=[ring])=>({type:'Feature',id,properties:{name,osm_id:id,residential:'apartments'},geometry:{type:'Polygon',coordinates}});
const point=(name='테스트',longitude=127.001,latitude=37.001)=>mapApartment({region_code:'41117',dong:'영통동',jibun:'1',apartment:name,road_address:'테스트 주소',longitude,latitude},'경기도 수원시 영통구',2000);
test('matches true polygons with holes and only a matching name allows a nearby entrance',()=>{
  const apartment=point(),other={...point('다른 아파트'),id:'other'};
  assert.equal(matchApartmentBoundaries([apartment],[feature()]).matchedApartments,1);
  const hole=[[127.0005,37.0005],[127.0015,37.0005],[127.0015,37.0015],[127.0005,37.0015],[127.0005,37.0005]];
  assert.equal(matchApartmentBoundaries([other],[feature('way/1','',[ring,hole])]).matchedApartments,0);
  const nearby=point('테스트',127.0021,37.001),far=point('테스트',127.004,37.001);
  assert.equal(matchApartmentBoundaries([nearby],[feature()]).matchedApartments,1);
  assert.equal(matchApartmentBoundaries([far],[feature()]).matchedApartments,0);
  assert.equal(matchApartmentBoundaries([nearby],[feature('way/1','다른단지')]).matchedApartments,0);
});
test('ambiguous overlapping boundaries are withheld and one complex may link several apartment identities',()=>{
  assert.equal(matchApartmentBoundaries([point()],[feature(),feature('way/2')]).features.length,0);
  const two=matchApartmentBoundaries([point(),point('테스트2')],[feature()]);assert.equal(two.features.length,1);assert.equal(two.features[0].properties.apartment_ids.length,2);assert.equal(two.matchedApartments,2);
});
test('OSM geometry conversion never publishes unrelated POIs or tainted outlines',()=>{
  const geometry=ring.map(([lon,lat])=>({lon,lat})),payload={version:.6,elements:[{type:'way',id:1,tags:{landuse:'residential',name:'테스트'},nodes:[1,2,3,4,1],geometry},{type:'node',id:5,lat:37,lon:127,tags:{name:'외부 시설'}}]};
  const result=osmBoundaryFeatures(payload);assert.equal(result.length,1);assert.equal(result[0].geometry.type,'Polygon');assert.throws(()=>osmBoundaryFeatures({remark:'timeout',elements:[]}));
});
test('map data rejects unrelated apartment links, invalid coordinates and non-closed boundaries',()=>{
  const apartments=[point()],boundaries=matchApartmentBoundaries(apartments,[feature()]);assert.equal(validateApartmentMap({apartments,boundaries}).apartments.length,1);
  assert.throws(()=>validateApartmentMap({apartments:[{...point(),latitude:0}],boundaries}));
  const wrong=structuredClone(boundaries);wrong.features[0].properties.apartment_ids=['unrelated'];assert.throws(()=>validateApartmentMap({apartments,boundaries:wrong}));
  const open=structuredClone(boundaries);open.features[0].geometry.coordinates[0].pop();assert.throws(()=>validateApartmentMap({apartments,boundaries:open}));
});
test('current saved collection regions limit displayed apartments independently of an older map snapshot',()=>{
  const apartments=[point(),{...point(),id:'other',dong:'미수집동'}],manifest={favorite_region_ids:['dong_41117102'],regions:[{region_id:'dong_41117102',region_code:'41117',dongs:['영통동']}],districts:{'41117':{}}};
  assert.equal(mapCollectedApartments(apartments,manifest).length,1);assert.equal(mapCollectedApartments(apartments,{...manifest,favorite_region_ids:[]}).length,0);
});
test('map exporter scopes the data, excludes private coordinate history and preserves bootstrap when cloud has no coordinates',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'home-map-export-'));t.after(()=>{const resolved=path.resolve(root);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('home-map-export-'));fs.rmSync(resolved,{recursive:true,force:true});});
 const source=path.join(root,'work.sqlite3'),target=path.join(root,'map'),favorites=path.join(root,'favorites.json'),secretsFile=path.join(root,'.env');fs.writeFileSync(favorites,JSON.stringify({version:1,regions:[{region_id:'dong_41117102'}]}));fs.writeFileSync(secretsFile,'JUSO_COORDINATE_SEARCH_KEY=privatefixturekey12345');
 const db=connect(source);db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA);db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run('dong_41117102','지역','41117','경기도 수원시 영통구','["영통동"]',37,127);
 for(const dong of ['영통동','미수집동']){db.prepare('INSERT INTO trades(region_code,deal_month,deal_date,apartment,dong,jibun,price_man,area_m2,build_year,cancelled,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('41117','202601','2026-01-01','테스트',dong,'1',10000,84,2000,0,'{}');db.prepare('INSERT INTO road_addresses VALUES(?,?,?,?)').run('41117',dong,'1','주소');db.prepare('INSERT INTO address_lookups VALUES(?,?,?,?,?,?,?,?)').run('41117',dong,'1','query','exact','주소','{}','version');db.prepare('INSERT INTO parcel_coordinates VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('41117',dong,'1','주소','version','privatefixturekey12345','',37.001,127.001,1e6,2e6,'juso','EPSG:5179','today');}
 db.close();const result=exportApartmentMap({source,target,favorites,secretsFile});assert.equal(result.count,1);const bytes=fs.readFileSync(path.join(target,result.apartments.file),'utf8');assert(!bytes.includes('privatefixturekey'));assert(!bytes.includes('address_signature'));assert.equal(JSON.parse(bytes)[0].build_year,2000);
 const before=fs.readFileSync(path.join(target,'manifest.json'));fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({...result,version:2,data_mode:'registry_master'}));const registryManifest=fs.readFileSync(path.join(target,'manifest.json'));assert.equal(exportApartmentMap({source,target,favorites,secretsFile}),null);assert(fs.readFileSync(path.join(target,'manifest.json')).equals(registryManifest));fs.writeFileSync(path.join(target,'manifest.json'),before);const empty=connect(source);empty.exec('DELETE FROM parcel_coordinates');empty.close();assert.equal(exportApartmentMap({source,target,favorites,secretsFile}),null);assert(fs.readFileSync(path.join(target,'manifest.json')).equals(before));
});

test('declared cohort membership keeps migrated favorites visible without weakening scope equality',()=>{
 const rootRef={kind:'root',id:'hub:favorite-map'},cohortRef={kind:'cohort',id:'cohort:hub:favorite-map:one'},secondRef={kind:'cohort',id:'cohort:hub:favorite-map:two'};
 const original=point(),root={...makeApartmentFavorite({...original,master_id:rootRef.id,identity_ref:rootRef},original),latitude:original.latitude,longitude:original.longitude,map_member_refs:[cohortRef,secondRef]};
 const favorite=makeApartmentFavorite({...original,master_id:rootRef.id,identity_ref:cohortRef},original),second=makeApartmentFavorite({...original,master_id:rootRef.id,identity_ref:secondRef},original);
 assert.equal(sameApartmentFavorite(root,favorite),false);
 assert.deepEqual(mapVisibleApartments([root],{favoriteOnly:true},[favorite]),[root]);
 assert.equal(mapApartmentFavorite(root,[favorite]),favorite);
 assert.equal(mapApartmentFavorite(root,[favorite,second]),null);
 assert.equal(mapApartmentFavorite(root,[favorite,root]),root);
 assert.deepEqual(mapVisibleApartments([{...root,map_member_refs:[]}],{favoriteOnly:true},[favorite]),[]);
});

test('common ancillary, inactive and unresolved map-ineligible entries do not enter the collected map list',()=>{
 const original=point(),manifest={regions:[{region_code:original.region_code,dongs:[original.dong]}],districts:{[original.region_code]:{}}};
 assert.deepEqual(mapCollectedApartments([original,{...original,id:'inactive',active:false},{...original,id:'ancillary',residential_status:'ancillary_only'},{...original,id:'unresolved',map_visible:false,residential_status:'unresolved'}],manifest),[original]);
});

test('map loader rejects a stale common generation before reading apartment rows',async t=>{
 const previous=globalThis.fetch,requested=[],expected='a'.repeat(64);
 t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async url=>{requested.push(url);return {ok:true,json:async()=>({apartments:{file:'apartments-111111111111.json'},boundaries:{file:'boundaries-222222222222.geojson'},apartment_information_generation:'b'.repeat(64)})};};
 await assert.rejects(loadApartmentMap(expected),/버전/);
 assert.deepEqual(requested,['/apartment-map/manifest.json?v='+expected]);
});

test('map boundary retry rejects a mismatched common generation and accepts the matching one',async t=>{
 const previous=globalThis.fetch,generation='c'.repeat(64),sha='d'.repeat(64);let stale=true;
 t.after(()=>{globalThis.fetch=previous;});
 const apartments=[point()],apartmentHash=createHash('sha256').update(JSON.stringify(apartments)).digest('hex');
 const manifest={apartments:{file:`apartments-${apartmentHash.slice(0,12)}.json`,sha256:apartmentHash},boundaries:{file:`boundaries-${sha.slice(0,12)}.geojson`,sha256:sha},apartment_information_generation:generation};
 globalThis.fetch=async url=>({ok:true,json:async()=>url.startsWith('/apartment-map/manifest.json')?manifest:url==='/apartment-map/'+manifest.apartments.file?[point()]:{version:1,source_sha256:sha,apartment_information_generation:stale?'e'.repeat(64):generation,tiles:[]}});
 const data=await loadApartmentMap(generation);
 await assert.rejects(data.loadBoundaries([126,36,128,38]),/갱신 중/);
 stale=false;assert.deepEqual(await data.loadBoundaries([126,36,128,38]),{type:'FeatureCollection',features:[]});
});

test('current map generations verify apartment bytes and each loaded boundary tile',async t=>{
 const previous=globalThis.fetch,generation='f'.repeat(64),sha='1'.repeat(64),apartments=[point('무결성지도')],apartmentBody=JSON.stringify(apartments),apartmentHash=createHash('sha256').update(apartmentBody).digest('hex');
 const geometry={type:'FeatureCollection',features:[{...feature('checked-feature','무결성지도'),properties:{apartment_ids:[apartments[0].id]},bbox:[127,37,127.002,37.002]}]},tileBody=JSON.stringify(geometry),tileHash=createHash('sha256').update(tileBody).digest('hex');
 const manifest={apartments:{file:`apartments-${apartmentHash.slice(0,12)}.json`,sha256:apartmentHash},boundaries:{file:`boundaries-${sha.slice(0,12)}.geojson`,sha256:sha},apartment_information_generation:generation};
 const tile={file:`tile-1_1-${tileHash.slice(0,12)}.json`,sha256:tileHash,bytes:Buffer.byteLength(tileBody),bbox:[127,37,127.002,37.002]};let corruptApartment=true,corruptTile=true;
 t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async url=>{
  const value=url.startsWith('/apartment-map/manifest.json')?manifest:url==='/apartment-map/'+manifest.apartments.file?(corruptApartment?[]:apartments):url.startsWith('/map-data/manifest.json')?{version:1,source_sha256:sha,apartment_information_generation:generation,tiles:[tile]}:corruptTile?{type:'FeatureCollection',features:[]}:geometry;
  return {ok:true,text:async()=>JSON.stringify(value)};
 };
 await assert.rejects(loadApartmentMap(generation),/체크섬/);corruptApartment=false;
 const data=await loadApartmentMap(generation);await assert.rejects(data.loadBoundaries([126,36,128,38]),/체크섬|크기/);
 corruptTile=false;assert.equal((await data.loadBoundaries([126,36,128,38])).features.length,1);
});
