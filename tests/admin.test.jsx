import React,{useEffect} from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Admin from '../admin/Admin.jsx';
const region={region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_name:'서울특별시 종로구',region_code:'11110',dongs:['청운동']};
const state={catalog:[region],saved:[],csrf:'token',keyReady:true,currentMonth:'202601',job:{status:'idle',completed:0,total:0,rows:0},stats:{count:0},history:[]};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('Local React administrator',()=>{
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
