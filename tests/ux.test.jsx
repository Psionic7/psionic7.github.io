import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,within,waitFor,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import {readPreferences,savePreferences} from '../src/preferences.js';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {loadDistrict} from '../src/data.js';
const region={region_id:'dong_41465101',label:'경기도 용인시 수지구 풍덕천동',region_name:'경기도 용인시 수지구',region_code:'41465',dongs:['풍덕천동']};
const missing={...region,region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_name:'서울특별시 종로구',region_code:'11110',dongs:['청운동']};
const manifest={regions:[region,missing],districts:{'41465':{file:'fixture.json',months:['202609','202610'],dongs:['풍덕천동']}},months:['202609','202610'],published_at:'2026-10-03T00:00:00Z',count:2};
const row={id:1,region_code:'41465',dong:'풍덕천동',jibun:'1',apartment:'관심단지',price_man:100000,area_m2:60,deal_date:'2026-09-28',deal_month:'202609',floor:10,cancelled:0,raw:{}};
const favorite=makeApartmentFavorite(row,region),loader=async()=>[row,{...row,id:2,cancelled:1,raw:{cdealDay:'2026-10-02'}}];
const open=()=>render(<App initialManifest={manifest} districtLoader={loader}/>);
beforeEach(()=>{localStorage.clear();history.replaceState(null,'','/?tab=apartments');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('places search before the period, hides unavailable regions by default, and offers an explicit opt-in',async()=>{
  const user=userEvent.setup();open();await screen.findByLabelText('조회 지역');
  const selection=screen.getByRole('region',{name:'조회 아파트 설정'}),period=screen.getByRole('region',{name:'조회 기간 설정'});
  expect(selection.compareDocumentPosition(period)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('combobox',{name:'조회 지역'}).textContent).not.toContain('청운동');
  await user.click(screen.getByRole('checkbox',{name:'미수집 지역 포함'}));expect(screen.getByRole('combobox',{name:'조회 지역'}).textContent).toContain('청운동');
  expect(screen.getByRole('button',{name:'전용면적 펼치기'}).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('complementary',{name:'조회 자료 범위'}).textContent).toContain('2026-10-03');
});
it('round trips empty bounds, exact square metres, cancellation and display units across devices',async()=>{
  const user=userEvent.setup();let view=open();await screen.findByRole('button',{name:'전용면적 펼치기'});
  await user.click(screen.getByRole('button',{name:'전용면적 펼치기'}));
  fireEvent.change(screen.getByLabelText('최소 전용면적 (㎡)'),{target:{value:'60'}});
  await user.click(screen.getByRole('checkbox',{name:'해제 거래 포함'}));await user.click(screen.getByRole('button',{name:'평 (전용)',exact:true}));
  await waitFor(()=>expect(new URLSearchParams(location.search).get('min')).toBe('60'));
  const shared=location.search;view.unmount();localStorage.clear();history.replaceState(null,'',shared);view=open();
  await screen.findByRole('button',{name:'평 (전용)',exact:true});expect(readPreferences('apartmentTransactions')).toMatchObject({minArea:60,maxArea:'',includeCancelled:false});
  expect(screen.getByRole('checkbox',{name:'해제 거래 포함'}).checked).toBe(false);expect(screen.getByRole('button',{name:'평 (전용)',exact:true}).getAttribute('aria-pressed')).toBe('true');
});
it('back and forward restore the route and its own query parameters',async()=>{
  const user=userEvent.setup();open();await screen.findByLabelText('조회 지역');
  await user.click(screen.getByRole('button',{name:'동 별 실거래가',exact:true}));await screen.findByRole('searchbox',{name:'주간 동 검색'});
  await user.click(screen.getByRole('button',{name:'데이터 안내',exact:true}));expect(location.search).toBe('?tab=about');
  await act(async()=>{const changed=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await changed;});
  await screen.findByRole('searchbox',{name:'주간 동 검색'});expect(new URLSearchParams(location.search).get('tab')).toBe('weekly');
  await act(async()=>{const changed=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.forward();await changed;});
  await screen.findByRole('button',{name:'즐겨찾기 전체 삭제'});expect(location.search).toBe('?tab=about');
});
it('does not remount transaction filters on an in-page results jump',async()=>{
  const user=userEvent.setup();savePreferences('apartmentTransactions',{selected:[favorite]});open();
  await screen.findByRole('link',{name:'거래 결과로 이동 ↓'});
  await user.click(screen.getByRole('button',{name:'전용면적 접기'}));
  await user.click(screen.getByRole('link',{name:'거래 결과로 이동 ↓'}));
  await waitFor(()=>expect(location.hash).toBe('#transaction-results'));
  expect(screen.getByRole('button',{name:'전용면적 펼치기'})).toBeTruthy();
});
it('preserves favorites on query reset and requires a cancellable confirmation for deletion with undo',async()=>{
  const user=userEvent.setup();savePreferences('viewer',{apartments:[favorite],regions:[region.region_id]});savePreferences('display',{areaUnit:'pyeong'});history.replaceState(null,'','/?tab=about');open();
  await user.click(screen.getByRole('button',{name:'이 브라우저의 조회 설정 초기화'}));await screen.findByRole('button',{name:'되돌리기'});
  expect(readPreferences('viewer').apartments).toEqual([favorite]);expect(readPreferences('display')).toEqual({});
  await user.click(screen.getByRole('button',{name:'되돌리기'}));await screen.findByRole('button',{name:'즐겨찾기 전체 삭제'});expect(readPreferences('display').areaUnit).toBe('pyeong');
  await user.click(screen.getByRole('button',{name:'즐겨찾기 전체 삭제'}));await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'취소'}));expect(readPreferences('viewer').apartments).toHaveLength(1);
  await user.click(screen.getByRole('button',{name:'즐겨찾기 전체 삭제'}));await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'모든 즐겨찾기 삭제'}));
  await screen.findByRole('button',{name:'되돌리기'});expect(readPreferences('viewer').apartments).toEqual([]);
  await user.click(screen.getByRole('button',{name:'되돌리기'}));expect(readPreferences('viewer')).toMatchObject({apartments:[favorite],regions:[region.region_id]});
});
it('opens a shared dashboard without replacing the recipients personal favorites',async()=>{
  const params=new URLSearchParams({tab:'dashboard',view:'shared',days:'30',viewDong:region.region_id,viewApt:JSON.stringify(favorite)});history.replaceState(null,'','/?'+params);savePreferences('viewer',{apartments:[],regions:[]});open();
  await screen.findByRole('region',{name:'최근 관심 거래 내역'});expect(readPreferences('viewer')).toEqual({apartments:[],regions:[]});expect(screen.getByText(/공유된 관심 목록을 보고/)).toBeTruthy();
});
it('loads only the catalog and requested months, preserves cancellation dates, and retries a failed shard',async()=>{
  const meta={districts:{'12345':{file:'never-full.json',browser:{file:'catalog-ux.json'}}}};
  let fail=true;const fetcher=vi.fn(async url=>({ok:true,json:async()=>{
    if(url==='/query-data/catalog-ux.json')return {catalog:[row],latest:[{...row,id:3,deal_date:'2026-08-01'}],months:{202608:'aug-ux.json',202609:'sep-ux.json',202610:'oct-ux.json'}};
    if(url==='/query-data/sep-ux.json'&&fail){fail=false;throw new Error('offline');}
    if(url==='/query-data/sep-ux.json')return [{...row,cancelled:1,raw:{cdealDay:'2026-10-02'}}];
    throw new Error('unexpected file '+url);
  }}));vi.stubGlobal('fetch',fetcher);
  expect((await loadDistrict(meta,'12345',{catalogOnly:true})).catalog).toEqual([row]);expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(loadDistrict(meta,'12345',{start:'2026-09-01',end:'2026-09-30'})).rejects.toThrow('offline');
  const result=await loadDistrict(meta,'12345',{start:'2026-09-01',end:'2026-09-30',includeLatest:true});expect(result.rows).toHaveLength(2);expect(result.rows[0].raw.cdealDay).toBe('2026-10-02');
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/query-data/catalog-ux.json','/query-data/sep-ux.json','/query-data/sep-ux.json']);
});
