import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import {readPreferences} from '../src/preferences.js';

const a={region_id:'dong_41465101',label:'경기도 용인시 수지구 풍덕천동',region_name:'경기도 용인시 수지구',region_code:'41465',dongs:['풍덕천동']};
const b={region_id:'dong_11110101',label:'서울특별시 종로구 풍덕천동',region_name:'서울특별시 종로구',region_code:'11110',dongs:['풍덕천동']};
const c={...a,region_id:'dong_41465103',label:'경기도 용인시 수지구 동천동',dongs:['동천동']};
const uncollected={...a,region_id:'dong_41117101',label:'경기도 수원시 영통구 매탄동',region_name:'경기도 수원시 영통구',region_code:'41117',dongs:['매탄동']};
const manifest={regions:[a,b,c,uncollected],favorite_region_ids:[a.region_id],districts:{'41465':{file:'suji.json',months:['202609','202610']},'11110':{file:'seoul.json',months:['202610']}},months:['202609','202610'],published_at:'2026-10-03T12:00:00Z',count:8};
const row=(id,overrides={})=>({id,region_code:'41465',dong:'풍덕천동',apartment:'수지단지',jibun:'1',area_m2:85,price_man:100000,deal_month:'202609',deal_date:'2026-09-28',floor:10,cancelled:0,raw:{dealingGbn:'중개거래'},...overrides});
beforeEach(()=>{window.localStorage.clear();window.history.replaceState(null,'','/?tab=weekly');});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('Dong weekly transaction tab',()=>{
  it('connects both slider handles to the filters, prevents crossing and supports unbounded endpoints',async()=>{
    window.history.replaceState(null,'',`/?tab=weekly&dong=${a.region_id}`);
    render(<App initialManifest={manifest} districtLoader={()=>Promise.resolve([row(1,{area_m2:60}),row(2),row(3,{area_m2:120})])}/>);
    await screen.findByRole('region',{name:`${a.label} 주간 거래 내역`});
    const lower=screen.getByRole('slider',{name:'최소 전용면적 슬라이더 (㎡)'});
    const upper=screen.getByRole('slider',{name:'최대 전용면적 슬라이더 (㎡)'});
    fireEvent.change(upper,{target:{value:'85'}});
    fireEvent.change(lower,{target:{value:'60'}});
    expect(screen.getByRole('spinbutton',{name:'최소 전용면적 (㎡)'}).value).toBe('60');
    expect(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}).value).toBe('85');
    expect(within(screen.getByRole('region',{name:`${a.label} 주간 거래 내역`})).getAllByRole('row')).toHaveLength(3);
    fireEvent.keyDown(lower,{key:'ArrowRight'});
    expect(lower.value).toBe('61');
    fireEvent.change(lower,{target:{value:'100'}});
    expect(lower.value).toBe('85');expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(upper,{target:{value:'40'}});
    expect(upper.value).toBe('85');
    fireEvent.change(lower,{target:{value:'0'}});
    fireEvent.change(upper,{target:{value:upper.max}});
    expect(readPreferences('weekly')).toMatchObject({minArea:'',maxArea:''});
    fireEvent.change(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}),{target:{value:'400'}});
    expect(Number(upper.max)).toBeGreaterThanOrEqual(400);expect(upper.value).toBe('400');
  });
  it('filters every dong and its statistics inclusively, keeps exact bounds across units and revisits, and resets the range',async()=>{
    const user=userEvent.setup();
    window.history.replaceState(null,'',`/?tab=weekly&dong=${a.region_id}&dong=${b.region_id}`);
    const loader=vi.fn((_,code)=>Promise.resolve([
      row(1,{region_code:code,area_m2:59.99,apartment:'작은단지',price_man:30000}),
      row(2,{region_code:code,area_m2:60,apartment:'경계60단지',price_man:60000}),
      row(3,{region_code:code,area_m2:85,apartment:'경계85단지',price_man:100000}),
      row(4,{region_code:code,area_m2:85.01,apartment:'큰단지',price_man:150000}),
      row(5,{region_code:code,cancelled:1,area_m2:70,apartment:'해제단지',price_man:900000})
    ]));
    const first=render(<App initialManifest={manifest} districtLoader={loader}/>);
    await screen.findByRole('region',{name:`${b.label} 주간 거래 내역`});
    await user.type(screen.getByRole('spinbutton',{name:'최소 전용면적 (㎡)'}),'60');
    await user.type(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}),'85');
    for(const region of [a,b]){
      const table=screen.getByRole('region',{name:`${region.label} 주간 거래 내역`});
      expect(within(table).getAllByRole('row')).toHaveLength(3);
      expect(within(table).queryByText('작은단지')).toBeNull();
      expect(within(table).queryByText('큰단지')).toBeNull();
      expect(within(table).queryByText('해제단지')).toBeNull();
      const metrics=screen.getByLabelText(`${region.label} 주간 통계`);
      expect(within(metrics).getByText('유효 거래').parentElement.textContent).toBe('유효 거래2건');
      expect(within(metrics).getByText('거래금액 중앙값').parentElement.textContent).toBe('거래금액 중앙값8.00억 원');
    }
    await user.click(screen.getByRole('button',{name:'평 (전용)',exact:true}));
    expect(screen.getByRole('spinbutton',{name:'최소 전용면적 (평)'}).value).toBe('18.15');
    expect(readPreferences('weekly')).toMatchObject({minArea:60,maxArea:85});
    expect(within(screen.getByRole('region',{name:`${a.label} 주간 거래 내역`})).getAllByRole('row')).toHaveLength(3);
    expect(loader).toHaveBeenCalledTimes(2);
    first.unmount();window.history.replaceState(null,'','/');
    render(<App initialManifest={manifest} districtLoader={loader}/>);
    await screen.findByRole('region',{name:`${b.label} 주간 거래 내역`});
    expect(screen.getByRole('spinbutton',{name:'최대 전용면적 (평)'}).value).toBe('25.7125');
    await user.click(screen.getByRole('button',{name:'㎡',exact:true}));
    const min=screen.getByRole('spinbutton',{name:'최소 전용면적 (㎡)'});
    expect(min.value).toBe('60');
    await user.clear(min);await user.type(min,'90');
    expect(screen.getByRole('alert').textContent).toContain('최소 전용면적은 최대 전용면적보다');
    expect(screen.getAllByText('이 주의 면적 조건에 맞는 유효 거래가 없습니다.')).toHaveLength(2);
    await user.click(screen.getByRole('button',{name:'면적 필터 초기화'}));
    expect(min.value).toBe('');expect(screen.queryByRole('alert')).toBeNull();
    expect(within(screen.getByRole('region',{name:`${a.label} 주간 거래 내역`})).getAllByRole('row')).toHaveLength(5);
  });
  it('stacks multiple districts in selection order, keeps selections during search, caches shared districts and changes area units',async()=>{
    const user=userEvent.setup();
    const data=[row(1),row(2,{deal_month:'202610',deal_date:'2026-10-04',price_man:120000}),row(3,{deal_date:'2026-09-27',price_man:700000}),row(4,{cancelled:1,price_man:800000}),row(5,{dong:'동천동',apartment:'동천단지'}),row(6,{deal_date:'2026-10-05',price_man:900000})];
    const loader=vi.fn((_,code)=>Promise.resolve(code==='41465'?data:[row(1,{region_code:'11110',apartment:'서울단지',price_man:50000})]));
    render(<App initialManifest={manifest} districtLoader={loader}/>);
    await screen.findByText('주간 실거래가를 볼 동을 선택해 주세요.');
    expect(loader).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox',{name:/풍덕천동.*용인시/}));
    const sectionA=screen.getByRole('region',{name:`${a.label} 주간 실거래가`});
    await within(sectionA).findByText('11.00');
    const tableA=within(sectionA).getByRole('region',{name:`${a.label} 주간 거래 내역`});
    expect(within(tableA).getAllByRole('row')).toHaveLength(3);
    await user.click(screen.getByRole('checkbox',{name:/풍덕천동.*종로구/}));
    const sectionB=screen.getByRole('region',{name:`${b.label} 주간 실거래가`});
    await within(sectionB).findByText('5.00억 원');
    expect(within(sectionA).queryByText('서울단지')).toBeNull();
    await user.click(screen.getByRole('checkbox',{name:/동천동.*용인시/}));
    await screen.findByText('동천단지');
    const stack=document.querySelector('.weekly-stack');
    expect([...stack.children].map(el=>el.getAttribute('aria-label'))).toEqual([a,b,c].map(region=>`${region.label} 주간 실거래가`));
    expect(loader).toHaveBeenCalledTimes(2);
    await user.type(screen.getByRole('searchbox',{name:'주간 동 검색'}),'동천');
    expect(screen.queryByRole('checkbox',{name:/풍덕천동.*용인시/})).toBeNull();
    expect(screen.getByRole('region',{name:`${a.label} 주간 실거래가`})).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'평 (전용)',exact:true}));
    expect(within(tableA).getAllByRole('cell',{name:'25.71평'})).toHaveLength(2);
    await user.click(screen.getByRole('button',{name:`${b.label} 조회 제거`}));
    expect(screen.queryByRole('region',{name:`${b.label} 주간 실거래가`})).toBeNull();
    expect(window.location.search).toContain('week=2026-09-28');
    expect(new URLSearchParams(window.location.search).getAll('dong')).toEqual([a.region_id,c.region_id]);
  });
  it('restores selected dongs from the URL, paginates each card and resets pages on week changes',async()=>{
    const user=userEvent.setup();
    window.history.replaceState(null,'',`/?tab=weekly&dong=${a.region_id}&dong=invalid&dong=${a.region_id}&week=2026-10-01`);
    const loader=vi.fn(()=>Promise.resolve(Array.from({length:52},(_,i)=>row(i+1,{price_man:i===0?77000:100000}))));
    render(<App initialManifest={manifest} districtLoader={loader}/>);
    const table=await screen.findByRole('region',{name:`${a.label} 주간 거래 내역`});
    expect(within(table).getAllByRole('row')).toHaveLength(51);
    await user.click(screen.getByRole('button',{name:`${a.label} 다음 거래 페이지`}));
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('7.70억 원')).toBeTruthy();
    await user.type(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}),'85');
    await waitFor(()=>expect(screen.getByRole('button',{name:`${a.label} 이전 거래 페이지`}).disabled).toBe(true));
    expect(within(screen.getByRole('region',{name:`${a.label} 주간 거래 내역`})).getAllByRole('row')).toHaveLength(51);
    await user.click(screen.getByRole('button',{name:'면적 필터 초기화'}));
    await user.click(screen.getByRole('button',{name:'이전 주',exact:true}));
    await screen.findByText('이 주에 조회되는 유효 거래가 없습니다.');
    await user.click(screen.getByRole('button',{name:'다음 주',exact:true}));
    const refreshed=screen.getByRole('region',{name:`${a.label} 주간 거래 내역`});
    expect(within(refreshed).getAllByRole('row')).toHaveLength(51);
    expect(screen.getByRole('button',{name:`${a.label} 이전 거래 페이지`}).disabled).toBe(true);
    expect(screen.getByRole('button',{name:'다음 주',exact:true}).disabled).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button',{name:'데이터 안내',exact:true}));
    await user.click(screen.getByRole('button',{name:'동별 주간 실거래가',exact:true}));
    await screen.findByRole('region',{name:`${a.label} 주간 거래 내역`});
    expect(screen.getByRole('checkbox',{name:/풍덕천동.*용인시/}).checked).toBe(true);
  });
  it('isolates a failed district, retries it, and never fetches an uncollected district',async()=>{
    const user=userEvent.setup();
    window.history.replaceState(null,'',`/?tab=weekly&dong=${a.region_id}&dong=${b.region_id}&dong=${uncollected.region_id}`);
    let attempts=0;
    const loader=vi.fn((_,code)=>code==='11110'&&attempts++===0?Promise.reject(new Error('failure')):Promise.resolve([row(1,{region_code:code})]));
    render(<App initialManifest={manifest} districtLoader={loader}/>);
    await screen.findByRole('alert');
    await screen.findByRole('region',{name:`${a.label} 주간 거래 내역`});
    expect(screen.getByText('아직 수집된 자료가 없는 동입니다.')).toBeTruthy();
    expect(loader.mock.calls.map(call=>call[1]).sort()).toEqual(['11110','41465']);
    await user.click(screen.getByRole('button',{name:'다시 불러오기',exact:true}));
    await screen.findByRole('region',{name:`${b.label} 주간 거래 내역`});
    expect(loader).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole('button',{name:'선택 모두 해제'}));
    expect(screen.queryByRole('region',{name:`${a.label} 주간 실거래가`})).toBeNull();
    expect(screen.getByText('주간 실거래가를 볼 동을 선택해 주세요.')).toBeTruthy();
  });
  it('does not restore a removed card when an earlier request finishes late',async()=>{
    const user=userEvent.setup();let resolve;
    const loader=vi.fn(()=>new Promise(done=>{resolve=done;}));
    render(<App initialManifest={manifest} districtLoader={loader}/>);
    await screen.findByRole('checkbox',{name:/풍덕천동.*용인시/});
    await user.click(screen.getByRole('checkbox',{name:/풍덕천동.*용인시/}));
    await waitFor(()=>expect(loader).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button',{name:`${a.label} 조회 제거`}));
    resolve([row(1)]);
    await waitFor(()=>expect(screen.queryByRole('region',{name:`${a.label} 주간 실거래가`})).toBeNull());
  });
});
