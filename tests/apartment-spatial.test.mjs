import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readApartmentSpatialContext,scopeApartmentSpatialContext} from '../server/apartment-spatial.mjs';

const polygon={type:'Polygon',coordinates:[[[127,37],[127.4,37],[127.4,37.4],[127,37.4],[127,37]]]};
const root='hub:spatial',legal='4113510300',region='dong_41135103';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`
  CREATE TABLE apartment_complexes(apartment_id TEXT PRIMARY KEY,legal_code TEXT,name TEXT,build_year INTEGER,approval_date TEXT,household_count INTEGER,building_count INTEGER,max_floors INTEGER,structure TEXT,source TEXT,fetched_at TEXT,active INTEGER);
  CREATE TABLE apartment_building_inventory(building_id TEXT PRIMARY KEY,region_id TEXT,classification TEXT,record_json TEXT,active INTEGER);
  CREATE TABLE apartment_inventory_regions(region_id TEXT PRIMARY KEY,legal_code TEXT);
  CREATE TABLE apartment_buildings(building_id TEXT PRIMARY KEY,apartment_id TEXT,legal_code TEXT,dong_name TEXT,road_address TEXT,jibun TEXT,households INTEGER,floors_above INTEGER,build_year INTEGER);
  CREATE TABLE apartment_entrances(building_id TEXT,entrance_index INTEGER,latitude REAL,longitude REAL,source TEXT,fetched_at TEXT);
  CREATE TABLE apartment_parcels(apartment_id TEXT,pnu TEXT,legal_code TEXT,jibun TEXT,relation TEXT,geometry_json TEXT,boundary_status TEXT,boundary_source TEXT,fetched_at TEXT,attributes_json TEXT);
  CREATE TABLE apartment_footprint_links(apartment_id TEXT,footprint_id TEXT,pnu TEXT);
  CREATE TABLE apartment_building_footprints(footprint_id TEXT,geometry_json TEXT,properties_json TEXT,source TEXT,fetched_at TEXT);
  CREATE TABLE apartment_zoning_links(apartment_id TEXT,feature_id TEXT,pnu TEXT);
  CREATE TABLE apartment_zoning_features(feature_id TEXT,geometry_json TEXT,properties_json TEXT,source TEXT,fetched_at TEXT);
 `);
 db.prepare('INSERT INTO apartment_complexes VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(root,legal,'공통 단지',2000,'2000-01-01',100,3,25,'철근콘크리트','건축물대장','2026-11-10T00:00:00Z',1);
 db.prepare('INSERT INTO apartment_inventory_regions VALUES(?,?)').run(region,legal);
 const building=(id,classification,{households=50,units=null,rootId=root,legalCode=legal,regionId=region,jibun='1'}={})=>{
  db.prepare('INSERT INTO apartment_buildings VALUES(?,?,?,?,?,?,?,?,?)').run(id,rootId,legalCode,id,'경기도 성남시 분당구 시험로 '+jibun,jibun,households,25,2000);
  db.prepare('INSERT INTO apartment_building_inventory VALUES(?,?,?,?,?)').run(id,regionId,classification,JSON.stringify({title:{hoCnt:units}}),1);
 };
 building('a-guard','other',{households:0});building('z-home','apartment');building('z-home2','apartment',{jibun:'2'});
 db.prepare('INSERT INTO apartment_entrances VALUES(?,?,?,?,?,?)').run('a-guard',0,37.05,127.05,'주소정보누리집','2026-11-09T00:00:00Z');
 db.prepare('INSERT INTO apartment_entrances VALUES(?,?,?,?,?,?)').run('z-home',1,37.2,127.2,'주소정보누리집','2026-11-09T00:00:00Z');
 db.prepare('INSERT INTO apartment_entrances VALUES(?,?,?,?,?,?)').run('z-home',0,37.1,127.1,'주소정보누리집','2026-11-09T00:00:00Z');
 db.prepare('INSERT INTO apartment_parcels VALUES(?,?,?,?,?,?,?,?,?,?)').run(root,'pnu1',legal,'1','primary',JSON.stringify(polygon),'exact','V-World','2026-11-08T00:00:00Z',JSON.stringify({jiga:1000,gosi_year:'2026',gosi_month:'01'}));
 db.prepare('INSERT INTO apartment_parcels VALUES(?,?,?,?,?,?,?,?,?,?)').run(root,'pnu2',legal,'2','attached',null,'pending',null,null,null);
 db.prepare('INSERT INTO apartment_footprint_links VALUES(?,?,?)').run(root,'footprint1','pnu1');
 db.prepare('INSERT INTO apartment_building_footprints VALUES(?,?,?,?,?)').run('footprint1',JSON.stringify(polygon),JSON.stringify({bld_nm:'101동',grnd_flr:25}),'V-World GIS','2026-11-08T00:00:00Z');
 db.prepare('INSERT INTO apartment_zoning_links VALUES(?,?,?)').run(root,'zone1','pnu1');
 db.prepare('INSERT INTO apartment_zoning_features VALUES(?,?,?,?,?)').run('zone1',JSON.stringify(polygon),JSON.stringify({uname:'제3종일반주거지역'}),'V-World 용도지역','2026-11-08T00:00:00Z');
 return {db,building};
}

test('one normalized context selects an observed residential entrance and preserves source areas without copying geometry into summaries',t=>{
 const {db}=fixture(t),context=readApartmentSpatialContext(db).get(root);
 assert.equal(context.residential_status,'residential');assert.equal(context.primary_building_id,'z-home');assert.equal(context.primary_entrance_index,0);
 assert.equal(context.location.latitude,37.1);assert.equal(context.location.anchors.length,3);assert.equal(context.location.source,'주소정보누리집');
 assert.equal(context.area.parcels[0].relation,'primary');assert.equal(context.area.parcels[1].status,'pending');assert.equal(context.area.parcels[1].bbox,null);
 assert.deepEqual(context.area.region_ids,[region]);assert.deepEqual(context.area.bbox,[127,37,127.4,37.4]);assert.equal(context.area.zoning_refs[0].name,'제3종일반주거지역');
 assert.deepEqual(context.area.boundary_ids,context.area.boundary_refs.map(boundary=>boundary.id));
 assert.equal(context.facts.land_price_per_m2,1000);assert.equal(context.facts.household_count,100);assert.equal(context.facts.building_footprint_count,1);
 assert.equal(context.boundaries,undefined);assert(!JSON.stringify(context).includes('coordinates'));
 const full=readApartmentSpatialContext(db,{geometry:'full'}).get(root);
 assert.equal(full.boundaries.features.length,2);assert.deepEqual(full.boundaries.features[0].geometry,polygon);
 assert.deepEqual(full.boundaries.features[0].properties.apartment_ids,[root]);assert.equal(full.boundaries.features[1].properties.building_attributes.grnd_flr,25);
 assert.deepEqual(readApartmentSpatialContext(db),readApartmentSpatialContext(db));
});

test('geometry and zoning hashes detect changed content even when IDs, timestamps and bounding boxes stay equal',t=>{
 const {db}=fixture(t),before=readApartmentSpatialContext(db).get(root);
 const changed={type:'Polygon',coordinates:[[[127,37],[127.4,37],[127.2,37.2],[127.4,37.4],[127,37.4],[127,37]]]};
 db.prepare('UPDATE apartment_parcels SET geometry_json=? WHERE pnu=?').run(JSON.stringify(changed),'pnu1');
 db.prepare('UPDATE apartment_building_footprints SET geometry_json=?').run(JSON.stringify(changed));
 db.prepare('UPDATE apartment_zoning_features SET geometry_json=?').run(JSON.stringify(changed));
 const after=readApartmentSpatialContext(db).get(root);
 assert.deepEqual(before.area.bbox,after.area.bbox);
 assert.notEqual(before.area.boundary_refs[0].sha256,after.area.boundary_refs[0].sha256);
 assert.notEqual(before.area.boundary_refs[1].sha256,after.area.boundary_refs[1].sha256);
 assert.notEqual(before.area.zoning_refs[0].sha256,after.area.zoning_refs[0].sha256);
});

test('an address cohort uses only its own observed entrances and retains root provenance for shared polygons',t=>{
 const {db}=fixture(t),context=readApartmentSpatialContext(db,{geometry:'full'}).get(root);
 const scope={cohort_id:'cohort:hub:spatial:one',building_ids:['z-home'],parcels:['001']};
 const selected=scopeApartmentSpatialContext(context,scope);
 assert.deepEqual(selected.location.anchors.map(anchor=>anchor.building_id),['z-home','z-home']);
 assert.equal(selected.facts.household_count,50);assert.equal(selected.facts.building_count,1);
 assert.equal(selected.area.parcels.length,1);assert.equal(selected.area.parcels[0].pnu,'pnu1');
 assert.deepEqual(selected.area.boundary_ids,selected.area.boundary_refs.map(boundary=>boundary.id));
 assert.deepEqual(selected.area.identity_ref,{kind:'cohort',id:scope.cohort_id});assert.deepEqual(selected.area.geometry_scope,{kind:'root',id:root});
 assert(selected.area.boundary_refs.every(boundary=>boundary.identity_ref.kind==='root'));
 assert(selected.boundaries.features.every(feature=>feature.properties.identity_ref.kind==='root'));
 const unlocated=scopeApartmentSpatialContext(context,{cohort_id:'cohort:hub:spatial:two',building_ids:['z-home2'],parcels:['2']});
 assert.equal(unlocated.location.status,'missing');assert.equal(unlocated.location.latitude,null);assert.equal(unlocated.primary_building_id,null);
 assert.deepEqual(unlocated.area.region_ids,[region]);assert.equal(unlocated.area.parcels[0].pnu,'pnu2');assert.equal(unlocated.area.bbox,null);
 assert.equal(unlocated.facts.land_price_per_m2,null);assert.equal(unlocated.facts.land_price_parcel_pnu,null);
 assert.equal(context.location.latitude,37.1);assert.equal(context.area.parcels.length,2);
});

test('cohort parcel scoping respects legal-region ownership even when different regions use the same parcel number',t=>{
 const {db,building}=fixture(t),secondLegal='4113510400',secondRegion='dong_41135104';
 db.prepare('INSERT INTO apartment_inventory_regions VALUES(?,?)').run(secondRegion,secondLegal);
 building('foreign-road','apartment',{legalCode:secondLegal,regionId:secondRegion,jibun:'1'});
 db.prepare('INSERT INTO apartment_parcels VALUES(?,?,?,?,?,?,?,?,?,?)').run(root,'foreign-pnu',secondLegal,'1','primary',null,'pending',null,null,null);
 const selected=scopeApartmentSpatialContext(readApartmentSpatialContext(db).get(root),{cohort_id:'cohort:hub:spatial:foreign',building_ids:['foreign-road'],parcels:['1']});
 assert.equal(selected.location.status,'missing');assert.equal(selected.area.legal_code,secondLegal);assert.deepEqual(selected.area.region_ids,[secondRegion]);
 assert.deepEqual(selected.area.parcels.map(parcel=>parcel.pnu),['foreign-pnu']);
});

test('ancillary and unknown roots remain explicit while zero households and senior housing units are preserved',t=>{
 const {db,building}=fixture(t);
 const insert=db.prepare('INSERT INTO apartment_complexes(apartment_id,legal_code,name,household_count,active) VALUES(?,?,?,?,?)');
 for(const [id,name]of [['hub:guard','시설'],['hub:unknown','미확정'],['hub:zero','세대 미기재'],['hub:senior','노인복지주택']])insert.run(id,legal,name,0,id==='hub:guard'?0:1);
 building('guard','other',{rootId:'hub:guard',households:0});building('zero','apartment',{rootId:'hub:zero',households:0});
 building('senior1','senior_housing',{rootId:'hub:senior',households:0,units:20});building('senior2','senior_housing',{rootId:'hub:senior',households:0,units:30});
 const contexts=readApartmentSpatialContext(db);
 assert.equal(contexts.get('hub:guard').residential_status,'ancillary_only');assert.equal(contexts.get('hub:unknown').residential_status,'unresolved');
 assert.equal(contexts.get('hub:zero').residential_status,'residential');assert.equal(contexts.get('hub:senior').facts.housing_type,'senior_housing');
 assert.equal(contexts.get('hub:senior').facts.dwelling_unit_count,50);assert.equal(contexts.get('hub:senior').facts.household_count,0);
 db.prepare('UPDATE apartment_building_inventory SET record_json=? WHERE building_id=?').run('{}','senior2');
 assert.equal(readApartmentSpatialContext(db).get('hub:senior').facts.dwelling_unit_count,null);
});

test('minimal identity databases keep unknown positions instead of inventing geometry centers or default coordinates',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE apartment_complexes(apartment_id TEXT,legal_code TEXT,name TEXT)');
 db.prepare('INSERT INTO apartment_complexes VALUES(?,?,?)').run(root,legal,'주소만 확인');
 const context=readApartmentSpatialContext(db).get(root);
 assert.equal(context.residential_status,'unresolved');assert.equal(context.location.latitude,null);assert.equal(context.location.precision,'unknown');assert.equal(context.area.bbox,null);
 assert.deepEqual(context.area.parcels,[]);assert.deepEqual(context.area.boundary_refs,[]);
});

test('broken spatial references and invalid observed coordinates fail at the common information boundary',t=>{
 const {db}=fixture(t);
 db.prepare('DELETE FROM apartment_building_footprints').run();assert.throws(()=>readApartmentSpatialContext(db),/외곽선 참조/);
 db.prepare('DELETE FROM apartment_footprint_links').run();db.prepare('UPDATE apartment_entrances SET latitude=0 WHERE building_id=?').run('z-home');
 assert.throws(()=>readApartmentSpatialContext(db),/출입구 좌표/);
});

test('a claimed exact parcel cannot publish an open or out-of-region polygon',t=>{
 const {db}=fixture(t);
 const open={type:'Polygon',coordinates:[[[127,37],[127.4,37],[127.4,37.4],[127,37.4]]]};
 db.prepare('UPDATE apartment_parcels SET geometry_json=? WHERE pnu=?').run(JSON.stringify(open),'pnu1');
 assert.throws(()=>readApartmentSpatialContext(db),/닫힌 경계/);
 const elsewhere={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]};
 db.prepare('UPDATE apartment_parcels SET geometry_json=? WHERE pnu=?').run(JSON.stringify(elsewhere),'pnu1');
 assert.throws(()=>readApartmentSpatialContext(db),/닫힌 경계/);
});
