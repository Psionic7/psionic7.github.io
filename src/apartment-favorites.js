import {apartmentKey} from './domain.mjs';
export const apartmentFavoriteId=item=>JSON.stringify([item.region_code,...JSON.parse(apartmentKey(item))]);
export const apartmentFavoriteLabel=item=>`${item.apartment} ${item.region_name} ${item.dong} 지번 ${item.jibun||'미상'}`;
export function makeApartmentFavorite(item,region) {
  const favorite={region_code:region.region_code,region_name:region.region_name,apartment:item.apartment,dong:item.dong,jibun:item.jibun||'',road_address:item.road_address||''};
  return {...favorite,id:apartmentFavoriteId(favorite),key:apartmentKey(favorite)};
}
export function validApartmentFavorites(value) {
  return Array.isArray(value)&&value.length<=1000&&new Set(value.map(item=>item?.id)).size===value.length&&value.every(item=>item&&/^\d{5}$/.test(item.region_code)&&['region_name','apartment','dong','jibun','road_address'].every(field=>typeof item[field]==='string'&&item[field].length<=500)&&item.apartment&&item.dong&&item.id===apartmentFavoriteId(item)&&item.key===apartmentKey(item));
}
