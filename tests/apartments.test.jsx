import React, {useState} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApartmentPage from '../src/ApartmentPage.jsx';

const region={region_id:'area_41465',label:'경기도 용인시 수지구 전체',region_name:'경기도 용인시 수지구',region_code:'41465',dongs:[]};
const makeRow=(overrides={})=>({id:1,region_code:'41465',deal_month:'202601',deal_date:'2026-01-05',apartment:'동일아파트',dong:'풍덕천동',jibun:'1',price_man:100000,area_m2:85,floor:10,build_year:2000,cancelled:0,raw:{dealingGbn:'중개거래'},...overrides});
function ApartmentHarness({rows}) {
  const [selectedKey,onSelect]=useState('');
  return <ApartmentPage rows={rows} region={region} start="202601" end="202604" selectedKey={selectedKey} onSelect={onSelect}/>;
}
const renderApartments=rows=>render(<ApartmentHarness rows={rows}/>);
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('Apartment transaction detail',()=>{
  it('isolates the chosen lot, excludes cancellations and retains an exact area through unit changes',async()=>{
    const user=userEvent.setup();
    renderApartments([
      makeRow(),
      makeRow({id:2,deal_month:'202603',deal_date:'2026-03-10',price_man:120000,floor:15}),
      makeRow({id:3,deal_month:'202602',deal_date:'2026-02-10',price_man:90000,area_m2:60,floor:5}),
      makeRow({id:4,jibun:'2',price_man:900000}),
      makeRow({id:5,deal_month:'202604',deal_date:'2026-04-01',price_man:800000,cancelled:1}),
      makeRow({id:6,dong:'죽전동',price_man:700000}),
    ]);
    await user.selectOptions(screen.getByRole('combobox',{name:'조회 아파트'}),JSON.stringify(['풍덕천동','1','동일아파트']));
    const detail=screen.getByRole('region',{name:'아파트별 실거래가'});
    const metrics=within(detail).getByLabelText('선택 아파트 통계');
    expect(within(metrics).getByText('3')).toBeTruthy();
    expect(within(metrics).getByText('12.00')).toBeTruthy();
    expect(within(metrics).getByText('10.00')).toBeTruthy();
    let table=within(detail).getByRole('region',{name:'선택 아파트 실거래 내역'});
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).queryByText('90.00억 원')).toBeNull();
    expect(within(table).queryByText('80.00억 원')).toBeNull();
    expect(within(table).queryByText('70.00억 원')).toBeNull();
    await user.click(within(detail).getByText('단지 월별 수치 보기'));
    const emptyMonth=within(detail).getByRole('cell',{name:'2026.04'}).closest('tr');
    expect(emptyMonth.textContent).toContain('0건');expect(emptyMonth.textContent).toContain('—억 원');
    await user.selectOptions(within(detail).getByRole('combobox',{name:'단지 전용면적'}),'85');
    expect(within(metrics).getByText('2')).toBeTruthy();expect(within(metrics).getByText('11.00')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'평 (전용)',exact:true}));
    expect(within(detail).getByRole('combobox',{name:'단지 전용면적'}).value).toBe('85');
    expect(within(metrics).getByText('2')).toBeTruthy();
    table=within(detail).getByRole('region',{name:'선택 아파트 실거래 내역'});
    expect(within(table).getAllByRole('cell',{name:'25.71평',exact:true})).toHaveLength(2);
    expect(screen.queryByRole('button',{name:'CSV 다운로드'})).toBeNull();
  });
  it('searches every apartment and offers no implicit initial choice',async()=>{
    const user=userEvent.setup();
    const rows=Array.from({length:30},(_,i)=>[makeRow({id:i*2+1,apartment:`일반단지${i}`}),makeRow({id:i*2+2,apartment:`일반단지${i}`})]).flat();
    rows.push(makeRow({id:100,apartment:'희소단지',price_man:110000}));
    renderApartments(rows);
    const select=screen.getByRole('combobox',{name:'조회 아파트'});
    expect(select.value).toBe('');
    expect(screen.queryByRole('button',{name:'희소단지 풍덕천동 1 실거래 보기'})).toBeNull();
    await user.type(screen.getByRole('searchbox',{name:'아파트 검색'}),'희소');
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    await user.selectOptions(select,JSON.stringify(['풍덕천동','1','희소단지']));
    const detail=screen.getByRole('region',{name:'아파트별 실거래가'});
    expect(within(detail).getByRole('heading',{name:'희소단지'})).toBeTruthy();
    const table=within(detail).getByRole('region',{name:'선택 아파트 실거래 내역'});
    expect(within(table).getByText('11.00억 원')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'아파트 선택 해제'}));
    expect(select.value).toBe('');expect(within(detail).queryByRole('heading',{name:'희소단지'})).toBeNull();
  });
  it('paginates large histories and returns to the first page when the exact area changes',async()=>{
    const user=userEvent.setup();
    renderApartments(Array.from({length:52},(_,i)=>makeRow({id:i+1,area_m2:i===0?60:85,price_man:i===0?77000:100000})));
    await user.selectOptions(screen.getByRole('combobox',{name:'조회 아파트'}),JSON.stringify(['풍덕천동','1','동일아파트']));
    const detail=screen.getByRole('region',{name:'아파트별 실거래가'});
    let table=within(detail).getByRole('region',{name:'선택 아파트 실거래 내역'});
    expect(within(table).getAllByRole('row')).toHaveLength(51);
    expect(within(table).queryByText('7.70억 원')).toBeNull();
    await user.click(screen.getByRole('button',{name:'단지 거래 다음 페이지'}));
    expect(within(table).getAllByRole('row')).toHaveLength(3);expect(within(table).getByText('7.70억 원')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox',{name:'단지 전용면적'}),'60');
    table=within(detail).getByRole('region',{name:'선택 아파트 실거래 내역'});
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('button',{name:'단지 거래 이전 페이지'}).disabled).toBe(true);
    expect(screen.getByRole('button',{name:'단지 거래 다음 페이지'}).disabled).toBe(true);
  });
});
