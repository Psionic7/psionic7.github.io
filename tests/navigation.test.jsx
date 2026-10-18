import React from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/ApartmentMapPage.jsx',()=>({default:()=> <div>아파트 지도 화면</div>}));
vi.mock('../src/RegionMapPage.jsx',()=>({default:()=> <div>지역 지도 화면</div>}));
import App from '../src/App.jsx';
import {readPreferences,savePreferences} from '../src/preferences.js';
const region={region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',label:'풍덕천동',dongs:['풍덕천동']};
const manifest={regions:[region],favorite_region_ids:[],districts:{'41465':{file:'fixture.json',months:['202609'],count:1}},months:['202609'],published_at:'2026-10-03T00:00:00Z',count:1};
const loader=async()=>[];
beforeEach(()=>{localStorage.clear();history.replaceState(null,'','/');});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
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
