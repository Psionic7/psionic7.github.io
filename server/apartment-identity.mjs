import fs from 'node:fs';
import {APARTMENT_IDENTITY_SCHEMA} from './apartment-identity-schema.mjs';
import {validListingSnapshot} from '../src/naver-listings.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {normalizeRoadAddress,normalizeParcel} from '../src/address-identity.mjs';
import {rebuildHousingIdentity,housingIdentityCatalog,housingTradeBindings,housingIdentityStats} from './housing-identity.mjs';
export {housingIdentityCatalog,housingTradeBindings,housingIdentityStats};
export {readNaverMatch,naverMatchStats} from './apartment-naver-matches.mjs';
export function synchronizeHousingIdentity(db,options={}) {
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

export function apartmentInformation(db,{activeOnly=true}={}) {
  if(!has(db,'apartment_information'))return [];
  return db.prepare('SELECT * FROM apartment_information'+(activeOnly?' WHERE active=1':'')+' ORDER BY apartment_id').all().map(({name_aliases_json,sources_json,...row})=>({...row,name_aliases:JSON.parse(name_aliases_json),sources:JSON.parse(sources_json),trade_keys:has(db,'apartment_trade_links')?db.prepare("SELECT dong,jibun,trade_name FROM apartment_trade_links WHERE region_code=? AND status='matched' AND (apartment_id=? OR (method='shared_registry_address' AND EXISTS(SELECT 1 FROM json_each(candidates_json) WHERE value=?)))").all(row.region_code,row.apartment_id,row.apartment_id).map(t=>JSON.stringify([t.dong,t.jibun,t.trade_name])):[],addresses:db.prepare('SELECT * FROM apartment_identity_addresses WHERE apartment_id=? ORDER BY road_address,building_management_no').all(row.apartment_id)}));
}

export function synchronizeApartmentIdentity(db,{snapshot,overrides=apartmentAliasOverrides(),apartmentIds,now=new Date().toISOString()}={}) {
  if(!has(db,'apartment_complexes'))return {apartments:0,withPostalCode:0};
  if(snapshot&&!validListingSnapshot(snapshot))throw Error('아파트 정보에 연결할 매물 스냅샷 검증 실패');
  if(!Array.isArray(overrides)||overrides.some(row=>!row||!Array.isArray(row.names)||[row.canonical_name,...row.names].some(name=>typeof name!=='string'||!name.trim()||name.length>500)||!row.source))throw Error('검토한 아파트 별칭 형식을 확인하세요.');
  db.exec(APARTMENT_IDENTITY_SCHEMA);
  const old=new Map(apartmentInformation(db,{activeOnly:false}).map(row=>[row.apartment_id,row]));
  const complexes=db.prepare('SELECT * FROM apartment_complexes ORDER BY apartment_id').all();
  const regions=has(db,'regions')?db.prepare('SELECT region_code,region_name FROM regions ORDER BY rowid').all():[];
  const lookups=has(db,'address_lookups')?db.prepare("SELECT * FROM address_lookups WHERE status IN ('exact','ambiguous')").all():[];
  const trades=has(db,'apartment_trade_links')?db.prepare("SELECT * FROM apartment_trade_links WHERE status='matched'").all():[];
  const parcels=has(db,'apartment_parcels')?db.prepare('SELECT apartment_id,legal_code,jibun FROM apartment_parcels').all():[];
  const observations=new Map((snapshot?.groups||[]).map(group=>[group.favorite.id,group]));
  if(has(db,'naver_listing_snapshots'))for(const row of db.prepare('SELECT group_json FROM naver_listing_snapshots').all()){
    const group=JSON.parse(row.group_json);
    if(!validListingSnapshot({version:1,source:'naver-land',generatedAt:now,groups:[group]}))throw Error('아파트 정보에 연결할 저장 매물 검증 실패');
    const previous=observations.get(group.favorite.id);
    if(!previous||group.attemptedAt>=previous.attemptedAt)observations.set(group.favorite.id,group);
  }
  const addAlias=db.prepare('INSERT OR IGNORE INTO apartment_aliases(apartment_id,name,source) VALUES(?,?,?)');
  const fields=['apartment_id','canonical_name','region_code','region_name','legal_code','dong','jibun','road_address','postal_code','postal_source','naver_complex_no','naver_name','active','sources_json'];
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
      const values=[c.apartment_id,canonicalName,c.region_code,regionName,c.legal_code,c.dong,c.jibun,c.road_address,postal,postal?'주소정보누리집':null,latest?.complexNo||old.get(c.apartment_id)?.naver_complex_no||null,latest?.complexName||old.get(c.apartment_id)?.naver_name||null,c.active,sources];
      const previous=old.get(c.apartment_id);
      const unchanged=previous&&fields.every((name,index)=>(name==='sources_json'?JSON.stringify(previous.sources):previous[name])===values[index]);
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

export function searchApartmentInformation(db,query) {
  const needle=identityName(query);
  return apartmentInformation(db).filter(row=>[row.canonical_name,...row.name_aliases,row.region_name+' '+row.dong+' '+row.jibun,row.road_address,row.postal_code,...row.addresses.map(item=>item.road_address)].some(value=>identityName(value).includes(needle)));
}

export function resolveApartmentIdentity(db,input,information=apartmentInformation(db)) {
  if(!input.master_id&&!(input.region_code&&input.dong&&input.jibun)&&!input.road_address)return {status:'insufficient',apartment_id:null,candidates:[]};
  const candidates=information.filter(row=>(!input.master_id||row.apartment_id===input.master_id)&&(!input.region_code||row.region_code===input.region_code)&&(!input.dong||row.dong===input.dong)&&(!input.jibun||normalizeParcel(input.jibun)&&(normalizeParcel(row.jibun)===normalizeParcel(input.jibun)||row.addresses.some(a=>addressParcel(a.jibun_address,row.region_name,row.dong)===normalizeParcel(input.jibun))))&&(!input.postal_code||[row.postal_code,...row.addresses.map(a=>a.postal_code)].includes(input.postal_code))&&(!input.road_address||road(input.road_address)&&[row.road_address,...row.addresses.map(a=>a.road_address)].some(value=>road(value)===road(input.road_address)))&&(input.master_id||[row.canonical_name,...row.name_aliases].some(name=>identityName(name)===identityName(input.apartment))));
  return {status:candidates.length===1?'matched':candidates.length?'ambiguous':'unmatched',apartment_id:candidates.length===1?candidates[0].apartment_id:null,candidates:candidates.map(row=>row.apartment_id)};
}

export function publicApartmentInformation(db) {
  return {version:1,apartments:apartmentInformation(db).map(row=>({...makeApartmentFavorite({apartment:row.canonical_name,dong:row.dong,jibun:row.jibun,road_address:row.road_address,master_id:row.apartment_id,trade_keys:row.trade_keys},row),name_aliases:row.name_aliases,postal_code:row.postal_code,naver_complex_no:row.naver_complex_no,addresses:row.addresses.map(({apartment_id,...address})=>address),sources:row.sources}))};
}
