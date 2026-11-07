import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,ExternalLink} from 'lucide-react';
import {areaValue,formatNumber,PYEONG_M2} from '../domain.mjs';
import {sameApartmentFavorite} from '../apartment-favorites.js';
import {LISTING_ERRORS,articleUrl,listingGroupForFavorite,listingIsStale,saleListingGroup} from '../naver-listings.mjs';
import useMediaQuery from '../useMediaQuery.js';
import TransactionTableColumns from './TransactionTableColumns.jsx';
import './apartment-sale-listings.css';

const time=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'});
const EMPTY_BANDS=[];

export default function ApartmentSaleListings({favorite,result,areaUnit='m2',minArea='',maxArea='',selectedBands=EMPTY_BANDS}) {
  const matched=listingGroupForFavorite(result.snapshot?.groups||[],favorite);
  const group=matched?saleListingGroup(matched):null;
  const daily=result.snapshot?.collection?.results.find(row=>row.favoriteId===favorite.id||row.favorite&&sameApartmentFavorite(row.favorite,favorite));
  const rows=useMemo(()=>(group?.articles||[]).filter(article=>(minArea===''||article.areaM2>=minArea)&&(maxArea===''||article.areaM2<=maxArea)&&(!selectedBands.length||selectedBands.some(band=>article.areaM2>=band*PYEONG_M2&&article.areaM2<(band+10)*PYEONG_M2))).sort((a,b)=>b.confirmedOn.localeCompare(a.confirmedOn)||b.id.localeCompare(a.id)),[matched,minArea,maxArea,selectedBands]);
  const mobile=useMediaQuery('(max-width:650px)'),pageSize=mobile?20:50;
  const [page,setPage]=useState(1),tableRef=useRef(null);
  useEffect(()=>setPage(1),[rows,pageSize]);
  const pages=Math.max(1,Math.ceil(rows.length/pageSize)),safePage=Math.min(page,pages),unit=areaUnit==='m2'?'㎡':'평';
  const changePage=value=>{setPage(value);requestAnimationFrame(()=>{tableRef.current?.scrollIntoView?.({block:'start'});tableRef.current?.focus({preventScroll:true});});};
  const missing=group?.errorCode||daily?.errorCode;
  return <section className="apartment-sale-listings" aria-label={`${favorite.apartment} 매매 매물`}>
    <div className="sale-listings-heading"><h3 className="transaction-table-label">매매 매물</h3>{group?.collectedAt&&<span className="badge result-count">{formatNumber(rows.length)}건</span>}</div>
    <p className="sale-listing-note">확인일과 매매 호가를 표시합니다. 계약된 실거래가와 다릅니다. 면적 조건을 함께 적용하며, 조회 기간·최근 거래 건수는 실거래에만 적용됩니다.</p>
    {result.status==='loading'?<p role="status" className="sale-listing-note">매물 수집 결과를 불러오는 중입니다.</p>:result.status==='error'?<div role="alert" className="notice error">매물 자료를 불러오지 못했습니다.<button onClick={result.retry} aria-label={`${favorite.apartment} 매물 다시 불러오기`}>다시 불러오기</button></div>:<>
      {missing&&<p className="sale-listing-note sale-listing-warning">{LISTING_ERRORS[missing]}{group?.collectedAt?' 이전 수집 결과를 표시합니다.':''}</p>}
      {!group?.collectedAt?<p className="sale-listing-note">이 단지는 아직 확인된 매매 매물 자료가 없습니다. 매물 0건으로 확인된 결과가 아닙니다.</p>:<>
        <p className="sale-listing-note">{group.status==='failed'?'이전 수집 결과 · ':''}{listingIsStale(group)?'오래된 자료 · ':''}<time dateTime={group.collectedAt}>{time(group.collectedAt)}</time> 수집{group.coverage==='partial'?' · 일부 광고만 수집한 결과입니다. 전체 매물 수가 아닙니다.':''}{group.areaSource==='list'?' · 면적은 네이버 목록 표시 값입니다.':''}</p>
        {!group.articles.length?<p className="sale-listing-note">{group.status==='failed'?'이전 수집 당시':'수집 당시'} 확인된 매매 매물 광고가 없습니다.</p>:!rows.length?<p className="sale-listing-note">선택한 면적 조건에 맞는 매매 매물이 없습니다.</p>:<>
          <p className="trade-scroll-hint">좌우로 밀어 매물 정보·원문 확인</p>
          <div ref={tableRef} className="table-scroll weekly-trades compact-trades" role="region" aria-label={`${favorite.apartment} 매매 매물 내역`} tabIndex={0}><table className="summary-table">
            <TransactionTableColumns/>
            <thead><tr><th scope="col">확인일</th><th scope="col">아파트 이름</th><th scope="col">전용면적</th><th scope="col">층</th><th scope="col">매매 호가</th><th scope="col">매물 정보 / 원문</th></tr></thead>
            <tbody>{rows.slice((safePage-1)*pageSize,safePage*pageSize).map(article=><tr key={article.id}>
              <td data-label="확인일">{article.confirmedOn?<time dateTime={article.confirmedOn} title={article.confirmedOn}>{article.confirmedOn.slice(2).replaceAll('-','.')}</time>:'미제공'}</td>
              <td data-label="아파트" title={article.name||favorite.apartment}><strong className="trade-apartment-name">{article.name||favorite.apartment}</strong></td>
              <td data-label="전용면적">{formatNumber(areaValue(article.areaM2,areaUnit),areaUnit==='m2'?2:1)}{unit}</td>
              <td data-label="층">{article.floor?article.floor.replace(/층$/,'')+'층':'—'}</td>
              <td data-label="매매 호가"><strong title={article.priceText}>{formatNumber(article.priceMan/10000,article.priceMan%100?4:2)}억 원</strong></td>
              <td data-label="매물 정보" className="sale-listing-source"><span>{article.building||'동 미제공'} · {article.direction||'방향 미제공'}</span><a href={articleUrl(article.id)} target="_blank" rel="noopener noreferrer" title={[article.realtor,article.description].filter(Boolean).join(' · ')} aria-label={`${favorite.apartment} 매물 ${article.id} 네이버 원문`}>네이버 원문<ExternalLink size={11}/></a></td>
            </tr>)}</tbody>
          </table></div>
          <div className="pagination"><span>확인일 최신순 · 페이지당 {pageSize}건 · {safePage} / {pages} 페이지</span><button aria-label={`${favorite.apartment} 이전 매물 페이지`} disabled={safePage<=1} onClick={()=>changePage(safePage-1)}><ChevronLeft size={16}/></button><button aria-label={`${favorite.apartment} 다음 매물 페이지`} disabled={safePage>=pages} onClick={()=>changePage(safePage+1)}><ChevronRight size={16}/></button></div>
          <p className="sale-listing-note">중개사별 동일 주택의 중복 광고가 포함될 수 있습니다. 거래 가능 여부는 원문과 중개사에게 확인하세요.</p>
        </>}
      </>}
    </>}
  </section>;
}
