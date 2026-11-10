import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA} from '../server/storage.mjs';
import {APARTMENT_MASTER_SCHEMA} from '../server/apartment-master-schema.mjs';
import * as identities from '../server/apartment-identity.mjs';
import {makeApartmentFavorite,refreshApartmentFavorites} from '../src/apartment-favorites.js';

const region={region_id:'dong_11110101',region_code:'11110',region_name:'서울특별시 종로구',legal_code:'1111010100',dong:'시험동',dongs:['시험동']};
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA+APARTMENT_MASTER_SCHEMA);
 db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run(region.region_id,'시험동',region.region_code,region.region_name,JSON.stringify(region.dongs),null,null);
 db.prepare('INSERT INTO apartment_inventory_regions(region_id,legal_code,dong,status,source_counts_json) VALUES(?,?,?,?,?)').run(region.region_id,region.legal_code,region.dong,'scanned','{}');
 db.prepare('INSERT INTO apartment_complexes(apartment_id,registry_root_id,region_code,legal_code,dong,name,jibun,road_address,build_year,fetched_at,inventory_run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('hub:spatial','spatial',region.region_code,region.legal_code,region.dong,'공통 단지','1','서울특별시 종로구 시험로 1',2000,'2026-11-10T00:00:00Z',1);
 const title={mgmBldrgstPk:'building1',sigunguCd:'11110',bjdongCd:'10100',platGbCd:'0',bun:'0001',ji:'0000',bldNm:'공통 단지',dongNm:'101동',mainAtchGbCd:'0',mainPurpsCd:'02001',mainPurpsCdNm:'아파트',etcPurps:'아파트',hhldCnt:'50',hoCnt:'0',useAprDay:'20000101',newPlatPlc:'서울특별시 종로구 시험로 1',naRoadCd:'111103012345',naUgrndCd:'0',naMainBun:'1',naSubBun:'0'};
 const record={building_id:'building1',root_id:'spatial',legal_code:region.legal_code,scope:region,title};
 db.prepare('INSERT INTO apartment_building_inventory VALUES(?,?,?,?,?,?,?,?)').run('building1',region.region_id,region.legal_code,'spatial','apartment',JSON.stringify(record),1,1);
 db.prepare('INSERT INTO apartment_buildings(building_id,apartment_id,legal_code,name,dong_name,jibun,road_address,households) VALUES(?,?,?,?,?,?,?,?)').run('building1','hub:spatial',region.legal_code,'공통 단지','101동','1',title.newPlatPlc,50);
 db.prepare('INSERT INTO apartment_entrances VALUES(?,?,?,?,?,?,?,?)').run('building1',0,37.5,126.9,0,0,'주소정보누리집 좌표 API','2026-11-10T00:00:00Z');
 const polygon={type:'Polygon',coordinates:[[[126.89,37.49],[126.91,37.49],[126.91,37.51],[126.89,37.49]]]};
 db.prepare('INSERT INTO apartment_parcels(apartment_id,pnu,legal_code,jibun,relation,geometry_json,boundary_status,boundary_source,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)').run('hub:spatial','1111010100100010000',region.legal_code,'1','primary',JSON.stringify(polygon),'exact','V-World','2026-11-10T00:00:00Z');
 return db;
}

test('one common apartment read supplies verified position, area, residential status and stable root identity',t=>{
 const db=fixture(t);identities.synchronizeApartmentIdentity(db,{overrides:[]});
 const info=identities.apartmentInformation(db)[0];
 assert.equal(info.residential_status,'residential');assert.equal(info.location.latitude,37.5);assert.equal(info.location.longitude,126.9);
 assert.equal(info.location.building_id,'building1');assert.equal(info.area.parcels[0].relation,'primary');
 assert.equal(info.primary_building_id,'building1');assert(!JSON.stringify(info.area).includes('coordinates'));
 const catalog=identities.publicApartmentInformation(db),root=catalog.apartments.find(item=>item.id==='hub:spatial');
 assert.deepEqual(root.identity_ref,{kind:'root',id:'hub:spatial'});
 const saved=makeApartmentFavorite(root,root),refreshed=refreshApartmentFavorites([saved],catalog.apartments)[0];
 assert.equal(refreshed.id,root.id);assert(!('location' in refreshed));assert(!('area' in refreshed));
});

test('the common view and API expose exact root and address scopes without changing map references',t=>{
 const db=fixture(t);identities.synchronizeHousingIdentity(db,{scopes:[region],overrides:[]});
 const rows=db.prepare('SELECT selection_id,scope_kind FROM apartment_information ORDER BY selection_id').all();
 assert(rows.some(row=>row.scope_kind==='root'));assert(rows.some(row=>row.scope_kind==='cohort'));
 const all=identities.apartmentInformation(db,{kind:'all'});assert(all.some(item=>item.scope_kind==='cohort'));
 const full=identities.apartmentInformation(db,{kind:'all',geometry:'full'});
 assert(full.filter(item=>item.scope_kind==='cohort').every(item=>item.boundaries.features.length===1));
 assert(all.every(item=>!('boundaries' in item)));
 const catalog=identities.publicApartmentInformation(db),map=identities.apartmentMapInformation(db,{scopeIds:[region.region_id],generation:catalog.generation});
 assert.equal(map.apartments.length,1);assert.deepEqual(map.apartments[0].identity_ref,{kind:'root',id:'hub:spatial'});
 assert.equal(map.boundaries.features.length,1);assert.equal(map.apartments[0].location.latitude,37.5);
 assert.throws(()=>identities.apartmentMapInformation(db,{scopeIds:[region.region_id],generation:'stale'}),/버전|세대/);
});

test('common spatial generation changes for geometry changes even when bbox and trade coverage stay equal',t=>{
 const db=fixture(t);identities.synchronizeHousingIdentity(db,{scopes:[region],overrides:[]});
 const before=identities.publicApartmentInformation(db).generation;
 const parcel=db.prepare('SELECT geometry_json FROM apartment_parcels').get(),geometry=JSON.parse(parcel.geometry_json);
 geometry.coordinates[0].splice(1,0,[126.9,37.495]);
 db.prepare('UPDATE apartment_parcels SET geometry_json=?').run(JSON.stringify(geometry));
 identities.synchronizeHousingIdentity(db,{scopes:[region],overrides:[]});
 const after=identities.publicApartmentInformation(db).generation;assert.notEqual(after,before);
 identities.synchronizeHousingIdentity(db,{scopes:[region],overrides:[],now:'2026-11-11T00:00:00Z'});
 assert.equal(identities.publicApartmentInformation(db).generation,after);
});
test('local master rebuild times do not invalidate a generation with unchanged source observations',t=>{
 const db=fixture(t);
 db.prepare('UPDATE apartment_inventory_regions SET fetched_at=?').run('2026-11-01T00:00:00Z');
 identities.synchronizeHousingIdentity(db,{scopes:[region],overrides:[]});
 const before=identities.publicApartmentInformation(db).generation;
 db.prepare('UPDATE apartment_complexes SET fetched_at=?').run('2026-11-12T00:00:00Z');
 identities.synchronizeHousingIdentity(db,{scopes:[region],overrides:[]});
 assert.equal(identities.publicApartmentInformation(db).generation,before);
 db.prepare('UPDATE apartment_inventory_regions SET fetched_at=?').run('2026-11-13T00:00:00Z');
 identities.synchronizeHousingIdentity(db,{scopes:[region],overrides:[]});
 assert.notEqual(identities.publicApartmentInformation(db).generation,before);
});
