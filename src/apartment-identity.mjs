import {validApartmentFavorites,sameApartmentFavorite} from './apartment-favorites.js';
import {sourceIdentityId,validIdentityRef} from './housing-identity.mjs';
import {validBounds} from './map-bounds.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const located=value=>Number.isFinite(value.latitude)&&Number.isFinite(value.longitude)&&value.latitude>=28&&value.latitude<=40&&value.longitude>=122&&value.longitude<=135;
function validSpatialInformation(item){
  const location=item.location,area=item.area;
  if(item.selection_id!==item.id||item.scope_kind!==item.identity_ref?.kind||typeof item.active!=='boolean'||typeof item.map_visible!=='boolean'||!['residential','ancillary_only','unresolved'].includes(item.residential_status))return false;
  if(!location||!['confirmed','missing','ambiguous'].includes(location.status)||!['entrance','unknown','parcel'].includes(location.precision)||!Array.isArray(location.anchors))return false;
  if(location.status==='confirmed'?!located(location)||!location.anchors.some(anchor=>anchor.building_id===location.building_id&&anchor.entrance_index===location.entrance_index):location.latitude!==null||location.longitude!==null)return false;
  if(location.anchors.some(anchor=>!located(anchor)||typeof anchor.building_id!=='string'))return false;
  if(!area||!same(area.identity_ref,item.identity_ref)||area.geometry_scope!==null&&!validIdentityRef(area.geometry_scope)||!Array.isArray(area.region_ids)||!Array.isArray(area.parcels)||!Array.isArray(area.boundary_refs)||!Array.isArray(area.boundary_ids)||!Array.isArray(area.zoning_refs)||area.bbox!==null&&!validBounds(area.bbox))return false;
  if(new Set(area.boundary_ids).size!==area.boundary_ids.length||!same(area.boundary_ids,area.boundary_refs.map(ref=>ref.id)))return false;
  if(area.boundary_refs.some(ref=>typeof ref.id!=='string'||!['cadastral_parcels','building_footprint'].includes(ref.kind)||!validIdentityRef(ref.identity_ref)||!validBounds(ref.bbox)||!hash(ref.sha256)))return false;
  if(!Array.isArray(item.map_member_refs)||item.map_member_refs.some(ref=>!validIdentityRef(ref)))return false;
  return true;
}

export function validateApartmentInformation(value) {
  if(value?.version!==1||!Array.isArray(value.apartments)||value.apartments.length>50000||new Set(value.apartments.map(item=>item.id)).size!==value.apartments.length||value.apartments.some(item=>!validApartmentFavorites([item])||!Array.isArray(item.name_aliases)||item.name_aliases.some(name=>typeof name!=='string'||name.length>500)||item.postal_code!==null&&!/^\d{5}$/.test(item.postal_code)||!Array.isArray(item.addresses)))throw Error('아파트 식별 정보 형식을 확인하세요.');
  if(value.schema_version!==undefined&&(value.schema_version!==2||!hash(value.generation)||value.apartments.some(item=>!validSpatialInformation(item))))throw Error('공통 아파트 위치·구역 정보 형식을 확인하세요.');
  return value;
}

export function validateIdentityMap(apartments,catalog){
  const byId=new Map(validateApartmentInformation(catalog).apartments.map(item=>[item.id,item]));
  if(!Array.isArray(apartments)||new Set(apartments.map(item=>item?.id)).size!==apartments.length)throw Error('아파트 지도 선택 형식을 확인하세요.');
  for(const item of apartments){
    const info=byId.get(item.id);
    if(!info||item.identity_ref?.kind!=='root'||!sameApartmentFavorite(item,info)||info.active===false||info.residential_status==='ancillary_only'||info.map_visible===false||item.apartment!==info.apartment||item.postal_code!==info.postal_code)throw Error('아파트 지도 선택과 공통 식별 정보가 다릅니다: '+item.id);
    for(const field of ['identity_coverage','identity_related_sources','identity_listing_members','identity_reported_buildings','identity_default_sources','name_aliases','location','area','map_member_refs'])if(!same(item[field],info[field]))throw Error('아파트 지도와 공통 정보의 범위·위치·구역이 다릅니다: '+item.id);
    if(info.location&&(item.latitude!==info.location.latitude||item.longitude!==info.location.longitude||item.location_status!==(info.location.status==='confirmed'?'confirmed':'missing')))throw Error('아파트 지도 위치와 공통 좌표가 다릅니다: '+item.id);
  }
  return apartments;
}

export function identityForApartment(information,favorite) {
  const matches=information.filter(item=>sameApartmentFavorite(item,favorite));
  const exact=matches.find(item=>item.id===favorite.id)||(matches.length===1?matches[0]:null);
  if(exact||favorite.identity_ref||favorite.master_id)return exact;
  const routes=information.filter(item=>item.identity_default_sources?.includes(sourceIdentityId(favorite)));
  return routes.length===1?routes[0]:null;
}

export function validateIdentitySearch(search,catalog) {
  const byId=new Map(validateApartmentInformation(catalog).apartments.map(row=>[row.id,row]));
  if(!Array.isArray(search))throw Error('아파트 검색 목록 형식을 확인하세요.');
  for(const item of search.filter(row=>row.master_id||row.identity_ref)){
    const identity=byId.get(item.identity_ref?item.id:item.master_id);
    if(!identity||!sameApartmentFavorite(item,identity)||item.apartment!==identity.apartment||item.postal_code!==identity.postal_code||identity.name_aliases.some(name=>!item.name_aliases?.includes(name))||item.identity_ref&&['identity_coverage','identity_related_sources','identity_listing_members','identity_reported_buildings','identity_default_sources'].some(field=>JSON.stringify(item[field])!==JSON.stringify(identity[field])))throw Error('아파트 식별 정보의 이름·별칭·우편번호가 검색 목록과 다릅니다: '+item.id);
  }
  return search;
}
