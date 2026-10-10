import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import {makeApartmentFavorite,apartmentFavoriteLabel} from '../src/apartment-favorites.js';
import {readPreferences,savePreferences} from '../src/preferences.js';
const region={region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',label:'경기도 용인시 수지구 풍덕천동',dongs:['풍덕천동']};
const other={region_id:'dong_11110101',region_code:'11110',region_name:'서울특별시 종로구',label:'서울특별시 종로구 청운동',dongs:['청운동']};
const manifest={regions:[region,other],districts:{'41465':{file:'suji.json',months:['202601','202602','202603','202604']},'11110':{file:'seoul.json',months:['202601','202602','202603','202604']}},months:['202601','202602','202603','202604'],published_at:'2026-04-30T12:00:00Z'};
const row=(changes={})=>({id:1,region_code:'41465',dong:'풍덕천동',jibun:'1',apartment:'동일아파트',road_address:'',area_m2:85,price_man:100000,floor:10,cancelled:0,deal_date:'2026-01-05',deal_month:'202601',raw:{},...changes});
const favorite=makeApartmentFavorite(row(),region);
const label=item=>item.apartment+' · '+item.region_name+' '+item.dong+' · 지번 '+(item.jibun||'미상');
const tradeTable=item=>screen.getByRole('region',{name:label(item)+' 기간별 거래 내역'});
const search=()=>screen.getByRole('group',{name:'검색 아파트 선택'});
const choose=(user,item=favorite)=>user.click(within(search()).getByRole('checkbox',{name:apartmentFavoriteLabel(item)+' 조회 선택'}));
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/?tab=apartments&region=area_41465&start=202601&end=202604');});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('Unified apartment transactions',()=>{
 it('isolates the selected lot, shares the dong table format and area filter, and optionally includes cancellations',async()=>{
  const user=userEvent.setup(),rows=[row(),row({id:2,deal_date:'2026-03-10',deal_month:'202603',price_man:120000}),row({id:3,area_m2:60}),row({id:4,jibun:'2',price_man:900000}),row({id:5,cancelled:1,price_man:800000,raw:{cdealDay:'2026-04-01'}}),row({id:6,dong:'죽전동',price_man:700000})];
  render(<App initialManifest={manifest} districtLoader={async()=>rows}/>);await screen.findByRole('group',{name:'검색 아파트 선택'});await choose(user);
  let table=tradeTable(favorite);expect(within(table).getAllByRole('row')).toHaveLength(5);
  expect(within(table).getAllByRole('columnheader').map(cell=>cell.textContent)).toEqual(['계약일','아파트 이름','전용면적','층','거래금액','거래 상태 / 해제일']);
  expect(within(table).getByText('26.03.10')).toBeTruthy();expect(within(table).getAllByText('25.7평')).toHaveLength(3);
  expect(within(table).queryByText('90.00억 원')).toBeNull();expect(within(table).queryByText('70.00억 원')).toBeNull();expect(screen.queryByText('유효 거래')).toBeNull();expect(screen.queryByText('최고 거래금액')).toBeNull();expect(document.querySelector('.weekly-metrics')).toBeNull();
  await user.click(screen.getByRole('checkbox',{name:'해제 거래 포함'}));expect(within(table).getAllByRole('row')).toHaveLength(4);
  fireEvent.change(screen.getByRole('spinbutton',{name:'최소 전용면적 (㎡)'}),{target:{value:'85'}});expect(within(table).getAllByRole('row')).toHaveLength(3);
  await user.click(screen.getByRole('button',{name:'평 (전용)',exact:true}));expect(within(table).getAllByText('25.7평')).toHaveLength(2);expect(readPreferences('apartmentTransactions').minArea).toBe(85);
  await user.click(screen.getByRole('button',{name:'조회할 아파트 접기'}));expect(within(table).getAllByRole('row')).toHaveLength(3);
  await user.click(screen.getByRole('button',{name:'조회할 아파트 펼치기'}));expect(within(search()).getByRole('checkbox',{name:apartmentFavoriteLabel(favorite)+' 조회 선택'}).checked).toBe(true);
 });
 it('finds every apartment without implicit choice and keeps query selection separate from favorite stars',async()=>{
  const user=userEvent.setup(),rows=Array.from({length:150},(_,index)=>row({id:index+1,apartment:'일반단지'+index}));rows.push(row({id:151,apartment:'희소단지'}));
  render(<App initialManifest={manifest} districtLoader={async()=>rows}/>);await screen.findByRole('group',{name:'검색 아파트 선택'});expect(within(search()).getAllByRole('checkbox')).toHaveLength(100);
  await user.click(screen.getByRole('button',{name:/아파트 더 보기/}));expect(within(search()).getAllByRole('checkbox')).toHaveLength(151);
  expect(screen.queryByRole('region',{name:/기간별 거래 내역/})).toBeNull();await user.type(screen.getByRole('searchbox',{name:'아파트 검색'}),'희소');
  const item=makeApartmentFavorite(rows.at(-1),region);await choose(user,item);expect(tradeTable(item)).toBeTruthy();expect(readPreferences('viewer').apartments).toEqual([]);
  await user.click(within(search()).getByRole('button',{name:/희소단지.*즐겨찾기 추가/}));expect(readPreferences('viewer').apartments).toEqual([item]);
  const favorites=screen.getByRole('group',{name:'즐겨찾기 아파트 선택'});expect(within(favorites).getByRole('checkbox').checked).toBe(true);
  await user.click(screen.getByRole('button',{name:label(item)+' 조회 제거'}));expect(readPreferences('apartmentTransactions').selected).toEqual([]);expect(readPreferences('viewer').apartments).toEqual([item]);
  await user.click(within(favorites).getByRole('checkbox'));expect(tradeTable(item)).toBeTruthy();
  await user.click(within(favorites).getByRole('button',{name:/즐겨찾기 해제/}));expect(readPreferences('viewer').apartments).toEqual([]);expect(tradeTable(item)).toBeTruthy();
 });
 it('paginates histories and returns to the first page when the common exact area range changes',async()=>{
  const user=userEvent.setup();render(<App initialManifest={manifest} districtLoader={async()=>Array.from({length:52},(_,index)=>row({id:index+1,area_m2:index===0?60:85,price_man:index===0?77000:100000}))}/>);
  await screen.findByRole('group',{name:'검색 아파트 선택'});await choose(user);const table=tradeTable(favorite);expect(within(table).getAllByRole('row')).toHaveLength(51);
  await user.click(screen.getByRole('button',{name:label(favorite)+' 다음 거래 페이지'}));expect(within(table).getAllByRole('row')).toHaveLength(3);expect(within(table).getByText('7.70억 원')).toBeTruthy();
  fireEvent.change(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}),{target:{value:'60'}});expect(within(table).getAllByRole('row')).toHaveLength(2);expect(screen.getByRole('button',{name:label(favorite)+' 이전 거래 페이지'}).disabled).toBe(true);
 });
 it('keeps selections across search regions, requests each district once, and restores the entire shared query',async()=>{
  const user=userEvent.setup(),otherItem=makeApartmentFavorite(row({region_code:'11110',dong:'청운동'}),other);
  const loader=vi.fn(async(_,code)=>[row(code==='41465'?{}:{region_code:code,dong:'청운동'})]);
  let view=render(<App initialManifest={manifest} districtLoader={loader}/>);await screen.findByRole('group',{name:'검색 아파트 선택'});await choose(user);
  await user.selectOptions(screen.getByRole('combobox',{name:'조회 지역'}),'area_11110');await waitFor(()=>expect(within(search()).getByRole('checkbox',{name:/청운동/})).toBeTruthy());await choose(user,otherItem);
  expect(tradeTable(favorite)).toBeTruthy();expect(tradeTable(otherItem)).toBeTruthy();expect(loader).toHaveBeenCalledTimes(2);
  const shared=window.location.search;expect(new URLSearchParams(shared).getAll('apt')).toHaveLength(2);
  view.unmount();localStorage.clear();window.history.replaceState(null,'',shared);view=render(<App initialManifest={manifest} districtLoader={loader}/>);await screen.findByRole('region',{name:label(otherItem)+' 기간별 거래 내역'});
  expect(readPreferences('apartmentTransactions').selected).toEqual([favorite,otherItem]);expect(readPreferences('viewer').apartments).toEqual([]);
 });
 it('does not lose selections when a failed search region retries or an earlier response arrives late',async()=>{
  const user=userEvent.setup();let resolveOld;let attempts=0;const loader=vi.fn((_,code)=>code==='41465'?new Promise(resolve=>{resolveOld=resolve;}):++attempts===1?Promise.reject(new Error('offline')):Promise.resolve([row({region_code:code,dong:'청운동'})]));
  render(<App initialManifest={manifest} districtLoader={loader}/>);await waitFor(()=>expect(loader).toHaveBeenCalledTimes(1));await user.selectOptions(screen.getByRole('combobox',{name:'조회 지역'}),'area_11110');await screen.findByRole('alert');resolveOld([row()]);
  await user.click(screen.getByRole('button',{name:'다시 불러오기'}));await screen.findByRole('group',{name:'검색 아파트 선택'});expect(within(search()).queryByRole('checkbox',{name:/풍덕천동/})).toBeNull();
 });
});
