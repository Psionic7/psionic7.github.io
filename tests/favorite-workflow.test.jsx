import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import {readPreferences,savePreferences} from '../src/preferences.js';
import {makeApartmentFavorite,validApartmentFavorites} from '../src/apartment-favorites.js';
const state=vi.hoisted(()=>({information:[],mapApartment:null}));
vi.mock('../src/useApartmentInformation.js',async importOriginal=>({...await importOriginal(),default:()=>state.information,loadApartmentInformation:async()=>state.information}));
vi.mock('../src/RegionMapPage.jsx',()=>({default:({onToggleFavorite})=><button onClick={()=>onToggleFavorite('dong_41465101')}>관심 동 저장</button>}));
vi.mock('../src/ApartmentMapPage.jsx',async()=>{
 const {default:FavoriteButton}=await import('../src/ApartmentFavoriteButton.jsx');
 return {default:({favorites,onToggleFavorite,onOpenApartment})=><><FavoriteButton apartment={state.mapApartment} region={state.mapApartment} favorites={favorites} onToggle={onToggleFavorite}/><button onClick={()=>onOpenApartment(state.mapApartment)}>지도 단지 거래 보기</button></>};
});
const region={region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',label:'경기도 용인시 수지구 풍덕천동',dongs:['풍덕천동']};
const manifest={regions:[region],districts:{'41465':{file:'fixture.json',months:['202001','202609']}},months:['202001','202609'],published_at:'2026-09-30T00:00:00Z',count:0};
const row=(id,changes={})=>({id,region_code:'41465',dong:'풍덕천동',jibun:'1',apartment:'지도 단지',area_m2:85,price_man:100000,floor:8,deal_date:'2020-01-10',deal_month:'202001',cancelled:0,raw:{},...changes});
const loader=async()=>[];
function holdWrites(){
 const queue=[];vi.stubGlobal('navigator',{locks:{request:vi.fn((_name,callback)=>new Promise(resolve=>queue.push(()=>resolve(callback()))))}});
 return async()=>{while(queue.length)queue.shift()();await Promise.resolve();};
}
beforeEach(()=>{localStorage.clear();history.replaceState(null,'','/?tab=regions');state.information=[];state.mapApartment=null;});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});

it('delete-all through the real App UI does not resurrect an earlier queued favorite',async()=>{
 const drain=holdWrites();render(<App initialManifest={manifest} districtLoader={loader}/>);
 fireEvent.click(await screen.findByRole('button',{name:'관심 동 저장'}));
 fireEvent.click(screen.getByRole('button',{name:'데이터 안내',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'즐겨찾기 전체 삭제',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'모든 즐겨찾기 삭제',exact:true}));
 await act(drain);
 expect(readPreferences('viewer').regions).toEqual([]);
});

it('a queued favorite remains visible after query reset remounts the real App',async()=>{
 const drain=holdWrites();render(<App initialManifest={manifest} districtLoader={loader}/>);
 fireEvent.click(await screen.findByRole('button',{name:'관심 동 저장'}));
 fireEvent.click(screen.getByRole('button',{name:'데이터 안내',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'이 브라우저의 조회 설정 초기화',exact:true}));
 await act(drain);
 expect(readPreferences('viewer').regions).toEqual([region.region_id]);
 expect(screen.getByRole('button',{name:'관심 동네1곳'})).toBeTruthy();
});

it('a legacy and current selection survive metadata refresh and reopening the real App',async()=>{
 const base={apartment:'단지',dong:'풍덕천동',jibun:'1',road_address:'경기도 용인시 수지구 도로 1',master_id:'hub:audit'};
 const legacy=makeApartmentFavorite(base,region),modern=makeApartmentFavorite({...base,identity_ref:{kind:'cohort',id:'cohort:hub:audit:road'},identity_coverage:{entity_ids:[],cohort_ids:['cohort:hub:audit:road'],root_ids:['hub:audit']}},region);
 state.information=[modern];savePreferences('apartmentTransactions',{selected:[legacy,modern]});
 history.replaceState(null,'','/?tab=apartments');
 vi.spyOn(console,'error').mockImplementation(()=>{});
 const first=render(<App initialManifest={manifest} districtLoader={loader}/>);
 await waitFor(()=>expect(readPreferences('apartmentTransactions').selected.map(item=>item.id)).toEqual([modern.id]));
 expect(validApartmentFavorites(readPreferences('apartmentTransactions').selected)).toBe(true);
 first.unmount();render(<App initialManifest={manifest} districtLoader={loader}/>);
 await waitFor(()=>expect(document.querySelector('.public-shell')).toBeTruthy());
 const restored=readPreferences('apartmentTransactions').selected;
 expect(restored).toHaveLength(1);expect(restored[0].id).toBe(modern.id);
});

it('shows a map favorite above the collapsed selector and opens older trades with clear filters',async()=>{
 const favorite=makeApartmentFavorite(row(1),region);state.mapApartment=favorite;state.information=[favorite];
 savePreferences('apartmentTransactions',{minArea:10,maxArea:20,areaBands:[10],includeCancelled:true,recentCount:'',period:{mode:'week'}});
 savePreferences('apartmentSearch',{query:'다른 아파트'});history.replaceState(null,'','/?tab=map');
 const user=userEvent.setup(),view=render(<App initialManifest={manifest} districtLoader={async()=>[row(1),row(2,{cancelled:1})]}/>);
 await user.click(await screen.findByRole('button',{name:/지도 단지.*즐겨찾기 추가$/}));
 await screen.findByText('즐겨찾기 저장됨');expect(readPreferences('viewer').apartments).toHaveLength(1);
 await user.click(screen.getByRole('button',{name:'아파트별 실거래가',exact:true}));
 const shortcuts=screen.getByRole('region',{name:'즐겨찾기 단지'});
 expect(document.getElementById('query-controls').hidden).toBe(true);
 await user.click(within(shortcuts).getByRole('button',{name:/지도 단지.*거래 조회$/}));
 const table=await screen.findByRole('region',{name:/지도 단지.*최근 거래 내역$/});
 expect(within(table).getByText('20.01.10')).toBeTruthy();expect(within(table).getAllByRole('row')).toHaveLength(2);
 expect(readPreferences('apartmentTransactions')).toMatchObject({minArea:'',maxArea:'',areaBands:[],includeCancelled:false,recentCount:20});
 expect(readPreferences('apartmentSearch').query).toBe('');
 expect(new URLSearchParams(location.search).get('count')).toBe('20');
 view.unmount();render(<App initialManifest={manifest} districtLoader={async()=>[row(1)]}/>);
 expect(screen.getByRole('region',{name:'즐겨찾기 단지'})).toBeTruthy();
 await screen.findByRole('region',{name:/지도 단지.*최근 거래 내역$/});
});

it('adds another saved apartment without replacing the current selection or comparison filters',async()=>{
 const a=makeApartmentFavorite(row(1),region),b=makeApartmentFavorite(row(2,{apartment:'다음 단지',jibun:'2'}),region);
 state.information=[a,b];savePreferences('viewer',{apartments:[a,b]});
 savePreferences('apartmentTransactions',{selected:[a],maxArea:100,minArea:60,areaBands:[],includeCancelled:false,recentCount:20});
 history.replaceState(null,'','/?tab=apartments');
 render(<App initialManifest={manifest} districtLoader={async()=>[row(1),row(2,{apartment:'다음 단지',jibun:'2'})]}/>);
 await screen.findByRole('button',{name:/다음 단지.*거래 조회$/});
 fireEvent.click(within(screen.getByRole('region',{name:'즐겨찾기 단지'})).getByRole('button',{name:/다음 단지.*거래 조회$/}));
 const table=await screen.findByRole('region',{name:/다음 단지.*최근 거래 내역$/});
 expect(within(table).getByText('20.01.10')).toBeTruthy();
 expect(readPreferences('apartmentTransactions')).toMatchObject({minArea:60,maxArea:100,includeCancelled:false,recentCount:20});
 expect(readPreferences('apartmentTransactions').selected.map(item=>item.id)).toEqual([a.id,b.id]);
 expect(screen.getByRole('region',{name:/지도 단지.*최근 거래 내역$/})).toBeTruthy();
 expect(within(screen.getByRole('region',{name:'즐겨찾기 단지'})).getAllByRole('button',{pressed:true})).toHaveLength(2);
});

it('selects all favorites, removes just one with the keyboard, and restores the remaining comparison',async()=>{
 const a=makeApartmentFavorite(row(1),region),b=makeApartmentFavorite(row(2,{apartment:'비교 단지',jibun:'2'}),region);
 state.information=[a,b];savePreferences('viewer',{apartments:[a,b]});history.replaceState(null,'','/?tab=apartments');
 const user=userEvent.setup(),load=async()=>[row(1),row(2,{apartment:'비교 단지',jibun:'2'})];
 const view=render(<App initialManifest={manifest} districtLoader={load}/>);
 const shortcuts=await screen.findByRole('region',{name:'즐겨찾기 단지'});
 await user.click(within(shortcuts).getByRole('button',{name:'즐겨찾기 전체 보기'}));
 await screen.findByRole('region',{name:/비교 단지.*최근 거래 내역$/});
 expect(readPreferences('apartmentTransactions').selected.map(item=>item.id)).toEqual([a.id,b.id]);
 expect(new URLSearchParams(location.search).getAll('apt')).toHaveLength(2);
 const first=within(shortcuts).getByRole('button',{name:/지도 단지.*거래 조회$/});
 first.focus();await user.keyboard(' ');
 expect(first.getAttribute('aria-pressed')).toBe('false');
 expect(readPreferences('apartmentTransactions').selected.map(item=>item.id)).toEqual([b.id]);
 expect(screen.queryByRole('region',{name:/지도 단지.*최근 거래 내역$/})).toBeNull();
 expect(readPreferences('viewer').apartments.map(item=>item.id)).toEqual([a.id,b.id]);
 view.unmount();render(<App initialManifest={manifest} districtLoader={load}/>);
 await screen.findByRole('region',{name:/비교 단지.*최근 거래 내역$/});
 expect(readPreferences('apartmentTransactions').selected.map(item=>item.id)).toEqual([b.id]);
 expect(within(screen.getByRole('region',{name:'즐겨찾기 단지'})).getByRole('button',{name:/비교 단지.*거래 조회$/}).getAttribute('aria-pressed')).toBe('true');
});

it('displays pending and saved states while Chrome grants a delayed favorite lock',async()=>{
 const drain=holdWrites();state.mapApartment=makeApartmentFavorite(row(1),region);history.replaceState(null,'','/?tab=map');
 render(<App initialManifest={manifest} districtLoader={loader}/>);
 const add=await screen.findByRole('button',{name:/지도 단지.*즐겨찾기 추가$/});
 fireEvent.click(add);expect(add.disabled).toBe(true);expect(add.getAttribute('aria-busy')).toBe('true');expect(add.textContent).toBe('변경 중…');
 await act(drain);
 const saved=screen.getByRole('button',{name:/지도 단지.*즐겨찾기 해제$/});
 expect(saved.disabled).toBe(false);expect(saved.textContent).toBe('즐겨찾기 저장됨');expect(readPreferences('viewer').apartments).toHaveLength(1);
});
