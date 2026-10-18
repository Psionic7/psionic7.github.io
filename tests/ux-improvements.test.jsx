import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,waitFor,fireEvent} from '@testing-library/react';
import {PREFERENCES_KEY,restorePreferences,readPreferences,savePreferences,clearPreferences} from '../src/preferences.js';
import StorageNotice from '../src/StorageNotice.jsx';
import {loadApartmentMap} from '../src/apartment-map-data.js';
import {mapApartment} from '../server/apartment-boundaries.mjs';
import TransactionResults from '../src/transactions/TransactionResults.jsx';
beforeEach(()=>{clearPreferences();});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();clearPreferences();});
it('restores documents above the previous 256KB threshold and preserves favorites through later writes',()=>{
 const favorites=Array.from({length:467},(_,i)=>({id:'saved:'+i,name:'단지'+i,padding:'x'.repeat(300)}));
 restorePreferences({version:1,scopes:{viewer:{apartments:favorites},apartmentTransactions:{selected:favorites}}});
 expect(localStorage.getItem(PREFERENCES_KEY).length).toBeGreaterThan(262144);
 expect(readPreferences('viewer').apartments).toHaveLength(467);expect(savePreferences('display',{areaUnit:'m2'})).toBe(true);expect(readPreferences('viewer').apartments).toHaveLength(467);
});
it('rejects oversized writes without losing the previous document and visibly reports a blocked storage write',async()=>{
 savePreferences('viewer',{apartments:[{id:'keep'}]});const previous=localStorage.getItem(PREFERENCES_KEY);
 render(<StorageNotice/>);expect(restorePreferences({version:1,scopes:{padding:'x'.repeat(2*1024*1024)}})).toBe(false);
 await screen.findByRole('alert');expect(localStorage.getItem(PREFERENCES_KEY)).toBe(previous);
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});expect(savePreferences('display',{areaUnit:'pyeong'})).toBe(false);expect(readPreferences('viewer').apartments[0].id).toBe('keep');
});
it('opens the map without geometry, loads only intersecting spatial pieces and retries a failed piece',async()=>{
 const apartment=mapApartment({region_code:'41465',apartment:'부분 지도',dong:'풍덕천동',jibun:'1',road_address:'도로 1',latitude:37,longitude:127},'경기도 용인시 수지구',2000);
 const manifest={apartments:{file:'apartments-111111111111.json'},boundaries:{file:'boundaries-111111111111.geojson',sha256:'geometry-fixture'}};
 const tile='tile-6350_1850-111111111111.json',far='tile-6400_1850-222222222222.json';
 const feature={type:'Feature',bbox:[127,37,127.001,37.001],properties:{apartment_ids:[apartment.id]},geometry:{type:'Polygon',coordinates:[[[127,37],[127.001,37],[127.001,37.001],[127,37.001],[127,37]]]}};
 let fail=true;const fetcher=vi.fn(async path=>({ok:true,json:async()=>{
  if(path==='/apartment-map/manifest.json')return manifest;
  if(path.includes('apartments-'))return [apartment];
  if(path.startsWith('/map-data/manifest'))return {version:1,source_sha256:'geometry-fixture',tiles:[{file:tile,bbox:[127,37,127.001,37.001]},{file:far,bbox:[128,37,128.001,37.001]}]};
  if(path==='/map-data/'+tile){if(fail){fail=false;throw new Error('offline');}return {type:'FeatureCollection',features:[feature]};}
  throw new Error('Unexpected download '+path);
 }}));vi.stubGlobal('fetch',fetcher);
 const data=await loadApartmentMap();expect(data.apartments).toHaveLength(1);expect(data.boundaries.features).toHaveLength(0);expect(fetcher.mock.calls).toHaveLength(2);
 await expect(data.loadBoundaries([126.99,36.99,127.01,37.01])).rejects.toThrow('offline');
 expect((await data.loadBoundaries([126.99,36.99,127.01,37.01])).features).toHaveLength(1);
 expect(fetcher.mock.calls.some(([url])=>url.includes(far)||url.includes('boundaries-'))).toBe(false);
});
it('mobile paging renders 20 rows and retains all transactions on the following pages',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
 const region={region_id:'dong_41465101',label:'풍덕천동',region_name:'용인시 수지구',region_code:'41465',dongs:['풍덕천동']};
 const rows=Array.from({length:45},(_,i)=>({id:i,region_code:'41465',dong:'풍덕천동',apartment:'단지'+i,jibun:'1',area_m2:84,price_man:100000,floor:10,deal_date:'2026-09-20',cancelled:0}));
 render(<TransactionResults region={region} week={{start:'2026-09-01',end:'2026-09-30'}} dataset={{rows}} collected minArea="" maxArea="" selectedBands={[]} includeCancelled mode="month"/>);
 await waitFor(()=>expect(document.querySelectorAll('tbody tr').length).toBe(20));expect(screen.getByText(/페이지당 20건 · 1 \/ 3/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'풍덕천동 다음 거래 페이지'}));await waitFor(()=>expect(screen.getByText(/2 \/ 3 페이지/)).toBeTruthy());expect(document.querySelectorAll('tbody tr').length).toBe(20);
 fireEvent.click(screen.getByRole('button',{name:'풍덕천동 다음 거래 페이지'}));await waitFor(()=>expect(document.querySelectorAll('tbody tr').length).toBe(5));
});

it('times out a stalled request with a recoverable message',async()=>{
 const {fetchJson}=await import('../src/data.js');vi.useFakeTimers();
 try{
  vi.stubGlobal('fetch',(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
  const request=fetchJson('/stalled'),expectation=expect(request).rejects.toThrow('응답이 지연되고 있습니다');
  await vi.advanceTimersByTimeAsync(30000);await expectation;
 }finally{vi.useRealTimers();}
});

it('offers newly published data without automatically replacing the current query',async()=>{
 const {act}=await import('@testing-library/react');const {default:App}=await import('../src/App.jsx');
 const first={regions:[{region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',label:'풍덕천동',dongs:['풍덕천동']}],favorite_region_ids:[],districts:{'41465':{months:['202609'],file:'fixture'}},months:['202609'],published_at:'2026-10-03T00:00:00Z',count:1};
 const second={...first,published_at:'2026-10-04T00:00:00Z'};let calls=0;
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>++calls===1?first:second})));history.replaceState(null,'','/?tab=apartments&period=month&month=2026-09');vi.useFakeTimers();
 try{
  await act(async()=>{render(<App districtLoader={async()=>[]}/>);});
  expect(screen.queryByRole('button',{name:'새 자료 불러오기'})).toBeNull();
  await act(async()=>{await vi.advanceTimersByTimeAsync(300001);});
  expect(screen.getByText('2026-10-03')).toBeTruthy();expect(screen.queryByText('2026-10-04')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'새 자료 불러오기'}));expect(screen.getByText('2026-10-04')).toBeTruthy();expect(location.search).toContain('month=2026-09');
 }finally{vi.useRealTimers();}
});
