import React, {useEffect, useMemo, useRef, useState} from 'react';
import {CalendarDays, ChevronLeft, ChevronRight, Search, X} from 'lucide-react';
import {apartmentAddress, areaInputValue, areaM2, areaUnitLabel, areaValue, formatNumber, hierarchy, priceEok, stats, unitPrice} from './domain.mjs';
import {publishedDay, shiftWeek, weekBounds, weeklyRows} from './weekly.mjs';
import {Empty,Loading} from './ViewState.jsx';
import AreaUnit from './AreaUnit.jsx';
import AreaRange from './AreaRange.jsx';
import {areaPreference,textPreference,unitPreference,useStoredState} from './preferences.js';

const unique=values=>[...new Set(values)].sort((a,b)=>a.localeCompare(b,'ko'));
const optionalArea=value=>value==='' || areaPreference(value);
export default function WeeklyPage({manifest, catalog, selectedIds, onChange, day, onDayChange, districtLoader}) {
  const locations=catalog.map(hierarchy);
  const [province,setProvince]=useStoredState('weekly','province','',value=>value==='' || locations.some(item=>item.province===value));
  const [city,setCity]=useStoredState('weekly','city','',value=>value==='' || locations.some(item=>(!province || item.province===province) && item.city===value));
  const [district,setDistrict]=useStoredState('weekly','district','',value=>value==='' || locations.some(item=>(!province || item.province===province) && (!city || item.city===city) && item.district===value));
  const [search,setSearch]=useStoredState('weekly','search','',textPreference);
  const [areaUnit,setAreaUnit]=useStoredState('display','areaUnit','m2',unitPreference);
  // Store exact square metres; unit changes only affect the input display.
  const [minArea,setMinArea]=useStoredState('weekly','minArea','',optionalArea);
  const [maxArea,setMaxArea]=useStoredState('weekly','maxArea','',optionalArea);
  const setArea=(setter,value)=>setter(value===''?'':areaM2(Math.max(0,Number(value)),areaUnit));
  const areaFiltered=minArea!=='' || maxArea!=='';
  const invalidArea=minArea!=='' && maxArea!=='' && minArea>maxArea;
  const unit=areaUnitLabel(areaUnit);
  const [datasets,setDatasets]=useState({}), [retry,setRetry]=useState(0);
  const cache=useRef(new Map());
  const dongs=useMemo(()=>catalog.filter(region=>region.dongs.length===1),[catalog]);
  const selected=selectedIds.map(id=>dongs.find(region=>region.region_id===id)).filter(Boolean);
  const codes=JSON.stringify([...new Set(selected.map(region=>region.region_code))].sort());
  const knownMaxArea=useMemo(()=>JSON.parse(codes).reduce((max,code)=>(datasets[code]?.rows||[]).reduce((value,row)=>Math.max(value,Number(row.area_m2)||0),max),300),[codes,datasets]);
  const sliderCeiling=Math.max(Math.ceil(knownMaxArea/50)*50,minArea||0,maxArea||0);
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
  const week=weekBounds(day), latestDay=publishedDay(manifest.published_at);
  const firstMonth=manifest.months[0], earliestDay=firstMonth?`${firstMonth.slice(0,4)}-${firstMonth.slice(4)}-01`:undefined;
  return <div className="weekly-page">
    <section className="panel weekly-controls" aria-label="주간 조회 조건">
      <div className="section-title"><div><h2><CalendarDays size={19}/>동별 주간 실거래가</h2><p>여러 동을 선택하면 선택한 순서대로 아래에 거래 정보를 쌓아 보여줍니다.</p></div><span className="badge">{selected.length}개 동 선택</span></div>
      <div className="weekly-period"><label>조회 주 기준 날짜<input type="date" value={day} min={earliestDay} max={latestDay||undefined} onChange={event=>onDayChange(event.target.value)}/></label><div className="weekly-navigation"><button aria-label="이전 주" disabled={!week||!!earliestDay&&shiftWeek(day,-1)<weekBounds(earliestDay).start} onClick={()=>onDayChange(shiftWeek(day,-1))}><ChevronLeft size={16}/></button><strong>{week?`${week.start} — ${week.end}`:'조회 날짜를 선택해 주세요'}</strong><button aria-label="다음 주" disabled={!week||!!latestDay&&shiftWeek(day,1)>latestDay} onClick={()=>onDayChange(shiftWeek(day,1))}><ChevronRight size={16}/></button></div><AreaUnit value={areaUnit} onChange={setAreaUnit}/></div>
      <p className="small-note">계약일 기준 월요일~일요일 · 계약 해제 거래 제외 · 신고 지연에 따라 최근 주의 자료는 적거나 없을 수 있습니다. 자료 기준일: {latestDay||'미상'} (한국 시간)</p>
      {!week&&<p className="notice error" role="alert">주간 조회를 위해 올바른 날짜를 선택해 주세요.</p>}
      <AreaRange minArea={minArea} maxArea={maxArea} ceilingM2={sliderCeiling} unit={areaUnit} onMinChange={setMinArea} onMaxChange={setMaxArea}/>
      <div className="weekly-area-filter" role="group" aria-label="주간 전용면적 필터">
        <label>최소 전용면적 ({unit})<input type="number" min="0" step="any" placeholder="제한 없음" value={minArea===''?'':areaInputValue(minArea,areaUnit)} onChange={event=>setArea(setMinArea,event.target.value)}/></label>
        <label>최대 전용면적 ({unit})<input type="number" min="0" step="any" placeholder="제한 없음" value={maxArea===''?'':areaInputValue(maxArea,areaUnit)} onChange={event=>setArea(setMaxArea,event.target.value)}/></label>
        <button disabled={!areaFiltered} onClick={()=>{setMinArea('');setMaxArea('');}}>면적 필터 초기화</button>
      </div>
      <p className="small-note">양쪽 손잡이를 움직여 면적 범위를 조절하세요. 선택한 모든 동의 거래와 통계에 적용됩니다. 숫자로도 입력할 수 있으며, 양 끝으로 이동하거나 입력을 비우면 해당 면적 제한을 해제합니다.</p>
      {invalidArea&&<p className="notice error" role="alert">최소 전용면적은 최대 전용면적보다 클 수 없습니다.</p>}
      <div className="weekly-location"><label>주간 시도<select value={province} onChange={event=>{setProvince(event.target.value);setCity('');setDistrict('');}}><option value="">전체 시도</option>{provinces.map(value=><option key={value}>{value}</option>)}</select></label><label>주간 시<select value={city} onChange={event=>{setCity(event.target.value);setDistrict('');}}><option value="">전체 시</option>{cities.map(value=><option key={value}>{value}</option>)}</select></label><label>주간 구<select value={district} onChange={event=>setDistrict(event.target.value)}><option value="">전체 구</option>{districts.map(value=><option key={value}>{value}</option>)}</select></label><label className="search-input"><span>주간 동 검색</span><Search size={16}/><input type="search" placeholder="동 이름 또는 시·구 이름" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
      <div className="weekly-picker-title"><span>조회할 동 선택 · {formatNumber(choices.length)}곳</span><button disabled={!selectedIds.length} onClick={()=>onChange([])}>선택 모두 해제</button></div>
      <div className="weekly-dong-picker" role="group" aria-label="주간 조회할 동 선택">{choices.map(region=><label key={region.region_id} className={selectedIds.includes(region.region_id)?'selected':''}><input type="checkbox" checked={selectedIds.includes(region.region_id)} onChange={()=>toggle(region.region_id)}/><span>{region.dongs[0]}<small>{region.region_name}{manifest.districts[region.region_code]?'':' · 미수집'}</small></span></label>)}{!choices.length&&<p className="small-note">검색 조건과 일치하는 동이 없습니다.</p>}</div>
      <div className="weekly-selected" aria-label="선택한 주간 조회 동">{selected.map(region=><button key={region.region_id} aria-label={`${region.label} 선택 해제`} onClick={()=>toggle(region.region_id)}>{region.dongs[0]}<small>{region.region_name}</small><X size={13}/></button>)}</div>
      <p className="small-note">검색·지역 필터를 바꿔도 선택한 동은 유지됩니다. 전용평 = 전용면적(㎡) ÷ 3.305785</p>
    </section>
    {!selected.length ? <section className="panel"><Empty title="주간 실거래가를 볼 동을 선택해 주세요.">서로 다른 시·구의 동도 함께 선택할 수 있습니다.</Empty></section>
      : week&&<div className="weekly-stack">{selected.map(region=><DongWeek key={region.region_id} region={region} week={week} dataset={datasets[region.region_code]} collected={!!manifest.districts[region.region_code]} areaUnit={areaUnit} minArea={minArea} maxArea={maxArea} onRemove={()=>toggle(region.region_id)} onRetry={()=>setRetry(value=>value+1)}/>)}</div>}
  </div>;
}

function DongWeek({region,week,dataset,collected,areaUnit,minArea,maxArea,onRemove,onRetry}) {
  const rows=useMemo(()=>weeklyRows(dataset?.rows||[],region,week).filter(row=>(minArea==='' || row.area_m2>=minArea) && (maxArea==='' || row.area_m2<=maxArea)),[dataset?.rows,region,week.start,week.end,minArea,maxArea]);
  const areaFiltered=minArea!=='' || maxArea!=='';
  const summary=useMemo(()=>stats(rows),[rows]);
  const [page,setPage]=useState(1);
  useEffect(()=>setPage(1),[rows]);
  const pages=Math.max(1,Math.ceil(rows.length/50)), safePage=Math.min(page,pages), unit=areaUnitLabel(areaUnit);
  return <section className="panel weekly-dong" aria-label={`${region.label} 주간 실거래가`}>
    <div className="section-title"><div><h2>{region.dongs[0]}</h2><p>{region.region_name} · {week.start} — {week.end}</p></div><button aria-label={`${region.label} 조회 제거`} onClick={onRemove}><X size={14}/>제거</button></div>
    {!collected?<Empty title="아직 수집된 자료가 없는 동입니다.">로컬 관리자에서 수집·배포하면 조회할 수 있습니다.</Empty>:dataset?.error?<div className="notice error" role="alert">이 지역의 자료를 불러오지 못했습니다.<button onClick={onRetry}>다시 불러오기</button></div>:!dataset?.rows?<Loading text="이 동의 주간 거래를 불러오는 중입니다."/>:<>
      <div className="weekly-metrics" aria-label={`${region.label} 주간 통계`}><div><span>유효 거래</span><strong>{formatNumber(summary.count)}<small>건</small></strong></div><div><span>거래금액 중앙값</span><strong>{formatNumber(summary.median,2)}<small>억 원</small></strong></div><div><span>{areaUnit==='pyeong'?'전용평당':'전용㎡당'} 중앙값</span><strong>{formatNumber(unitPrice(summary,areaUnit))}<small>만 원</small></strong></div><div><span>거래된 아파트</span><strong>{formatNumber(summary.apartments)}<small>곳</small></strong></div></div>
      {!rows.length?<Empty title={areaFiltered?'이 주의 면적 조건에 맞는 유효 거래가 없습니다.':'이 주에 조회되는 유효 거래가 없습니다.'}>{areaFiltered?'면적 필터를 조정하거나 초기화해 보세요.':'이전 주나 다른 동을 선택해 보세요.'}</Empty>:<><div className="table-scroll weekly-trades" role="region" aria-label={`${region.label} 주간 거래 내역`} tabIndex={0}><table className="summary-table"><thead><tr><th>계약일</th><th>아파트 / 주소</th><th>전용면적 ({unit})</th><th>층</th><th>거래금액</th><th>거래유형</th></tr></thead><tbody>{rows.slice((safePage-1)*50,safePage*50).map(row=><tr key={row.id}><td>{row.deal_date}</td><td><strong>{row.apartment}</strong><small>{apartmentAddress(row,region.region_name)}</small></td><td>{formatNumber(areaValue(row.area_m2,areaUnit),2)}{unit}</td><td>{row.floor??'—'}층</td><td><strong>{formatNumber(priceEok(row),2)}억 원</strong><small>{formatNumber(row.price_man)}만 원</small></td><td>{row.raw?.dealingGbn?.trim()||'—'}</td></tr>)}</tbody></table></div><div className="pagination"><span>계약일 최신순 · 페이지당 50건 · {safePage} / {pages} 페이지</span><button aria-label={`${region.label} 이전 거래 페이지`} disabled={safePage<=1} onClick={()=>setPage(safePage-1)}><ChevronLeft size={16}/></button><button aria-label={`${region.label} 다음 거래 페이지`} disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}><ChevronRight size={16}/></button></div></>}
    </>}
  </section>;
}
