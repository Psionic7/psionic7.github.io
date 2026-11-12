import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import ApartmentPage from '../src/ApartmentPage.jsx';
import ApartmentSaleListings from '../src/transactions/ApartmentSaleListings.jsx';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {listingSnapshot} from '../src/naver-listings.mjs';
import {listingClient} from '../src/naver-listings-client.js';

const region={region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',label:'수지구 풍덕천동',dongs:['풍덕천동']};
const manifest={regions:[region],districts:{'41465':{file:'suji.json',months:['202603']}},months:['202603'],published_at:'2026-03-31T12:00:00Z'};
const trade=(extra={})=>({id:1,region_code:'41465',dong:'풍덕천동',jibun:'1',apartment:'테스트아파트',road_address:'',area_m2:85,price_man:100000,floor:10,cancelled:0,deal_date:'2026-03-10',deal_month:'202603',raw:{},...extra});
const favorite=makeApartmentFavorite(trade(),region);
const other=makeApartmentFavorite(trade({jibun:'2'}),region);
const article=(id='26000000001',extra={})=>({id,name:favorite.apartment,tradeType:'A1',priceText:'13억 5,000',rentText:'',priceMan:135000,rentMan:0,areaM2:85,supplyAreaM2:112.3,floor:'저/20',building:'101동',direction:'남향',confirmedOn:'2026-11-05',description:'채광 좋은 집',realtor:'중개사',...extra});
const group=(extra={})=>({favorite,complexNo:'12345',complexName:favorite.apartment,status:'ready',attemptedAt:'2026-11-05T03:00:00.000Z',collectedAt:'2026-11-05T03:00:00.000Z',errorCode:null,articles:[article()],...extra});
const result=(groups=[])=>({status:'ready',snapshot:listingSnapshot(groups),retry:vi.fn()});
const expandSales=()=>screen.queryAllByRole('button',{name:/ 매매 매물 펼치기$/}).forEach(button=>fireEvent.click(button));
const table=()=>screen.getByRole('region',{name:favorite.apartment+' 매매 매물 내역'});
it('starts collapsed with the house count, expands and collapses independently, and respects area filters',()=>{
 const ads=[article('26000000001',{providerHouseId:'12345:26000000001'}),article('26000000002',{providerHouseId:'12345:26000000001'}),article('26000000003',{providerHouseId:'12345:26000000003',areaM2:60})];
 const view=render(<ApartmentSaleListings favorite={favorite} result={result([group({articles:ads})])}/>);
 const button=screen.getByRole('button',{name:favorite.apartment+' 매매 매물 펼치기'});
 expect(button.getAttribute('aria-expanded')).toBe('false');expect(within(button).getByText('매물 2건')).toBeTruthy();
 expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByText(/확인일과 매매 호가를 표시/)).toBeNull();
 fireEvent.click(button);expect(table()).toBeTruthy();expect(button.getAttribute('aria-expanded')).toBe('true');
 fireEvent.click(button);expect(screen.queryByRole('table')).toBeNull();
 view.rerender(<ApartmentSaleListings favorite={favorite} result={result([group({articles:ads})])} minArea={80}/>);
 expect(within(button).getByText('매물 1건')).toBeTruthy();expect(button.getAttribute('aria-expanded')).toBe('false');
});
it('does not display unknown or failed collection as zero in the collapsed summary',()=>{
 const view=render(<ApartmentSaleListings favorite={favorite} result={result()}/>);
 expect(screen.getByText('자료 미확인')).toBeTruthy();
 view.rerender(<ApartmentSaleListings favorite={favorite} result={{status:'error',retry:vi.fn()}}/>);
 expect(screen.getByText('불러오기 실패')).toBeTruthy();
});
it('shows one parent per provider house and expands all broker ads underneath without losing prices or links',()=>{
 const ads=[article('26000000001',{providerHouseId:'12345:26000000001'}),article('26000000002',{providerHouseId:'12345:26000000001',priceMan:130000,realtor:'두번째 중개사'}),article('26000000003',{providerHouseId:'12345:26000000003'})];
 render(<ApartmentSaleListings favorite={favorite} result={result([group({articles:ads})])}/>);
 expandSales();
 expect(screen.getByText(/네이버 묶음 2건/)).toBeTruthy();
 const summary=screen.getByText('네이버 동일 주택 · 중개사별 광고 2건 펼치기');fireEvent.click(summary);
 expect(summary.closest('details').open).toBe(true);
 const tree=screen.getByRole('list',{name:'같은 집의 중개사별 광고'});expect(within(tree).getAllByRole('listitem')).toHaveLength(2);expect(within(tree).getAllByRole('link')).toHaveLength(2);expect(within(tree).getByText('두번째 중개사')).toBeTruthy();
 expect(within(tree).getByText('13.00억 원')).toBeTruthy();expect(within(tree).getByText('13.50억 원')).toBeTruthy();
});
it('labels advertisement counts and keeps same-house broker advertisements, individual prices and source links',()=>{
 const ads=[article('26000000001',{providerSameAddress:{advertisementCount:7,minPriceText:'13억',maxPriceText:'13억 5,000',minPriceMan:130000,maxPriceMan:135000}}),article('26000000002',{realtor:'다른중개사',priceMan:130000,priceText:'13억'}),article('26000000003')];
 render(<ApartmentSaleListings favorite={favorite} result={result([group({articles:ads})])}/>);
 expandSales();
 expect(screen.getByText('광고 3건')).toBeTruthy();expect(within(table()).getByText('네이버 동일주소 광고 7건 · 13억 ~ 13억 5,000')).toBeTruthy();
 expect(within(table()).getByText('중개 다른중개사')).toBeTruthy();
 expect(within(table()).getAllByRole('row')).toHaveLength(4);expect(within(table()).getAllByRole('link')).toHaveLength(3);
 expect(screen.getByText(/건수는 광고 수이며 실제 주택 수가 아닙니다/)).toBeTruthy();
});
const pageProps={manifest,catalog:[region],selected:[favorite],searchRegionId:region.region_id,searchFilters:{province:'',city:'',district:'',search:''},onChange:vi.fn(),onSearchRegionChange:vi.fn(),onSearchFiltersChange:vi.fn(),day:'2026-03-31',period:{mode:'custom',start:'2026-03-01',end:'2026-03-31'},onDayChange:vi.fn(),onPeriodChange:vi.fn(),districtLoader:async()=>[trade()]};
beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('keeps the trade table and area filters while sale listings and their requests are paused',async()=>{
 const load=vi.spyOn(listingClient,'load').mockResolvedValue({snapshot:listingSnapshot([group()])});
 render(<ApartmentPage {...pageProps}/>);
 const trades=await screen.findByRole('region',{name:/기간별 거래 내역/});
 expect(within(trades).getAllByRole('columnheader').map(el=>el.textContent)).toEqual(['계약일','아파트 이름','전용면적','층','거래금액','거래 상태 / 해제일']);
 expect(within(trades).getByText('26.03.10')).toBeTruthy();
 expect(screen.queryByRole('button',{name:/ 매매 매물 펼치기$/})).toBeNull();expect(load).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'전체 면적 · 기간 / 조건'}));
 fireEvent.change(screen.getByRole('spinbutton',{name:'최소 전용면적 (㎡)'}),{target:{value:'90'}});
 expect(screen.queryByRole('region',{name:/기간별 거래 내역/})).toBeNull();
 expect(screen.queryByText(/매매 매물/)).toBeNull();expect(load).not.toHaveBeenCalled();
});

it('uses the shared area unit, exact range and noncontiguous pyeong bands for listings',()=>{
 const state=result([group({articles:[article(),article('26000000002',{areaM2:115}),article('26000000003',{areaM2:50})]})]);
 const view=render(<ApartmentSaleListings favorite={favorite} result={state} areaUnit="pyeong" selectedBands={[10,30]}/>);
 expandSales();
 expect(within(table()).getAllByRole('row')).toHaveLength(3);
 expect(within(table()).getByText('15.1평')).toBeTruthy();
 expect(within(table()).getByText('34.8평')).toBeTruthy();
 expect(within(table()).queryByText('25.7평')).toBeNull();
 view.rerender(<ApartmentSaleListings favorite={favorite} result={state} minArea={85} maxArea={85}/>);
 expandSales();
 expect(within(table()).getAllByRole('row')).toHaveLength(2);
 expect(within(table()).getByText('85.00㎡')).toBeTruthy();
});

it('matches verified master aliases and never attaches ads by apartment name alone',()=>{
 const master=makeApartmentFavorite({...trade({apartment:'새이름'}),master_id:'hub:123',trade_keys:[favorite.key]},region);
 const verified=group({favorite:{...favorite,master_id:'hub:123',id:'hub:123',trade_keys:[favorite.key],identity_ref:{kind:'root',id:'hub:123'}}});
 const view=render(<ApartmentSaleListings favorite={master} result={result([verified])}/>);
 expandSales();
 expect(screen.getByRole('region',{name:'새이름 매매 매물 내역'})).toBeTruthy();
 view.rerender(<ApartmentSaleListings favorite={other} result={result([group()])}/>);
 expandSales();
 expect(screen.queryByRole('table')).toBeNull();
 expect(screen.getByText(/아직 확인된 매매 매물 자료가 없습니다/)).toBeTruthy();
});

it('distinguishes complete zero ads, missing data and failed collection with retained partial data',()=>{
 const view=render(<ApartmentSaleListings favorite={favorite} result={result([group({articles:[]})])}/>);
 expandSales();
 expect(screen.getByText('수집 당시 확인된 매매 매물 광고가 없습니다.')).toBeTruthy();
 view.rerender(<ApartmentSaleListings favorite={favorite} result={result()}/>);
 expandSales();
 expect(screen.getByText(/매물 0건으로 확인된 결과가 아닙니다/)).toBeTruthy();
 view.rerender(<ApartmentSaleListings favorite={favorite} result={result([group({status:'failed',errorCode:'blocked',coverage:'partial',areaSource:'list'})])}/>);
 expandSales();
 expect(table()).toBeTruthy();
 expect(screen.getByText(/이전 수집 결과를 표시합니다/)).toBeTruthy();
 expect(screen.getByText(/일부 광고만 수집한 결과/)).toBeTruthy();
 expect(screen.getByText(/오래된 자료/)).toBeTruthy();
});

it('preserves standalone listing pagination while collapsed and resets it on area changes',()=>{
 const state=result([group({articles:Array.from({length:52},(_,i)=>article(String(26000000001+i),{areaM2:i===0?60:85}))})]);
 const view=render(<ApartmentSaleListings favorite={favorite} result={state}/>);
 expandSales();expect(within(table()).getAllByRole('row')).toHaveLength(51);
 fireEvent.click(screen.getByRole('button',{name:favorite.apartment+' 다음 매물 페이지'}));
 expect(within(table()).getAllByRole('row')).toHaveLength(3);
 fireEvent.click(screen.getByRole('button',{name:favorite.apartment+' 매매 매물 접기'}));
 expect(screen.queryByRole('table')).toBeNull();expandSales();
 expect(within(table()).getAllByRole('row')).toHaveLength(3);
 view.rerender(<ApartmentSaleListings favorite={favorite} result={state} maxArea={60}/>);
 expect(within(table()).getAllByRole('row')).toHaveLength(2);
 expect(screen.getByRole('button',{name:favorite.apartment+' 이전 매물 페이지'}).disabled).toBe(true);
});

it('keeps trade retries available without fetching or displaying listings',async()=>{
 const load=vi.spyOn(listingClient,'load'),districtLoader=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([trade()]);
 render(<ApartmentPage {...pageProps} districtLoader={districtLoader}/>);
 await screen.findByText('이 지역의 자료를 불러오지 못했습니다.');
 fireEvent.click(screen.getByRole('button',{name:'다시 불러오기',exact:true}));
 await screen.findByRole('region',{name:/기간별 거래 내역/});
 expect(districtLoader).toHaveBeenCalledTimes(2);expect(load).not.toHaveBeenCalled();
 expect(screen.queryByText(/매매 매물/)).toBeNull();
});

it('does not start listing requests when comparison selections change',async()=>{
 const load=vi.spyOn(listingClient,'load');
 const view=render(<ApartmentPage {...pageProps}/>);
 await screen.findByRole('region',{name:/기간별 거래 내역/});
 view.rerender(<ApartmentPage {...pageProps} selected={[favorite,other]}/>);
 await waitFor(()=>expect(screen.getByText('조회 결과 · 2개 아파트')).toBeTruthy());
 expect(load).not.toHaveBeenCalled();expect(screen.queryByText(/매매 매물/)).toBeNull();
});

it('uses twenty ads per page on narrow screens',()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 render(<ApartmentSaleListings favorite={favorite} result={result([group({articles:Array.from({length:22},(_,i)=>article(String(26000000001+i)))})])}/>);
 expandSales();
 expect(within(table()).getAllByRole('row')).toHaveLength(21);
 fireEvent.click(screen.getByRole('button',{name:favorite.apartment+' 다음 매물 페이지'}));
 expect(within(table()).getAllByRole('row')).toHaveLength(3);
});
