import React from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import RawTable from '../src/RawTable.jsx';
import Dashboard from '../src/Dashboard.jsx';
const region={region_id:'suji',label:'용인 수지구',region_name:'경기도 용인시 수지구',region_code:'41465',dongs:[]};
const rows=Array.from({length:115},(_,i)=>({id:i+1,region_code:'41465',deal_month:'202601',deal_date:'2026-01-05',apartment:i===0?'첫 아파트':'두번째',dong:'풍덕천동',jibun:'1',price_man:100000,area_m2:85,cancelled:0,raw:{aptNm:i===0?'첫 아파트':'두번째',umdNm:'풍덕천동',dealAmount:i===0?'100,000':'50,000',floor:'4',cdealType:''}}));
const manifest={regions:[region,{region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_name:'서울특별시 종로구',region_code:'11110',dongs:['청운동']}],districts:{'41465':{file:'fake.json',count:115,months:['202601']}},months:['202601'],published_at:'2026-10-02T00:00:00+00:00',count:115,boundary_catalog_date:'2023-07-29'};
beforeEach(()=>window.history.replaceState(null,'','/?region=suji&tab=raw'));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('React transaction explorer',()=>{
  it('renders real charts and excludes cancelled transactions from dashboard statistics',async()=>{
    vi.stubGlobal('ResizeObserver',class {
      constructor(callback){this.callback=callback;}
      observe(){this.callback([{contentRect:{width:800,height:300}}]);}
      unobserve(){}
      disconnect(){}
    });
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:800,height:300,top:0,left:0,right:800,bottom:300,x:0,y:0,toJSON(){}});
    const sample=[rows[0],{...rows[1],cancelled:1,price_man:900000}];
    render(<Dashboard rows={sample} region={region} manifest={manifest} start="202601" end="202601" districtLoader={()=>Promise.resolve(sample)}/>);
    await screen.findByText('1건의 해제 거래 제외');
    const metric=screen.getByText('유효 거래',{selector:'.metric-label'}).closest('section');
    expect(metric.querySelector('.metric-value').textContent).toBe('1건');
    expect(screen.getByText('거래금액 중앙값').closest('section').querySelector('.metric-value').textContent).toBe('10.00억 원');
    await waitFor(()=>expect(document.querySelectorAll('.recharts-surface').length).toBeGreaterThanOrEqual(3));
  });
  it('filters by an individual column, resets pagination, and keeps raw strings',async()=>{
    const user=userEvent.setup();
    render(<RawTable rows={rows} region={region} start="202601" end="202601"/>);
    expect(screen.getByText('100,000')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'다음 페이지'}));
    expect(screen.queryByText('첫 아파트')).toBeNull();
    await user.click(screen.getByLabelText('아파트명 필터'));
    await user.type(screen.getByRole('textbox',{name:'aptNm 필터 값'}),'첫');
    expect(screen.getByText('첫 아파트')).toBeTruthy();
    expect(screen.getByRole('button',{name:'다음 페이지'}).disabled).toBe(true);
    await user.click(screen.getByRole('button',{name:'필터 초기화'}));
    expect(screen.getByRole('button',{name:'다음 페이지'}).disabled).toBe(false);
  });
  it('numeric errors are visible and CSV exports all filtered rows rather than one page',async()=>{
    const user=userEvent.setup();
    const blobs=[];
    const create=vi.fn(blob=>{blobs.push(blob);return 'blob:test';});
    Object.defineProperty(URL,'createObjectURL',{value:create,configurable:true});
    Object.defineProperty(URL,'revokeObjectURL',{value:vi.fn(),configurable:true});
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    render(<RawTable rows={rows} region={region} start="202601" end="202601"/>);
    await user.click(screen.getByLabelText('거래금액(만원) 필터'));
    await user.selectOptions(screen.getByRole('combobox',{name:'dealAmount 필터 조건'}),'gte');
    await user.type(screen.getByRole('textbox',{name:'dealAmount 필터 값'}),'bad');
    expect(screen.getByRole('alert').textContent).toContain('숫자');
    expect(screen.getByRole('button',{name:'CSV 다운로드'}).disabled).toBe(true);
    await user.click(screen.getByRole('button',{name:'필터 초기화'}));
    await user.click(screen.getByRole('button',{name:'CSV 다운로드'}));
    const content=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(blobs[0]);});
    expect(content.split('\r\n').length).toBe(116);
  });
  it('allows city/district/dong navigation to an uncollected scope and exposes no collector',async()=>{
    const user=userEvent.setup();
    const loader=vi.fn((_,code)=>Promise.resolve(code==='41465'?rows:[]));
    render(<App initialManifest={manifest} districtLoader={loader}/>);
    await screen.findByText('첫 아파트');
    await user.selectOptions(screen.getByRole('combobox',{name:'시도'}),'서울특별시');
    await user.selectOptions(screen.getByRole('combobox',{name:'조회 지역'}),'dong_11110101');
    await screen.findByText('이 조건에 해당하는 실거래가 없습니다.');
    expect(window.location.search).toContain('dong_11110101');
    expect(screen.queryByRole('button',{name:'선택 지역 수집'})).toBeNull();
    await user.click(screen.getByRole('button',{name:'데이터 안내'}));
    expect(screen.getByText('로컬 전용')).toBeTruthy();
    expect(screen.getByRole('link',{name:'공개 SQLite 다운로드'}).getAttribute('href')).toBe('/data/public.sqlite3');
  });
  it('does not display a stale district when a slow previous request finishes',async()=>{
    const user=userEvent.setup();
    let resolveOld;
    const loader=vi.fn((_,code)=>code==='41465'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve([]));
    render(<App initialManifest={manifest} districtLoader={loader}/>);
    await user.selectOptions(screen.getByRole('combobox',{name:'조회 지역'}),'dong_11110101');
    await screen.findByText('이 조건에 해당하는 실거래가 없습니다.');
    resolveOld(rows);
    await waitFor(()=>expect(screen.queryByText('첫 아파트')).toBeNull());
  });
});
