import React from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/ApartmentMapPage.jsx',()=>({default:()=> <div>아파트 지도 화면</div>}));
vi.mock('../src/RegionMapPage.jsx',()=>({default:()=> <div>지역 지도 화면</div>}));
import App from '../src/App.jsx';
import {readPreferences,savePreferences} from '../src/preferences.js';
const region={region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',label:'풍덕천동',dongs:['풍덕천동']};
const manifest={regions:[region],favorite_region_ids:[],districts:{'41465':{file:'fixture.json',months:['202609'],count:1}},months:['202609'],published_at:'2026-10-03T00:00:00Z',count:1};
const loader=async()=>[];
beforeEach(()=>{localStorage.clear();history.replaceState(null,'','/');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
for(const [tab,label] of [['apartments','아파트별 실거래가'],['weekly','동 별 실거래가'],['map','아파트 지도'],['regions','지역 지도']]){
 it('returns home to '+tab+' after other main tabs and a new visit',async()=>{
  const user=userEvent.setup();history.replaceState(null,'','/?tab='+tab);let view=render(<App initialManifest={manifest} districtLoader={loader}/>);
  expect(screen.getByRole('button',{name:label,exact:true}).getAttribute('aria-current')).toBe('page');
  await user.click(screen.getByRole('button',{name:'집 찾기',exact:true}));expect(document.querySelector('.public-shell').dataset.tab).toBe(tab);
  await user.click(screen.getByRole('button',{name:'관심 목록',exact:true}));await user.click(screen.getByRole('button',{name:'데이터 안내',exact:true}));
  await user.click(screen.getByRole('button',{name:'집 찾기',exact:true}));expect(screen.getByRole('button',{name:label,exact:true}).getAttribute('aria-current')).toBe('page');expect(new URLSearchParams(location.search).get('tab')).toBe(tab);
  expect(readPreferences('explorer').lastExploreTab).toBe(tab);
  await user.click(screen.getByRole('button',{name:'데이터 안내',exact:true}));view.unmount();history.replaceState(null,'','/?tab=about');
  view=render(<App initialManifest={manifest} districtLoader={loader}/>);await user.click(screen.getByRole('button',{name:'집 찾기',exact:true}));expect(document.querySelector('.public-shell').dataset.tab).toBe(tab);
 });
}
it('remembers the explicitly opened subtab instead of a different saved subtab',async()=>{
 savePreferences('explorer',{lastExploreTab:'regions'});history.replaceState(null,'','/?tab=map');render(<App initialManifest={manifest} districtLoader={loader}/>);const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:'데이터 안내',exact:true}));await user.click(screen.getByRole('button',{name:'집 찾기',exact:true}));expect(document.querySelector('.public-shell').dataset.tab).toBe('map');
});
it('falls back to apartment search for an invalid saved subtab',async()=>{
 savePreferences('explorer',{lastExploreTab:'invalid'});history.replaceState(null,'','/?tab=about');render(<App initialManifest={manifest} districtLoader={loader}/>);const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:'집 찾기',exact:true}));expect(document.querySelector('.public-shell').dataset.tab).toBe('apartments');
});

it('saves the latest scroll position during sustained scrolling and before navigation',()=>{
 vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 history.replaceState(null,'','/?tab=about');render(<App initialManifest={manifest} districtLoader={loader}/>);
 vi.useFakeTimers();let scrollY=0;
 vi.spyOn(window,'scrollY','get').mockImplementation(()=>scrollY);
 for(let second=0;second<30;second++){
  for(let frame=0;frame<60;frame++){scrollY++;fireEvent.scroll(window);}
  act(()=>vi.advanceTimersByTime(1000));
  expect(history.state.scrollY).toBe(scrollY);
 }
 scrollY=1900;fireEvent.scroll(window);
 const push=history.pushState.bind(history);let departure;
 vi.spyOn(history,'pushState').mockImplementation((...args)=>{departure=history.state.scrollY;return push(...args);});
 fireEvent.click(screen.getByRole('button',{name:'집 찾기',exact:true}));
 expect(departure).toBe(1900);expect(history.state.scrollY).toBe(0);
 act(()=>vi.advanceTimersByTime(1000));expect(history.state.scrollY).toBe(0);
});

it('flushes a pending scroll position when the page is hidden and cancels it on unmount',()=>{
 history.replaceState(null,'','/?tab=about');const view=render(<App initialManifest={manifest} districtLoader={loader}/>);
 vi.useFakeTimers();let scrollY=300;
 vi.spyOn(window,'scrollY','get').mockImplementation(()=>scrollY);
 fireEvent.scroll(window);fireEvent(window,new Event('pagehide'));
 expect(history.state.scrollY).toBe(300);
 scrollY=600;fireEvent.scroll(window);view.unmount();
 act(()=>vi.advanceTimersByTime(1000));expect(history.state.scrollY).toBe(300);
});
