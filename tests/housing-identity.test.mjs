import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA} from '../server/storage.mjs';
import {APARTMENT_MASTER_SCHEMA} from '../server/apartment-master-schema.mjs';
import {rebuildHousingIdentity,housingIdentityCatalog,housingTradeBindings,housingIdentityStats} from '../server/housing-identity.mjs';

function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA+APARTMENT_MASTER_SCHEMA);
 db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run('dong_test','시험동','41465','경기도 용인시 수지구','["시험동"]',37.3,127.1);
 t.after(()=>db.close());return db;
}
function building(db,{id,root=id,name='시험마을',dong='101',lot='1',road='경기도 용인시 수지구 시험로 1',year=1993,classification='apartment',use='아파트',master=true,codes=true}){
 const title={mgmBldrgstPk:id,sigunguCd:'41465',bjdongCd:'10100',platGbCd:'0',bun:lot?lot.split('-')[0].padStart(4,'0'):'0000',ji:(lot?.split('-')[1]||'0').padStart(4,'0'),bldNm:name,dongNm:dong,mainAtchGbCd:'0',mainPurpsCdNm:classification==='apartment'?'공동주택':'업무시설',etcPurps:use,newPlatPlc:road,useAprDay:year+'0101',...(codes?{naRoadCd:'414653012345',naUgrndCd:'0',naMainBun:road.match(/(\d+)$/)?.[1]||'1',naSubBun:'0'}:{})};
 const rootId='hub:'+root;
 if(master){db.prepare('INSERT OR IGNORE INTO apartment_complexes(apartment_id,registry_root_id,region_code,legal_code,dong,name,jibun,road_address,active,fetched_at,inventory_run_id) VALUES(?,?,?,?,?,?,?,?,1,?,1)').run(rootId,root,'41465','4146510100','시험동',name,lot||'',road,'2026-11-08');db.prepare('INSERT INTO apartment_buildings(building_id,apartment_id,legal_code,name,dong_name,jibun,road_address,build_year) VALUES(?,?,?,?,?,?,?,?)').run(id,rootId,'4146510100',name,dong,lot||'',road,year);}
 db.prepare('INSERT INTO apartment_building_inventory VALUES(?,?,?,?,?,?,1,1)').run(id,'dong_test','4146510100',root,classification,JSON.stringify({title,root_id:root,scope:{region_code:'41465',region_name:'경기도 용인시 수지구',dong:'시험동'}}));
 return rootId;
}
function trade(db,{id,name='시험마을',dong='',lot='1',year=1992}){
 db.prepare('INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'41465','202610','2026-10-01',name,'시험동',lot,10000,84,3,year,0,JSON.stringify({aptDong:dong}));return id;
}
const rebuild=db=>rebuildHousingIdentity(db,{scopes:[{region_code:'41465',dongs:['시험동']}],now:'2026-11-08T01:00:00.000Z'});

test('one registry root is divided by actual building roads without copying phase2 history into phase6',t=>{
 const db=fixture(t);
 for(const dong of ['201','202'])building(db,{id:'two'+dong,root:'mixed',name:'정든마을',dong:dong==='202'?'제202동':dong,lot:'198',road:'경기도 용인시 수지구 불정로 179',year:1995});
 for(const dong of ['609','610'])building(db,{id:'six'+dong,root:'mixed',name:'정든마을',dong,lot:'198',road:'경기도 용인시 수지구 불정로 195',year:1994});
 trade(db,{id:1,name:'정든마을(2단지)(동아)',dong:'201동',lot:'198',year:1995});trade(db,{id:2,name:'정든마을(2단지)(동아)',dong:'202',lot:'198',year:1995});trade(db,{id:3,name:'정든마을(2단지)(동아)',lot:'198',year:1995});
 rebuild(db);const catalog=housingIdentityCatalog(db),bindings=housingTradeBindings(db),entity=catalog.entities[0];
 assert.equal(entity.state,'verified');assert.equal(entity.cohort_ids.length,1);assert.equal(catalog.cohorts.length,2);
 assert.equal(bindings.get(1).building_id,'two201');assert.equal(bindings.get(1).cohort_id,entity.cohort_ids[0]);assert.equal(bindings.get(3).precision,'complex');assert.equal(bindings.get(3).root_id,null);
 const wrong=catalog.cohorts.find(row=>row.road_addresses[0].endsWith('195'));assert.deepEqual(wrong.entity_ids,[]);assert.deepEqual(wrong.partial_entity_ids,[]);
 assert.deepEqual(catalog.roots[0].entity_ids,[entity.entity_id]);
});

test('one reported wall complex spans parcels and root years while historical rows remain complex-level',t=>{
 const db=fixture(t);
 for(const [root,lot,year,dongs,road] of [['wall-a','71',1993,['101','102'],'경기도 용인시 수지구 수내로 174'],['wall-b','72',1992,['201','202'],'경기도 용인시 수지구 수내로 192'],['wall-c','73',1992,['301','302'],'경기도 용인시 수지구 불정로 277']])for(const dong of dongs)building(db,{id:root+dong,root,name:'푸른마을',lot,year,dong,road});
 ['101','201','301',''].forEach((dong,index)=>trade(db,{id:index+1,name:'푸른마을(벽산)',dong,lot:'71'}));
 const stats=rebuild(db),catalog=housingIdentityCatalog(db),entity=catalog.entities[0],bindings=housingTradeBindings(db);
 assert.equal(entity.state,'verified');assert.equal(entity.root_ids.length,3);assert.equal(stats.row_count,4);assert.deepEqual(stats.precision_counts,{building:3,cohort:0,complex:1,unresolved:0});
 assert.equal(bindings.get(2).root_id,'hub:wall-b');assert.equal(bindings.get(3).root_id,'hub:wall-c');
 for(const root of catalog.roots){assert.deepEqual(root.entity_ids,[]);assert.deepEqual(root.partial_entity_ids,[entity.entity_id]);}
 assert.equal(bindings.get(4).root_id,null);
});

test('ssangyong source parcel75 resolves building401/403/501/601 across four registered parcels',t=>{
 const db=fixture(t);
 for(const [lot,dong] of [['74','403'],['75','401'],['76','501'],['77','601']])building(db,{id:'b'+dong,root:'root'+lot,name:'푸른마을',lot,dong,road:'경기도 용인시 수지구 수내로 '+lot});
 ['401','403','501','601',''].forEach((dong,index)=>trade(db,{id:index+1,name:'푸른마을(쌍용)',lot:'75',dong}));rebuild(db);
 const entity=housingIdentityCatalog(db).entities[0];assert.equal(entity.state,'verified');assert.equal(entity.root_ids.length,4);assert.equal(housingTradeBindings(db).get(2).root_id,'hub:root74');assert.equal(housingTradeBindings(db).get(5).precision,'complex');
});

test('two source complexes can witness distinct buildings at one road cohort without claiming every building',t=>{
 const db=fixture(t);building(db,{id:'wall101',root:'wall',name:'푸른마을',dong:'101',lot:'71'});
 for(const dong of ['401','402'])building(db,{id:'shared'+dong,root:'shared',name:'푸른마을',dong,lot:'75',road:'경기도 용인시 수지구 공유로 75'});
 trade(db,{id:1,name:'푸른마을(벽산)',dong:'101',lot:'71'});trade(db,{id:2,name:'푸른마을(벽산)',dong:'402',lot:'71'});trade(db,{id:3,name:'푸른마을(벽산)',lot:'71'});trade(db,{id:4,name:'푸른마을(쌍용)',dong:'401',lot:'75'});
 rebuild(db);const wall=housingIdentityCatalog(db).entities.find(entity=>entity.favorite.apartment==='푸른마을(벽산)');assert.equal(wall.state,'verified');
 const evidence=JSON.parse(db.prepare('SELECT evidence_json FROM housing_identity_entities WHERE entity_id=?').get(wall.entity_id).evidence_json),shared=evidence.member_buildings.find(member=>member.registered_building_ids.includes('shared402'));
 assert.deepEqual(shared.witness_building_ids,['shared402']);assert.equal(housingTradeBindings(db).get(4).building_id,'shared401');assert.equal(housingTradeBindings(db).get(3).precision,'complex');
 assert.deepEqual(wall.favorite.identity_listing_members.find(member=>member.cohort_id===shared.cohort_id).building_dongs,['402']);
 const ssang=housingIdentityCatalog(db).entities.find(entity=>entity.favorite.apartment==='푸른마을(쌍용)');assert.deepEqual(ssang.favorite.identity_listing_members[0].building_dongs,['401']);
});

test('malformed parcels require a unique exact named year and multiple published building witnesses',t=>{
 const db=fixture(t);
 for(const [name,root,year,dongs] of [['동천센트럴자이','central',2019,['201','202']],['동천자이','xi',2018,['101','102']],['한화포레나수지동천','forena',2022,['101','102']]]){
  dongs.forEach(dong=>building(db,{id:root+dong,root,name,dong,lot:'',year,road:'경기도 용인시 수지구 고기로 '+year}));
  dongs.concat('').forEach(dong=>trade(db,{id:db.prepare('SELECT count(*) n FROM trades').get().n+1,name,dong,lot:'가-',year}));
 }
 rebuild(db);const catalog=housingIdentityCatalog(db);assert.equal(catalog.entities.length,3);assert(catalog.entities.every(entity=>entity.state==='verified'&&entity.method==='registry_building_series'));
 assert.equal(housingIdentityStats(db).precision_counts.complex,3);
 const before=JSON.stringify(catalog);trade(db,{id:10,name:'이름뿐인단지',lot:'BL-',year:2022});rebuild(db);assert.equal(housingIdentityCatalog(db).entities.find(row=>row.favorite.apartment==='이름뿐인단지').state,'insufficient');assert(before.includes('registry_building_series'));
});

test('excluded legal residential buildings are source-identifiable without creating apartment masters',t=>{
 const db=fixture(t);
 building(db,{id:'luce',root:'luce',name:'루체스타',dong:'',lot:'185-11',classification:'other',use:'업무시설,연립주택',master:false,year:2020});
 building(db,{id:'ever',root:'ever',name:'에버하임',dong:'',lot:'971-3',classification:'other',use:'오피스텔(36) 및 도시형생활주택(단지형다세대12)',master:false,year:2020});
 trade(db,{id:1,name:'루체스타',lot:'185-11',year:2020});trade(db,{id:2,name:'에버하임',lot:'971-3',dong:'에버하임',year:2020});
 rebuild(db);const catalog=housingIdentityCatalog(db);assert.equal(catalog.entities.filter(row=>row.state==='verified').length,2);assert.equal(db.prepare('SELECT count(*) n FROM apartment_complexes').get().n,0);
 assert(catalog.cohorts.every(cohort=>cohort.master_id===null&&!cohort.legal_types.includes('아파트')));assert(catalog.entities.some(entity=>entity.legal_types.includes('연립주택')));assert(catalog.entities.some(entity=>entity.legal_types.includes('다세대주택')));
});

test('a shared entrance or matching name alone cannot override a different registered parcel',t=>{
 const db=fixture(t);
 for(const lot of ['1','2']){building(db,{id:'building'+lot,root:'root'+lot,dong:'101',lot});db.prepare('INSERT INTO apartment_entrances VALUES(?,?,?,?,?,?,?,?)').run('building'+lot,0,37.3,127.1,0,0,'juso','2026-11-08');}
 trade(db,{id:1,dong:'101',lot:'1'});rebuild(db);const binding=housingTradeBindings(db).get(1);assert.equal(binding.root_id,'hub:root1');assert.equal(housingIdentityCatalog(db).entities[0].root_ids.length,1);
 trade(db,{id:2,name:'시험마을',lot:'BL-'});rebuild(db);assert.equal(housingTradeBindings(db).get(2).precision,'unresolved');
});

test('unknown explicit buildings do not become fabricated complex assignments',t=>{
 const db=fixture(t);building(db,{id:'101',dong:'101'});trade(db,{id:1,dong:'101'});trade(db,{id:2,dong:'999'});trade(db,{id:3});rebuild(db);
 const entity=housingIdentityCatalog(db).entities[0];assert.equal(entity.state,'partial');assert.equal(housingTradeBindings(db).get(1).precision,'building');assert.equal(housingTradeBindings(db).get(2).precision,'unresolved');assert.equal(housingTradeBindings(db).get(3).precision,'unresolved');assert.equal(entity.row_count,3);
});

test('rebuild is idempotent and a month replacement cannot expose stale reused trade IDs',t=>{
 const db=fixture(t);building(db,{id:'101',dong:'101'});trade(db,{id:1,dong:'101'});rebuild(db);const first=JSON.stringify(housingIdentityCatalog(db)),bindings=JSON.stringify([...housingTradeBindings(db)]);rebuild(db);assert.equal(JSON.stringify(housingIdentityCatalog(db)),first);assert.equal(JSON.stringify([...housingTradeBindings(db)]),bindings);
 db.prepare('DELETE FROM trades').run();trade(db,{id:1,name:'다른단지',dong:'101',lot:'55'});assert.throws(()=>housingTradeBindings(db),/만료/);rebuild(db);assert.equal(housingTradeBindings(db).get(1).precision,'unresolved');assert.notEqual(housingTradeBindings(db).get(1).entity_id,JSON.parse(bindings)[0][1].entity_id);
});

test('all raw rows including duplicate observations and out-of-scope groups have one preserved source owner',t=>{
 const db=fixture(t);building(db,{id:'101',dong:'101'});trade(db,{id:1,dong:'101'});trade(db,{id:2,dong:'101'});db.prepare("INSERT INTO trades SELECT 3,region_code,deal_month,deal_date,apartment,'범위밖동',jibun,price_man,area_m2,floor,build_year,cancelled,raw_json FROM trades WHERE id=1").run();
 const before=db.prepare('SELECT * FROM trades ORDER BY id').all(),stats=rebuild(db);assert.equal(stats.row_count,3);assert.equal(housingTradeBindings(db).size,3);assert.equal(stats.states.out_of_scope,1);assert.deepEqual(db.prepare('SELECT * FROM trades ORDER BY id').all(),before);
});

test('official parcel and published building series verify reordered names without trusting old links',t=>{
 const db=fixture(t);for(const dong of ['6101','6102'])building(db,{id:dong,root:'gwanggyo',name:'e편한세상 광교',dong,year:2012});
 trade(db,{id:1,name:'광교e편한세상',dong:'6101',year:2012});trade(db,{id:2,name:'광교e편한세상',dong:'6102',year:2012});trade(db,{id:3,name:'광교e편한세상',year:2012});
 rebuild(db);assert.equal(housingIdentityCatalog(db).entities[0].state,'verified');assert.equal(housingTradeBindings(db).get(1).precision,'building');assert.equal(housingTradeBindings(db).get(3).precision,'complex');
});
test('even a unique official parcel and exact year never override a conflicting numbered phase',t=>{
 const db=fixture(t);for(const dong of ['101','102'])building(db,{id:dong,name:'공식마을1단지',dong,year:2012});
 trade(db,{id:1,name:'공식마을2단지',dong:'101',year:2012});trade(db,{id:2,name:'공식마을2단지',dong:'102',year:2012});
 rebuild(db);assert.equal(housingIdentityCatalog(db).entities[0].state,'insufficient');assert.equal(housingTradeBindings(db).get(1).precision,'unresolved');
});

test('a single official aggregate title supports cohort precision without inventing individual buildings',t=>{
 const db=fixture(t);building(db,{id:'aggregate',name:'분당하우스토리',dong:'분당하우스토리',year:2004});
 trade(db,{id:1,name:'분당하우스토리',dong:'분당하우스토리101동',year:2004});trade(db,{id:2,name:'분당하우스토리',dong:'분당하우스토리102동',year:2004});trade(db,{id:3,name:'분당하우스토리',year:2004});
 rebuild(db);assert.equal(housingIdentityCatalog(db).entities[0].state,'verified');assert.equal(housingTradeBindings(db).get(1).precision,'cohort');assert.equal(housingTradeBindings(db).get(1).building_id,null);assert.equal(housingTradeBindings(db).get(3).precision,'complex');
});

test('a changed registry road invalidates the derived catalog until the common rebuild',t=>{
 const db=fixture(t);building(db,{id:'101'});trade(db,{id:1,dong:'101'});rebuild(db);
 db.prepare("UPDATE apartment_buildings SET road_address='바뀐 도로' WHERE building_id='101'").run();assert.throws(()=>housingIdentityCatalog(db),/만료/);rebuild(db);assert.equal(housingTradeBindings(db).size,1);
});
