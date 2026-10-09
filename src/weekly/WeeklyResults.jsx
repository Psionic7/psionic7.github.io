import React, {useEffect, useMemo, useState} from 'react';
import {ChevronLeft, ChevronRight, X} from 'lucide-react';
import {apartmentAddress, areaUnitLabel, areaValue, formatNumber, priceEok, stats} from '../domain.mjs';
import {Empty, Loading} from '../ViewState.jsx';
import {weeklyResultRows} from './query.mjs';

export default function WeeklyResults({region,week,dataset,collected,areaUnit,minArea,maxArea,selectedBands,includeCancelled,mode,onOpenApartment,onRemove,onRetry}) {
  const rows=useMemo(()=>weeklyResultRows(dataset?.rows||[],region,week,{minArea,maxArea,selectedBands,includeCancelled}),[dataset?.rows,region,week.start,week.end,minArea,maxArea,selectedBands,includeCancelled]);
  const periodLabel=mode==='week'?'주간':'기간별',timeLabel=mode==='week'?'이 주':'선택 기간';
  const areaFiltered=minArea!=='' || maxArea!=='' || selectedBands.length>0;
  const summary=useMemo(()=>stats(rows.filter(row=>row.cancelled===0)),[rows]);
  const latest=rows.find(row=>row.cancelled===0);
  const [page,setPage]=useState(1);
  useEffect(()=>setPage(1),[rows]);
  const pages=Math.max(1,Math.ceil(rows.length/50)), safePage=Math.min(page,pages), displayAreaUnit=region.key?areaUnit:'pyeong', unit=areaUnitLabel(displayAreaUnit);
  return <section className="panel weekly-dong" aria-label={`${region.label} ${periodLabel} 실거래가`}>
    <div className="section-title"><div><h2>{region.key?region.apartment:region.dongs[0]}</h2><p>{region.key?apartmentAddress(region,region.region_name):region.region_name} · {week.start} — {week.end}</p></div><div className="watch-card-actions">{onOpenApartment&&<button onClick={onOpenApartment} aria-label={region.label+' 아파트 상세 보기'}>상세 보기</button>}<button aria-label={region.label+(region.key?' 즐겨찾기 해제':' 조회 제거')} onClick={onRemove}><X size={14}/>{region.key?'즐겨찾기 해제':'제거'}</button></div></div>
    {!collected?<Empty title="아직 수집된 자료가 없는 동입니다.">로컬 관리자에서 수집·배포하면 조회할 수 있습니다.</Empty>:dataset?.error?<div className="notice error" role="alert">이 지역의 자료를 불러오지 못했습니다.<button onClick={onRetry}>다시 불러오기</button></div>:!dataset?.rows?<Loading text="이 동의 거래를 불러오는 중입니다."/>:<>
      <div className="weekly-metrics" aria-label={`${region.label} ${periodLabel} 통계`}><div><span>유효 거래</span><strong>{formatNumber(summary.count)}<small>건</small></strong></div><div><span>최저 거래금액</span><strong>{formatNumber(summary.min,2)}<small>억 원</small></strong></div><div><span>최고 거래금액</span><strong>{formatNumber(summary.max,2)}<small>억 원</small></strong></div><div><span>{region.key?'최근 거래가격':'거래된 아파트'}</span><strong>{region.key?formatNumber(latest?priceEok(latest):null,2):formatNumber(summary.apartments)}<small>{region.key?'억 원':'곳'}</small></strong></div></div>
      <p className="small-note">표시 {formatNumber(rows.length)}건 · 유효 {formatNumber(summary.count)}건 · 해제 {formatNumber(rows.length-summary.count)}건. 위 통계는 유효 거래 기준이며, 거래표 금액은 각 신고의 원래 금액입니다.</p>
      {!rows.length?<Empty title={areaFiltered?`${timeLabel}의 면적 조건에 맞는 ${includeCancelled?'':'유효 '}거래가 없습니다.`:`${timeLabel}에 조회되는 ${includeCancelled?'':'유효 '}거래가 없습니다.`}>{areaFiltered?'면적 필터를 조정하거나 초기화해 보세요.':region.key?'기간이나 다른 아파트를 선택해 보세요.':'기간이나 다른 동을 선택해 보세요.'}</Empty>:<>
        <div className="table-scroll weekly-trades" role="region" aria-label={`${region.label} ${periodLabel} 거래 내역`} tabIndex={0}><table className="summary-table">
          <thead><tr><th>계약일</th><th>아파트 이름</th><th>전용면적 ({unit})</th><th>층</th><th>거래금액</th><th>거래 상태 / 해제일</th></tr></thead>
          <tbody>{rows.slice((safePage-1)*50,safePage*50).map(row=><tr key={row.id} className={row.cancelled?'cancelled-trade':''}><td><time dateTime={row.deal_date} title={row.deal_date}>{row.deal_date.slice(2).replaceAll('-','.')}</time></td><td><strong>{row.apartment}</strong></td><td>{formatNumber(areaValue(row.area_m2,displayAreaUnit),1)}{unit}</td><td>{row.floor??'—'}층</td><td><strong>{formatNumber(priceEok(row),2)}억 원</strong></td><td><span className={`trade-status ${row.cancelled?'cancelled':''}`}>{row.cancelled?'해제':'유효'}</span>{!!row.cancelled&&<small className="trade-cancel-date">해제일 {row.raw?.cdealDay?.trim()||'미상'}</small>}</td></tr>)}</tbody>
        </table></div>
        <div className="pagination"><span>계약일 최신순 · 페이지당 50건 · {safePage} / {pages} 페이지</span><button aria-label={`${region.label} 이전 거래 페이지`} disabled={safePage<=1} onClick={()=>setPage(safePage-1)}><ChevronLeft size={16}/></button><button aria-label={`${region.label} 다음 거래 페이지`} disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}><ChevronRight size={16}/></button></div>
      </>}
    </>}
  </section>;
}
