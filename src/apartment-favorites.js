import {apartmentKey} from './domain.mjs';
export const apartmentFavoriteId=item=>item.master_id||JSON.stringify([item.region_code,...JSON.parse(apartmentKey(item))]);
export const apartmentFavoriteLabel=item=>`${item.apartment} ${item.region_name} ${item.dong} 지번 ${item.jibun||'미상'}`;
export function makeApartmentFavorite(item,region) {
  const favorite={region_code:region.region_code,region_name:region.region_name,apartment:item.apartment,dong:item.dong,jibun:item.jibun||'',road_address:item.road_address||''};
  return {...favorite,id:apartmentFavoriteId({...favorite,master_id:item.master_id}),key:apartmentKey(favorite),...(item.master_id?{master_id:item.master_id,trade_keys:item.trade_keys||[]}:{})};
}
export function validApartmentFavorites(value) {
  return Array.isArray(value)&&value.length<=1000&&new Set(value.map(item=>item?.id)).size===value.length&&value.every(item=>item&&/^\d{5}$/.test(item.region_code)&&['region_name','apartment','dong','jibun','road_address'].every(field=>typeof item[field]==='string'&&item[field].length<=500)&&item.apartment&&item.dong&&item.id===apartmentFavoriteId(item)&&item.key===apartmentKey(item)&&(!item.master_id||(typeof item.master_id==='string'&&/^hub:[^\s]{1,200}$/.test(item.master_id)&&validTradeKeys(item.trade_keys))));
}

export function validTradeKeys(keys){return Array.isArray(keys)&&keys.length<=1000&&new Set(keys).size===keys.length&&keys.every(k=>{try{const a=JSON.parse(k);return typeof k==='string'&&k.length<=1600&&Array.isArray(a)&&a.length===3&&a.every(v=>typeof v==='string'&&v.length<=500)&&a[0]&&a[2];}catch{return false;}});}
export function favoriteTradeMatches(favorite,row){const key=apartmentKey(row);return favorite.master_id?favorite.trade_keys?.includes(key)===true:favorite.key===key;}
export function sameApartmentFavorite(a,b){return Boolean(a.master_id&&b.master_id&&a.master_id===b.master_id)||a.id===b.id||(a.region_code===b.region_code&&(a.master_id&&a.trade_keys?.includes(b.key)||b.master_id&&b.trade_keys?.includes(a.key)));}
