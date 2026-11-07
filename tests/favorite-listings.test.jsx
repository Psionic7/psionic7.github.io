import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,within,cleanup,waitFor,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FavoriteListings from '../src/FavoriteListings.jsx';
import {savePreferences,readPreferences} from '../src/preferences.js';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {listingSnapshot,LISTING_ERRORS} from '../src/naver-listings.mjs';
import {listingClient} from '../src/naver-listings-client.js';

const favorite=makeApartmentFavorite({apartment:'관심아파트',dong:'풍덕천동',jibun:'1112'},{region_code:'41465',region_name:'경기도 용인시 수지구'});
const other=makeApartmentFavorite({...favorite,apartment:'다른아파트',jibun:'2222'},favorite);
const now=new Date().toISOString();
const article=(id='26000000001',extra={})=>({id,name:'관심아파트',tradeType:'A1',priceText:'13억 5,000',rentText:'',priceMan:135000,rentMan:0,areaM2:84.9,supplyAreaM2:112.3,floor:'10/20',building:'101동',direction:'남향',confirmedOn:'2026-11-05',description:'채광 좋은 집',realtor:'중개사',...extra});
const group=(extra={})=>({favorite,complexNo:'12345',complexName:'관심아파트',status:'ready',attemptedAt:now,collectedAt:now,errorCode:null,articles:[article()],...extra});
const client=(groups=[],available=true)=>({load:vi.fn(async()=>({available,snapshot:listingSnapshot(groups)})),collect:vi.fn(async()=>group())});
const save=(items=[favorite])=>savePreferences('naverListings',{connections:items.map((f,i)=>({favoriteId:f.id,complexNo:String(12345+i)}))});
beforeEach(()=>localStorage.clear());afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('empty favorites need no network and explain where listings appear',()=>{
  const api=client();render(<FavoriteListings apartments={[]} client={api}/>);expect(screen.getByText(/아파트를 즐겨찾기에 추가하면/)).toBeTruthy();expect(api.load).not.toHaveBeenCalled();
});

it('connects a valid Naver URL, rejects forged domains, preserves favorites and collects',async()=>{
  savePreferences('viewer',{apartments:[favorite]});const api=client(),user=userEvent.setup();render(<FavoriteListings apartments={[favorite]} client={api}/>);
  await screen.findByRole('button',{name:'네이버 매물 수집'});
  const input=screen.getByLabelText('관심아파트 네이버 단지 URL 또는 번호');
  await user.type(input,'https://evil.test/complexes/12345');await user.click(screen.getByRole('button',{name:'연결 저장'}));expect(screen.getByRole('alert').textContent).toContain('네이버 단지 URL');
  await user.clear(input);await user.type(input,'https://new.land.naver.com/complexes/12345');await user.click(screen.getByRole('button',{name:'연결 저장'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'네이버 매물 수집'}).disabled).toBe(false));
  expect(readPreferences('naverListings').connections).toEqual([{favoriteId:favorite.id,complexNo:'12345'}]);
  await user.click(screen.getByRole('button',{name:'네이버 매물 수집'}));
  const table=await screen.findByRole('region',{name:'관심아파트 네이버 매물 광고'});expect(within(table).getByText('13억 5,000')).toBeTruthy();
  expect(api.collect).toHaveBeenCalledWith(favorite,'12345');expect(readPreferences('viewer').apartments).toEqual([favorite]);
  expect(within(table).getByRole('link',{name:'관심아파트 매물 26000000001 네이버 원문'}).href).toBe('https://fin.land.naver.com/articles/26000000001');
});

it('shows only sale ads from older mixed snapshots and filters, sorts and paginates sales',async()=>{
  save();const articles=Array.from({length:22},(_,i)=>article(String(26000000001+i),{priceMan:135000+i}));articles.push(article('26000000100',{tradeType:'B2',priceText:'1억',priceMan:10000,rentText:'120',rentMan:120,areaM2:59}));
  render(<FavoriteListings apartments={[favorite]} client={client([group({articles})])}/>);
  const table=await screen.findByRole('region',{name:'관심아파트 네이버 매물 광고'});expect(within(table).getAllByRole('row')).toHaveLength(21);
  fireEvent.click(screen.getByRole('button',{name:'관심아파트 다음 매물 페이지'}));expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(screen.queryByLabelText('매물 거래 유형')).toBeNull();expect(screen.queryByText('월 120만원')).toBeNull();
  fireEvent.change(screen.getByLabelText('최소 전용면적(㎡)'),{target:{value:'90'}});expect(screen.getByText(/현재 필터에 맞는 광고가 없습니다/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('최소 전용면적(㎡)'),{target:{value:''}});fireEvent.change(screen.getByLabelText('매물 정렬'),{target:{value:'priceDesc'}});
  expect(within(screen.getByRole('region',{name:'관심아파트 네이버 매물 광고'})).getAllByRole('row')[1].textContent).toContain('84.9㎡');
  expect(screen.getByRole('button',{name:'관심아파트 이전 매물 페이지'}).disabled).toBe(true);
});

it('failed refresh keeps prior rows, labels old collection and stops a batch on 429',async()=>{
  save([favorite,other]);const stale='2026-01-01T00:00:00.000Z',api=client([group({collectedAt:stale})]);api.collect.mockResolvedValue(group({status:'failed',errorCode:'rate_limited',collectedAt:stale}));
  render(<FavoriteListings apartments={[favorite,other]} client={api}/>);await screen.findByRole('region',{name:'관심아파트 네이버 매물 광고'});
  fireEvent.click(screen.getByRole('button',{name:'네이버 매물 수집'}));await screen.findByText(LISTING_ERRORS.rate_limited);
  expect(screen.getByText(/이전 수집 결과 · 오래된 자료/)).toBeTruthy();expect(screen.getByText('13억 5,000')).toBeTruthy();expect(api.collect).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/나머지 단지는 수집하지 않았습니다/)).toBeTruthy();
});

it('static hosting shows only matching favorites and exports the current target list',async()=>{
  const download=vi.fn(),api=client([group(),group({favorite:other,complexNo:'12346'})],false);
  const view=render(<FavoriteListings apartments={[favorite]} client={api} onDownload={download}/>);await screen.findByText(/새 매물 수집은 로컬 미리보기/);
  expect(screen.queryByRole('button',{name:'네이버 매물 수집'})).toBeNull();expect(screen.queryByRole('article',{name:'다른아파트 매물 수집 정보'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'수집 대상 내려받기'}));expect(download).toHaveBeenCalledWith([favorite],[{favoriteId:favorite.id,complexNo:'12345'}]);
  view.rerender(<FavoriteListings apartments={[]} client={api}/>);expect(screen.queryByText('13억 5,000')).toBeNull();
});

it('distinguishes no results, missing results and transport failure',async()=>{
  save();const api=client([group({articles:[]})]);const view=render(<FavoriteListings apartments={[favorite]} client={api}/>);
  await screen.findByText(/수집 당시 네이버에 노출된/);expect(screen.queryByText(/아직 수집한 매물 자료가 없습니다/)).toBeNull();
  view.unmount();api.load.mockResolvedValue({available:true,snapshot:listingSnapshot([])});render(<FavoriteListings apartments={[favorite]} client={api}/>);
  await screen.findByText('아직 수집한 매물 자료가 없습니다.');api.collect.mockRejectedValue(new Error('연결 실패'));
  fireEvent.click(screen.getByRole('button',{name:'네이버 매물 수집'}));await screen.findByText('연결 실패');expect(screen.queryByText(/수집 당시 네이버에 노출된/)).toBeNull();
});

it('does not show the prior complex after changing its connection or accept a late removed favorite',async()=>{
  save();let finish;const api=client([group()]);api.collect.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<FavoriteListings apartments={[favorite]} client={api}/>);await screen.findByRole('region',{name:'관심아파트 네이버 매물 광고'});
  fireEvent.click(screen.getByRole('button',{name:'네이버 매물 수집'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
  view.rerender(<FavoriteListings apartments={[]} client={api}/>);finish(group());await waitFor(()=>expect(screen.queryByText('13억 5,000')).toBeNull());
});

it('reconnecting a favorite hides the former complex and its ads immediately',async()=>{
  save();const api=client([group()]);render(<FavoriteListings apartments={[favorite]} client={api}/>);
  await screen.findByRole('region',{name:'관심아파트 네이버 매물 광고'});
  fireEvent.change(screen.getByLabelText('관심아파트 네이버 단지 URL 또는 번호'),{target:{value:'99999'}});fireEvent.click(screen.getByRole('button',{name:'연결 저장'}));
  await screen.findByText('아직 수집한 매물 자료가 없습니다.');expect(screen.queryByText('13억 5,000')).toBeNull();expect(readPreferences('naverListings').connections[0].complexNo).toBe('99999');
});

it('client uses same-origin collection and static fallback validates the source contract',async()=>{
  vi.stubGlobal('fetch',vi.fn(async url=>url==='/api/naver-listings/status'?new Response('<html/>',{headers:{'Content-Type':'text/html'}}):new Response(JSON.stringify(listingSnapshot([group()])),{headers:{'Content-Type':'application/json'}})));
  const loaded=await listingClient.load([favorite],[]);expect(loaded.available).toBe(false);expect(loaded.snapshot.groups).toHaveLength(1);
  globalThis.fetch.mockImplementation(async()=>new Response(JSON.stringify({groups:[]}),{headers:{'Content-Type':'application/json'}}));await expect(listingClient.load([favorite],[])).rejects.toThrow('저장된 매물 자료');
});

it('browser samples show their partial coverage alongside the actual captured rows',async()=>{
  render(<FavoriteListings apartments={[favorite]} client={client([group({collectionMethod:'browser',coverage:'partial',sourceUrl:'https://new.land.naver.com/complexes/12345'})],false)}/>);
  await screen.findByText('브라우저 화면에서 확인한 일부 광고 1건입니다. 전체 매물 수집 결과가 아닙니다.');
  expect(screen.getByText('13억 5,000')).toBeTruthy();
});

it('shows daily regional coverage and never describes a completed full-browser collection as a sample',async()=>{
  const collection={dayKst:'2026-11-06',startedAt:now,finishedAt:now,status:'partial',regionIds:['dong_41465101'],targetCount:2,successCount:1,failureCount:1,unmatchedCount:0,notAttemptedCount:0,results:[{favoriteId:favorite.id,favorite,status:'ready',errorCode:null,attemptedAt:now},{favoriteId:other.id,favorite:other,status:'failed',errorCode:'timeout',attemptedAt:now}]};
  const api=client([group({collectionMethod:'browser',coverage:'complete',pageCount:2,sourceUrl:'https://new.land.naver.com/complexes/12345'})],false);api.load.mockResolvedValue({available:false,snapshot:{...listingSnapshot([group({collectionMethod:'browser',coverage:'complete',pageCount:2,sourceUrl:'https://new.land.naver.com/complexes/12345'})]),collection}});
  render(<FavoriteListings apartments={[favorite,other]} client={api}/>);
  await screen.findByText('브라우저의 전체 2개 목록 페이지를 확인한 결과입니다.');
  expect(screen.getByLabelText('지역 전체 매물 일일 수집 상태').textContent).toContain('대상 2곳 · 성공 1곳 · 실패 1곳');
  expect(screen.getByText(/일일 수집: 매물 수집 제한 시간/)).toBeTruthy();expect(screen.queryByText(/브라우저 화면에서 확인한 일부 광고/)).toBeNull();
});

it('loads daily status even with no personal favorites without requesting listing rows',async()=>{
  const api=client();api.status=vi.fn(async()=>({dayKst:'2026-11-06',status:'failed',regionIds:['dong_41465101'],targetCount:0,successCount:0,failureCount:0,unmatchedCount:0,notAttemptedCount:0,results:[],errorCode:'inventory_unavailable',finishedAt:now}));
  render(<FavoriteListings apartments={[]} client={api}/>);await screen.findByText(LISTING_ERRORS.inventory_unavailable);expect(api.load).not.toHaveBeenCalled();
});
