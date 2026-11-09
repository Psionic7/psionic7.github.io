import {validApartmentFavorites,sameApartmentFavorite} from './apartment-favorites.js';
import {sourceIdentityId} from './housing-identity.mjs';

export function validateApartmentInformation(value) {
  if(value?.version!==1||!Array.isArray(value.apartments)||value.apartments.length>50000||new Set(value.apartments.map(item=>item.id)).size!==value.apartments.length||value.apartments.some(item=>!validApartmentFavorites([item])||!Array.isArray(item.name_aliases)||item.name_aliases.some(name=>typeof name!=='string'||name.length>500)||item.postal_code!==null&&!/^\d{5}$/.test(item.postal_code)||!Array.isArray(item.addresses)))throw Error('아파트 식별 정보 형식을 확인하세요.');
  return value;
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
