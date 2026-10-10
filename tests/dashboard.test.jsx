import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,within,cleanup,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {readPreferences,savePreferences} from '../src/preferences.js';
const a={region_id:'dong_41465101',label:'경기도 용인시 수지구 풍덕천동',region_code:'41465',region_name:'경기도 용인시 수지구',dongs:['풍덕천동']};
const b={region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_code:'11110',region_name:'서울특별시 종로구',dongs:['청운동']};
const missing={region_id:'dong_41117101',label:'경기도 수원시 영통구 매탄동',region_code:'41117',region_name:'경기도 수원시 영통구',dongs:['매탄동']};
const months=['202608','202609','202610'],manifest={regions:[a,b,missing],favorite_region_ids:[b.region_id],districts:{'41465':{file:'a.json',months},'11110':{file:'b.json',months}},months,published_at:'2026-10-03T00:00:00Z'};
const row=(id,changes={})=>({id,region_code:'41465',dong:'풍덕천동',jibun:'1',apartment:'관심단지',deal_date:'2026-09-28',deal_month:'202609',area_m2:85,price_man:100000,floor:10,cancelled:0,raw:{},...changes});
const apartment=makeApartmentFavorite(row(1),a);
const apartmentLabel=apartment.apartment+' · '+apartment.region_name+' '+apartment.dong+' · 지번 '+apartment.jibun;
const seed=()=>savePreferences('viewer',{regions:[a.region_id],apartments:[apartment]});
const summary=()=>screen.getByRole('region',{name:'관심 거래 요약'});
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/?tab=dashboard');});afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('places the new overview tab first, starts fresh visitors there, and offers favorite setup without fetching a district',async()=>{
 window.history.replaceState(null,'','/');const user=userEvent.setup(),loader=vi.fn();render(<App initialManifest={manifest} districtLoader={loader}/>);
 await screen.findByText('즐겨찾기를 추가해 대시보드를 채워보세요.');expect(within(screen.getByRole('navigation',{name:'조회 화면'})).getAllByRole('button')[0].textContent).toBe('대시보드');expect(loader).not.toHaveBeenCalled();expect(readPreferences('overview').days).toBe(30);
 await user.click(screen.getByRole('button',{name:'동 즐겨찾기 추가'}));expect(new URLSearchParams(location.search).get('tab')).toBe('regions');
});
it('loads shared districts once, summarizes both favorite types and deduplicates recent trades without altering queries or favorites',async()=>{
 seed();savePreferences('apartmentTransactions',{selected:[apartment],minArea:60,period:{mode:'month',month:'2026-08',start:'2026-08-01',end:'2026-08-31'}});savePreferences('explorer',{weeklyIds:[b.region_id],weeklyPeriod:{mode:'month',month:'2026-08',start:'2026-08-01',end:'2026-08-31'}});
 const loader=vi.fn(async()=>[row(1),row(2,{cancelled:1,raw:{cdealDay:'2026-10-01'}}),row(3,{jibun:'2',apartment:'다른단지'})]);render(<App initialManifest={manifest} districtLoader={loader}/>);
 await waitFor(()=>expect(within(summary()).getByText('동 유효 거래').closest('article').textContent).toContain('2건'));
 expect(within(summary()).getByText('아파트 유효 거래').closest('article').textContent).toContain('1건');expect(loader).toHaveBeenCalledTimes(1);
 const trades=screen.getByRole('region',{name:'최근 관심 거래 내역'});expect(within(trades).getAllByRole('row')).toHaveLength(4);expect(within(trades).getByText('해제일 2026-10-01')).toBeTruthy();expect(within(trades).getAllByRole('columnheader')).toHaveLength(7);
 expect(readPreferences('viewer')).toEqual({regions:[a.region_id],apartments:[apartment]});expect(readPreferences('apartmentTransactions').selected).toEqual([apartment]);expect(readPreferences('apartmentTransactions').minArea).toBe(60);expect(readPreferences('explorer').weeklyIds).toEqual([b.region_id]);
 expect(readPreferences('apartmentTransactions').period.month).toBe('2026-08');expect(readPreferences('explorer').weeklyPeriod.month).toBe('2026-08');
});
it('persists recent duration independently, shares it in the URL and gives explicit shared duration priority',async()=>{
 seed();const user=userEvent.setup(),loader=vi.fn(async()=>[row(1),row(2,{deal_date:'2026-09-08'})]);let view=render(<App initialManifest={manifest} districtLoader={loader}/>);await screen.findByRole('region',{name:'최근 관심 거래 내역'});
 await user.click(within(screen.getByRole('group',{name:'대시보드 조회 기간'})).getByRole('button',{name:'최근 7일'}));expect(readPreferences('overview').days).toBe(7);expect(new URLSearchParams(location.search).get('days')).toBe('7');expect(within(screen.getByRole('region',{name:'최근 관심 거래 내역'})).getAllByRole('row')).toHaveLength(2);expect(loader).toHaveBeenCalledTimes(1);
 view.unmount();window.history.replaceState(null,'','/');view=render(<App initialManifest={manifest} districtLoader={loader}/>);await screen.findByRole('region',{name:'대시보드 안내'});expect(screen.getByRole('button',{name:'최근 7일'}).getAttribute('aria-pressed')).toBe('true');view.unmount();
 window.history.replaceState(null,'','/?tab=dashboard&days=90');view=render(<App initialManifest={manifest} districtLoader={loader}/>);await screen.findByRole('region',{name:'대시보드 안내'});expect(readPreferences('overview').days).toBe(90);
});
it('opens a dong or apartment with the same overview period and clears unrelated result filters while preserving favorite stars',async()=>{
 seed();savePreferences('weekly',{minArea:100,areaBands:[30],includeCancelled:true});savePreferences('apartmentTransactions',{minArea:100,areaBands:[30],includeCancelled:true});
 const user=userEvent.setup();render(<App initialManifest={manifest} districtLoader={async()=>[row(1)]}/>);await screen.findByRole('region',{name:'최근 관심 거래 내역'});
 await user.click(screen.getByRole('button',{name:a.label+' 거래 보기'}));await screen.findByRole('region',{name:a.label+' 기간별 거래 내역'});expect(readPreferences('explorer').weeklyIds).toEqual([a.region_id]);expect(readPreferences('weekly')).toMatchObject({minArea:'',maxArea:'',areaBands:[],includeCancelled:false});expect(screen.getByLabelText('조회 시작일').value).toBe('2026-09-04');
 await user.click(screen.getByRole('button',{name:'대시보드',exact:true}));await screen.findByRole('region',{name:'최근 관심 거래 내역'});await user.click(screen.getByRole('button',{name:'관심단지 경기도 용인시 수지구 풍덕천동 지번 1 거래 보기'}));
 await screen.findByRole('region',{name:apartmentLabel+' 기간별 거래 내역'});expect(readPreferences('apartmentTransactions')).toMatchObject({selected:[apartment],minArea:'',maxArea:'',areaBands:[],includeCancelled:false});expect(readPreferences('viewer')).toEqual({regions:[a.region_id],apartments:[apartment]});
});
it('distinguishes failed, loading, uncollected and empty sources and retries only the failed district',async()=>{
 savePreferences('viewer',{regions:[a.region_id,b.region_id,missing.region_id],apartments:[]});let attempts=0;const loader=vi.fn(async(_,code)=>{if(code==='11110'&&attempts++===0)throw new Error('offline');return code==='41465'?[row(1)]:[];});
 const user=userEvent.setup();render(<App initialManifest={manifest} districtLoader={loader}/>);await screen.findByRole('alert');await waitFor(()=>expect(loader).toHaveBeenCalledTimes(2));expect(screen.getByText('미수집')).toBeTruthy();expect(screen.getByText('불러오기 실패')).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'자료 다시 불러오기'}));await waitFor(()=>expect(screen.queryByText('불러오기 실패')).toBeNull());expect(loader).toHaveBeenCalledTimes(3);expect(loader.mock.calls.filter(call=>call[1]==='41465')).toHaveLength(1);expect(loader.mock.calls.some(call=>call[1]==='41117')).toBe(false);expect(readPreferences('viewer').regions).toEqual([a.region_id,b.region_id,missing.region_id]);
});
it('a cancelled recent trade opens its apartment query with cancellations enabled',async()=>{
 seed();const user=userEvent.setup();render(<App initialManifest={manifest} districtLoader={async()=>[row(1,{cancelled:1})]}/>);const recent=await screen.findByRole('region',{name:'최근 관심 거래 내역'});await user.click(within(recent).getByRole('button',{name:'관심단지 풍덕천동 2026-09-28 거래 조회'}));await screen.findByRole('region',{name:apartmentLabel+' 기간별 거래 내역'});expect(readPreferences('apartmentTransactions').includeCancelled).toBe(true);
});
