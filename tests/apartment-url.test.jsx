import {expect,it} from 'vitest';
import {apartmentUrlValue,apartmentUrlIds,readApartmentUrlValue,readRouteParams,routeUrl} from '../src/apartment-url.js';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {appendSharedOverview,readSharedOverview} from '../src/query-state.js';
const region={region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',dongs:['풍덕천동']};
const source=makeApartmentFavorite({apartment:'시험단지',dong:'풍덕천동',jibun:'1'},region);
const root=makeApartmentFavorite({...source,master_id:'hub:test',identity_ref:{kind:'root',id:'hub:test'},trade_keys:Array.from({length:1000},(_,i)=>JSON.stringify(['풍덕천동',String(i),'신고명']))},region);

it('encodes stable IDs without apartment metadata and still reads legacy links',()=>{
 expect(apartmentUrlValue(root)).toBe('@hub:test');
 expect(readApartmentUrlValue(apartmentUrlValue(root),[root])).toEqual(root);
 expect(readApartmentUrlValue(JSON.stringify(root))).toEqual(root);
 expect(readApartmentUrlValue(apartmentUrlValue(source),[],[region])).toEqual(source);
 expect(()=>readApartmentUrlValue('@hub:missing',[],[region])).toThrow();
});
it('keeps large selections out of the server request and restores every selection from the fragment',()=>{
 const params=new URLSearchParams({tab:'apartments',period:'month',month:'2026-10'});
 const ids=Array.from({length:1000},(_,i)=>'@cohort:hub:test:'+i);
 ids.forEach(id=>params.append('apt',id));
 const url=new URL(routeUrl(params),'https://example.test/');
 expect(url.search.length).toBeLessThan(1802);expect(url.hash.startsWith('#selection?')).toBe(true);
 expect(readRouteParams(url).getAll('apt')).toEqual(ids);
 expect(apartmentUrlIds(readRouteParams(url))).toHaveLength(1000);
 expect(readRouteParams(url).get('month')).toBe('2026-10');
});
it('restores compact selections without copying catalog position or area into saved state',()=>{
 const information={...root,location:{latitude:37.5,longitude:127,anchors:[{building_id:'one'}]},area:{parcels:[{pnu:'one'}],boundary_refs:[{id:'one'}]}};
 expect(readApartmentUrlValue('@hub:test',[information])).toEqual(root);
 expect(readApartmentUrlValue(JSON.stringify(information))).toEqual(root);
});
it('shares dashboard apartments with IDs and retains explicit empty selections',()=>{
 const overview={regions:[region],apartments:[root,source]},params=new URLSearchParams({tab:'dashboard'});
 appendSharedOverview(params,overview);
 expect(params.getAll('viewApt')).toEqual(['@hub:test',apartmentUrlValue(source)]);
 expect(readSharedOverview(params,[region],[root,source])).toEqual(overview);
 expect(routeUrl(params).length).toBeLessThan(500);
 const empty=readRouteParams({search:'?tab=apartments&apt=old',hash:'#selection?apt='});
 expect(empty.getAll('apt')).toEqual(['']);
});
