import {apartmentKey} from './domain.mjs';
import {makeApartmentFavorite} from './apartment-favorites.js';
import {sourceIdentityId} from './housing-identity.mjs';
// Trade identities remain searchable even when coordinates or registry links are missing.
export function buildSearchIndex(groups,regions,masters=[]){
  const links=new Map();
  const modern=masters.some(item=>Array.isArray(item.identity_default_sources));
  for(const item of masters){
    const keys=modern?(item.identity_default_sources||[]):(item.trade_keys?.length?item.trade_keys:[apartmentKey(item)]).map(key=>item.region_code+'|'+key);
    for(const key of keys){if(links.has(key)&&links.get(key)?.id!==item.id){if(modern)throw Error('원본 단지의 기본 검색 선택이 중복되었습니다.');links.set(key,null);}else if(!links.has(key))links.set(key,item);}
  }
  const items=new Map();
  for(const [code,rows] of groups){
    const region=regions.find(r=>r.region_code===code);if(!region)continue;
    for(const row of rows){
      const master=links.get(modern?sourceIdentityId(row):code+'|'+apartmentKey(row));
      if(modern&&!master)throw Error('원본 단지의 기본 검색 선택이 없습니다.');
      const favorite=makeApartmentFavorite(master||row,region);
      let item=items.get(favorite.id);
      if(!item){item={...favorite,name_aliases:[...(master?.name_aliases||[])],postal_code:master?.postal_code||null,last_deal_date:row.deal_date,...(modern?{identity_default_sources:[...master.identity_default_sources]}:{})};items.set(item.id,item);}
      if(!item.name_aliases.includes(row.apartment)&&row.apartment!==item.apartment)item.name_aliases.push(row.apartment);
      if(row.deal_date>item.last_deal_date)item.last_deal_date=row.deal_date;
    }
  }
  return [...items.values()].sort((a,b)=>a.apartment.localeCompare(b.apartment,'ko')||a.id.localeCompare(b.id));
}
