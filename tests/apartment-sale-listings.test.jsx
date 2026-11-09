import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import ApartmentPage from '../src/ApartmentPage.jsx';
import ApartmentSaleListings from '../src/transactions/ApartmentSaleListings.jsx';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {listingSnapshot} from '../src/naver-listings.mjs';

const region={region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',label:'수지구 풍덕천동',dongs:['풍덕천동']};
const manifest={regions:[region],districts:{'41465':{file:'suji.json',months:['202603']}},months:['202603'],published_at:'2026-03-31T12:00:00Z'};
const trade=(extra={})=>({id:1,region_code:'41465',dong:'풍덕천동',jibun:'1',apartment:'테스트아파트',road_address:'',area_m2:85,price_man:100000,floor:10,cancelled:0,deal_date:'2026-03-10',deal_month:'202603',raw:{},...extra});
const favorite=makeApartmentFavorite(trade(),region);
const other=makeApartmentFavorite(trade({jibun:'2'}),region);
const article=(id='26000000001',extra={})=>({id,name:favorite.apartment,tradeType:'A1',priceText:'13억 5,000',rentText:'',priceMan:135000,rentMan:0,areaM2:85,supplyAreaM2:112.3,floor:'저/20',building:'101동',direction:'남향',confirmedOn:'2026-11-05',description:'채광 좋은 집',realtor:'중개사',...extra});
const group=(extra={})=>({favorite,complexNo:'12345',complexName:favorite.apartment,status:'ready',attemptedAt:'2026-11-05T03:00:00.000Z',collectedAt:'2026-11-05T03:00:00.000Z',errorCode:null,articles:[article()],...extra});
const result=(groups=[])=>({status:'ready',snapshot:listingSnapshot(groups),retry:vi.fn()});
const table=()=>screen.getByRole('region',{name:favorite.apartment+' 매매 매물 내역'});
it('labels advertisement counts and keeps same-house broker advertisements, individual prices and source links',()=>{
 const ads=[article('26000000001',{providerSameAddress:{advertisementCount:7,minPriceText:'13억',maxPriceText:'13억 5,000',minPriceMan:130000,maxPriceMan:135000}}),article('26000000002',{realtor:'다른중개사',priceMan:130000,priceText:'13억'}),article('26000000003')];
 render(<ApartmentSaleListings favorite={favorite} result={result([group({articles:ads})])}/>);
 expect(screen.getByText('광고 3건')).toBeTruthy();expect(within(table()).getByText('네이버 동일주소 광고 7건 · 13억 ~ 13억 5,000')).toBeTruthy();
 expect(within(table()).getByText('중개 다른중개사')).toBeTruthy();
 expect(within(table()).getAllByRole('row')).toHaveLength(4);expect(within(table()).getAllByRole('link')).toHaveLength(3);
 expect(screen.getByText(/건수는 광고 수이며 실제 주택 수가 아닙니다/)).toBeTruthy();
});
const pageProps={manifest,catalog:[region],selected:[favorite],searchRegionId:region.region_id,searchFilters:{province:'',city:'',district:'',search:''},onChange:vi.fn(),onSearchRegionChange:vi.fn(),onSearchFiltersChange:vi.fn(),day:'2026-03-31',period:{mode:'custom',start:'2026-03-01',end:'2026-03-31'},onDayChange:vi.fn(),onPeriodChange:vi.fn(),districtLoader:async()=>[trade()]};
beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('places a separate six-column sale table directly after transactions and before the trend, retaining current ads outside the trade period',async()=>{
 const api={load:vi.fn(async()=>({snapshot:listingSnapshot([group({articles:[article(),article('26000000002',{tradeType:'B1',priceMan:50000})]})])}))};
 render(<ApartmentPage {...pageProps} listingClient={api}/>);
 const sales=await screen.findByRole('region',{name:favorite.apartment+' 매매 매물 내역'});
 const trades=await screen.findByRole('region',{name:/기간별 거래 내역/});
 expect(within(trades).getAllByRole('columnheader').map(el=>el.textContent)).toEqual(['계약일','아파트 이름','전용면적','층','거래금액','거래 상태 / 해제일']);
 expect(within(sales).getAllByRole('columnheader').map(el=>el.textContent)).toEqual(['확인일','아파트 이름','전용면적','층','매매 호가','매물 정보 / 원문']);
 expect(trades.compareDocumentPosition(sales)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(sales.compareDocumentPosition(document.querySelector('.transaction-extras'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(within(trades).getByText('26.03.10')).toBeTruthy();
 expect(within(sales).getByText('26.11.05')).toBeTruthy();
 expect(within(sales).getByText('13.50억 원')).toBeTruthy();
 expect(within(sales).getByText('저/20층')).toBeTruthy();
 expect(within(sales).getAllByRole('row')).toHaveLength(2);
 expect(within(sales).getByRole('link').href).toBe('https://fin.land.naver.com/articles/26000000001');
 expect(api.load).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'전체 면적 · 기간 / 조건'}));
 fireEvent.change(screen.getByRole('spinbutton',{name:'최소 전용면적 (㎡)'}),{target:{value:'90'}});
 expect(screen.queryByRole('region',{name:/기간별 거래 내역/})).toBeNull();
 expect(screen.getByText('선택한 면적 조건에 맞는 매매 매물이 없습니다.')).toBeTruthy();
 expect(api.load).toHaveBeenCalledTimes(1);
});

it('uses the shared area unit, exact range and noncontiguous pyeong bands for listings',()=>{
 const state=result([group({articles:[article(),article('26000000002',{areaM2:115}),article('26000000003',{areaM2:50})]})]);
 const view=render(<ApartmentSaleListings favorite={favorite} result={state} areaUnit="pyeong" selectedBands={[10,30]}/>);
 expect(within(table()).getAllByRole('row')).toHaveLength(3);
 expect(within(table()).getByText('15.1평')).toBeTruthy();
 expect(within(table()).getByText('34.8평')).toBeTruthy();
 expect(within(table()).queryByText('25.7평')).toBeNull();
 view.rerender(<ApartmentSaleListings favorite={favorite} result={state} minArea={85} maxArea={85}/>);
 expect(within(table()).getAllByRole('row')).toHaveLength(2);
 expect(within(table()).getByText('85.00㎡')).toBeTruthy();
});

it('matches verified master aliases and never attaches ads by apartment name alone',()=>{
 const master=makeApartmentFavorite({...trade({apartment:'새이름'}),master_id:'hub:123',trade_keys:[favorite.key]},region);
 const verified=group({favorite:{...favorite,master_id:'hub:123',id:'hub:123',trade_keys:[favorite.key],identity_ref:{kind:'root',id:'hub:123'}}});
 const view=render(<ApartmentSaleListings favorite={master} result={result([verified])}/>);
 expect(screen.getByRole('region',{name:'새이름 매매 매물 내역'})).toBeTruthy();
 view.rerender(<ApartmentSaleListings favorite={other} result={result([group()])}/>);
 expect(screen.queryByRole('table')).toBeNull();
 expect(screen.getByText(/아직 확인된 매매 매물 자료가 없습니다/)).toBeTruthy();
});

it('distinguishes complete zero ads, missing data and failed collection with retained partial data',()=>{
 const view=render(<ApartmentSaleListings favorite={favorite} result={result([group({articles:[]})])}/>);
 expect(screen.getByText('수집 당시 확인된 매매 매물 광고가 없습니다.')).toBeTruthy();
 view.rerender(<ApartmentSaleListings favorite={favorite} result={result()}/>);
 expect(screen.getByText(/매물 0건으로 확인된 결과가 아닙니다/)).toBeTruthy();
 view.rerender(<ApartmentSaleListings favorite={favorite} result={result([group({status:'failed',errorCode:'blocked',coverage:'partial',areaSource:'list'})])}/>);
 expect(table()).toBeTruthy();
 expect(screen.getByText(/이전 수집 결과를 표시합니다/)).toBeTruthy();
 expect(screen.getByText(/일부 광고만 수집한 결과/)).toBeTruthy();
 expect(screen.getByText(/오래된 자료/)).toBeTruthy();
});

it('paginates sale ads independently, keeps the page when collapsed, and resets on area changes',async()=>{
 const api={load:async()=>({snapshot:listingSnapshot([group({articles:Array.from({length:52},(_,i)=>article(String(26000000001+i),{areaM2:i===0?60:85}))})])})};
 render(<ApartmentPage {...pageProps} initialFilters={{recentCount:10}} listingClient={api}/>);
 await screen.findByRole('region',{name:favorite.apartment+' 매매 매물 내역'});
 expect(within(table()).getAllByRole('row')).toHaveLength(51);
 fireEvent.click(screen.getByRole('button',{name:favorite.apartment+' 다음 매물 페이지'}));
 expect(within(table()).getAllByRole('row')).toHaveLength(3);
 fireEvent.click(screen.getByRole('button',{name:/실거래가 접기$/}));
 expect(screen.queryByRole('region',{name:favorite.apartment+' 매매 매물 내역'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/실거래가 펼치기$/}));
 expect(within(table()).getAllByRole('row')).toHaveLength(3);
 fireEvent.click(screen.getByRole('button',{name:'전체 면적 · 기간 / 조건'}));
 fireEvent.change(screen.getByRole('spinbutton',{name:'최대 전용면적 (㎡)'}),{target:{value:'60'}});
 expect(within(table()).getAllByRole('row')).toHaveLength(2);
 expect(screen.getByRole('button',{name:favorite.apartment+' 이전 매물 페이지'}).disabled).toBe(true);
});

it('shows listings despite a trade failure and retries a failed snapshot read',async()=>{
 const api={load:vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({snapshot:listingSnapshot([group()])})};
 render(<ApartmentPage {...pageProps} districtLoader={async()=>{throw new Error('offline');}} listingClient={api}/>);
 await screen.findByRole('button',{name:favorite.apartment+' 매물 다시 불러오기'});
 fireEvent.click(screen.getByRole('button',{name:favorite.apartment+' 매물 다시 불러오기'}));
 await screen.findByRole('region',{name:favorite.apartment+' 매매 매물 내역'});
 expect(screen.getByText('이 지역의 자료를 불러오지 못했습니다.')).toBeTruthy();
 expect(api.load).toHaveBeenCalledTimes(2);
});

it('loads once per comparison selection and ignores a late response for the previous selection',async()=>{
 let resolveOld;
 const api={load:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValue({snapshot:listingSnapshot([group({favorite:other,articles:[article('26000000099')]})])})};
 const view=render(<ApartmentPage {...pageProps} listingClient={api}/>);
 await waitFor(()=>expect(api.load).toHaveBeenCalledTimes(1));
 view.rerender(<ApartmentPage {...pageProps} selected={[favorite,other]} listingClient={api}/>);
 await screen.findByRole('link',{name:favorite.apartment+' 매물 26000000099 네이버 원문'});
 await act(async()=>resolveOld({snapshot:listingSnapshot([group()])}));
 expect(screen.queryByRole('link',{name:favorite.apartment+' 매물 26000000001 네이버 원문'})).toBeNull();
 expect(screen.getByText(/아직 확인된 매매 매물 자료가 없습니다/)).toBeTruthy();
 expect(api.load).toHaveBeenCalledTimes(2);
});

it('uses twenty ads per page on narrow screens',()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 render(<ApartmentSaleListings favorite={favorite} result={result([group({articles:Array.from({length:22},(_,i)=>article(String(26000000001+i)))})])}/>);
 expect(within(table()).getAllByRole('row')).toHaveLength(21);
 fireEvent.click(screen.getByRole('button',{name:favorite.apartment+' 다음 매물 페이지'}));
 expect(within(table()).getAllByRole('row')).toHaveLength(3);
});
