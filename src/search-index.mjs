import {apartmentKey} from './domain.mjs';
import {makeApartmentFavorite} from './apartment-favorites.js';
// Trade identities remain searchable even when coordinates or registry links are missing.
export function buildSearchIndex(groups,regions,masters=[]){
  const links=new Map();
  for(const item of masters)for(const key of item.trade_keys?.length?item.trade_keys:[apartmentKey(item)])links.set(item.region_code+'|'+key,item);
  const items=new Map();
  for(const [code,rows] of groups){
    const region=regions.find(r=>r.region_code===code);if(!region)continue;
    for(const row of rows){
      const master=links.get(code+'|'+apartmentKey(row));
      const favorite=makeApartmentFavorite(master||row,region);
      let item=items.get(favorite.id);
      if(!item){item={...favorite,name_aliases:[...(master?.name_aliases||[])],last_deal_date:row.deal_date};items.set(item.id,item);}
      if(!item.name_aliases.includes(row.apartment)&&row.apartment!==item.apartment)item.name_aliases.push(row.apartment);
      if(row.deal_date>item.last_deal_date)item.last_deal_date=row.deal_date;
    }
  }
  return [...items.values()].sort((a,b)=>a.apartment.localeCompare(b.apartment,'ko')||a.id.localeCompare(b.id));
}
