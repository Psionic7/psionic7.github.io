import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import App from '../src/App.jsx';
import {loadDistrict} from '../src/data.js';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {readPreferences,savePreferences} from '../src/preferences.js';

const region={region_id:'dong_41465101',label:'경기도 용인시 수지구 풍덕천동',region_code:'41465',region_name:'경기도 용인시 수지구',dongs:['풍덕천동']};
const manifest={regions:[region],favorite_region_ids:[region.region_id],districts:{'41465':{file:'suji.json',months:['202001','202606','202608','202610']}},months:['202001','202606','202608','202610'],published_at:'2026-10-03T12:00:00Z',count:6};
const row=(id,deal_date,overrides={})=>({id,region_code:'41465',dong:'풍덕천동',jibun:'693',apartment:'삼성1',area_m2:99.9,price_man:90000,floor:5,cancelled:0,raw:{},deal_date,deal_month:deal_date.slice(0,7).replace('-',''),...overrides});
const data=[row(1,'2020-01-03'),row(2,'2026-06-20'),row(3,'2026-08-28',{area_m2:134.97}),row(4,'2026-10-02'),row(5,'2026-10-03',{cancelled:1}),row(6,'2026-10-03',{jibun:'99',apartment:'다른단지'})];
const favorite=makeApartmentFavorite({apartment:'삼성1',dong:'풍덕천동',jibun:'693'},region);
beforeEach(()=>{localStorage.clear();history.replaceState(null,'','/');});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

for(const tab of ['apartments','weekly'])it(`${tab}: recent count includes older matching trades, restores shared settings, and switches back to date queries`,async()=>{
  const scope=tab==='weekly'?'weekly':'apartmentTransactions';
  const limit=tab==='weekly'?3:2;
  savePreferences(scope,{includeCancelled:false,maxArea:100});
  const params=new URLSearchParams({tab,period:'custom',from:'2026-09-01',to:'2026-10-03'});
  if(tab==='weekly')params.set('dong',region.region_id);else params.set('apt',JSON.stringify(favorite));
  history.replaceState(null,'','/?'+params);
  const loader=vi.fn(async()=>data);
  let view=render(<App initialManifest={manifest} districtLoader={loader}/>);
  const title=tab==='weekly'?region.label:`삼성1 · ${region.region_name} 풍덕천동 · 지번 693`;
  await screen.findByRole('region',{name:`${title} 기간별 거래 내역`});
  fireEvent.change(screen.getByRole('spinbutton',{name:'최근 거래 건수'}),{target:{value:String(limit)}});
  fireEvent.submit(screen.getByRole('form',{name:'최근 거래 건수 조회'}));
  const table=await screen.findByRole('region',{name:`${title} 최근 거래 내역`});
  expect(within(table).getAllByRole('row')).toHaveLength(limit+1);
  expect(within(table).getByText('26.06.20')).toBeTruthy();
  expect(within(table).queryByText('26.08.28')).toBeNull();
  expect(within(table).queryByText('해제')).toBeNull();
  expect(readPreferences(scope).recentCount).toBe(limit);
  expect(new URLSearchParams(location.search).get('count')).toBe(String(limit));
  if(tab==='weekly')expect(within(table).getByText('다른단지')).toBeTruthy();
  const shared=location.search;
  view.unmount();localStorage.clear();history.replaceState(null,'','/'+shared);
  view=render(<App initialManifest={manifest} districtLoader={loader}/>);
  await screen.findByRole('region',{name:`${title} 최근 거래 내역`});
  expect(screen.getByRole('button',{name:'건 조회'}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'90일',exact:true}));
  const dated=await screen.findByRole('region',{name:`${title} 기간별 거래 내역`});
  expect(within(dated).queryByText('26.06.20')).toBeNull();
  expect(new URLSearchParams(location.search).has('count')).toBe(false);
  expect(readPreferences(scope).recentCount).toBe('');
  expect(loader).toHaveBeenCalledTimes(2);
});

it('reads older months until every selection has enough filtered rows, and stops before unnecessary history',async()=>{
  const code='12345',a={region_code:code,dongs:['풍덕천동'],key:favorite.key},b={region_code:code,dongs:['동천동']};
  const other={region_code:'99999',dongs:['다른구']};
  const recent=row(11,'2026-10-02',{region_code:code}),older=row(12,'2026-06-20',{region_code:code});
  const urls=[];
  vi.stubGlobal('fetch',vi.fn(async url=>{urls.push(url);const files={
    '/query-data/recent-count-catalog.json':{catalog:[],months:{202001:'never-count.json',202606:'jun-count.json',202608:'aug-count.json',202610:'oct-count.json'}},
    '/query-data/oct-count.json':[recent,{...recent,id:13,cancelled:1},{...recent,id:14,area_m2:135}],
    '/query-data/aug-count.json':[{...recent,id:15,dong:'동천동'}],
    '/query-data/jun-count.json':[older,{...older,id:16,dong:'동천동'}],
  };if(!(url in files))throw new Error('Unexpected request '+url);return {ok:true,json:async()=>files[url]};}));
  const result=await loadDistrict({districts:{[code]:{browser:{file:'recent-count-catalog.json'}}}},code,{recentCount:2,recentRegions:[a,b,other],includeCancelled:false,maxArea:100,end:'2026-10-03'});
  expect(result.rows).toContainEqual(older);
  expect(urls).toEqual(['/query-data/recent-count-catalog.json','/query-data/oct-count.json','/query-data/aug-count.json','/query-data/jun-count.json']);
});
