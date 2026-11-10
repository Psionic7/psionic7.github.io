import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import ApartmentPage from '../src/ApartmentPage.jsx';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
const state=vi.hoisted(()=>({information:[]}));
vi.mock('../src/useApartmentInformation.js',async importOriginal=>({...await importOriginal(),default:()=>state.information}));
const region={region_id:'dong_41135103',region_code:'41135',region_name:'경기도 성남시 분당구',label:'분당구 정자동',dongs:['정자동']};
const entity=JSON.stringify(['41135','정자동','199','동아2']);
const create=(kind,id,extra={})=>makeApartmentFavorite({apartment:'동아2',dong:'정자동',jibun:'199',road_address:'불정로 179',identity_ref:{kind,id},...extra},region);
const source=create('source',entity);
const cohort=create('cohort','cohort:hub:one:road',{identity_coverage:{entity_ids:[],cohort_ids:['cohort:hub:one:road'],root_ids:['hub:one']},identity_related_sources:[entity]});
const manifest={regions:[region],districts:{'41135':{months:['202603']}},months:['202603'],published_at:'2026-03-31T12:00:00Z'};
const base={manifest,catalog:[region],searchFilters:{province:'',city:'',district:'',search:''},onSearchRegionChange:vi.fn(),onSearchFiltersChange:vi.fn(),day:'2026-03-31',period:{mode:'custom',start:'2026-03-01',end:'2026-03-31'},onDayChange:vi.fn(),onPeriodChange:vi.fn(),districtLoader:async()=>[],listingClient:{load:async()=>({snapshot:{groups:[]}})}};
beforeEach(()=>{localStorage.clear();state.information=[source,cohort];});
afterEach(cleanup);
it('opens complete source history from a precise address selection without silently copying historical rows',()=>{
 const onChange=vi.fn();render(<ApartmentPage {...base} selected={[cohort]} onChange={onChange}/>);
 expect(screen.getByText(/구분할 수 없는 과거 거래/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'동아2 전체 거래 보기'}));expect(onChange).toHaveBeenCalledWith([source]);
});
it('keeps source APT classification separate from the official legal use',()=>{
 render(<ApartmentPage {...base} selected={[{...source,housing_source_kind:'APT',housing_legal_types:['연립주택','업무시설']}]} onChange={vi.fn()}/>);
 expect(screen.getByText('실거래 원천 분류: 아파트 · 건축물대장 용도: 연립주택, 업무시설')).toBeTruthy();
});
