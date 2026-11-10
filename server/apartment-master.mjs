import os from 'node:os';
import {resolveTradeCandidates} from './trade-link-resolution.mjs';
import {APARTMENT_MASTER_SCHEMA,BUILDING_INVENTORY_SCHEMA} from './apartment-master-schema.mjs';
import {approvalDate,buildingClassification,isResidentialClassification,numeric,parcel,registryCoordinateCodes,text} from './building-registry.mjs';
import {normalizeApartmentName} from './apartment-boundaries.mjs';
import {apartmentInformation,apartmentMapInformation,resolveApartmentIdentity,synchronizeApartmentIdentity} from './apartment-identity.mjs';
import {normalizeRoadAddress,normalizeParcel} from '../src/address-identity.mjs';
export function initializeApartmentMaster(db){db.exec(APARTMENT_MASTER_SCHEMA);migrateHousingClassification(db);const fields=db.prepare('PRAGMA table_info(apartment_inventory_runs)').all().map(p=>p.name);if(!fields.includes('owner_pid'))db.exec('ALTER TABLE apartment_inventory_runs ADD COLUMN owner_pid INTEGER');if(!fields.includes('owner_host'))db.exec('ALTER TABLE apartment_inventory_runs ADD COLUMN owner_host TEXT');const parcelFields=db.prepare('PRAGMA table_info(apartment_parcels)').all().map(p=>p.name);if(!parcelFields.includes('attributes_json'))db.exec('ALTER TABLE apartment_parcels ADD COLUMN attributes_json TEXT');if(!parcelFields.includes('spatial_status'))db.exec("ALTER TABLE apartment_parcels ADD COLUMN spatial_status TEXT NOT NULL DEFAULT 'pending'");if(!parcelFields.includes('spatial_fetched_at'))db.exec('ALTER TABLE apartment_parcels ADD COLUMN spatial_fetched_at TEXT');}
// Extend the existing CHECK constraint transactionally; identifiers and raw rows
// are copied unchanged. No table references the inventory through a foreign key.
function migrateHousingClassification(db) {
 const schema=db.prepare("SELECT sql FROM sqlite_master WHERE name='apartment_building_inventory'").get().sql;
 if(schema.includes("'senior_housing'"))return;
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec(BUILDING_INVENTORY_SCHEMA.replace('apartment_building_inventory','apartment_building_inventory_next'));
  db.exec('INSERT INTO apartment_building_inventory_next SELECT * FROM apartment_building_inventory');
  db.exec('DROP TABLE apartment_building_inventory; ALTER TABLE apartment_building_inventory_next RENAME TO apartment_building_inventory; COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function masterScopes(catalog,ids){
 return ids.map(id=>{const r=catalog.find(r=>r.region_id===id);if(!r||!/^dong_\d{8}$/.test(id)||r.dongs.length!==1)throw new Error('전체 아파트 수집에는 공식 법정동 코드를 가진 지역을 선택하세요.');return{region_id:id,legal_code:id.slice(5)+'00',region_code:r.region_code,region_name:r.region_name,dong:r.dongs[0]};});
}
export function startMasterRun(db,scopes,{preserveScanned=false}={}){
 initializeApartmentMaster(db);db.exec('BEGIN IMMEDIATE');let id;try{if(masterCollectionRunning(db))throw new Error('전체 아파트 수집이 이미 실행 중입니다. 완료 후 다시 실행하세요.');db.prepare("UPDATE apartment_inventory_runs SET status='interrupted',finished_at=? WHERE status='running'").run(new Date().toISOString());id=Number(db.prepare('INSERT INTO apartment_inventory_runs(started_at,status,scope_json,owner_pid,owner_host) VALUES(?,?,?,?,?)').run(new Date().toISOString(),'running',JSON.stringify(scopes),process.pid,os.hostname()).lastInsertRowid);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 const put=db.prepare(preserveScanned?`INSERT INTO apartment_inventory_regions(region_id,legal_code,dong,status,run_id) VALUES(?,?,?,?,?) ON CONFLICT(region_id) DO UPDATE SET status=CASE WHEN apartment_inventory_regions.status='scanned' THEN 'scanned' ELSE 'pending' END,run_id=excluded.run_id,error=''`:`INSERT INTO apartment_inventory_regions(region_id,legal_code,dong,status,run_id) VALUES(?,?,?,?,?) ON CONFLICT(region_id) DO UPDATE SET status=excluded.status,run_id=excluded.run_id,error=''`);
 for(const s of scopes)put.run(s.region_id,s.legal_code,s.dong,'pending',id);return id;
}
const pk=r=>text(r.mgmBldrgstPk);
function rootId(id,basis){const seen=new Set();let current=id;while(current){if(seen.has(current))throw new Error('건축물 상위 대장 연결이 순환합니다.');seen.add(current);const up=text(basis.get(current)?.mgmUpBldrgstPk);if(!up||up==='0')return current;current=up;}return id;}
export function saveRegistrySnapshot(db,runId,scope,snapshot){
 const title=snapshot.getBrTitleInfo.items,basis=new Map(snapshot.getBrBasisOulnInfo.items.map(p=>[pk(p),p])),recaps=new Map(snapshot.getBrRecapTitleInfo.items.map(p=>[pk(p),p])),floors=new Map(),attached=new Map();
 for(const f of snapshot.getBrFlrOulnInfo.items){if(!floors.has(pk(f)))floors.set(pk(f),[]);floors.get(pk(f)).push(f);}
 for(const a of snapshot.getBrAtchJibunInfo.items){if(!attached.has(pk(a)))attached.set(pk(a),[]);attached.get(pk(a)).push(a);}
 const at=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{
 db.prepare('UPDATE apartment_building_inventory SET active=0 WHERE region_id=?').run(scope.region_id);
 const page=db.prepare('INSERT OR REPLACE INTO apartment_inventory_pages VALUES(?,?,?,?,?,?)');for(const [dataset,value] of Object.entries(snapshot))for(const p of value.pages)page.run(runId,scope.region_id,dataset,p.page,value.total,JSON.stringify(p.items));
 const insert=db.prepare(`INSERT INTO apartment_building_inventory VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(building_id) DO UPDATE SET region_id=excluded.region_id,legal_code=excluded.legal_code,parent_id=excluded.parent_id,classification=excluded.classification,record_json=excluded.record_json,active=1,run_id=excluded.run_id`);
 for(const row of title){const id=pk(row),root=rootId(id,basis),f=floors.get(id)||[],recap=recaps.get(root)||null;insert.run(id,scope.region_id,scope.legal_code,root,buildingClassification(row,f),JSON.stringify({title:row,basis:basis.get(id)||null,root_id:root,recap,attached:[...(attached.get(id)||[]),...(id!==root?attached.get(root)||[]:[])],scope}),runId);}
 const counts=Object.fromEntries(Object.entries(snapshot).map(([key,value])=>[key,value.total]));db.prepare(`UPDATE apartment_inventory_regions SET status='scanned',source_counts_json=?,fetched_at=?,error='' WHERE region_id=?`).run(JSON.stringify(counts),at,scope.region_id);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function masterIssue(db,{region_id,apartment_id=null,building_id=null,code,detail}){
 const key=JSON.stringify([region_id,apartment_id,building_id,code]);db.prepare(`INSERT INTO apartment_master_issues VALUES(?,?,?,?,?,?,?) ON CONFLICT(issue_key) DO UPDATE SET detail=excluded.detail,updated_at=excluded.updated_at`).run(key,region_id,apartment_id,building_id,code,detail,new Date().toISOString());
}
export function rebuildApartmentMaster(db){
 initializeApartmentMaster(db);
 const inventory=db.prepare('SELECT * FROM apartment_building_inventory WHERE active=1 ORDER BY region_id,building_id').all().map(p=>({...p,...JSON.parse(p.record_json)})),groups=new Map();
 const floorScopes=new Set(),floors=new Map(),scopeKey=(run,region)=>JSON.stringify([run,region]);
 for(const row of db.prepare("SELECT * FROM apartment_inventory_regions").all())if(JSON.parse(row.source_counts_json).getBrFlrOulnInfo===0)floorScopes.add(scopeKey(row.run_id,row.region_id));
 for(const page of db.prepare("SELECT p.* FROM apartment_inventory_pages p WHERE p.dataset='getBrFlrOulnInfo' AND EXISTS(SELECT 1 FROM apartment_building_inventory i WHERE i.active=1 AND i.run_id=p.run_id AND i.region_id=p.region_id)").all()){
  const scope=scopeKey(page.run_id,page.region_id);floorScopes.add(scope);
  for(const floor of JSON.parse(page.items_json)){const key=scope+'|'+pk(floor);if(!floors.has(key))floors.set(key,[]);floors.get(key).push(floor);}
 }
 for(const p of inventory){const scope=scopeKey(p.run_id,p.region_id);if(floorScopes.has(scope))p.classification=buildingClassification(p.title,floors.get(scope+'|'+p.building_id)||[]);else if(buildingClassification(p.title)==='senior_housing')p.classification='senior_housing';const id='hub:'+p.root_id;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}
 const at=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{
 const updateClassification=db.prepare('UPDATE apartment_building_inventory SET classification=? WHERE building_id=?');
 for(const p of inventory)updateClassification.run(p.classification,p.building_id);
 db.prepare('UPDATE apartment_complexes SET active=0').run();db.prepare('DELETE FROM apartment_master_issues').run();
 for(const p of inventory.filter(p=>p.classification==='review'))masterIssue(db,{region_id:p.region_id,building_id:p.building_id,code:'use_review',detail:'공동주택 용도만 확인되어 아파트·연립·다세대 구분이 필요합니다.'});
 const complex=db.prepare(`INSERT INTO apartment_complexes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?) ON CONFLICT(apartment_id) DO UPDATE SET registry_root_id=excluded.registry_root_id,region_code=excluded.region_code,legal_code=excluded.legal_code,dong=excluded.dong,name=excluded.name,jibun=excluded.jibun,road_address=excluded.road_address,approval_date=excluded.approval_date,build_year=excluded.build_year,household_count=excluded.household_count,building_count=excluded.building_count,max_floors=excluded.max_floors,structure=excluded.structure,active=1,fetched_at=excluded.fetched_at,inventory_run_id=excluded.inventory_run_id`);
 const building=db.prepare(`INSERT INTO apartment_buildings(building_id,apartment_id,legal_code,name,dong_name,jibun,road_address,main_use_code,main_use_name,other_use,approval_date,build_year,households,floors_above,floors_below,structure,gross_area_m2,site_area_m2,coordinate_codes_json) VALUES(${Array(19).fill('?').join(',')}) ON CONFLICT(building_id) DO UPDATE SET apartment_id=excluded.apartment_id,legal_code=excluded.legal_code,name=excluded.name,dong_name=excluded.dong_name,jibun=excluded.jibun,road_address=excluded.road_address,main_use_code=excluded.main_use_code,main_use_name=excluded.main_use_name,other_use=excluded.other_use,approval_date=excluded.approval_date,build_year=excluded.build_year,households=excluded.households,floors_above=excluded.floors_above,floors_below=excluded.floors_below,structure=excluded.structure,gross_area_m2=excluded.gross_area_m2,site_area_m2=excluded.site_area_m2,coordinate_codes_json=excluded.coordinate_codes_json`);
 const saveParcel=db.prepare(`INSERT INTO apartment_parcels(apartment_id,pnu,legal_code,jibun,relation) VALUES(?,?,?,?,?) ON CONFLICT(apartment_id,pnu) DO UPDATE SET legal_code=excluded.legal_code,jibun=excluded.jibun,relation=excluded.relation`),alias=db.prepare('INSERT OR IGNORE INTO apartment_aliases VALUES(?,?,?)');
 for(const [id,all] of groups){const apt=all.filter(p=>isResidentialClassification(p.classification));if(!apt.length)continue;const first=apt[0],recap=all.find(p=>p.recap)?.recap||{},titles=apt.map(p=>p.title),name=text(recap.bldNm)||text(titles.find(t=>text(t.bldNm))?.bldNm)||null;
 const approved=approvalDate(recap.useAprDay)||titles.map(t=>approvalDate(t.useAprDay)).filter(Boolean).sort()[0]||null,years=approved?Number(approved.slice(0,4)):null;
 const households=numeric(recap.hhldCnt)??(titles.every(t=>numeric(t.hhldCnt)!==null)?titles.reduce((n,t)=>n+numeric(t.hhldCnt),0):null),floors=titles.map(t=>numeric(t.grndFlrCnt)).filter(p=>p!==null),primary=parcel(first.title);
 complex.run(id,first.root_id,first.scope.region_code,first.legal_code,first.scope.dong,name,primary?.jibun||'',text(recap.newPlatPlc)||text(first.title.newPlatPlc),approved,years,households,numeric(recap.mainBldCnt)??all.filter(p=>text(p.title.mainAtchGbCd)==='0').length,floors.length?Math.max(...floors):null,text(first.title.strctCdNm)||null,'건축HUB 건축물대장',at,first.run_id);
 if(!name)masterIssue(db,{region_id:first.region_id,apartment_id:id,code:'missing_name',detail:'공식 대장에 단지명이 비어 있습니다.'});if(!approved)masterIssue(db,{region_id:first.region_id,apartment_id:id,code:'missing_approval',detail:'공식 사용승인일이 미확인입니다.'});
 const expectedBuildings=numeric(recap.mainBldCnt),actualBuildings=all.filter(p=>text(p.title.mainAtchGbCd)==='0').length;
 if(expectedBuildings!==null&&expectedBuildings!==actualBuildings)masterIssue(db,{region_id:first.region_id,apartment_id:id,code:'building_count_mismatch',detail:'총괄표제부 주건축물 '+expectedBuildings+'동 / 연결된 표제부 '+actualBuildings+'동. 지역 경계 밖 건물·상위 대장 연결 확인이 필요합니다.'});
 const pnus=new Set();for(const p of all){const t=p.title,approval=approvalDate(t.useAprDay),codes=registryCoordinateCodes(t),old=db.prepare('SELECT coordinate_codes_json FROM apartment_buildings WHERE building_id=?').get(p.building_id);
 if(old&&old.coordinate_codes_json!==JSON.stringify(codes)){db.prepare('DELETE FROM apartment_entrances WHERE building_id=?').run(p.building_id);db.prepare("UPDATE apartment_buildings SET coordinate_status='pending',coordinate_fetched_at=NULL WHERE building_id=?").run(p.building_id);}
 building.run(p.building_id,id,p.legal_code,text(t.bldNm),text(t.dongNm),parcel(t)?.jibun||'',text(t.newPlatPlc),text(t.mainPurpsCd),text(t.mainPurpsCdNm),text(t.etcPurps),approval,approval?+approval.slice(0,4):null,numeric(t.hhldCnt),numeric(t.grndFlrCnt),numeric(t.ugrndFlrCnt),text(t.strctCdNm),numeric(t.totArea),numeric(t.platArea),JSON.stringify(codes));
 for(const label of [text(t.bldNm),text(p.recap?.bldNm)])if(label)alias.run(id,label,'건축HUB 건축물대장');
 const parcels=[{value:parcel(t),relation:'primary'},...p.attached.map(a=>({value:parcel(a,'atch'),relation:'attached'}))];for(const {value,relation} of parcels)if(value){pnus.add(value.pnu);saveParcel.run(id,value.pnu,value.legal_code,value.jibun,relation);}else masterIssue(db,{region_id:p.region_id,apartment_id:id,building_id:p.building_id,code:'parcel_unresolved',detail:'대표·부속 지번을 PNU로 변환할 수 없습니다. 블록/롯트 또는 대지구분 확인이 필요합니다.'});
 if(!codes)masterIssue(db,{region_id:p.region_id,apartment_id:id,building_id:p.building_id,code:'coordinate_codes_missing',detail:'공식 건물의 도로명주소 코드가 없어 출입구 좌표 조회를 할 수 없습니다.'});
 }
 for(const p of db.prepare('SELECT pnu FROM apartment_parcels WHERE apartment_id=?').all(id))if(!pnus.has(p.pnu))db.prepare('DELETE FROM apartment_parcels WHERE apartment_id=? AND pnu=?').run(id,p.pnu);
 }
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return masterStats(db);
}
export function masterStats(db,scopeIds){
 if(!db.prepare("SELECT name FROM sqlite_master WHERE name='apartment_complexes'").get())return {complexes:0,buildings:0,regions:[],issues:0};
 let regions=db.prepare('SELECT * FROM apartment_inventory_regions ORDER BY region_id').all();if(scopeIds)regions=regions.filter(r=>scopeIds.includes(r.region_id));const legal=new Set(regions.map(r=>r.legal_code));
 const memberships=db.prepare('SELECT b.apartment_id,i.region_id,i.legal_code FROM apartment_buildings b JOIN apartment_building_inventory i USING(building_id) WHERE i.active=1').all(),scopedComplexes=new Set(memberships.filter(m=>!scopeIds||scopeIds.includes(m.region_id)).map(m=>m.apartment_id));
 const complexes=db.prepare(`SELECT c.*,EXISTS(SELECT 1 FROM apartment_buildings b JOIN apartment_entrances e USING(building_id) JOIN apartment_building_inventory i USING(building_id) WHERE b.apartment_id=c.apartment_id AND i.active=1) AS has_location,(SELECT count(*) FROM apartment_parcels p WHERE p.apartment_id=c.apartment_id) AS parcels,(SELECT count(*) FROM apartment_parcels p WHERE p.apartment_id=c.apartment_id AND p.geometry_json IS NOT NULL AND p.boundary_status='exact') AS boundaries FROM apartment_complexes c WHERE active=1`).all().filter(c=>!scopeIds||scopedComplexes.has(c.apartment_id));
 const selectedComplexes=new Set(complexes.map(c=>c.apartment_id));
 const issues=db.prepare('SELECT * FROM apartment_master_issues ORDER BY region_id,code').all().filter(p=>!scopeIds||scopeIds.includes(p.region_id)||selectedComplexes.has(p.apartment_id));
 const summary={complexes:complexes.length,buildings:db.prepare('SELECT b.apartment_id FROM apartment_buildings b JOIN apartment_building_inventory i USING(building_id) JOIN apartment_complexes c USING(apartment_id) WHERE i.active=1 AND c.active=1').all().filter(b=>selectedComplexes.has(b.apartment_id)).length,withName:complexes.filter(p=>p.name).length,withAddress:complexes.filter(p=>p.road_address&&p.jibun).length,withLocation:complexes.filter(p=>p.has_location).length,withBoundary:complexes.filter(p=>p.parcels&&p.parcels===p.boundaries).length,withYear:complexes.filter(p=>p.build_year).length,withFootprints:new Set(db.prepare('SELECT DISTINCT apartment_id FROM apartment_footprint_links').all().map(p=>p.apartment_id)).size,withLandPrice:complexes.filter(p=>db.prepare('SELECT 1 FROM apartment_parcels WHERE apartment_id=? AND attributes_json IS NOT NULL').get(p.apartment_id)).length,withZoning:new Set(db.prepare('SELECT DISTINCT apartment_id FROM apartment_zoning_links').all().map(p=>p.apartment_id)).size,issues:issues.length,issueList:issues,regions:regions.map(r=>({...r,source_counts:JSON.parse(r.source_counts_json),complexes:complexes.filter(c=>memberships.some(m=>m.apartment_id===c.apartment_id&&m.region_id===r.region_id)).length}))};
 const parcelCoverage=db.prepare('SELECT apartment_id,pnu,geometry_json,boundary_status,attributes_json,spatial_status FROM apartment_parcels').all().filter(row=>selectedComplexes.has(row.apartment_id));
 summary.withRegionBoundary=regions.filter(row=>db.prepare('SELECT 1 FROM apartment_region_boundaries WHERE region_id=?').get(row.region_id)).length;
 summary.withDistrictBoundary=new Set(regions.map(row=>row.legal_code.slice(0,5))).size?new Set(regions.filter(row=>db.prepare('SELECT 1 FROM apartment_district_boundaries WHERE district_code=?').get(row.legal_code.slice(0,5))).map(row=>row.legal_code.slice(0,5))).size:0;
 summary.pendingVworldParcels=parcelCoverage.filter(row=>row.boundary_status==='exact'&&(!row.attributes_json||!['complete','empty'].includes(row.spatial_status))).length;
 summary.vworldDataComplete=summary.withRegionBoundary===regions.length&&summary.withDistrictBoundary===new Set(regions.map(row=>row.legal_code.slice(0,5))).size&&parcelCoverage.every(row=>row.boundary_status!=='exact'||(Boolean(row.attributes_json)&&['complete','empty'].includes(row.spatial_status)));
 summary.lastRunStatus=db.prepare('SELECT status FROM apartment_inventory_runs ORDER BY id DESC LIMIT 1').get()?.status||'pending';
 summary.readyToComplete=Boolean(regions.length)&&(!scopeIds||regions.length===scopeIds.length)&&regions.every(r=>r.status==='scanned')&&!issues.length&&['withName','withAddress','withLocation','withBoundary','withYear'].every(k=>summary[k]===summary.complexes)&&summary.vworldDataComplete;summary.complete=summary.readyToComplete&&summary.lastRunStatus==='complete';return summary;
}
export function linkMasterTrades(db,tradeDb=db){
 synchronizeApartmentIdentity(db);
 const information=apartmentInformation(db);
 if(!tradeDb.prepare("SELECT name FROM sqlite_master WHERE name='trades'").get())return {matched:0,ambiguous:0,unmatched:0};
 const infoById=new Map(information.map(row=>[row.apartment_id,row]));
 const roadAliases=new Map();for(const alias of db.prepare("SELECT * FROM apartment_aliases WHERE source NOT LIKE '국토교통부 실거래%'").all()){if(!roadAliases.has(alias.apartment_id))roadAliases.set(alias.apartment_id,new Set());roadAliases.get(alias.apartment_id).add(normalizeApartmentName(alias.name));}
 const complexes=db.prepare('SELECT * FROM apartment_complexes WHERE active=1').all().map(c=>({...c,road_addresses:infoById.get(c.apartment_id)?.addresses.map(a=>a.road_address)||[]})),byId=new Map(complexes.map(c=>[c.apartment_id,c])),aliases=new Map();for(const a of db.prepare('SELECT * FROM apartment_aliases').all()){if(!aliases.has(a.apartment_id))aliases.set(a.apartment_id,new Set());aliases.get(a.apartment_id).add(normalizeApartmentName(a.name));}
 const byParcel=new Map();for(const p of db.prepare('SELECT p.*,c.region_code FROM apartment_parcels p JOIN apartment_complexes c USING(apartment_id) WHERE c.active=1').all()){const lot=normalizeParcel(p.jibun);if(!lot)continue;const key=JSON.stringify([p.legal_code.slice(0,5),p.legal_code.slice(0,8),lot]);if(!byParcel.has(key))byParcel.set(key,new Set());byParcel.get(key).add(p.apartment_id);}
 const byRoad=new Map();for(const c of complexes)for(const address of [c.road_address,...c.road_addresses]){const normalized=normalizeRoadAddress(address);if(!normalized)continue;const key=c.region_code+'|'+normalized;if(!byRoad.has(key))byRoad.set(key,new Set());byRoad.get(key).add(c.apartment_id);}
 const tradeRoads=new Map();if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='road_addresses'").get())for(const row of db.prepare('SELECT * FROM road_addresses').all()){const lot=normalizeParcel(row.jibun);if(!lot)continue;const key=JSON.stringify([row.region_code,row.dong,lot]);if(!tradeRoads.has(key))tradeRoads.set(key,new Set());const road=normalizeRoadAddress(row.road_address);if(road)tradeRoads.get(key).add(road);}
 const dongCodes=new Map(db.prepare('SELECT legal_code,dong FROM apartment_inventory_regions').all().map(r=>[r.legal_code.slice(0,5)+'|'+r.dong,r.legal_code.slice(0,8)])),rows=tradeDb.prepare('SELECT region_code,dong,jibun,apartment,min(build_year) AS year FROM trades GROUP BY region_code,dong,jibun,apartment').all();
 const insert=db.prepare('INSERT OR REPLACE INTO apartment_trade_links VALUES(?,?,?,?,?,?,?,?,?)'),counts={matched:0,ambiguous:0,unmatched:0},at=new Date().toISOString();db.exec('BEGIN');try{db.prepare('DELETE FROM apartment_trade_links').run();for(const t of rows){const roads=[...(tradeRoads.get(JSON.stringify([t.region_code,t.dong,normalizeParcel(t.jibun)]))||[])];t.road_address=roads.length===1?roads[0]:'';t.road_ambiguous=roads.length>1;const ids=[...new Set([...(byParcel.get(JSON.stringify([t.region_code,dongCodes.get(t.region_code+'|'+t.dong),normalizeParcel(t.jibun)]))||[]),...(byRoad.get(t.region_code+'|'+normalizeRoadAddress(t.road_address))||[])])];
 const resolved=resolveTradeCandidates(t,ids.map(id=>byId.get(id)),aliases,{roadAliases}),identity=resolveApartmentIdentity(db,t,information);
 if(resolved.ids.length===1&&identity.status==='matched'&&identity.apartment_id!==resolved.ids[0]){resolved.ids=[];resolved.method='review';}
 const shared=resolved.method==='shared_registry_address';
 const status=resolved.ids.length===1||shared?'matched':resolved.ids.length?'ambiguous':'unmatched';
 counts[status]++;insert.run(t.region_code,t.dong,t.jibun,t.apartment,status==='matched'?resolved.ids[0]:null,status,resolved.method,JSON.stringify(resolved.ids),at);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return counts;
}
export function masterMapData(db,catalog,scopeIds,generation){
 const stats=masterStats(db,scopeIds),{apartments,boundaries}=apartmentMapInformation(db,{scopeIds,generation});
 return {apartments,boundaries,coverage:{...stats,issueList:undefined,mapEligible:apartments.length,mapExcluded:stats.complexes-apartments.length,mapLocated:apartments.filter(p=>p.location_status==='confirmed').length,mapUnlocated:apartments.filter(p=>p.location_status==='missing').length,mapUnnamed:apartments.filter(p=>p.name_status==='missing').length}};
}

export function masterCollectionRunning(db){if(!db.prepare("SELECT name FROM sqlite_master WHERE name='apartment_inventory_runs'").get())return false;return db.prepare("SELECT * FROM apartment_inventory_runs WHERE status='running'").all().some(r=>{if(r.owner_host&&r.owner_host!==os.hostname())return false;if(!r.owner_pid)return true;try{process.kill(r.owner_pid,0);return true;}catch(e){return e.code==='EPERM';}});}
