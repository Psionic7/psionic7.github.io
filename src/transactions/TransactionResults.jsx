import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {apartmentAddress, areaValue, formatNumber, priceEok} from '../domain.mjs';
import {Empty, Loading} from '../ViewState.jsx';
import TradeTrend from './TradeTrend.jsx';
import useMediaQuery from '../useMediaQuery.js';
import CollapsiblePanel from '../CollapsiblePanel.jsx';
import {weeklyResultRows} from '../weekly/query.mjs';

export default function TransactionResults({region,week,dataset,collected,minArea,maxArea,selectedBands,includeCancelled,recentCount='',mode,onRetry,areaUnit='m2',resultActions}) {
  const rows=useMemo(()=>weeklyResultRows(dataset?.rows||[],region,week,{minArea,maxArea,selectedBands,includeCancelled,recentCount}),[dataset?.rows,region,week.start,week.end,minArea,maxArea,selectedBands,includeCancelled,recentCount]);
  const periodLabel=mode==='week'?'주간':mode==='count'?'최근':'기간별',timeLabel=mode==='week'?'이 주':mode==='count'?'전체 기간':'선택 기간';
  const areaFiltered=minArea!=='' || maxArea!=='' || selectedBands.length>0;
  const [page,setPage]=useState(1),resultsRef=useRef(null);
  const mobile=useMediaQuery('(max-width:650px)'),pageSize=mobile?20:50;
  useEffect(()=>setPage(1),[rows,pageSize]);
  const pages=Math.max(1,Math.ceil(rows.length/pageSize)), safePage=Math.min(page,pages), displayAreaUnit=areaUnit, unit=areaUnit==='m2'?'㎡':'평';
  const changePage=value=>{setPage(value);requestAnimationFrame(()=>{resultsRef.current?.scrollIntoView?.({block:'start'});resultsRef.current?.focus({preventScroll:true});});};
  const latest=rows.find(row=>!row.cancelled);
  return <CollapsiblePanel className="weekly-dong" label={`${region.label} ${periodLabel} 실거래가`} toggleLabel={region.label+' 실거래가'} heading={<><h2>{region.key?region.apartment:region.dongs[0]}</h2><p>{region.key?apartmentAddress(region,region.region_name):region.region_name}</p></>} actions={<>{resultActions}{dataset?.rows&&!dataset.error&&collected?<span className="badge result-count">{formatNumber(rows.length)}건</span>:null}</>}>
    {!collected?<Empty title={region.key?"이 아파트 지역은 아직 수집된 자료가 없습니다.":"아직 수집된 자료가 없는 동입니다."}>거래 자료가 제공되는 다른 지역을 선택해 주세요.</Empty>:dataset?.error?<div className="notice error" role="alert">이 지역의 자료를 불러오지 못했습니다.<button onClick={onRetry}>다시 불러오기</button></div>:!dataset?.rows?<Loading text="이 동의 거래를 불러오는 중입니다."/>:<>
      {!rows.length?<Empty title={areaFiltered?`${timeLabel}의 면적 조건에 맞는 ${includeCancelled?'':'유효 '}거래가 없습니다.`:`${timeLabel}에 조회되는 ${includeCancelled?'':'유효 '}거래가 없습니다.`}>{areaFiltered?'면적 필터를 조정하거나 초기화해 보세요.':region.key?'기간이나 다른 아파트를 선택해 보세요.':'기간이나 다른 동을 선택해 보세요.'}</Empty>:<>
        <p className="trade-scroll-hint">좌우로 밀어 거래 상태·해제일 확인</p>
        <div ref={resultsRef} className="table-scroll weekly-trades compact-trades" role="region" aria-label={`${region.label} ${periodLabel} 거래 내역`} tabIndex={0}><table className="summary-table">
          <colgroup><col className="trade-date-column"/><col className="trade-name-column"/><col className="trade-area-column"/><col className="trade-floor-column"/><col className="trade-price-column"/><col className="trade-status-column"/></colgroup>
          <thead><tr><th>계약일</th><th>아파트 이름</th><th>전용면적</th><th>층</th><th>거래금액</th><th>거래 상태 / 해제일</th></tr></thead>
          <tbody>{rows.slice((safePage-1)*pageSize,safePage*pageSize).map(row=><tr key={row.id} className={row.cancelled?'cancelled-trade':''}><td data-label="계약일"><time dateTime={row.deal_date} title={row.deal_date}>{row.deal_date.slice(2).replaceAll('-','.')}</time></td><td data-label="아파트" title={row.apartment}><strong className="trade-apartment-name">{row.apartment}</strong></td><td data-label="전용면적">{formatNumber(areaValue(row.area_m2,displayAreaUnit),displayAreaUnit==='m2'?2:1)}{unit}</td><td data-label="층">{row.floor??'—'}층</td><td data-label="거래금액"><strong>{formatNumber(priceEok(row),2)}억 원</strong></td><td data-label="거래 상태"><span className={`trade-status ${row.cancelled?'cancelled':''}`}>{row.cancelled?'해제':'유효'}</span>{!!row.cancelled&&<small className="trade-cancel-date">해제일 {row.raw?.cdealDay?.trim()||'미상'}</small>}</td></tr>)}</tbody>
        </table></div>
        <div className="pagination"><span>계약일 최신순 · 페이지당 {pageSize}건 · {safePage} / {pages} 페이지</span><button aria-label={`${region.label} 이전 거래 페이지`} disabled={safePage<=1} onClick={()=>changePage(safePage-1)}><ChevronLeft size={16}/></button><button aria-label={`${region.label} 다음 거래 페이지`} disabled={safePage>=pages} onClick={()=>changePage(safePage+1)}><ChevronRight size={16}/></button></div>
        {region.key&&<div className="transaction-extras">
          {latest&&<details className="trade-summary"><summary>최근 유효 거래 요약</summary><div className="trade-highlight" aria-label="최근 유효 거래"><div><span>{mode==='count'?'조회된 최근 유효 거래':'선택 기간의 최근 유효 거래'}</span><strong>{formatNumber(priceEok(latest),2)}<small>억 원</small></strong></div><div><b>전용 {formatNumber(latest.area_m2,2)}㎡</b><span>{latest.deal_date} · {latest.floor??'—'}층</span><small>면적과 층이 다른 거래는 가격 차이가 날 수 있습니다.</small></div></div></details>}
          <TradeTrend rows={rows} countMode={mode==='count'}/>
        </div>}
      </>}
    </>}
  </CollapsiblePanel>;
}
