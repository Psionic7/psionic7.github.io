import {apartmentKey} from './domain.mjs';
import {normalizeRoadAddress} from './address-identity.mjs';
import {sourceIdentityId,identityRef,identityTradeMatches,identitySelectionEqual,validIdentityRef,validIdentityCoverage,validRelatedSources} from './housing-identity.mjs';
export const apartmentFavoriteId=item=>item.identity_ref?.id||item.master_id||sourceIdentityId(item);
export const apartmentFavoriteLabel=item=>`${item.apartment} ${item.region_name} ${item.dong} 지번 ${item.jibun||'미상'}`;
export function makeApartmentFavorite(item,region) {
  const favorite={region_code:region.region_code,region_name:region.region_name,apartment:item.apartment,dong:item.dong,jibun:item.jibun||'',road_address:item.road_address||''};
  const metadata={...identityMetadata(item),...(item.housing_source_kind?{housing_source_kind:item.housing_source_kind}:{}),...(item.housing_legal_types?{housing_legal_types:[...item.housing_legal_types]}:{})};
  return {...favorite,id:apartmentFavoriteId({...favorite,master_id:item.master_id,...metadata}),key:apartmentKey(favorite),...(item.master_id?{master_id:item.master_id,trade_keys:[...(item.trade_keys||[])]}:{}),...metadata};
}
function identityMetadata(item) {
  const reported=item.identity_reported_buildings===undefined?{}:{identity_reported_buildings:[...item.identity_reported_buildings]};
  return {...reported,...(item.identity_ref!==undefined?{identity_ref:{...item.identity_ref}}:{}),...(item.identity_coverage!==undefined?{identity_coverage:Object.fromEntries(Object.entries(item.identity_coverage).map(([key,values])=>[key,[...values]]))}:{}),...(item.identity_related_sources!==undefined?{identity_related_sources:[...item.identity_related_sources]}:{}),...(item.identity_listing_members!==undefined?{identity_listing_members:item.identity_listing_members.map(member=>({...member,building_dongs:member.building_dongs===null?null:[...member.building_dongs]}))}:{})};
}
const validBuildingLabels=value=>Array.isArray(value)&&value.length<=1000&&new Set(value).size===value.length&&value.every(dong=>typeof dong==='string'&&dong.length>0&&dong.length<=100);
const validListingMembers=value=>Array.isArray(value)&&value.length<=1000&&new Set(value.map(item=>item?.cohort_id)).size===value.length&&value.every(item=>validIdentityRef({kind:'cohort',id:item?.cohort_id})&&(item.whole_cohort===undefined||typeof item.whole_cohort==='boolean')&&(item.building_dongs===null||validBuildingLabels(item.building_dongs)));
export function validApartmentFavorites(value) {
  if(!Array.isArray(value)||value.some(item=>item?.identity_listing_members!==undefined&&!validListingMembers(item.identity_listing_members)||item?.identity_reported_buildings!==undefined&&!validBuildingLabels(item.identity_reported_buildings)))return false;
  return Array.isArray(value)&&value.length<=1000&&new Set(value.map(item=>item?.id)).size===value.length&&value.every(item=>item&&/^\d{5}$/.test(item.region_code)&&['region_name','apartment','dong','jibun','road_address'].every(field=>typeof item[field]==='string'&&item[field].length<=500)&&item.apartment&&item.dong&&item.id===apartmentFavoriteId(item)&&item.key===apartmentKey(item)&&(!item.master_id||(typeof item.master_id==='string'&&/^hub:[^\s]{1,200}$/.test(item.master_id)&&validTradeKeys(item.trade_keys)))&&(item.identity_ref===undefined||validIdentityRef(item.identity_ref)&&(item.identity_ref.kind!=='source'||JSON.parse(item.identity_ref.id)[0]===item.region_code))&&(item.identity_coverage===undefined||validIdentityCoverage(item.identity_coverage))&&(item.identity_related_sources===undefined||validRelatedSources(item.identity_related_sources)));
}

export function validTradeKeys(keys){return Array.isArray(keys)&&keys.length<=1000&&new Set(keys).size===keys.length&&keys.every(k=>{try{const a=JSON.parse(k);return typeof k==='string'&&k.length<=1600&&Array.isArray(a)&&a.length===3&&a.every(v=>typeof v==='string'&&v.length<=500)&&a[0]&&a[2];}catch{return false;}});}
export const favoriteTradeMatches=identityTradeMatches;
export function refreshApartmentFavorites(saved, current) {
  const byId=new Map(current.map(item=>[item.id,item]));
  let changed=false;
  const next=saved.map(item=>{
    let latest=byId.get(item.id);
    const legacyRoot=!item.identity_ref&&item.master_id;
    if(legacyRoot){
      const road=normalizeRoadAddress(item.road_address);
      const cohorts=road?current.filter(candidate=>identityRef(candidate)?.kind==='cohort'&&candidate.region_code===item.region_code&&candidate.dong===item.dong&&validIdentityCoverage(candidate.identity_coverage)&&(candidate.master_id===item.master_id||candidate.identity_coverage.root_ids.includes(item.master_id))&&normalizeRoadAddress(candidate.road_address)===road):[];
      if(cohorts.length===1)latest=cohorts[0];
    }
    if(!latest||latest.region_code!==item.region_code){
      if(!legacyRoot||!current.length)return item;
      latest={...item,identity_ref:{kind:'root',id:item.master_id},identity_coverage:{entity_ids:[],cohort_ids:[],root_ids:[item.master_id]},identity_related_sources:[]};
    }
    if(!item.master_id&&!item.identity_ref&&!latest.identity_ref)return item;
    const updated={...latest,...identityMetadata(latest),...(latest.master_id?{trade_keys:[...(latest.trade_keys||[])]}:{}),identity_ref:{...identityRef(latest)}};
    if(JSON.stringify(item)===JSON.stringify(updated))return item;
    changed=true;return updated;
  });
  return changed?next:saved;
}
export const sameApartmentFavorite=identitySelectionEqual;
