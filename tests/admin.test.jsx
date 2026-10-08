import React,{useEffect} from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Admin from '../admin/Admin.jsx';
const region={region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_name:'서울특별시 종로구',region_code:'11110',dongs:['청운동']};
const state={catalog:[region],saved:[],csrf:'token',keyReady:true,currentMonth:'202601',job:{status:'idle',completed:0,total:0,rows:0},stats:{count:0},history:[]};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('Local React administrator',()=>{
  it('queries local raw data with CSRF while preserving the unsaved collection draft and map',async()=>{
    const user=userEvent.setup(),mounted=vi.fn(),unmounted=vi.fn();
    function Map({draft,onToggle}){useEffect(()=>{mounted();return unmounted;},[]);return <button onClick={()=>onToggle(region.region_id)}>지역 별표 {draft.includes(region.region_id)?'★':'☆'}</button>;}
    const row={id:1,region_code:'11110',deal_month:'202601',deal_date:'2026-01-09',apartment:'로컬 아파트',dong:'청운동',jibun:'001-2',price_man:100000,area_m2:85,cancelled:1,raw:{aptNm:'로컬 아파트',umdNm:'청운동',excluUseAr:'85',cdealType:'O'}};
    const request=vi.fn(async(endpoint)=>endpoint==='raw-data'?{rows:[row]}:state);
    render(<Admin initialState={{...state,stats:{count:1,districts:[{region_code:'11110',start:'202601',end:'202601'}]}}} initialBoundaries={{}} initialAdminBoundaries={{}} request={request} MapComponent={Map}/>);
    await user.click(screen.getByRole('button',{name:'지역 별표 ☆'}));
    await user.click(screen.getByRole('button',{name:'원천 데이터'}));
    await user.selectOptions(screen.getByRole('combobox',{name:'조회 지역'}),region.region_id);
    await screen.findByText('로컬 아파트');
    expect(request).toHaveBeenCalledWith('raw-data',{region_id:region.region_id,start:'202601',end:'202601'},'token');
    await user.click(screen.getByRole('button',{name:'평 (전용)'}));
    expect(screen.getByText('25.71')).toBeTruthy();
    expect(request.mock.calls.some(([endpoint])=>endpoint==='favorites')).toBe(false);
    await user.click(screen.getByRole('button',{name:'데이터 수집'}));
    expect(screen.getByText(/업데이트 필요 · 추가 1곳/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'지역 별표 ★'})).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);expect(unmounted).not.toHaveBeenCalled();
  });
  it('star edits only the draft; map survives an explicit save and file/API updates happen only then',async()=>{
    const user=userEvent.setup(),mounted=vi.fn(),unmounted=vi.fn();
    function Map({catalog,draft,onToggle}){useEffect(()=>{mounted();return unmounted;},[catalog]);return <button onClick={()=>onToggle(region.region_id)}>지도 별표 {draft.includes(region.region_id)?'★':'☆'}</button>;}
    let persisted=[];
    const request=vi.fn(async(endpoint,body)=>{if(endpoint==='favorites'){persisted=body.ids;return{saved:persisted};}return{...state,catalog:[{...region}],saved:persisted};});
    render(<Admin initialState={state} initialBoundaries={{}} initialAdminBoundaries={{}} request={request} MapComponent={Map}/>);
    expect(screen.getByRole('button',{name:'수집 지역 업데이트'}).disabled).toBe(true);
    await user.click(screen.getByRole('button',{name:'지도 별표 ☆'}));
    expect(screen.getByText(/업데이트 필요 · 추가 1곳/)).toBeTruthy();expect(request).not.toHaveBeenCalled();expect(persisted).toEqual([]);expect(mounted).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button',{name:'수집 지역 업데이트'}));
    await waitFor(()=>expect(request).toHaveBeenCalledWith('favorites',{ids:[region.region_id]},'token'));
    await screen.findByText('저장된 수집 지역과 일치합니다.');expect(mounted).toHaveBeenCalledTimes(1);expect(unmounted).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'지도 별표 ★'}));expect(screen.getByText(/업데이트 필요 · 추가 0곳 · 해제 1곳/)).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'변경사항 되돌리기'}));expect(screen.getByRole('button',{name:'지도 별표 ★'})).toBeTruthy();expect(persisted).toEqual([region.region_id]);
  });
  it('collects the saved selection while edits remain in memory',async()=>{
    const user=userEvent.setup();function Map({onToggle}){return <button onClick={()=>onToggle(region.region_id)}>지역 해제</button>;}
    const request=vi.fn(async endpoint=>endpoint==='state'?{...state,saved:[region.region_id]}:{ok:true});
    render(<Admin initialState={{...state,saved:[region.region_id]}} initialBoundaries={{}} initialAdminBoundaries={{}} request={request} MapComponent={Map}/>);
    await user.click(screen.getByRole('button',{name:'지역 해제'}));await user.click(screen.getByRole('button',{name:'저장 지역 수집'}));
    expect(request).toHaveBeenCalledWith('collect',{start:'202601',end:'202601'},'token');expect(request.mock.calls.some(([endpoint])=>endpoint==='favorites')).toBe(false);
    expect(screen.getByText(/업데이트 필요 · 추가 0곳 · 해제 1곳/)).toBeTruthy();
  });
});

it('coordinate API key setup is visible and its missing state disables collection',async()=>{
  function Map(){return <div/>;}
  const request=vi.fn(async endpoint=>endpoint==='coordinate-points'?{points:[]}:{...state,coordinateKeyReady:false,stats:{count:0,pendingCoordinates:1,coordinateRevision:'v1'}});
  render(<Admin initialState={{...state,coordinateKeyReady:false,stats:{count:0,pendingCoordinates:1,coordinateRevision:'v1'}}} initialBoundaries={{}} initialAdminBoundaries={{}} request={request} MapComponent={Map}/>);
  expect(screen.getByRole('button',{name:'좌표 조회·저장'}).disabled).toBe(true);expect(screen.getByText(/좌표제공 API 승인키가 필요/)).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button',{name:'설정 확인'}));expect(request).toHaveBeenCalledWith('state',undefined,'token');
  expect(request.mock.calls.some(([endpoint])=>endpoint==='coordinates')).toBe(false);
});
it('coordinates collection uses the limit, refresh option and CSRF without saving selection',async()=>{
  function Map({coordinatePoints}){return <div>지도 좌표 {coordinatePoints.length}개</div>;}
  const ready={...state,coordinateKeyReady:true,stats:{count:0,pendingCoordinates:1,coordinateRevision:'v1'}};
  const request=vi.fn(async endpoint=>endpoint==='coordinate-points'?{points:[{apartment:'저장 아파트'}]}:ready);
  const user=userEvent.setup();render(<Admin initialState={ready} initialBoundaries={{}} initialAdminBoundaries={{}} request={request} MapComponent={Map}/>);
  await screen.findByText('지도 좌표 1개');await user.clear(screen.getByRole('spinbutton',{name:'이번 좌표 조회 건수'}));await user.type(screen.getByRole('spinbutton',{name:'이번 좌표 조회 건수'}),'25');
  await user.click(screen.getByRole('checkbox',{name:'기존 조회 결과도 다시 확인'}));await user.click(screen.getByRole('button',{name:'좌표 조회·저장'}));
  expect(request).toHaveBeenCalledWith('coordinates',{limit:25,refresh:true},'token');expect(request.mock.calls.some(([endpoint])=>endpoint==='favorites')).toBe(false);
});
