import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA} from '../server/storage.mjs';
import {APARTMENT_MASTER_SCHEMA} from '../server/apartment-master-schema.mjs';
import {apartmentInformation,synchronizeApartmentIdentity,searchApartmentInformation,resolveApartmentIdentity,publicApartmentInformation} from '../server/apartment-identity.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {listingSnapshot} from '../src/naver-listings.mjs';
import {identityForApartment,validateApartmentInformation,validateIdentitySearch} from '../src/apartment-identity.mjs';
import {buildSearchIndex} from '../src/search-index.mjs';
import {dailyListingTargets} from '../server/daily-naver-listings.mjs';
import {NAVER_LISTING_SCHEMA} from '../server/naver-listing-schema.mjs';

function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA+APARTMENT_MASTER_SCHEMA);
  db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run('dong_41465101','풍덕천동','41465','경기도 용인시 수지구','["풍덕천동"]',null,null);
  db.prepare('INSERT INTO apartment_inventory_regions(region_id,legal_code,dong,status) VALUES(?,?,?,?)').run('dong_41465101','4146510100','풍덕천동','scanned');
  const save=db.prepare('INSERT INTO apartment_complexes(apartment_id,registry_root_id,region_code,legal_code,dong,name,jibun,road_address,fetched_at,inventory_run_id) VALUES(?,?,?,?,?,?,?,?,?,?)');
  save.run('hub:samsung','samsung','41465','4146510100','풍덕천동','삼성아파트','693','경기도 용인시 수지구 수풍로 13','2026-11-07T00:00:00.000Z',1);
  save.run('hub:other','other','41465','4146510100','풍덕천동','삼성아파트','694','경기도 용인시 수지구 수풍로 15','2026-11-07T00:00:00.000Z',1);
  db.prepare('INSERT INTO apartment_trade_links VALUES(?,?,?,?,?,?,?,?,?)').run('41465','풍덕천동','693','삼성1','hub:samsung','matched','address','[]','2026-11-07T00:00:00.000Z');
  const address=(number,extra={})=>({roadAddr:`경기도 용인시 수지구 수풍로 ${number} (풍덕천동)`,jibunAddr:'경기도 용인시 수지구 풍덕천동 693 삼성래미안1차아파트',zipNo:'16818',bdNm:'삼성래미안1차아파트',bdMgtSn:'building'+number,rnMgtSn:'road',...extra});
  const payload={results:{common:{errorCode:'0'},juso:[address(9),address(13),address(99,{jibunAddr:'경기도 용인시 수지구 풍덕천동 693-1 이웃아파트',bdNm:'이웃아파트',zipNo:'99999'})]}};
  db.prepare('INSERT INTO address_lookups VALUES(?,?,?,?,?,?,?,?)').run('41465','풍덕천동','693','경기도 용인시 수지구 풍덕천동 693','ambiguous','',JSON.stringify(payload),'2026-11-07T00:00:00.000Z');
  const favorite=makeApartmentFavorite({apartment:'삼성아파트',dong:'풍덕천동',jibun:'693',master_id:'hub:samsung',trade_keys:[JSON.stringify(['풍덕천동','693','삼성1'])]},{region_code:'41465',region_name:'경기도 용인시 수지구'});
  const group={favorite,complexNo:'2219',complexName:'삼성1차',status:'ready',errorCode:null,attemptedAt:'2026-11-07T01:00:00.000Z',collectedAt:'2026-11-07T01:00:00.000Z',articles:[]};
  const options={snapshot:listingSnapshot([group]),overrides:[{apartment_id:'hub:samsung',region_code:'41465',dong:'풍덕천동',jibun:'693',canonical_name:'수지삼성래미안1차아파트',names:['수지삼성래미안1차'],source:'사용자 주소 확인'}],now:'2026-11-07T02:00:00.000Z'};
  return {db,options,group};
}

test('registry, verified trade, official address and Naver names share one identity with both roads and a verified postcode',t=>{
  const {db,options}=fixture(t);const stats=synchronizeApartmentIdentity(db,options);
  assert.deepEqual(stats,{apartments:2,withPostalCode:1});
  const row=apartmentInformation(db).find(row=>row.apartment_id==='hub:samsung');
  assert.equal(row.canonical_name,'수지삼성래미안1차아파트');assert.equal(row.postal_code,'16818');assert.equal(row.naver_complex_no,'2219');assert.equal(row.addresses.length,2);
  for(const name of ['삼성아파트','삼성1','삼성1차','삼성래미안1차아파트','수지삼성래미안1차'])assert(row.name_aliases.includes(name));
  assert(!row.name_aliases.includes('이웃아파트'));assert.equal(apartmentInformation(db).find(row=>row.apartment_id==='hub:other').postal_code,null);
  assert(searchApartmentInformation(db,'삼성래미안1차').some(row=>row.apartment_id==='hub:samsung'));
  assert.equal(searchApartmentInformation(db,'16818').length,1);assert.equal(searchApartmentInformation(db,'수풍로 9').length,1);
});

test('linking needs a verified ID or address and names; names and postcodes alone never merge apartments',t=>{
  const {db,options}=fixture(t);synchronizeApartmentIdentity(db,options);
  assert.equal(resolveApartmentIdentity(db,{apartment:'삼성아파트',postal_code:'16818'}).status,'insufficient');
  assert.equal(resolveApartmentIdentity(db,{region_code:'41465',dong:'풍덕천동',jibun:'693',apartment:'삼성1차'}).apartment_id,'hub:samsung');
  assert.equal(resolveApartmentIdentity(db,{road_address:'경기도 용인시 수지구 수풍로 9',apartment:'삼성래미안1차아파트'}).apartment_id,'hub:samsung');
  assert.equal(resolveApartmentIdentity(db,{region_code:'41465',dong:'풍덕천동',jibun:'694',apartment:'삼성1차'}).status,'unmatched');
  assert.equal(resolveApartmentIdentity(db,{master_id:'hub:samsung',jibun:'694'}).status,'unmatched');
  assert.equal(resolveApartmentIdentity(db,{region_code:'41465',dong:'풍덕천동',jibun:'693',apartment:'다른아파트'}).status,'unmatched');
});

test('refresh is idempotent and legacy trade keys do not grant a raw selection its parent identity',t=>{
  const {db,options}=fixture(t);synchronizeApartmentIdentity(db,options);const before=apartmentInformation(db);
  synchronizeApartmentIdentity(db,{...options,now:'2026-11-08T00:00:00.000Z'});assert.deepEqual(apartmentInformation(db),before);
  const catalog=validateApartmentInformation(publicApartmentInformation(db));
  const legacy=makeApartmentFavorite({apartment:'삼성1',dong:'풍덕천동',jibun:'693'},{region_code:'41465',region_name:'경기도 용인시 수지구'});
  assert.equal(identityForApartment(catalog.apartments,legacy),null);
  const sourceId=JSON.stringify(['41465','풍덕천동','693','삼성1']);
  const routed={...catalog.apartments.find(item=>item.id==='hub:samsung'),identity_ref:{kind:'root',id:'hub:samsung'},identity_default_sources:[sourceId]};
  assert.equal(identityForApartment([routed],legacy).id,'hub:samsung');
  assert.equal(identityForApartment([routed,{...routed,id:'hub:other'}],legacy),null);
  const target=dailyListingTargets(db,{region_ids:['dong_41465101']}).find(t=>t.favorite.id==='hub:samsung');
  assert.equal(target.complexNo,'2219');assert.equal(target.query,'풍덕천동 삼성1차');assert(target.favorite.name_aliases.includes('삼성래미안1차아파트'));
});

test('wrong-address overrides roll back and foreign parcel observations cannot add Naver names',t=>{
  const {db,options,group}=fixture(t);
  assert.throws(()=>synchronizeApartmentIdentity(db,{...options,overrides:[{...options.overrides[0],jibun:'694'}]}),/주소/);
  assert.equal(apartmentInformation(db).length,0);assert.equal(db.prepare('SELECT count(*) n FROM apartment_aliases').get().n,0);
  const favorite={...group.favorite,jibun:'694',key:JSON.stringify(['풍덕천동','694','삼성아파트'])};
  synchronizeApartmentIdentity(db,{...options,snapshot:listingSnapshot([{...group,favorite,complexName:'오연결'}])});
  assert(!apartmentInformation(db).find(row=>row.apartment_id==='hub:samsung').name_aliases.includes('오연결'));
});

test('inconsistent postal evidence stays unknown and inactive apartments do not appear in search',t=>{
  const {db,options}=fixture(t);
  db.prepare("UPDATE apartment_complexes SET road_address='' WHERE apartment_id='hub:samsung'").run();
  const record=db.prepare('SELECT response_json FROM address_lookups').get();const payload=JSON.parse(record.response_json);
  payload.results.juso[1].zipNo='16819';
  db.prepare('UPDATE address_lookups SET response_json=?').run(JSON.stringify(payload));
  db.prepare("UPDATE apartment_complexes SET active=0 WHERE apartment_id='hub:other'").run();
  synchronizeApartmentIdentity(db,options);
  assert.equal(apartmentInformation(db)[0].postal_code,null);
  assert.equal(searchApartmentInformation(db,'삼성아파트').length,1);
  assert.equal(apartmentInformation(db,{activeOnly:false}).length,2);
});

test('the publication gate rejects a search index that loses the canonical table aliases or postcode',t=>{
  const {db,options}=fixture(t);synchronizeApartmentIdentity(db,options);
  const catalog=publicApartmentInformation(db);
  const search=buildSearchIndex(new Map([['41465',[{apartment:'삼성1',dong:'풍덕천동',jibun:'693',deal_date:'2026-06-20'}]]]),[{region_code:'41465',region_name:'경기도 용인시 수지구'}],catalog.apartments);
  assert.equal(validateIdentitySearch(search,catalog).length,1);
  assert.throws(()=>validateIdentitySearch(search.map(item=>({...item,name_aliases:['삼성1']})),catalog),/검색 목록/);
  assert.throws(()=>validateIdentitySearch(search.map(item=>({...item,postal_code:'99999'})),catalog),/검색 목록/);
});

test('a newer rejected recollection cannot be replaced by an older published successful connection',t=>{
 const {db,options,group}=fixture(t);db.exec(NAVER_LISTING_SCHEMA);synchronizeApartmentIdentity(db,options);
 db.prepare("UPDATE apartment_identity SET naver_complex_no=NULL,naver_name=NULL WHERE apartment_id='hub:samsung'").run();
 const rejected={...group,status:'failed',errorCode:'address_mismatch',attemptedAt:'2026-11-08T00:00:00.000Z'};
 db.prepare('INSERT INTO naver_listing_snapshots VALUES(?,?,?)').run(group.favorite.id,group.collectedAt,JSON.stringify(rejected));
 synchronizeApartmentIdentity(db,{...options,now:'2026-11-08T01:00:00.000Z'});
 assert.equal(apartmentInformation(db).find(row=>row.apartment_id===group.favorite.id).naver_complex_no,null);
});
