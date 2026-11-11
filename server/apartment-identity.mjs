import fs from 'node:fs';
import {initializeApartmentIdentity} from './apartment-identity-schema.mjs';
import {createHash} from 'node:crypto';
import {readApartmentSpatialContext,scopeApartmentSpatialContext} from './apartment-spatial.mjs';
import {housingQueryInformation} from './housing-export.mjs';
import {validListingSnapshot} from '../src/naver-listings.mjs';
import {readInstalledBaseline} from './apartment-baseline-state.mjs';
import {deriveBaselineHousing,baselineApartmentInformation} from './apartment-baseline-runtime.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {normalizeRoadAddress,normalizeParcel} from '../src/address-identity.mjs';
import {rebuildHousingIdentity,housingIdentityCatalog,housingTradeBindings,housingIdentityStats} from './housing-identity.mjs';
export {housingIdentityCatalog,housingTradeBindings,housingIdentityStats};
export {readNaverMatch,naverMatchStats} from './apartment-naver-matches.mjs';
export function synchronizeHousingIdentity(db,options={}) {
  if(readInstalledBaseline(db))return deriveBaselineHousing(db);
  synchronizeApartmentIdentity(db,options);
  let scopes=options.scopes;
  if(scopes===undefined){
    const config=JSON.parse(fs.readFileSync(new URL('../automation/config.json',import.meta.url),'utf8'));
    scopes=db.prepare('SELECT region_id,region_code,dongs_json FROM regions').all().filter(row=>config.region_ids.includes(row.region_id));
  }
  return rebuildHousingIdentity(db,{...options,scopes,information:apartmentInformation(db)});
}

const has=(db,name)=>Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name));
const clean=value=>String(value||'').trim();
export const identityName=value=>clean(value).toLowerCase().replace(/[\s()[\]·.,_-]|아파트/g,'').replace(/(\d+)차/g,'$1');
const road=normalizeRoadAddress;
const zip=value=>/^\d{5}$/.test(clean(value))?clean(value):null;
const addressParcel=(value,regionName,dong)=>{
  const prefix=String(regionName+' '+dong).replace(/\s/g,''),address=String(value||'').replace(/\s/g,'');
  return address.startsWith(prefix)?normalizeParcel(address.slice(prefix.length).match(/^(?:산)?\d+(?:-\d+)?/)?.[0]):null;
};
export const apartmentAliasOverrides=()=>JSON.parse(fs.readFileSync(new URL('../automation/apartment-aliases.json',import.meta.url),'utf8'));

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function readRootInformation(db,{activeOnly=true,contexts=readApartmentSpatialContext(db)}={}) {
  if(!has(db,'apartment_information'))return [];
  const modern=db.prepare('PRAGMA table_info(apartment_information)').all().some(row=>row.name==='scope_kind');
  return db.prepare('SELECT * FROM apartment_information WHERE '+(modern?"scope_kind='root' AND ":'')+(activeOnly?'active=1':'1')+' ORDER BY apartment_id').all().map(({name_aliases_json,sources_json,classification_evidence_json,root_ids_json,...row})=>{
    const context=contexts.get(row.apartment_id);
    return {...row,selection_id:row.apartment_id,scope_kind:'root',root_ids:root_ids_json?JSON.parse(root_ids_json):[row.apartment_id],name_aliases:JSON.parse(name_aliases_json),sources:JSON.parse(sources_json),classification_evidence:JSON.parse(classification_evidence_json||'{}'),
      ...(context?{...context.facts,residential_status:context.residential_status,location:context.location,area:context.area,primary_building_id:context.primary_building_id,primary_entrance_index:context.primary_entrance_index}:{}),
      trade_keys:has(db,'apartment_trade_links')?db.prepare("SELECT dong,jibun,trade_name FROM apartment_trade_links WHERE region_code=? AND status='matched' AND (apartment_id=? OR (method='shared_registry_address' AND EXISTS(SELECT 1 FROM json_each(candidates_json) WHERE value=?)))").all(row.region_code,row.apartment_id,row.apartment_id).map(t=>JSON.stringify([t.dong,t.jibun,t.trade_name])):[],addresses:db.prepare('SELECT * FROM apartment_identity_addresses WHERE apartment_id=? ORDER BY road_address,building_management_no').all(row.apartment_id)};
  });
}

export function apartmentInformation(db,{activeOnly=true,kind='root',geometry='summary'}={}) {
  if(!['root','cohort','source','all'].includes(kind)||!['summary','full'].includes(geometry))throw Error('공통 아파트 정보의 조회 범위를 확인하세요.');
  if(readInstalledBaseline(db))return baselineApartmentInformation(db).apartments.filter(item=>(!activeOnly||item.active!==false)&&(kind==='all'||item.identity_ref.kind===kind)).map(item=>({...item,canonical_name:item.apartment,apartment_id:item.identity_ref.kind==='root'?item.id:item.master_id||null,selection_id:item.id,scope_kind:item.identity_ref.kind}));
  if(kind==='root'){
    const contexts=readApartmentSpatialContext(db,{geometry});
    return readRootInformation(db,{activeOnly,contexts}).map(row=>({...row,...(geometry==='full'?{boundaries:contexts.get(row.apartment_id)?.boundaries}:{})}));
  }
  const catalog=publicApartmentInformation(db),contexts=geometry==='full'?readApartmentSpatialContext(db,{geometry}):null;
  const housing=contexts?housingIdentityCatalog(db):null,cohorts=new Map((housing?.cohorts||[]).map(cohort=>[cohort.cohort_id,cohort]));
  const scoped=cohort=>cohort&&contexts.has(cohort.root_id)?scopeApartmentSpatialContext(contexts.get(cohort.root_id),cohort).boundaries?.features||[]:[];
  return catalog.apartments.filter(item=>(!activeOnly||item.active!==false)&&(kind==='all'||item.identity_ref.kind===kind)).map(item=>{
    let boundaries;
    if(contexts){
      const source=item.identity_ref.kind==='source'?housing.entities.find(entity=>entity.entity_id===item.id&&entity.state==='verified'):null;
      const features=item.identity_ref.kind==='root'?contexts.get(item.id)?.boundaries?.features||[]:item.identity_ref.kind==='cohort'?scoped(cohorts.get(item.id)):source?.cohort_ids.flatMap(id=>scoped(cohorts.get(id)))||[];
      boundaries={type:'FeatureCollection',features:[...new Map(features.map(feature=>[feature.id,feature])).values()]};
    }
    return {...item,canonical_name:item.apartment,apartment_id:item.identity_ref.kind==='root'?item.id:item.master_id||(item.root_ids.length===1?item.root_ids[0]:null),selection_id:item.id,scope_kind:item.identity_ref.kind,...(boundaries?{boundaries}:{})};
  });
}

export function synchronizeApartmentIdentity(db,{snapshot,overrides=apartmentAliasOverrides(),apartmentIds,now=new Date().toISOString()}={}) {
  if(readInstalledBaseline(db))throw Error('로컬 확정 기준본의 아파트 정보는 원격에서 갱신할 수 없습니다.');
  if(!has(db,'apartment_complexes'))return {apartments:0,withPostalCode:0};
  if(snapshot&&!validListingSnapshot(snapshot))throw Error('아파트 정보에 연결할 매물 스냅샷 검증 실패');
  if(!Array.isArray(overrides)||overrides.some(row=>!row||!Array.isArray(row.names)||[row.canonical_name,...row.names].some(name=>typeof name!=='string'||!name.trim()||name.length>500)||!row.source))throw Error('검토한 아파트 별칭 형식을 확인하세요.');
  initializeApartmentIdentity(db);
  const old=new Map(apartmentInformation(db,{activeOnly:false}).map(row=>[row.apartment_id,row]));
  const complexes=db.prepare('SELECT * FROM apartment_complexes ORDER BY apartment_id').all();
  const regions=has(db,'regions')?db.prepare('SELECT region_code,region_name FROM regions ORDER BY rowid').all():[];
  const lookups=has(db,'address_lookups')?db.prepare("SELECT * FROM address_lookups WHERE status IN ('exact','ambiguous')").all():[];
  const trades=has(db,'apartment_trade_links')?db.prepare("SELECT * FROM apartment_trade_links WHERE status='matched'").all():[];
  const parcels=has(db,'apartment_parcels')?db.prepare('SELECT apartment_id,legal_code,jibun FROM apartment_parcels').all():[];
  const spatial=readApartmentSpatialContext(db);
  const observations=new Map((snapshot?.groups||[]).map(group=>[group.favorite.id,group]));
  if(has(db,'naver_listing_snapshots'))for(const row of db.prepare('SELECT group_json FROM naver_listing_snapshots').all()){
    const group=JSON.parse(row.group_json);
    if(!validListingSnapshot({version:1,source:'naver-land',generatedAt:now,groups:[group]}))throw Error('아파트 정보에 연결할 저장 매물 검증 실패');
    const previous=observations.get(group.favorite.id);
    if(!previous||group.attemptedAt>=previous.attemptedAt)observations.set(group.favorite.id,group);
  }
  const addAlias=db.prepare('INSERT OR IGNORE INTO apartment_aliases(apartment_id,name,source) VALUES(?,?,?)');
  const fields=['apartment_id','canonical_name','region_code','region_name','legal_code','dong','jibun','road_address','postal_code','postal_source','naver_complex_no','naver_name','active','sources_json','residential_status','primary_building_id','primary_entrance_index','spatial_generation','classification_evidence_json'];
  const save=db.prepare(`INSERT INTO apartment_identity(${fields.join(',')},updated_at) VALUES(${fields.map(()=>'?').join(',')},?) ON CONFLICT(apartment_id) DO UPDATE SET ${fields.slice(1).map(name=>`${name}=excluded.${name}`).join(',')},updated_at=excluded.updated_at`);
  const saveAddress=db.prepare('INSERT INTO apartment_identity_addresses VALUES(?,?,?,?,?,?,?,?)');
  db.exec('SAVEPOINT apartment_identity_refresh');
  try{
    for(const c of complexes.filter(row=>!apartmentIds||apartmentIds.includes(row.apartment_id))){
      const regionName=regions.find(row=>row.region_code===c.region_code)?.region_name||old.get(c.apartment_id)?.region_name||'';
      const attached=parcels.filter(row=>row.apartment_id===c.apartment_id&&row.legal_code===c.legal_code).map(row=>row.jibun);
      const jibus=new Set([c.jibun,...attached].map(normalizeParcel).filter(Boolean));
      const addresses=[];
      for(const lookup of lookups.filter(row=>row.region_code===c.region_code&&row.dong===c.dong&&jibus.has(normalizeParcel(row.jibun)))){
        let payload;try{payload=JSON.parse(lookup.response_json);}catch{continue;}
        if(String(payload?.results?.common?.errorCode)!=='0'||!Array.isArray(payload.results.juso))continue;
        for(const item of payload.results.juso){
          if(!item||typeof item.jibunAddr!=='string'||addressParcel(item.jibunAddr,regionName,c.dong)!==normalizeParcel(lookup.jibun)||!clean(item.roadAddr))continue;
          addresses.push({road_address:clean(item.roadAddr),jibun_address:clean(item.jibunAddr),postal_code:zip(item.zipNo),building_management_no:clean(item.bdMgtSn),road_code:clean(item.rnMgtSn),source:'주소정보누리집',observed_at:lookup.fetched_at});
          if(clean(item.bdNm))addAlias.run(c.apartment_id,clean(item.bdNm),'주소정보누리집 · 지번 검증');
        }
      }
      if(c.name)addAlias.run(c.apartment_id,c.name,c.source);
      for(const trade of trades.filter(row=>row.apartment_id===c.apartment_id||(row.method==='shared_registry_address'&&JSON.parse(row.candidates_json).includes(c.apartment_id))))addAlias.run(c.apartment_id,trade.trade_name,'국토교통부 실거래 · 주소 연결');
      let canonicalName=c.name||old.get(c.apartment_id)?.canonical_name||`단지명 미확인 (${c.dong} ${c.jibun})`;
      for(const override of overrides.filter(row=>row.apartment_id===c.apartment_id)){
        if(override.region_code!==c.region_code||override.dong!==c.dong||normalizeParcel(override.jibun)!==normalizeParcel(c.jibun))throw Error('아파트 별칭의 검증 주소가 대장과 다릅니다.');
        canonicalName=override.canonical_name;
        for(const name of [canonicalName,...override.names])addAlias.run(c.apartment_id,name,override.source);
      }
      const verified=[...observations.values()].filter(group=>group.status==='ready'&&group.collectedAt&&group.favorite.region_code===c.region_code&&group.favorite.dong===c.dong&&jibus.has(normalizeParcel(group.favorite.jibun))&&(group.favorite.master_id===c.apartment_id||(!group.favorite.master_id&&complexes.filter(other=>other.active&&other.region_code===c.region_code&&other.dong===c.dong&&normalizeParcel(other.jibun)===normalizeParcel(group.favorite.jibun)).length===1)));
      const latest=verified.sort((a,b)=>b.collectedAt.localeCompare(a.collectedAt))[0];
      if(latest)addAlias.run(c.apartment_id,latest.complexName,'네이버 부동산 · 주소 검증');
      const primary=addresses.filter(item=>road(item.road_address)===road(c.road_address));
      const postals=[...new Set((primary.length?primary:addresses).map(item=>item.postal_code).filter(Boolean))];
      const postal=postals.length===1&&(primary.length?primary:addresses).every(item=>item.postal_code===postals[0])?postals[0]:null;
      const sources=JSON.stringify({name:overrides.find(row=>row.apartment_id===c.apartment_id)?.source||c.source,address:addresses.length?'주소정보누리집':c.source,postal:postal?'주소정보누리집':null,naver:latest?'주소 검증한 브라우저 관찰':old.get(c.apartment_id)?.sources.naver||null});
      const context=spatial.get(c.apartment_id),evidence={buildings:context?.buildings.map(item=>({building_id:item.building_id,classification:item.classification}))||[]};
      const values=[c.apartment_id,canonicalName,c.region_code,regionName,c.legal_code,c.dong,c.jibun,c.road_address,postal,postal?'주소정보누리집':null,latest?.complexNo||old.get(c.apartment_id)?.naver_complex_no||null,latest?.complexName||old.get(c.apartment_id)?.naver_name||null,c.active,sources,context?.residential_status||'unresolved',context?.primary_building_id||null,context?.primary_entrance_index??null,digest(context?{location:context.location,area:context.area,facts:context.facts}:{}),JSON.stringify(evidence)];
      const previous=old.get(c.apartment_id);
      const unchanged=previous&&fields.every((name,index)=>(name==='sources_json'?JSON.stringify(previous.sources):name==='classification_evidence_json'?JSON.stringify(previous.classification_evidence):previous[name])===values[index]);
      save.run(...values,unchanged?previous.updated_at:now);
      db.prepare('DELETE FROM apartment_identity_addresses WHERE apartment_id=?').run(c.apartment_id);
      const unique=new Map(addresses.map(item=>[item.road_address+'|'+item.building_management_no,item]));
      for(const item of unique.values())saveAddress.run(c.apartment_id,item.road_address,item.jibun_address,item.postal_code,item.building_management_no,item.road_code,item.source,item.observed_at);
    }
    db.exec('RELEASE apartment_identity_refresh');
  }catch(error){db.exec('ROLLBACK TO apartment_identity_refresh; RELEASE apartment_identity_refresh');throw error;}
  const rows=apartmentInformation(db);
  return {apartments:rows.length,withPostalCode:rows.filter(row=>row.postal_code).length};
}

export function searchApartmentInformation(db,query,options={}) {
  const needle=identityName(query);
  return apartmentInformation(db,options).filter(row=>[row.canonical_name,...row.name_aliases,row.region_name+' '+row.dong+' '+row.jibun,row.road_address,row.postal_code,...row.addresses.map(item=>item.road_address)].some(value=>identityName(value).includes(needle)));
}

export function resolveApartmentIdentity(db,input,information=apartmentInformation(db)) {
  if(!input.master_id&&!(input.region_code&&input.dong&&input.jibun)&&!input.road_address)return {status:'insufficient',apartment_id:null,candidates:[]};
  const candidates=information.filter(row=>(!input.master_id||row.apartment_id===input.master_id)&&(!input.region_code||row.region_code===input.region_code)&&(!input.dong||row.dong===input.dong)&&(!input.jibun||normalizeParcel(input.jibun)&&(normalizeParcel(row.jibun)===normalizeParcel(input.jibun)||row.addresses.some(a=>addressParcel(a.jibun_address,row.region_name,row.dong)===normalizeParcel(input.jibun))))&&(!input.postal_code||[row.postal_code,...row.addresses.map(a=>a.postal_code)].includes(input.postal_code))&&(!input.road_address||road(input.road_address)&&[row.road_address,...row.addresses.map(a=>a.road_address)].some(value=>road(value)===road(input.road_address)))&&(input.master_id||[row.canonical_name,...row.name_aliases].some(name=>identityName(name)===identityName(input.apartment))));
  return {status:candidates.length===1?'matched':candidates.length?'ambiguous':'unmatched',apartment_id:candidates.length===1?candidates[0].apartment_id:null,candidates:candidates.map(row=>row.apartment_id)};
}

export function publicApartmentInformation(db) {
  if(readInstalledBaseline(db))return baselineApartmentInformation(db);
  const contexts=readApartmentSpatialContext(db),rows=readRootInformation(db,{activeOnly:false,contexts});
  const base={version:1,apartments:rows.map(row=>({...makeApartmentFavorite({apartment:row.canonical_name,dong:row.dong,jibun:row.jibun,road_address:row.road_address,master_id:row.apartment_id,trade_keys:row.trade_keys,identity_ref:{kind:'root',id:row.apartment_id}},row),name_aliases:row.name_aliases,postal_code:row.postal_code,naver_complex_no:row.naver_complex_no,addresses:row.addresses.map(({apartment_id,...address})=>address),sources:row.sources}))};
  const hasGeneration=has(db,'housing_identity_meta')&&db.prepare("SELECT 1 FROM housing_identity_meta WHERE key='generation'").get();
  if(!hasGeneration&&has(db,'housing_identity_entities')&&db.prepare('SELECT 1 FROM housing_identity_entities LIMIT 1').get())throw Error('공통 아파트 정보가 원천 변경으로 만료됐습니다. 식별 정보를 재구성하세요.');
  const housing=hasGeneration?housingIdentityCatalog(db):{entities:[],cohorts:[],roots:[]};
  const catalog=hasGeneration?housingQueryInformation(base,housing):base,byRoot=new Map(rows.map(row=>[row.apartment_id,row]));
  const cohorts=new Map(housing.cohorts.map(item=>[item.cohort_id,item]));
  const empty=id=>({residential_status:'unresolved',location:{status:'missing',precision:'unknown',latitude:null,longitude:null,building_id:null,entrance_index:null,source:null,observed_at:null,anchors:[]},area:{identity_ref:id,geometry_scope:null,legal_code:'',region_ids:[],parcels:[],boundary_refs:[],boundary_ids:[],bbox:null,zoning_refs:[]},facts:{}});
  const scoped=new Map(housing.cohorts.map(cohort=>[cohort.cohort_id,contexts.has(cohort.root_id)?scopeApartmentSpatialContext(contexts.get(cohort.root_id),cohort):empty({kind:'cohort',id:cohort.cohort_id})]));
  const apartments=catalog.apartments.map(item=>{
    const kind=item.identity_ref.kind,root=kind==='root'?byRoot.get(item.id):kind==='cohort'?byRoot.get(cohorts.get(item.id)?.root_id):null;
    let context=kind==='root'?contexts.get(item.id):kind==='cohort'?scoped.get(item.id):null;
    if(kind==='source'){
      const entity=housing.entities.find(entity=>entity.entity_id===item.id),members=entity?.state==='verified'?entity.cohort_ids.map(id=>scoped.get(id)).filter(Boolean):[];
      if(members.length===1)context=members[0];
      else if(members.length>1){
        const unique=(items,key)=>[...new Map(items.map(value=>[key(value),value])).values()];
        context=empty(item.identity_ref);context.residential_status='residential';
        context.location.status='ambiguous';
        context.area={...context.area,region_ids:[...new Set(members.flatMap(member=>member.area.region_ids))].sort(),parcels:unique(members.flatMap(member=>member.area.parcels),p=>p.pnu),boundary_refs:unique(members.flatMap(member=>member.area.boundary_refs),r=>r.id),zoning_refs:unique(members.flatMap(member=>member.area.zoning_refs),r=>r.id),geometry_scopes:unique(members.map(member=>member.area.geometry_scope).filter(Boolean),r=>r.id)};
      }
    }
    context||=empty(item.identity_ref);
    const area={...context.area,identity_ref:item.identity_ref,boundary_ids:context.area.boundary_refs.map(ref=>ref.id)};
    const active=root?Boolean(root.active):true,residential_status=context.residential_status;
    const memberRefs=kind==='root'?[item.identity_ref,...housing.cohorts.filter(c=>c.root_id===item.id).map(c=>({kind:'cohort',id:c.cohort_id})),...housing.entities.filter(e=>e.state==='verified'&&e.root_ids.length===1&&e.root_ids[0]===item.id).map(e=>({kind:'source',id:e.entity_id}))]:[item.identity_ref];
    const root_ids=item.identity_coverage?.root_ids||((kind==='root')?[item.id]:[]);
    return {...item,...context.facts,selection_id:item.id,scope_kind:kind,root_ids,active,residential_status,map_visible:kind==='root'&&active&&residential_status==='residential',map_member_refs:memberRefs,location:context.location,area,latitude:context.location.latitude,longitude:context.location.longitude,location_status:context.location.status==='confirmed'?'confirmed':'missing'};
  });
  return {version:1,schema_version:2,generation:digest({schema_version:2,apartments}),apartments};
}

export function apartmentMapInformation(db,{scopeIds=[],generation}={}){
  const catalog=publicApartmentInformation(db);
  if(generation&&generation!==catalog.generation)throw Error('공통 아파트 정보와 지도 자료의 생성 버전이 다릅니다.');
  const contexts=readApartmentSpatialContext(db,{geometry:'full'}),selected=new Set(scopeIds);
  const apartments=catalog.apartments.filter(item=>item.identity_ref.kind==='root'&&item.map_visible&&(!selected.size||item.area.region_ids.some(id=>selected.has(id))));
  const features=new Map();
  for(const item of apartments)for(const feature of contexts.get(item.id)?.boundaries?.features||[]){
    const previous=features.get(feature.id);
    if(previous){previous.properties.apartment_ids.push(item.id);previous.properties.shared_parcel=true;previous.properties.name=[previous.properties.name,item.apartment].filter(Boolean).join(' · ');}
    else features.set(feature.id,{...feature,properties:{...feature.properties,name:item.apartment,apartment_ids:[item.id]}});
  }
  for(const feature of features.values())if(feature.properties.apartment_ids.length>1){feature.properties.geometry_scopes=feature.properties.apartment_ids.map(id=>({kind:'root',id}));delete feature.properties.identity_ref;}
  return {apartments,boundaries:{type:'FeatureCollection',features:[...features.values()],matchedApartments:new Set([...features.values()].flatMap(feature=>feature.properties.apartment_ids)).size}};
}
