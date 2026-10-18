import React from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import TransactionPage from '../src/TransactionPage.jsx';
import {PREFERENCES_KEY,clearPreferences,readPreferences,resetQueries,snapshotPreferences,useStoredState} from '../src/preferences.js';
import {validRegionFavorites} from '../src/region-favorites.js';
import ApartmentMasterPanel from '../admin/ApartmentMasterPanel.jsx';

vi.mock('../src/ApartmentMapPage.jsx',()=>({default:()=>{throw new Error('simulated chunk/render failure');}}));
const region={region_id:'dong_41465101',label:'경기도 용인시 수지구 풍덕천동',region_name:'경기도 용인시 수지구',region_code:'41465',dongs:['풍덕천동']};
const months=['202608','202609','202610'];
const manifest={regions:[region],districts:{'41465':{file:'fixture.json',months,dongs:['풍덕천동']}},months,published_at:'2026-10-03T00:00:00Z',count:0};
beforeEach(()=>{clearPreferences();history.replaceState(null,'','/');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();clearPreferences();});

it('does not request transactions for empty, reversed or out-of-coverage dates, but preserves catalog-only selection',async()=>{
  const loader=Object.assign(vi.fn(async()=>({rows:[],catalog:[]})),{supportsRanges:true});
  const props={manifest,regions:[region],day:'2026-09-28',period:{mode:'custom',start:'',end:'2026-09-30'},districtLoader:loader,renderSelection:()=>null};
  const view=render(<TransactionPage {...props}/>);
  await screen.findByRole('alert');expect(loader).not.toHaveBeenCalled();
  view.rerender(<TransactionPage {...props} period={{mode:'custom',start:'2026-09-30',end:'2026-09-01'}}/>);
  expect(loader).not.toHaveBeenCalled();
  view.rerender(<TransactionPage {...props} period={{mode:'month',month:'2026-11'}}/>);
  expect(loader).not.toHaveBeenCalled();
  view.rerender(<TransactionPage {...props} searchRegionCode="41465"/>);
  await waitFor(()=>expect(loader).toHaveBeenCalledTimes(1));expect(loader.mock.calls[0][2].catalogOnly).toBe(true);
  view.rerender(<TransactionPage {...props} period={{mode:'custom',start:'2026-09-01',end:'2026-09-30'}}/>);
  await waitFor(()=>expect(loader).toHaveBeenCalledTimes(2));expect(loader.mock.calls[1][2]).toMatchObject({start:'2026-09-01',end:'2026-09-30',catalogOnly:false});
});

it('applies additions and deletions to the latest favorite list and synchronizes external storage changes',()=>{
  const a=renderHook(()=>useStoredState('viewer','regions',[],validRegionFavorites));
  const b=renderHook(()=>useStoredState('viewer','regions',[],validRegionFavorites));
  const one='dong_41465101',two='dong_41465103',three='dong_41465104';
  act(()=>a.result.current[1](previous=>[...previous,one]));
  act(()=>b.result.current[1](previous=>[...previous,two]));
  expect(readPreferences('viewer').regions).toEqual([one,two]);
  act(()=>window.dispatchEvent(new StorageEvent('storage',{key:PREFERENCES_KEY})));
  expect(a.result.current[0]).toEqual([one,two]);
  act(()=>a.result.current[1](previous=>previous.filter(id=>id!==one)));
  act(()=>b.result.current[1](previous=>[...previous,three]));
  expect(readPreferences('viewer').regions).toEqual([two,three]);
});

it('uses a shared browser lock for concurrent favorite operations',async()=>{
  let tail=Promise.resolve();const request=vi.fn((_name,callback)=>{const next=tail.then(callback);tail=next.catch(()=>{});return next;});
  vi.stubGlobal('navigator',{locks:{request}});
  const a=renderHook(()=>useStoredState('viewer','regions',[],validRegionFavorites));
  const b=renderHook(()=>useStoredState('viewer','regions',[],validRegionFavorites));
  await act(async()=>{a.result.current[1](previous=>[...previous,'dong_41465101']);b.result.current[1](previous=>[...previous,'dong_41465103']);await tail;});
  expect(request).toHaveBeenCalledTimes(2);expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
  expect(readPreferences('viewer').regions).toEqual(['dong_41465101','dong_41465103']);
});

it('preserves an unreadable oversized preference document and does not announce a successful reset',async()=>{
  const raw=JSON.stringify({version:1,scopes:{viewer:{regions:[region.region_id]},old:{padding:'x'.repeat(2*1024*1024)}}});localStorage.setItem(PREFERENCES_KEY,raw);
  expect(snapshotPreferences()).toBe(null);expect(resetQueries()).toBe(false);expect(localStorage.getItem(PREFERENCES_KEY)).toBe(raw);
  history.replaceState(null,'','/?tab=about');render(<App initialManifest={manifest} districtLoader={async()=>[]}/>);
  await userEvent.setup().click(await screen.findByRole('button',{name:'이 브라우저의 조회 설정 초기화'}));
  expect(localStorage.getItem(PREFERENCES_KEY)).toBe(raw);expect(screen.queryByRole('button',{name:'되돌리기'})).toBe(null);
});

it('keeps navigation and a reload action when a screen fails',async()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});history.replaceState(null,'','/?tab=map');
  render(<App initialManifest={manifest}/>);
  await screen.findByRole('button',{name:'페이지 새로고침'});expect(screen.getByRole('navigation',{name:'주요 메뉴'})).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button',{name:'데이터 안내'}));
  await screen.findByRole('button',{name:'이 브라우저의 조회 설정 초기화'});expect(screen.queryByRole('button',{name:'페이지 새로고침'})).toBe(null);
});

it('validates a malformed manifest and recovers after a successful retry',async()=>{
  let damaged=true;vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>damaged?{}:manifest})));
  render(<App/>);expect((await screen.findByRole('alert')).textContent).toContain('형식');
  damaged=false;await userEvent.setup().click(screen.getByRole('button',{name:'다시 불러오기'}));
  await screen.findByRole('navigation',{name:'주요 메뉴'});
});

it('refreshes apartment collection settings through the existing GET state API',async()=>{
  const action=vi.fn();render(<ApartmentMasterPanel state={{catalog:[],saved:[],stats:{},job:{status:'idle'}}} action={action}/>);
  await userEvent.setup().click(screen.getByRole('button',{name:'아파트 수집 설정 확인'}));
  expect(action).toHaveBeenCalledWith('state',undefined);
});

it('shares the visible filter even when storage is blocked, and restores it from the URL',async()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage denied');});
  history.replaceState(null,'',`/?tab=weekly&dong=${region.region_id}&period=month&month=2026-09&filters=1&min=70&max=100&bands=&cancelled=0&unit=m2`);
  const view=render(<App initialManifest={manifest} districtLoader={async()=>[]}/>);
  await userEvent.setup().click(await screen.findByRole('button',{name:/기간 \/ 조건/}));
  const min=await screen.findByRole('spinbutton',{name:'최소 전용면적 (㎡)'});expect(min.value).toBe('70');
  fireEvent.change(min,{target:{value:'80'}});
  await waitFor(()=>expect(new URLSearchParams(location.search).get('min')).toBe('80'));
  expect(new URLSearchParams(location.search).get('max')).toBe('100');expect(new URLSearchParams(location.search).get('cancelled')).toBe('0');
  const shared=location.search;view.unmount();history.replaceState(null,'',shared);
  render(<App initialManifest={manifest} districtLoader={async()=>[]}/>);
  await userEvent.setup().click(await screen.findByRole('button',{name:/기간 \/ 조건/}));
  expect((await screen.findByRole('spinbutton',{name:'최소 전용면적 (㎡)'})).value).toBe('80');
});
