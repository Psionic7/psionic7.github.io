import {makeApartmentFavorite,validApartmentFavorites} from './apartment-favorites.js';
const selectionKeys=['apt','viewApt'];
export const apartmentUrlValue=item=>'@'+item.id;
export function readRouteParams(location=window.location){
  const params=new URLSearchParams(location.search);
  if(location.hash?.startsWith('#selection?')){
    const fragment=new URLSearchParams(location.hash.slice('#selection?'.length));
    for(const key of selectionKeys)if(fragment.has(key)){params.delete(key);for(const value of fragment.getAll(key))params.append(key,value);}
  }
  return params;
}
export function routeUrl(params){
  const query=new URLSearchParams(params);
  if(query.toString().length<=1800)return '?'+query;
  const fragment=new URLSearchParams();
  for(const key of selectionKeys){for(const value of query.getAll(key))fragment.append(key,value);query.delete(key);}
  return '?'+query+(fragment.size?'#selection?'+fragment:'');
}
export function apartmentUrlIds(params){
  return [...new Set(selectionKeys.flatMap(key=>params.getAll(key)).filter(value=>value.startsWith('@')).map(value=>value.slice(1)))];
}
export function readApartmentUrlValue(value,information=[],catalog=[]){
  if(!value.startsWith('@'))return JSON.parse(value);
  const id=value.slice(1),item=information.find(item=>item.id===id);
  if(!item){
    try{
      const tuple=JSON.parse(id),region=catalog.find(region=>region.region_code===tuple[0]);
      if(Array.isArray(tuple)&&tuple.length===4&&region){
        const source=makeApartmentFavorite({dong:tuple[1],jibun:tuple[2],apartment:tuple[3]},region);
        if(validApartmentFavorites([source]))return source;
      }
    }catch{}
  }
  if(!item)throw Error('공유 주소의 아파트 정보를 찾지 못했습니다.');
  return item;
}
