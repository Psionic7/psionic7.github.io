import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const map=vi.hoisted(()=>({props:null}));
vi.mock('../src/CloudRegionMap.jsx',()=>({default:props=>{
  map.props=props;
  return <div role="region" aria-label="동 팝업 지도">{props.visibleIds.map(id=>{
    const region=props.catalog.find(item=>item.region_id===id),selected=props.draft.includes(id);
    return <button key={id} aria-label={region.label+' 즐겨찾기 '+(selected?'해제':'추가')} aria-pressed={selected} onClick={()=>props.onToggle(id)}>{region.dongs[0]}</button>;
  })}</div>;
}}));
import App from '../src/App.jsx';
import {readPreferences,savePreferences} from '../src/preferences.js';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
const a={region_id:'dong_41465101',label:'경기도 용인시 수지구 풍덕천동',region_code:'41465',region_name:'경기도 용인시 수지구',dongs:['풍덕천동']};
const b={region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_code:'11110',region_name:'서울특별시 종로구',dongs:['청운동']};
const manifest={regions:[a,b],favorite_region_ids:[b.region_id],districts:{'41465':{file:'fixture.json',months:['202609']}},months:['202609'],published_at:'2026-10-03T00:00:00Z'};
const apartment=makeApartmentFavorite({apartment:'기존 아파트',dong:'풍덕천동',jibun:'1'},a);
const popup=()=>screen.getByRole('region',{name:'동 팝업 지도'});
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/?tab=regions');map.props=null;});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('persists personal region stars beside apartment favorites, restores the tab, and uses the personal list in apartment queries',async()=>{
 const user=userEvent.setup(),loader=vi.fn(async()=>[]);savePreferences('viewer',{apartments:[apartment]});
 let view=render(<App initialManifest={manifest} districtLoader={loader}/>);await screen.findByRole('region',{name:'동 팝업 지도'});
 const tabs=within(screen.getByRole('navigation',{name:'조회 화면'})).getAllByRole('button').map(button=>button.textContent);
 expect(tabs[tabs.indexOf('아파트 지도')+1]).toBe('지역 지도');expect(map.props.favoriteMode).toBe(true);expect(map.props.draft).toEqual([]);expect(loader).not.toHaveBeenCalled();
 await user.click(within(popup()).getByRole('button',{name:a.label+' 즐겨찾기 추가'}));
 expect(readPreferences('viewer')).toMatchObject({regions:[a.region_id],apartments:[apartment]});
 expect(within(popup()).getByRole('button',{name:b.label+' 즐겨찾기 추가'})).toBeTruthy();
 view.unmount();window.history.replaceState(null,'','/');view=render(<App initialManifest={manifest} districtLoader={loader}/>);await screen.findByRole('region',{name:'동 팝업 지도'});
 expect(window.location.search).toContain('tab=regions');expect(within(popup()).getByRole('button',{name:a.label+' 즐겨찾기 해제'}).getAttribute('aria-pressed')).toBe('true');
 await user.click(screen.getByRole('button',{name:'아파트별 실거래가',exact:true}));
 const favorites=await screen.findByRole('region',{name:'즐겨찾기 지역'});expect(within(favorites).queryByRole('button',{name:/청운동/})).toBeNull();
 await user.click(within(favorites).getByRole('button',{name:/풍덕천동/}));await waitFor(()=>expect(loader).toHaveBeenCalledWith(expect.anything(),'41465'));
 expect(screen.getByRole('combobox',{name:'조회 지역'}).value).toBe(a.region_id);
 await user.click(screen.getByRole('button',{name:'지역 지도',exact:true}));await screen.findByRole('region',{name:'동 팝업 지도'});
 await user.click(within(popup()).getByRole('button',{name:a.label+' 즐겨찾기 해제'}));expect(readPreferences('viewer').regions).toEqual([]);expect(readPreferences('viewer').apartments).toEqual([apartment]);
 view.unmount();view=render(<App initialManifest={manifest} districtLoader={loader}/>);await screen.findByRole('region',{name:'동 팝업 지도'});expect(map.props.draft).toEqual([]);
 expect(manifest.favorite_region_ids).toEqual([b.region_id]);
});
it('keeps map inputs stable on star changes and restores map search and favorite-only filters',async()=>{
 const user=userEvent.setup();let view=render(<App initialManifest={manifest}/>);await screen.findByRole('region',{name:'동 팝업 지도'});
 const visible=map.props.visibleIds,catalog=map.props.catalog;
 await user.click(within(popup()).getByRole('button',{name:a.label+' 즐겨찾기 추가'}));expect(map.props.visibleIds).toBe(visible);expect(map.props.catalog).toBe(catalog);
 await user.click(screen.getByRole('checkbox',{name:'즐겨찾기 지역만'}));expect(map.props.visibleIds).toEqual([a.region_id]);
 await user.type(screen.getByRole('searchbox',{name:'지역 지도 검색'}),'청운');expect(map.props.visibleIds).toEqual([]);expect(screen.getByText(/조건에 맞는 지역이 없습니다/)).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'필터 초기화'}));expect(map.props.visibleIds).toEqual([a.region_id,b.region_id]);
 await user.selectOptions(screen.getByRole('combobox',{name:'지역 지도 시도'}),'경기도');await user.type(screen.getByRole('searchbox',{name:'지역 지도 검색'}),'풍덕');await user.click(screen.getByRole('checkbox',{name:'즐겨찾기 지역만'}));
 view.unmount();view=render(<App initialManifest={manifest}/>);await screen.findByRole('region',{name:'동 팝업 지도'});
 expect(screen.getByRole('combobox',{name:'지역 지도 시도'}).value).toBe('경기도');expect(screen.getByRole('searchbox',{name:'지역 지도 검색'}).value).toBe('풍덕');expect(screen.getByRole('checkbox',{name:'즐겨찾기 지역만'}).checked).toBe(true);expect(map.props.visibleIds).toEqual([a.region_id]);
});
it('ignores malformed region favorites while retaining existing apartment favorites',async()=>{
 for(const regions of [['../bad'],[a.region_id,a.region_id],{id:a.region_id},[null]]){
  savePreferences('viewer',{regions,apartments:[apartment]});window.history.replaceState(null,'','/?tab=regions');
  const view=render(<App initialManifest={manifest}/>);await screen.findByRole('region',{name:'동 팝업 지도'});expect(map.props.draft).toEqual([]);expect(readPreferences('viewer').apartments).toEqual([apartment]);view.unmount();
 }
});


it('updates the weekly favorite dong picker after region-map stars change without changing the saved query selection',async()=>{
 const user=userEvent.setup();render(<App initialManifest={manifest} districtLoader={async()=>[]}/>);
 await screen.findByRole('region',{name:'동 팝업 지도'});
 await user.click(within(popup()).getByRole('button',{name:a.label+' 즐겨찾기 추가'}));
 await user.click(screen.getByRole('button',{name:'동 별 실거래가',exact:true}));
 const favorites=await screen.findByRole('group',{name:'즐겨찾기한 동 선택'});
 await user.click(within(favorites).getByRole('checkbox',{name:/풍덕천동/}));
 expect(new URLSearchParams(location.search).getAll('dong')).toEqual([a.region_id]);
 await user.click(screen.getByRole('button',{name:'지역 지도',exact:true}));
 await screen.findByRole('region',{name:'동 팝업 지도'});
 await user.click(within(popup()).getByRole('button',{name:a.label+' 즐겨찾기 해제'}));
 await user.click(within(popup()).getByRole('button',{name:b.label+' 즐겨찾기 추가'}));
 await user.click(screen.getByRole('button',{name:'동 별 실거래가',exact:true}));
 const changed=await screen.findByRole('group',{name:'즐겨찾기한 동 선택'});
 expect(within(changed).queryByRole('checkbox',{name:/풍덕천동/})).toBeNull();expect(within(changed).getByRole('checkbox',{name:/청운동/}).checked).toBe(false);
 expect(within(screen.getByRole('group',{name:'주간 조회할 동 선택'})).getByRole('checkbox',{name:/풍덕천동/}).checked).toBe(true);
 expect(readPreferences('viewer').regions).toEqual([b.region_id]);expect(readPreferences('explorer').weeklyIds).toEqual([a.region_id]);
});
