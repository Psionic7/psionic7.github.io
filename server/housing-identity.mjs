import {createHash} from 'node:crypto';
import {HOUSING_IDENTITY_SCHEMA,HOUSING_IDENTITY_INVALIDATION_SCHEMA} from './housing-identity-schema.mjs';
import {normalizeRoadAddress,normalizeParcel} from '../src/address-identity.mjs';
import {parcel,registryCoordinateCodes} from './building-registry.mjs';
import {listingBuildingMembers} from '../src/housing-identity.mjs';

const has=(db,name)=>Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name));
const all=(db,name)=>has(db,name)?db.prepare('SELECT * FROM '+name).all():[];
const clean=value=>String(value??'').trim();
const unique=values=>[...new Set(values.filter(value=>value!==null&&value!==undefined&&value!==''))].sort();
const nameKey=value=>clean(value).toLowerCase().replace(/아파트|apartment/gi,'').replace(/(\d+)차/g,'$1').replace(/[^\p{L}\p{N}]/gu,'');
const dongKey=value=>{const original=clean(value).replace(/\s/g,''),suffix=original.match(/(?:제)?(\d+)(?:동)?$/);const text=(suffix?suffix[1]:original.replace(/동$/,'').replace(/^제(?=\d)/,''));return /^0+$/.test(text)?'':/^\d+$/.test(text)?String(Number(text)):nameKey(text);};
const sourceId=row=>JSON.stringify([row.region_code,row.dong,row.jibun,row.apartment]);
const tradeKey=row=>JSON.stringify([row.dong,row.jibun,row.apartment]);
const scopeKey=row=>row.region_code+'|'+row.dong;
const digest=value=>createHash('sha256').update(value).digest('hex');
const plainPhases=value=>unique([...clean(value).matchAll(/(\d+(?:-\d+)?)(?:단지|차)/g)].map(match=>match[1]));
const phaseAgrees=(name,names)=>{const wanted=plainPhases(name),known=unique(names.flatMap(plainPhases));return wanted.length!==1||wanted[0].includes('-')||!known.length||known.some(value=>value===wanted[0]||value.includes('-'));};
const compatibleName=(name,names)=>{const key=nameKey(name);return names.some(value=>{const other=nameKey(value);return other.length>=2&&key.length>=2&&(key===other||key.startsWith(other)||other.startsWith(key));});};
const exactName=(name,names)=>names.some(value=>nameKey(name)===nameKey(value));
const yearAgrees=(years,year,tolerance=1)=>!year||!years.length||years.some(value=>Math.abs(value-year)<=tolerance);
const position=value=>Number.isFinite(value.latitude)&&Number.isFinite(value.longitude)&&value.latitude>=28&&value.latitude<=40&&value.longitude>=122&&value.longitude<=135;
const parseJson=(text,fallback)=>text?JSON.parse(text):fallback;
const officialAddressKey=codes=>codes?JSON.stringify([codes.admCd,codes.rnMgtSn,codes.udrtYn,codes.buldMnnm,codes.buldSlno]):null;

function legalTypes(title,classification){
 const uses=clean(title.mainPurpsCdNm)+' '+clean(title.etcPurps),types=[];
 if(classification==='senior_housing'||/노인복지주택/.test(uses))types.push('노인복지주택');
 else if(classification==='apartment')types.push('아파트');
 for(const [pattern,type] of [[/연립/,'연립주택'],[/다세대/,'다세대주택'],[/오피스텔/,'오피스텔'],[/업무시설/,'업무시설'],[/근린생활/,'근린생활시설']])if(pattern.test(uses))types.push(type);
 return unique(types);
}
function usableResidential(record){
 if(clean(record.title.mainAtchGbCd)==='1')return false;
 return ['apartment','senior_housing'].includes(record.classification)||/연립주택|다세대|도시형생활주택|오피스텔/.test(clean(record.title.etcPurps)+' '+clean(record.title.mainPurpsCdNm));
}
function scoped(row,scopes){
 if(scopes===undefined)return true;
 return scopes.some(scope=>scope.region_code===row.region_code&&(!(scope.dongs||parseJson(scope.dongs_json,[])).length||(scope.dongs||parseJson(scope.dongs_json,[])).includes(row.dong)));
}
function ensureSchema(db){
 db.exec(HOUSING_IDENTITY_SCHEMA);
 if(has(db,'trades'))db.exec(HOUSING_IDENTITY_INVALIDATION_SCHEMA);
 for(const table of ['regions','apartment_complexes','apartment_buildings','apartment_building_inventory','apartment_master_records','apartment_aliases','apartment_identity','apartment_identity_addresses','road_addresses','parcel_coordinates','apartment_parcels','apartment_entrances']){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  for(const operation of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS housing_invalidate_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN DELETE FROM housing_identity_meta WHERE key='generation'; END;`);
 }
}
function generation(db){
 if(!has(db,'housing_identity_meta'))return null;
 const saved=db.prepare("SELECT value FROM housing_identity_meta WHERE key='generation'").get();
 if(!saved)throw Error('주거 식별 정보가 원천 거래·대장·주소 변경으로 만료됐습니다. 공통 식별 정보 재구성을 먼저 실행하세요.');
 return JSON.parse(saved.value);
}

function registryCohorts(db,information){
 const infoById=new Map(information.map(row=>[row.apartment_id,row]));
 const masters=new Map(all(db,'apartment_complexes').filter(row=>row.active).map(row=>[row.apartment_id,row]));
 const storedBuildings=new Map(all(db,'apartment_buildings').map(row=>[row.building_id,row]));
 const regions=all(db,'regions');
 const aliases=new Map();
 for(const alias of all(db,'apartment_aliases').filter(row=>!clean(row.source).startsWith('국토교통부 실거래'))){if(!aliases.has(alias.apartment_id))aliases.set(alias.apartment_id,[]);aliases.get(alias.apartment_id).push(alias.name);}
 const records=all(db,'apartment_building_inventory').filter(row=>row.active).map(row=>({...row,...parseJson(row.record_json,{})})).filter(row=>row.title&&usableResidential(row));
 const roadCodes=new Map();
 for(const record of records){const road=normalizeRoadAddress(record.title.newPlatPlc||storedBuildings.get(record.building_id)?.road_address),codes=registryCoordinateCodes(record.title);if(!road||!codes)continue;const key='hub:'+record.root_id+'|'+road;if(!roadCodes.has(key))roadCodes.set(key,new Set());roadCodes.get(key).add(officialAddressKey(codes));}
 const cohorts=new Map(),buildingIndex=new Map();
 for(const record of records){
  const title=record.title,root_id='hub:'+clean(record.root_id||record.parent_id||record.building_id),master=masters.get(root_id),info=infoById.get(root_id),stored=storedBuildings.get(record.building_id);
  const region_code=record.scope?.region_code||record.legal_code.slice(0,5),dong=record.scope?.dong||master?.dong||'',region_name=record.scope?.region_name||info?.region_name||regions.find(row=>row.region_code===region_code)?.region_name||'';
  const road=clean(title.newPlatPlc||stored?.road_address),normalizedRoad=normalizeRoadAddress(road),codes=registryCoordinateCodes(title),lot=parcel(title),normalizedLot=normalizeParcel(lot?.jibun||stored?.jibun);
  const equivalentCodes=roadCodes.get(root_id+'|'+normalizedRoad),addressKey=officialAddressKey(codes)||(equivalentCodes?.size===1?[...equivalentCodes][0]:null)||(normalizedRoad?'road:'+normalizedRoad:normalizedLot?'parcel:'+record.legal_code+'|'+normalizedLot:'building:'+record.building_id);
  const cohort_id='cohort:'+root_id+':'+digest(addressKey).slice(0,20);
  if(!cohorts.has(cohort_id))cohorts.set(cohort_id,{cohort_id,root_id,master_id:master?root_id:null,region_code,region_name,dong,address_key:addressKey,road_addresses:[],parcels:[],building_ids:[],building_dongs:[],legal_types:[],buildings:[],names:[],regular:Boolean(master),location:{anchors:[],primary_parcels:[],roads:[],parcels:[]},entity_ids:[],partial_entity_ids:[]});
  const cohort=cohorts.get(cohort_id),building={building_id:record.building_id,dong:dongKey(title.dongNm||stored?.dong_name||title.bldNm||stored?.name),name:clean(title.bldNm||stored?.name||title.dongNm),year:Number(clean(title.useAprDay).slice(0,4))||stored?.build_year||null,road,parcel:normalizedLot,codes};
  cohort.buildings.push(building);buildingIndex.set(record.building_id,cohort);
  cohort.names.push(building.name,info?.canonical_name,master?.name,...(aliases.get(root_id)||[]));
  cohort.road_addresses.push(road);cohort.parcels.push(normalizedLot);cohort.building_ids.push(record.building_id);cohort.building_dongs.push(building.dong);cohort.legal_types.push(...legalTypes(title,record.classification));
  if(normalizedRoad)cohort.location.roads.push({building_id:record.building_id,road_address:road,road_key:normalizedRoad,codes,source:'건축HUB 건축물대장'});
 }
 for(const entry of all(db,'apartment_entrances')){const cohort=buildingIndex.get(entry.building_id);if(!cohort||!position(entry))continue;cohort.location.anchors.push({longitude:entry.longitude,latitude:entry.latitude,source:entry.source||'주소정보누리집 좌표 API',crs:'EPSG:4326',source_crs:'EPSG:4326',original_crs:'EPSG:5179',role:'entrance',building_id:entry.building_id,observed_at:entry.fetched_at,uncertainty_m:null});}
 const parcelRows=all(db,'apartment_parcels');
 for(const cohort of cohorts.values()){
  for(const row of parcelRows.filter(row=>row.apartment_id===cohort.master_id)){
   if(row.relation==='primary'&&!cohort.parcels.includes(normalizeParcel(row.jibun)))continue;
   const value={pnu:row.pnu,jibun:row.jibun,geometry:row.boundary_status==='exact'?parseJson(row.geometry_json,null):null,relation:row.relation,source:row.boundary_source||'건축HUB 건축물대장',observed_at:row.fetched_at};
   cohort.location.parcels.push(value);if(row.relation==='primary'&&value.geometry)cohort.location.primary_parcels.push(value);
  }
  for(const key of ['names','road_addresses','parcels','building_ids','building_dongs','legal_types'])cohort[key]=unique(cohort[key]);
 }
 return [...cohorts.values()];
}

function matchEntity(entity,available,road){
 const years=unique(entity.rows.map(row=>row.build_year).filter(Number.isFinite)),year=years.length===1?years[0]:null;
 const observed=unique(entity.rows.map(row=>row.building_dong));
 const family=available.filter(cohort=>cohort.region_code===entity.region_code&&cohort.dong===entity.dong&&compatibleName(entity.apartment,cohort.names)&&phaseAgrees(entity.apartment,cohort.buildings.map(row=>row.name))&&yearAgrees(cohort.buildings.map(row=>row.year).filter(Boolean),year));
 const lot=normalizeParcel(entity.jibun),rawRoad=normalizeRoadAddress(road),witnesses=cohort=>observed.filter(dong=>cohort.building_dongs.includes(dong));
 const sourceHasBuilding=observed.length>0;
 const namedDong=clean(entity.apartment).match(/(?:\(|\s)(?:제)?(\d+)동\)?$/)?.[1];
 const aggregateTitle=cohort=>cohort.buildings.length===1&&cohort.buildings[0].dong===nameKey(cohort.buildings[0].name)&&!/^\d+$/.test(cohort.buildings[0].dong);
 let physicalCandidates=available.filter(cohort=>cohort.regular&&cohort.region_code===entity.region_code&&cohort.dong===entity.dong&&phaseAgrees(entity.apartment,cohort.buildings.map(row=>row.name))&&yearAgrees(cohort.buildings.map(row=>row.year).filter(Boolean),year)&&Boolean(lot&&cohort.parcels.includes(lot)||rawRoad&&cohort.road_addresses.some(value=>normalizeRoadAddress(value)===rawRoad))&&(!sourceHasBuilding||witnesses(cohort).length||aggregateTitle(cohort))&&(!namedDong||cohort.building_dongs.includes(namedDong)||aggregateTitle(cohort)));
 const exactParcelCandidates=physicalCandidates.filter(cohort=>lot&&cohort.parcels.includes(lot));if(exactParcelCandidates.length)physicalCandidates=exactParcelCandidates;
 let seeds=family.filter(cohort=>{
  const physical=Boolean(lot&&cohort.parcels.includes(lot)||rawRoad&&cohort.road_addresses.some(value=>normalizeRoadAddress(value)===rawRoad));
  return physical&&(!sourceHasBuilding||witnesses(cohort).length>0)&&(!cohort.regular?exactName(entity.apartment,cohort.names):true);
 });
 let method='registered_address_membership';
 if(!seeds.length&&physicalCandidates.length===1){
  const candidate=physicalCandidates[0],exactYear=year&&candidate.buildings.some(building=>building.year===year);
  if(witnesses(candidate).length>=2||exactYear||namedDong){seeds=[candidate];method='unique_registered_address_and_components';}
 }
 if(!seeds.length&&!lot){
  seeds=family.filter(cohort=>exactName(entity.apartment,cohort.names)&&cohort.road_addresses.length&&year&&cohort.buildings.some(row=>row.year===year)&&observed.length>=2&&observed.every(dong=>cohort.building_dongs.includes(dong)));
  if(seeds.length===1)method='registry_building_series';else seeds=[];
 }
 if(!seeds.length)return {state:'insufficient',method:'no_independent_membership',members:[],evidence:{reported_parcel:entity.jibun,reported_years:years,building_witnesses:observed,candidate_ids:family.map(row=>row.cohort_id)}};
 if(namedDong)seeds=seeds.filter(cohort=>cohort.building_dongs.includes(namedDong)||aggregateTitle(cohort));
 if(!sourceHasBuilding&&seeds.length>1)return {state:'ambiguous',method:'multiple_address_units',members:[],evidence:{candidate_ids:seeds.map(row=>row.cohort_id)}};
 const members=new Map(seeds.map(row=>[row.cohort_id,row]));
 for(const dong of observed){const matches=available.filter(cohort=>(family.includes(cohort)||physicalCandidates.includes(cohort))&&cohort.building_dongs.includes(dong));if(matches.length===1)members.set(matches[0].cohort_id,matches[0]);}
 const selected=[...members.values()],aggregate=selected.length===1&&aggregateTitle(selected[0]);
 const unknown=aggregate?[]:observed.filter(dong=>!selected.some(cohort=>cohort.building_dongs.includes(dong)));
 const ambiguous=observed.filter(dong=>selected.filter(cohort=>cohort.building_dongs.includes(dong)).length>1);
 return {state:unknown.length||ambiguous.length?'partial':'verified',method:selected.length>1?'building_series_membership':method,members:selected,evidence:{reported_parcel:entity.jibun,reported_years:years,aggregate_title:aggregate,building_witnesses:observed,unknown_buildings:unknown,ambiguous_buildings:ambiguous,member_buildings:selected.map(cohort=>({cohort_id:cohort.cohort_id,registered_building_ids:cohort.building_ids,witness_building_ids:cohort.buildings.filter(building=>observed.includes(building.dong)).map(building=>building.building_id),roads:cohort.road_addresses,parcels:cohort.parcels,years:unique(cohort.buildings.map(row=>row.year))}))}};
}

function favorite(row,ref,coverage,related=[]){
 return {region_code:row.region_code,region_name:row.region_name,apartment:row.apartment,dong:row.dong,jibun:row.jibun||'',road_address:row.road_address||'',id:ref.id,key:tradeKey(row),...(row.master_id?{master_id:row.master_id}:{}),trade_keys:row.trade_keys||[],name_aliases:row.name_aliases||[row.apartment],identity_ref:ref,identity_coverage:coverage,identity_related_sources:related,...(ref.kind==='source'?{identity_reported_buildings:unique((row.rows||[]).map(item=>item.building_dong))}:{})};
}

export function rebuildHousingIdentity(db,{information=[],scopes,now=new Date().toISOString()}={}){
 ensureSchema(db);db.exec('SAVEPOINT housing_identity_refresh');
 try{
  const rows=has(db,'trades')?db.prepare('SELECT id,region_code,dong,jibun,apartment,build_year,raw_json FROM trades ORDER BY id').all():[];
  const cohorts=registryCohorts(db,information),groups=new Map(),regions=all(db,'regions');
  const roads=new Map(all(db,'road_addresses').map(row=>[JSON.stringify([row.region_code,row.dong,normalizeParcel(row.jibun)]),row.road_address]));
  const sourcePositions=all(db,'parcel_coordinates');
  for(const row of rows){const raw=parseJson(row.raw_json,{});row.building_dong=dongKey(raw.aptDong);const id=sourceId(row);if(!groups.has(id))groups.set(id,{entity_id:id,region_code:row.region_code,region_name:regions.find(region=>region.region_code===row.region_code)?.region_name||information.find(info=>info.region_code===row.region_code)?.region_name||'',dong:row.dong,jibun:row.jibun,apartment:row.apartment,rows:[]});groups.get(id).rows.push(row);}
  const entities=[],bindings=[];
  for(const entity of groups.values()){
   const road=roads.get(JSON.stringify([entity.region_code,entity.dong,normalizeParcel(entity.jibun)]))||'';
   const result=scoped(entity,scopes)?matchEntity(entity,cohorts,road):{state:'out_of_scope',method:'outside_inventory_scope',members:[],evidence:{}};
   const entityBindings=[];
   for(const row of entity.rows){
    let binding={entity_id:entity.entity_id,precision:'unresolved',root_id:null,cohort_id:null,building_id:null},method=result.method;
    if(result.members.length){
     if(!row.building_dong&&result.state==='verified')binding.precision='complex';
     else if(row.building_dong){const candidates=result.members.flatMap(cohort=>cohort.buildings.filter(building=>building.dong===row.building_dong).map(building=>({cohort,building})));const units=unique(candidates.map(candidate=>candidate.cohort.cohort_id));if(units.length===1){const selected=candidates[0];binding={...binding,precision:candidates.length===1?'building':'cohort',root_id:selected.cohort.root_id,cohort_id:selected.cohort.cohort_id,building_id:candidates.length===1?selected.building.building_id:null};method='published_building_membership';}else if(result.state==='verified'&&result.evidence.aggregate_title){const cohort=result.members[0];binding={...binding,precision:'cohort',root_id:cohort.root_id,cohort_id:cohort.cohort_id};method='aggregate_registry_title';}}
    }
    bindings.push({trade_id:row.id,...binding,method,evidence:{building_dong:row.building_dong,entity_method:result.method}});entityBindings.push(binding);
   }
   const counts={building:0,cohort:0,complex:0,unresolved:0};for(const binding of entityBindings)counts[binding.precision]++;
   const cohort_ids=unique(result.members.map(cohort=>cohort.cohort_id)),root_ids=unique(result.members.map(cohort=>cohort.root_id)),legal_types=unique(result.members.flatMap(cohort=>cohort.legal_types));
   const displayRoad=result.members.length===1?result.members[0].road_addresses[0]||road:road;
   const names=unique([entity.apartment,...result.members.flatMap(cohort=>cohort.names).filter(name=>phaseAgrees(entity.apartment,[name]))]);
   const item={entity_id:entity.entity_id,favorite:favorite({...entity,road_address:displayRoad,name_aliases:names,trade_keys:[tradeKey(entity)]},{kind:'source',id:entity.entity_id},{entity_ids:[entity.entity_id],cohort_ids,root_ids}),state:result.state,method:result.method,cohort_ids,root_ids,legal_types,row_count:entity.rows.length,precision_counts:counts,evidence:result.evidence};
   entities.push(item);
   for(const cohort of result.members){
    if(item.state==='verified'&&cohort_ids.length===1)cohort.entity_ids.push(entity.entity_id);else cohort.partial_entity_ids.push(entity.entity_id);
    const cached=sourcePositions.find(row=>row.region_code===entity.region_code&&row.dong===entity.dong&&normalizeParcel(row.jibun)===normalizeParcel(entity.jibun));
    if(cached&&position(cached)&&!cohort.location.anchors.length&&cohort.parcels.includes(normalizeParcel(cached.jibun)))cohort.location.anchors.push({longitude:cached.longitude,latitude:cached.latitude,source:'주소정보누리집 좌표 API',crs:'EPSG:4326',source_crs:'EPSG:4326',original_crs:cached.source_crs,role:'entrance',anchor_scope:'address',building_id:cached.building_id||null,observed_at:cached.fetched_at,uncertainty_m:null});
   }
  }
  for(const entity of entities){
   entity.favorite.identity_listing_members=entity.cohort_ids.map(cohort_id=>{
    const cohort=cohorts.find(item=>item.cohort_id===cohort_id),member=entity.evidence.member_buildings?.find(item=>item.cohort_id===cohort_id);
    const witnessed=member?.witness_building_ids||[],others=entities.filter(item=>item!==entity&&item.cohort_ids.includes(cohort_id));
    const conflicting=others.some(other=>{const ids=other.evidence.member_buildings?.find(item=>item.cohort_id===cohort_id)?.witness_building_ids||[];return ids.length&&witnessed.length&&!ids.some(id=>witnessed.includes(id));});
    return conflicting?{cohort_id,whole_cohort:false,building_dongs:unique(cohort.buildings.filter(building=>witnessed.includes(building.building_id)).map(building=>building.dong))}:listingBuildingMembers([cohort])[0];
   });
  }
  const used=new Set(entities.flatMap(entity=>entity.cohort_ids));
  const publicCohorts=cohorts.filter(cohort=>cohort.regular||used.has(cohort.cohort_id)).map(cohort=>{
   const matched=entities.filter(entity=>entity.cohort_ids.includes(cohort.cohort_id)),info=information.find(row=>row.apartment_id===cohort.master_id),base=info?.canonical_name||cohort.names[0]||'주거 건물';
   cohort.entity_ids=unique(cohort.entity_ids);cohort.partial_entity_ids=unique(cohort.partial_entity_ids);
   const coverage={entity_ids:cohort.entity_ids,cohort_ids:[cohort.cohort_id],root_ids:[cohort.root_id]};
   const item={cohort_id:cohort.cohort_id,root_id:cohort.root_id,master_id:cohort.master_id,favorite:favorite({region_code:cohort.region_code,region_name:cohort.region_name,dong:cohort.dong,jibun:cohort.parcels[0]||'',road_address:cohort.road_addresses[0]||'',apartment:base,master_id:cohort.master_id,name_aliases:unique([...cohort.names,...matched.map(entity=>entity.favorite.apartment)]),trade_keys:unique(matched.map(entity=>entity.favorite.key))},{kind:'cohort',id:cohort.cohort_id},coverage,cohort.partial_entity_ids),road_addresses:cohort.road_addresses,parcels:cohort.parcels,building_ids:cohort.building_ids,building_dongs:cohort.building_dongs,legal_types:cohort.legal_types,location:cohort.location,entity_ids:cohort.entity_ids,partial_entity_ids:cohort.partial_entity_ids};
   return item;
  });
  const roots=unique(publicCohorts.map(cohort=>cohort.root_id)).map(root_id=>{const items=publicCohorts.filter(cohort=>cohort.root_id===root_id),contained=entities.filter(entity=>entity.state==='verified'&&entity.root_ids.length===1&&entity.root_ids[0]===root_id).map(entity=>entity.entity_id),partial=entities.filter(entity=>entity.root_ids.includes(root_id)&&!contained.includes(entity.entity_id)).map(entity=>entity.entity_id);return {root_id,cohort_ids:items.map(item=>item.cohort_id),entity_ids:contained,partial_entity_ids:partial};});
  db.exec('DELETE FROM housing_identity_bindings; DELETE FROM housing_identity_members; DELETE FROM housing_identity_entities; DELETE FROM housing_identity_cohorts;');
  const saveEntity=db.prepare('INSERT INTO housing_identity_entities VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(const entity of entities)saveEntity.run(entity.entity_id,JSON.stringify(entity.favorite),entity.state,entity.method,JSON.stringify(entity.cohort_ids),JSON.stringify(entity.root_ids),JSON.stringify(entity.legal_types),entity.row_count,JSON.stringify(entity.precision_counts),JSON.stringify(entity.evidence),now);
  const saveCohort=db.prepare('INSERT INTO housing_identity_cohorts VALUES(?,?,?,?,?)');for(const cohort of publicCohorts)saveCohort.run(cohort.cohort_id,cohort.root_id,cohort.master_id,JSON.stringify(cohort),now);
  const saveMember=db.prepare('INSERT INTO housing_identity_members VALUES(?,?,?,?)');for(const entity of entities)for(const id of entity.cohort_ids)saveMember.run(entity.entity_id,id,entity.method,JSON.stringify(entity.evidence));
  const saveBinding=db.prepare('INSERT INTO housing_identity_bindings VALUES(?,?,?,?,?,?,?,?)');for(const binding of bindings)saveBinding.run(binding.trade_id,binding.entity_id,binding.precision,binding.root_id,binding.cohort_id,binding.building_id,binding.method,JSON.stringify(binding.evidence));
  if(bindings.length!==rows.length||new Set(bindings.map(binding=>binding.trade_id)).size!==rows.length||entities.reduce((count,entity)=>count+entity.row_count,0)!==rows.length)throw Error('주거 식별 정보의 거래 원본 보존 검사 실패');
  const metadata={version:1,generated_at:now,row_count:rows.length,roots,source_fingerprint:digest(JSON.stringify(rows.map(row=>[row.id,sourceId(row),row.build_year,row.building_dong])))};
  db.prepare("INSERT OR REPLACE INTO housing_identity_meta VALUES('generation',?)").run(JSON.stringify(metadata));
  db.exec('RELEASE housing_identity_refresh');
  return housingIdentityStats(db);
 }catch(error){db.exec('ROLLBACK TO housing_identity_refresh; RELEASE housing_identity_refresh');throw error;}
}

export function housingIdentityCatalog(db){
 if(!has(db,'housing_identity_meta'))return {version:1,entities:[],cohorts:[],roots:[]};
 const meta=generation(db),entities=db.prepare('SELECT * FROM housing_identity_entities ORDER BY entity_id').all().map(row=>({entity_id:row.entity_id,favorite:JSON.parse(row.favorite_json),state:row.state,method:row.method,cohort_ids:JSON.parse(row.cohort_ids_json),root_ids:JSON.parse(row.root_ids_json),legal_types:JSON.parse(row.legal_types_json),row_count:row.row_count,precision_counts:JSON.parse(row.precision_counts_json)}));
 return {version:1,entities,cohorts:db.prepare('SELECT data_json FROM housing_identity_cohorts ORDER BY cohort_id').all().map(row=>JSON.parse(row.data_json)),roots:meta.roots};
}
export function housingTradeBindings(db){
 if(!has(db,'housing_identity_meta'))return new Map();generation(db);
 return new Map(db.prepare('SELECT trade_id,entity_id,precision,root_id,cohort_id,building_id FROM housing_identity_bindings ORDER BY trade_id').all().map(({trade_id,...binding})=>[trade_id,binding]));
}
export function housingIdentityStats(db){
 if(!has(db,'housing_identity_meta'))return {version:1,row_count:0,entity_count:0,cohort_count:0,precision_counts:{building:0,cohort:0,complex:0,unresolved:0},states:{},methods:{}};
 const meta=generation(db),states={},methods={},precision_counts={building:0,cohort:0,complex:0,unresolved:0};
 for(const row of db.prepare('SELECT state,count(*) n FROM housing_identity_entities GROUP BY state').all())states[row.state]=row.n;
 for(const row of db.prepare('SELECT method,count(*) n FROM housing_identity_entities GROUP BY method').all())methods[row.method]=row.n;
 for(const row of db.prepare('SELECT precision,count(*) n FROM housing_identity_bindings GROUP BY precision').all())precision_counts[row.precision]=row.n;
 return {version:1,row_count:meta.row_count,entity_count:Object.values(states).reduce((sum,count)=>sum+count,0),cohort_count:db.prepare('SELECT count(*) n FROM housing_identity_cohorts').get().n,precision_counts,states,methods,source_fingerprint:meta.source_fingerprint,generated_at:meta.generated_at};
}
