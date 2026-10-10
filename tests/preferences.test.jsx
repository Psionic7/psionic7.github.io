import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
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
  it('discards invalid saved periods and accepts a valid custom period from a shared URL',async()=>{
    savePreferences('explorer',{tab:'weekly',weeklyIds:[a.region_id],weeklyPeriod:{mode:'custom',start:'2099-01-01',end:'2099-02-01'}});
    const first=open();await screen.findByRole('region',{name:`${a.label} 주간 거래 내역`});
    expect(screen.getByRole('button',{name:'주간',exact:true}).getAttribute('aria-pressed')).toBe('true');
    first.unmount();window.history.replaceState(null,'',`/?tab=weekly&dong=${a.region_id}&period=custom&from=2026-02-09&to=2026-02-10`);open();
    const table=await screen.findByRole('region',{name:`${a.label} 기간별 거래 내역`});
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByLabelText('조회 시작일').value).toBe('2026-02-09');
    expect(screen.getByLabelText('조회 종료일').value).toBe('2026-02-10');
  });
  it('restores apartment selections, exact area range, period, searches and unit on a new visit',async()=>{
    const user=userEvent.setup();window.history.replaceState(null,'','/?region=area_41465&tab=apartments&period=month&month=2026-02');
    const first=open();const search=await screen.findByRole('group',{name:'검색 아파트 선택'});
    await user.selectOptions(screen.getByRole('combobox',{name:'시도'}),'경기도');await user.selectOptions(screen.getByRole('combobox',{name:'시'}),'용인시');await user.selectOptions(screen.getByRole('combobox',{name:'구'}),'수지구');
    await user.type(screen.getByRole('searchbox',{name:'지역 검색'}),'수지');await user.type(screen.getByRole('searchbox',{name:'아파트 검색'}),'기억');
    await user.click(within(search).getByRole('checkbox',{name:/기억단지/}));
    fireEvent.change(screen.getByRole('spinbutton',{name:'최소 전용면적 (㎡)'}),{target:{value:'60'}});fireEvent.change(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}),{target:{value:'60'}});
    await user.click(screen.getByRole('button',{name:'평 (전용)',exact:true}));first.unmount();window.history.replaceState(null,'','/');open();
    const table=await screen.findByRole('region',{name:/기억단지.*기간별 거래 내역/});expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByLabelText('조회 월').value).toBe('2026-02');expect(screen.getByRole('combobox',{name:'시도'}).value).toBe('경기도');expect(screen.getByRole('searchbox',{name:'지역 검색'}).value).toBe('수지');expect(screen.getByRole('searchbox',{name:'아파트 검색'}).value).toBe('기억');
    expect(readPreferences('apartmentTransactions')).toMatchObject({minArea:60,maxArea:60});expect(screen.getByRole('button',{name:'평 (전용)',exact:true}).getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('group',{name:'검색 아파트 선택'})).getByRole('checkbox',{name:/기억단지/}).checked).toBe(true);
  });
  it('retains apartment transaction filters separately from dong filters',async()=>{
    const user=userEvent.setup();window.history.replaceState(null,'','/?tab=apartments');
    const first=open();await screen.findByText('실거래가를 볼 아파트를 선택해 주세요.');
    fireEvent.change(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}),{target:{value:'70'}});
    await user.click(screen.getByRole('button',{name:'10평대',exact:true}));
    first.unmount();open();await screen.findByText('실거래가를 볼 아파트를 선택해 주세요.');
    expect(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}).value).toBe('66.1157');
    expect(screen.getByRole('spinbutton',{name:'최소 전용면적 (㎡)'}).value).toBe('33.0579');
    expect(screen.getByRole('button',{name:'10평대',exact:true}).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button',{name:'동 별 실거래가',exact:true}));
    await screen.findByText('실거래가를 볼 동을 선택해 주세요.');
    expect(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}).value).toBe('');
    expect(screen.getByRole('button',{name:'10평대',exact:true}).getAttribute('aria-pressed')).toBe('false');
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

  it('lets an explicit shared region and legacy monthly period override the previous visit',async()=>{
    savePreferences('explorer',{regionId:'area_41465',tab:'apartments',start:'202601',end:'202601',province:'경기도',city:'용인시',search:'수지',selectedApartment:JSON.stringify(['풍덕천동','1','기억단지'])});
    window.history.replaceState(null,'','/?tab=apartments&region=area_11110&start=202602&end=202609');open();await screen.findByText('검색 조건과 일치하는 아파트가 없습니다.');
    expect(screen.getByRole('combobox',{name:'조회 지역'}).value).toBe('area_11110');expect(screen.getByLabelText('조회 시작일').value).toBe('2026-02-01');expect(screen.getByLabelText('조회 종료일').value).toBe('2026-09-30');expect(screen.getByRole('combobox',{name:'시도'}).value).toBe('');expect(readPreferences('apartmentTransactions').selected).toEqual([]);
  });
  it('ignores damaged or obsolete saved values and survives storage denial',async()=>{
    window.localStorage.setItem(PREFERENCES_KEY,'{broken');
    const first=open();await screen.findByRole('heading',{name:'즐겨찾기를 추가해 대시보드를 채워보세요.'});first.unmount();
    savePreferences('explorer',{regionId:'removed',tab:'invalid',weeklyIds:[a.region_id,'removed'],weeklyDay:'2099-01-01'});
    window.history.replaceState(null,'','/');const second=open();
    await screen.findByText('즐겨찾기를 추가해 대시보드를 채워보세요.');second.unmount();
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
    window.history.replaceState(null,'','/?region=area_41465&tab=apartments');open();
    await screen.findByRole('group',{name:'검색 아파트 선택'});
    expect(screen.getByRole('combobox',{name:'조회 지역'}).value).toBe('area_41465');
  });

  it('clears only this app preferences when the viewer resets them',async()=>{
    const user=userEvent.setup();window.localStorage.setItem('unrelated','keep');
    savePreferences('explorer',{regionId:'area_41465',tab:'about'});savePreferences('display',{areaUnit:'pyeong'});
    open();await user.click(screen.getByRole('button',{name:'이 브라우저의 조회 설정 초기화'}));
    await screen.findByText('즐겨찾기를 추가해 대시보드를 채워보세요.');
    expect(readPreferences('display')).toEqual({});expect(readPreferences('viewer').apartments).toEqual([]);expect(readPreferences('viewer').regions).toEqual([]);expect(window.localStorage.getItem('unrelated')).toBe('keep');
  });
});
