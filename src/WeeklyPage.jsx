import React, {useEffect, useMemo, useRef, useState} from 'react';
import {CalendarDays, ChevronLeft, ChevronRight, Search, X, MapPin} from 'lucide-react';
import {apartmentAddress, apartmentKey, areaUnitLabel, areaValue, formatNumber, hierarchy, priceEok, stats} from './domain.mjs';
import {weeklyRows} from './weekly.mjs';
import {Empty,Loading} from './ViewState.jsx';
import TransactionFilters from './TransactionFilters.jsx';
import {areaMatches} from './transaction-filters.js';
import ApartmentFavoriteButton from './ApartmentFavoriteButton.jsx';
import './dong-filters.css';
import {textPreference,useStoredState} from './preferences.js';

const unique=values=>[...new Set(values)].sort((a,b)=>a.localeCompare(b,'ko'));
export default function WeeklyPage({manifest, catalog, selectedIds=[], onChange, filters,districtLoader,favoritesView=false,favoriteApartments=[],onRemoveFavorite,onOpenApartment,onAddApartments,onToggleFavorite}) {
  const filterScope=favoritesView?'favoriteDashboard':'weekly';
  const {day,period,range:week,areaUnit,minArea,maxArea,areaBands:selectedBands}=filters;
  const locations=catalog.map(hierarchy);
  const [province,setProvince]=useStoredState(filterScope,'province','',value=>value==='' || locations.some(item=>item.province===value));
  const [city,setCity]=useStoredState(filterScope,'city','',value=>value==='' || locations.some(item=>(!province || item.province===province) && item.city===value));
  const [district,setDistrict]=useStoredState(filterScope,'district','',value=>value==='' || locations.some(item=>(!province || item.province===province) && (!city || item.city===city) && item.district===value));
  const [search,setSearch]=useStoredState(filterScope,'search','',textPreference);
  const [includeCancelled,setIncludeCancelled]=useStoredState(filterScope,'includeCancelled',true,value=>typeof value==='boolean');
  const [datasets,setDatasets]=useState({}), [retry,setRetry]=useState(0);
  const cache=useRef(new Map());
  const dongs=useMemo(()=>catalog.filter(region=>region.dongs.length===1),[catalog]);
  const selected=useMemo(()=>favoritesView?favoriteApartments.map(item=>({...item,region_id:item.id,label:item.apartment+' · '+item.region_name+' '+item.dong+' · 지번 '+(item.jibun||'미상'),dongs:[item.dong]})):selectedIds.map(id=>dongs.find(region=>region.region_id===id)).filter(Boolean),[favoritesView,favoriteApartments,selectedIds,dongs]);
  const codes=JSON.stringify([...new Set(selected.map(region=>region.region_code))].sort());
  const knownMaxArea=useMemo(()=>JSON.parse(codes).reduce((max,code)=>(datasets[code]?.rows||[]).reduce((value,row)=>Math.max(value,Number(row.area_m2)||0),max),300),[codes,datasets]);
  useEffect(()=>{
    let active=true;
    JSON.parse(codes).forEach(code=>{
      if(!manifest.districts[code])return;
      const saved=cache.current.get(code);
      if(saved?.rows){setDatasets(previous=>({...previous,[code]:{rows:saved.rows}}));return;}
      setDatasets(previous=>({...previous,[code]:{loading:true}}));
      const promise=saved?.promise||Promise.resolve().then(()=>districtLoader(manifest,code));
      cache.current.set(code,{promise});
      promise.then(rows=>{cache.current.set(code,{rows});if(active)setDatasets(previous=>({...previous,[code]:{rows}}));})
        .catch(()=>{cache.current.delete(code);if(active)setDatasets(previous=>({...previous,[code]:{error:true}}));});
    });
    return()=>{active=false;};
  },[codes,manifest,districtLoader,retry]);
  const provinces=unique(dongs.map(region=>hierarchy(region).province));
  const cities=unique(dongs.filter(region=>!province||hierarchy(region).province===province).map(region=>hierarchy(region).city));
  const districts=unique(dongs.filter(region=>(!province||hierarchy(region).province===province)&&(!city||hierarchy(region).city===city)).map(region=>hierarchy(region).district));
  const choices=dongs.filter(region=>{
    const location=hierarchy(region);
    return (!province||location.province===province)&&(!city||location.city===city)&&(!district||location.district===district)&&(!search.trim()||region.label.includes(search.trim()));
  });
  const toggle=id=>onChange(selectedIds.includes(id)?selectedIds.filter(value=>value!==id):[...selectedIds,id]);
  return <div className="weekly-page">
    <section className="panel weekly-controls" aria-label={favoritesView?"즐겨찾기 아파트 조회 조건":"주간 조회 조건"}>
      <div className="section-title weekly-controls-title"><div><h2><CalendarDays size={19}/>{favoritesView?'즐겨찾기 아파트 실거래가':'동별 주간 실거래가'}</h2><p>{favoritesView?'저장한 아파트들의 실제 거래를 기간과 면적으로 비교하세요.':'기간과 면적을 고르고, 여러 동의 실제 거래를 함께 비교하세요.'}</p></div><span className="badge">{selected.length}{favoritesView?'개 아파트':'개 동 선택'}</span></div>
      <TransactionFilters filters={filters} knownMaxArea={knownMaxArea}/>
      <div className="weekly-display-options"><label className="weekly-cancel-toggle"><input type="checkbox" checked={includeCancelled} onChange={event=>setIncludeCancelled(event.target.checked)}/>해제 거래 포함</label><p>최저·최고가는 유효 거래 기준입니다. 최근 자료는 신고 지연으로 추가될 수 있습니다.</p></div>
      {favoritesView?<section className="dong-filter-card region-card" aria-label="즐겨찾기 아파트 목록">
        <div className="dong-filter-heading"><span className="filter-step">03</span><h3>즐겨찾기 아파트</h3><button onClick={onAddApartments}>아파트 즐겨찾기 추가</button></div>
        <p className="small-note">아파트별 실거래가 또는 동별 거래표의 별표로 추가할 수 있습니다. 이 브라우저에 저장되며, 선택한 기간에 거래가 없어도 목록에 유지됩니다.</p>
        <div className="favorite-apartment-list">{selected.map(item=><button key={item.id} onClick={()=>onOpenApartment(item,week)}>{item.apartment}<small>{apartmentAddress(item,item.region_name)}</small></button>)}</div>
      </section>:<section className="dong-filter-card region-card" aria-label="조회 지역 설정">
        <div className="dong-filter-heading"><span className="filter-step">03</span><h3><MapPin size={16}/>조회할 동</h3><button className="text-button" disabled={!selectedIds.length} onClick={()=>onChange([])}>선택 모두 해제</button></div>
        <div className="weekly-location">
          <label>시도<select aria-label="주간 시도" value={province} onChange={event=>{setProvince(event.target.value);setCity('');setDistrict('');}}><option value="">전체 시도</option>{provinces.map(value=><option key={value}>{value}</option>)}</select></label>
          <label>시·군<select aria-label="주간 시" value={city} onChange={event=>{setCity(event.target.value);setDistrict('');}}><option value="">전체 시·군</option>{cities.map(value=><option key={value}>{value}</option>)}</select></label>
          <label>구<select aria-label="주간 구" value={district} onChange={event=>setDistrict(event.target.value)}><option value="">전체 구</option>{districts.map(value=><option key={value}>{value}</option>)}</select></label>
          <label className="search-input"><span>동·지역 검색</span><Search size={16}/><input aria-label="주간 동 검색" type="search" placeholder="동 이름 또는 시·구 이름" value={search} onChange={event=>setSearch(event.target.value)}/></label>
        </div>
        <div className="weekly-selected" aria-label="선택한 주간 조회 동">{selected.map(region=><button key={region.region_id} aria-label={region.label+' 선택 해제'} onClick={()=>toggle(region.region_id)}>{region.dongs[0]}<small>{region.region_name}</small><X size={13}/></button>)}{!selected.length&&<span className="selection-placeholder">아래 목록에서 비교할 동을 선택하세요.</span>}</div>
        <div className="weekly-picker-title"><span>검색 결과 {formatNumber(choices.length)}곳</span><small>여러 지역을 함께 선택할 수 있습니다.</small></div>
        <div className="weekly-dong-picker" role="group" aria-label="주간 조회할 동 선택">{choices.map(region=><label key={region.region_id} className={selectedIds.includes(region.region_id)?'selected':''}><input type="checkbox" checked={selectedIds.includes(region.region_id)} onChange={()=>toggle(region.region_id)}/><span>{region.dongs[0]}<small>{region.region_name}{manifest.districts[region.region_code]?'':' · 미수집'}</small></span></label>)}{!choices.length&&<p className="small-note">검색 조건과 일치하는 동이 없습니다.</p>}</div>
      </section>}
    </section>
    {!!selected.length&&week&&<div className="weekly-results-context"><strong>조회 결과 · {selected.length}{favoritesView?'개 아파트':'개 동'}</strong><span>{week.start} — {week.end}</span><small>{period.mode==='week'?'주간':period.mode==='month'?'월간':'직접 지정'} · {includeCancelled?'해제 포함':'유효 거래만'}</small></div>}
    {!selected.length ? <section className="panel"><Empty title={favoritesView?'즐겨찾기한 아파트가 없습니다.':'주간 실거래가를 볼 동을 선택해 주세요.'}>{favoritesView?'아파트별 실거래가에서 아파트를 선택한 뒤 즐겨찾기를 추가하세요.':'서로 다른 시·구의 동도 함께 선택할 수 있습니다.'}</Empty></section>
      : week&&<div className="weekly-stack">{selected.map(region=><DongWeek key={region.region_id} region={region} week={week} dataset={datasets[region.region_code]} collected={!!manifest.districts[region.region_code]} areaUnit={areaUnit} minArea={minArea} maxArea={maxArea} selectedBands={selectedBands} includeCancelled={includeCancelled} mode={period.mode} favoriteApartments={favoriteApartments} onToggleFavorite={onToggleFavorite} onOpenApartment={favoritesView?()=>onOpenApartment(region,week):undefined} onRemove={()=>favoritesView?onRemoveFavorite(region.id):toggle(region.region_id)} onRetry={()=>setRetry(value=>value+1)}/>)}</div>}
  </div>;
}

function DongWeek({region,week,dataset,collected,areaUnit,minArea,maxArea,selectedBands,includeCancelled,mode,favoriteApartments,onToggleFavorite,onOpenApartment,onRemove,onRetry}) {
  const rows=useMemo(()=>weeklyRows(dataset?.rows||[],region,week,includeCancelled).filter(row=>(!region.key || apartmentKey(row)===region.key) && areaMatches(row,{minArea,maxArea,areaBands:selectedBands})),[dataset?.rows,region,week.start,week.end,minArea,maxArea,selectedBands,includeCancelled]);
  const periodLabel=mode==='week'?'주간':'기간별',timeLabel=mode==='week'?'이 주':'선택 기간';
  const areaFiltered=minArea!=='' || maxArea!=='' || selectedBands.length>0;
  const summary=useMemo(()=>stats(rows.filter(row=>row.cancelled===0)),[rows]);
  const latest=rows.find(row=>row.cancelled===0);
  const [page,setPage]=useState(1);
  useEffect(()=>setPage(1),[rows]);
  const pages=Math.max(1,Math.ceil(rows.length/50)), safePage=Math.min(page,pages), unit=areaUnitLabel(areaUnit);
  return <section className="panel weekly-dong" aria-label={`${region.label} ${periodLabel} 실거래가`}>
    <div className="section-title"><div><h2>{region.key?region.apartment:region.dongs[0]}</h2><p>{region.key?apartmentAddress(region,region.region_name):region.region_name} · {week.start} — {week.end}</p></div><div className="watch-card-actions">{onOpenApartment&&<button onClick={onOpenApartment} aria-label={region.label+' 아파트 상세 보기'}>상세 보기</button>}<button aria-label={region.label+(region.key?' 즐겨찾기 해제':' 조회 제거')} onClick={onRemove}><X size={14}/>{region.key?'즐겨찾기 해제':'제거'}</button></div></div>
    {!collected?<Empty title="아직 수집된 자료가 없는 동입니다.">로컬 관리자에서 수집·배포하면 조회할 수 있습니다.</Empty>:dataset?.error?<div className="notice error" role="alert">이 지역의 자료를 불러오지 못했습니다.<button onClick={onRetry}>다시 불러오기</button></div>:!dataset?.rows?<Loading text="이 동의 거래를 불러오는 중입니다."/>:<>
      <div className="weekly-metrics" aria-label={`${region.label} ${periodLabel} 통계`}><div><span>유효 거래</span><strong>{formatNumber(summary.count)}<small>건</small></strong></div><div><span>최저 거래금액</span><strong>{formatNumber(summary.min,2)}<small>억 원</small></strong></div><div><span>최고 거래금액</span><strong>{formatNumber(summary.max,2)}<small>억 원</small></strong></div><div><span>{region.key?'최근 거래가격':'거래된 아파트'}</span><strong>{region.key?formatNumber(latest?priceEok(latest):null,2):formatNumber(summary.apartments)}<small>{region.key?'억 원':'곳'}</small></strong></div></div>
      <p className="small-note">표시 {formatNumber(rows.length)}건 · 유효 {formatNumber(summary.count)}건 · 해제 {formatNumber(rows.length-summary.count)}건. 위 통계는 유효 거래 기준이며, 거래표 금액은 각 신고의 원래 금액입니다.</p>
      {!rows.length?<Empty title={areaFiltered?`${timeLabel}의 면적 조건에 맞는 ${includeCancelled?'':'유효 '}거래가 없습니다.`:`${timeLabel}에 조회되는 ${includeCancelled?'':'유효 '}거래가 없습니다.`}>{areaFiltered?'면적 필터를 조정하거나 초기화해 보세요.':region.key?'기간이나 다른 아파트를 선택해 보세요.':'기간이나 다른 동을 선택해 보세요.'}</Empty>:<>
        <div className="table-scroll weekly-trades" role="region" aria-label={`${region.label} ${periodLabel} 거래 내역`} tabIndex={0}><table className="summary-table">
          <thead><tr><th>계약일</th><th>아파트 / 주소</th><th>전용면적 ({unit})</th><th>층</th><th>거래금액</th><th>거래유형</th><th>거래 상태 / 해제일</th></tr></thead>
          <tbody>{rows.slice((safePage-1)*50,safePage*50).map(row=><tr key={row.id} className={row.cancelled?'cancelled-trade':''}><td>{row.deal_date}</td><td><div className="trade-apartment-name"><strong>{row.apartment}</strong><ApartmentFavoriteButton compact apartment={row} region={region} favorites={favoriteApartments} onToggle={onToggleFavorite}/></div><small>{apartmentAddress(row,region.region_name)}</small></td><td>{formatNumber(areaValue(row.area_m2,areaUnit),2)}{unit}</td><td>{row.floor??'—'}층</td><td><strong>{formatNumber(priceEok(row),2)}억 원</strong><small>{formatNumber(row.price_man)}만 원</small></td><td>{row.raw?.dealingGbn?.trim()||'—'}</td><td><span className={`trade-status ${row.cancelled?'cancelled':''}`}>{row.cancelled?'해제':'유효'}</span>{!!row.cancelled&&<small>해제일 {row.raw?.cdealDay?.trim()||'미상'}</small>}</td></tr>)}</tbody>
        </table></div>
        <div className="pagination"><span>계약일 최신순 · 페이지당 50건 · {safePage} / {pages} 페이지</span><button aria-label={`${region.label} 이전 거래 페이지`} disabled={safePage<=1} onClick={()=>setPage(safePage-1)}><ChevronLeft size={16}/></button><button aria-label={`${region.label} 다음 거래 페이지`} disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}><ChevronRight size={16}/></button></div>
      </>}
    </>}
  </section>;
}
