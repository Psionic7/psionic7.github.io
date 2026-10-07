import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import {PREFERENCES_KEY,readPreferences,savePreferences} from '../src/preferences.js';

const a={region_id:'dong_41465101',label:'경기도 용인시 수지구 풍덕천동',region_name:'경기도 용인시 수지구',region_code:'41465',dongs:['풍덕천동']};
const b={...a,region_id:'dong_41465103',label:'경기도 용인시 수지구 동천동',dongs:['동천동']};
const seoul={region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_name:'서울특별시 종로구',region_code:'11110',dongs:['청운동']};
const months=['202601','202602','202609','202610'];
const manifest={regions:[a,b,seoul],favorite_region_ids:[],districts:{'41465':{file:'suji.json',months},'11110':{file:'seoul.json',months}},months,published_at:'2026-10-03T12:00:00Z',count:4};
const row=(id,changes={})=>({id,region_code:'41465',dong:'풍덕천동',jibun:'1',apartment:'기억단지',area_m2:60,price_man:100000,deal_month:'202602',deal_date:'2026-02-10',floor:10,cancelled:0,raw:{},...changes});
const rows=[row(1),row(2,{area_m2:85}),row(3,{deal_month:'202609',deal_date:'2026-09-28'}),row(4,{dong:'동천동',apartment:'동천단지',deal_month:'202609',deal_date:'2026-09-28'})];
const loader=(_,code)=>Promise.resolve(code==='41465'?rows:[]);
const open=()=>render(<App initialManifest={manifest} districtLoader={loader}/>);
beforeEach(()=>{window.localStorage.clear();window.history.replaceState(null,'','/');});
afterEach(()=>{cleanup();vi.restoreAllMocks();window.localStorage.clear();});

describe('Browser selection persistence',()=>{
  it('restores the apartment, exact area, period, searches and unit on a new visit',async()=>{
    const user=userEvent.setup();
    window.history.replaceState(null,'','/?region=area_41465&tab=apartments');
    const first=open();
    await screen.findByRole('combobox',{name:'조회 아파트'},{timeout:5000});
    await user.selectOptions(screen.getByRole('combobox',{name:'시작 계약월'}),'202602');
    await user.selectOptions(screen.getByRole('combobox',{name:'종료 계약월'}),'202602');
    await user.selectOptions(screen.getByRole('combobox',{name:'시도'}),'경기도');
    await user.selectOptions(screen.getByRole('combobox',{name:'시'}),'용인시');
    await user.selectOptions(screen.getByRole('combobox',{name:'구'}),'수지구');
    await user.type(screen.getByRole('searchbox',{name:'지역 검색'}),'수지');
    await user.type(screen.getByRole('searchbox',{name:'아파트 검색'}),'기억');
    const key=JSON.stringify(['풍덕천동','1','기억단지']);
    await user.selectOptions(screen.getByRole('combobox',{name:'조회 아파트'}),key);
    await user.selectOptions(screen.getByRole('combobox',{name:'단지 전용면적'}),'60');
    await user.click(screen.getByRole('button',{name:'평 (전용)',exact:true}));
    first.unmount();window.history.replaceState(null,'','/');open();
    await screen.findByRole('heading',{name:'기억단지'});
    expect(screen.getByRole('combobox',{name:'조회 아파트'}).value).toBe(key);
    expect(screen.getByRole('combobox',{name:'단지 전용면적'}).value).toBe('60');
    expect(screen.getByRole('combobox',{name:'시작 계약월'}).value).toBe('202602');
    expect(screen.getByRole('combobox',{name:'종료 계약월'}).value).toBe('202602');
    expect(screen.getByRole('combobox',{name:'시도'}).value).toBe('경기도');
    expect(screen.getByRole('searchbox',{name:'지역 검색'}).value).toBe('수지');
    expect(screen.getByRole('searchbox',{name:'아파트 검색'}).value).toBe('기억');
    expect(screen.getByRole('button',{name:'평 (전용)',exact:true}).getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('region',{name:'선택 아파트 실거래 내역'})).getAllByRole('row')).toHaveLength(2);
  });

  it('retains dashboard filters when reopening the same URL',async()=>{
    const user=userEvent.setup();window.history.replaceState(null,'','/?region=area_41465');
    const first=open();await screen.findByText('유효 거래',{selector:'.metric-label'});
    const max=screen.getByRole('spinbutton',{name:/최대 전용면적/});await user.clear(max);await user.type(max,'70');
    await user.click(screen.getByText('법정동 전체',{selector:'summary'}));
    await user.click(screen.getByRole('checkbox',{name:'풍덕천동'}));
    first.unmount();open();await screen.findByText('유효 거래',{selector:'.metric-label'});
    expect(screen.getByRole('spinbutton',{name:/최대 전용면적/}).value).toBe('70');
    expect(screen.getByRole('checkbox',{name:'풍덕천동',hidden:true}).checked).toBe(true);
    expect(screen.getByText('유효 거래',{selector:'.metric-label'}).closest('section').querySelector('.metric-value').textContent).toBe('2건');
  });

  it('restores weekly dongs in selection order with the week and search',async()=>{
    const user=userEvent.setup();window.history.replaceState(null,'','/?tab=weekly');
    const first=open();await screen.findByRole('checkbox',{name:/풍덕천동/});
    await user.click(screen.getByRole('checkbox',{name:/동천동/}));
    await user.click(screen.getByRole('checkbox',{name:/풍덕천동/}));
    await user.type(screen.getByRole('searchbox',{name:'주간 동 검색'}),'동천');
    first.unmount();window.history.replaceState(null,'','/');open();
    await screen.findByRole('region',{name:`${b.label} 주간 거래 내역`});
    expect([...document.querySelector('.weekly-stack').children].map(item=>item.getAttribute('aria-label'))).toEqual([b,a].map(item=>`${item.label} 주간 실거래가`));
    expect(screen.getByLabelText('조회 주 기준 날짜').value).toBe('2026-09-28');
    expect(screen.getByRole('searchbox',{name:'주간 동 검색'}).value).toBe('동천');
    expect(readPreferences('explorer').weeklyIds).toEqual([b.region_id,a.region_id]);
  });

  it('lets an explicit shared region and period override the previous visit',async()=>{
    savePreferences('explorer',{regionId:'area_41465',tab:'apartments',start:'202601',end:'202601',province:'경기도',city:'용인시',search:'수지',selectedApartment:JSON.stringify(['풍덕천동','1','기억단지'])});
    window.history.replaceState(null,'','/?tab=dashboard&region=area_11110&start=202602&end=202609');open();
    await screen.findByText('이 지역은 아직 수집된 자료가 없습니다.');
    expect(screen.getByRole('combobox',{name:'조회 지역'}).value).toBe('area_11110');
    expect(screen.getByRole('combobox',{name:'시작 계약월'}).value).toBe('202602');
    expect(screen.getByRole('combobox',{name:'종료 계약월'}).value).toBe('202609');
    expect(screen.getByRole('combobox',{name:'시도'}).value).toBe('');
  });

  it('ignores damaged or obsolete saved values and survives storage denial',async()=>{
    window.localStorage.setItem(PREFERENCES_KEY,'{broken');
    const first=open();await screen.findByRole('heading',{name:'조회할 지역을 선택해 주세요.'});first.unmount();
    savePreferences('explorer',{regionId:'removed',tab:'invalid',weeklyIds:[a.region_id,'removed'],weeklyDay:'2099-01-01'});
    window.history.replaceState(null,'','/');const second=open();
    expect(screen.getByRole('combobox',{name:'조회 지역'}).value).toBe('');second.unmount();
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
    window.history.replaceState(null,'','/?region=area_41465');open();
    await screen.findByText('유효 거래',{selector:'.metric-label'});
    expect(screen.getByRole('combobox',{name:'조회 지역'}).value).toBe('area_41465');
  });

  it('clears only this app preferences when the viewer resets them',async()=>{
    const user=userEvent.setup();window.localStorage.setItem('unrelated','keep');
    savePreferences('explorer',{regionId:'area_41465',tab:'about'});savePreferences('display',{areaUnit:'pyeong'});
    open();await user.click(screen.getByRole('button',{name:'이 브라우저의 조회 설정 초기화'}));
    expect(screen.getByRole('combobox',{name:'조회 지역'}).value).toBe('');
    expect(readPreferences('display')).toEqual({});expect(window.localStorage.getItem('unrelated')).toBe('keep');
  });
});
