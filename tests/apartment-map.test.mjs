import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {osmBoundaryFeatures,matchApartmentBoundaries,mapApartment} from '../server/apartment-boundaries.mjs';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA,connect} from '../server/storage.mjs';
import {exportApartmentMap} from '../server/export-apartment-map.mjs';
import {validateApartmentMap,mapCollectedApartments} from '../src/apartment-map-data.js';
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
