import React, {useMemo, useState} from 'react';
import {CalendarDays, Search, X, MapPin, SlidersHorizontal} from 'lucide-react';
import {apartmentAddress, areaInputValue, areaM2, areaUnitLabel, formatNumber, hierarchy} from './domain.mjs';
import {periodBounds,publishedDay} from './weekly.mjs';
import {Empty} from './ViewState.jsx';
import AreaUnit from './AreaUnit.jsx';
import AreaRange from './AreaRange.jsx';
import PeriodPicker from './PeriodPicker.jsx';
import './dong-filters.css';
import {areaPreference,textPreference,unitPreference,useStoredState} from './preferences.js';

import WeeklyResults from './weekly/WeeklyResults.jsx';
import {useDistrictDatasets} from './weekly/useDistrictDatasets.js';

const unique=values=>[...new Set(values)].sort((a,b)=>a.localeCompare(b,'ko'));
const optionalArea=value=>value==='' || areaPreference(value);
const areaBands=[10,20,30];
const validAreaBands=value=>Array.isArray(value) && value.length<=areaBands.length && new Set(value).size===value.length && value.every(band=>areaBands.includes(band));
export default function WeeklyPage({manifest, catalog, selectedIds=[], onChange, day, onDayChange,period,onPeriodChange,districtLoader,favoritesView=false,favoriteApartments=[],onRemoveFavorite,onOpenApartment,onAddApartments,onToggleFavorite}) {
  const filterScope=favoritesView?'favoriteDashboard':'weekly';
  const locations=catalog.map(hierarchy);
  const [province,setProvince]=useStoredState(filterScope,'province','',value=>value==='' || locations.some(item=>item.province===value));
  const [city,setCity]=useStoredState(filterScope,'city','',value=>value==='' || locations.some(item=>(!province || item.province===province) && item.city===value));
  const [district,setDistrict]=useStoredState(filterScope,'district','',value=>value==='' || locations.some(item=>(!province || item.province===province) && (!city || item.city===city) && item.district===value));
  const [search,setSearch]=useStoredState(filterScope,'search','',textPreference);
  const [areaUnit,setAreaUnit]=useStoredState('display','areaUnit','m2',unitPreference);
  // Store exact square metres; unit changes only affect the input display.
  const [minArea,setMinArea]=useStoredState(filterScope,'minArea','',optionalArea);
  const [maxArea,setMaxArea]=useStoredState(filterScope,'maxArea','',optionalArea);
  const [selectedBands,setSelectedBands]=useStoredState(filterScope,'areaBands',[],validAreaBands);
  const [includeCancelled,setIncludeCancelled]=useStoredState(filterScope,'includeCancelled',true,value=>typeof value==='boolean');
  const setArea=(setter,value)=>setter(value===''?'':areaM2(Math.max(0,Number(value)),areaUnit));
  const areaFiltered=minArea!=='' || maxArea!=='' || selectedBands.length>0;
  const toggleBand=band=>setSelectedBands(previous=>previous.includes(band)?previous.filter(value=>value!==band):[...previous,band].sort((a,b)=>a-b));
  const invalidArea=minArea!=='' && maxArea!=='' && minArea>maxArea;
  const unit=areaUnitLabel(areaUnit);
  const [retry,setRetry]=useState(0);
  const dongs=useMemo(()=>catalog.filter(region=>region.dongs.length===1),[catalog]);
  const selected=useMemo(()=>favoritesView?favoriteApartments.map(item=>({...item,region_id:item.id,label:item.apartment+' · '+item.region_name+' '+item.dong+' · 지번 '+(item.jibun||'미상'),dongs:item.master_id?[...new Set([item.dong,...item.trade_keys.map(k=>JSON.parse(k)[0])])]:[item.dong]})):selectedIds.map(id=>dongs.find(region=>region.region_id===id)).filter(Boolean),[favoritesView,favoriteApartments,selectedIds,dongs]);
  const codes=useMemo(()=>[...new Set(selected.map(region=>region.region_code))].sort(),[selected]);
  const datasets=useDistrictDatasets(manifest,codes,districtLoader,retry);
  const knownMaxArea=useMemo(()=>codes.reduce((max,code)=>(datasets[code]?.rows||[]).reduce((value,row)=>Math.max(value,Number(row.area_m2)||0),max),300),[codes,datasets]);
  const sliderCeiling=Math.max(Math.ceil(knownMaxArea/50)*50,minArea||0,maxArea||0);
  const provinces=unique(dongs.map(region=>hierarchy(region).province));
  const cities=unique(dongs.filter(region=>!province||hierarchy(region).province===province).map(region=>hierarchy(region).city));
  const districts=unique(dongs.filter(region=>(!province||hierarchy(region).province===province)&&(!city||hierarchy(region).city===city)).map(region=>hierarchy(region).district));
  const choices=dongs.filter(region=>{
    const location=hierarchy(region);
    return (!province||location.province===province)&&(!city||location.city===city)&&(!district||location.district===district)&&(!search.trim()||region.label.includes(search.trim()));
  });
  const toggle=id=>onChange(selectedIds.includes(id)?selectedIds.filter(value=>value!==id):[...selectedIds,id]);
  const latestDay=publishedDay(manifest.published_at),requestedRange=periodBounds(period,day);
  const firstMonth=manifest.months[0], earliestDay=firstMonth?`${firstMonth.slice(0,4)}-${firstMonth.slice(4)}-01`:undefined;
  let periodError=!requestedRange?'올바른 조회 날짜를 선택해 주세요.':'';
  if(period.mode==='custom'&&period.start&&period.end&&period.start>period.end)periodError='조회 시작일은 종료일보다 늦을 수 없습니다.';
  if(requestedRange&&period.mode==='custom'&&((earliestDay&&requestedRange.start<earliestDay)||(latestDay&&requestedRange.end>latestDay)))periodError='공개 자료 범위 안에서 시작일과 종료일을 선택해 주세요.';
  if(requestedRange&&period.mode==='month'&&((earliestDay&&period.month<earliestDay.slice(0,7))||(latestDay&&period.month>latestDay.slice(0,7))))periodError='공개 자료 범위 안에서 조회 월을 선택해 주세요.';
  const week=periodError?null:requestedRange;
  return <div className="weekly-page">
    <section className="panel weekly-controls" aria-label={favoritesView?"즐겨찾기 아파트 조회 조건":"주간 조회 조건"}>
      <div className="section-title weekly-controls-title"><div><h2><CalendarDays size={19}/>{favoritesView?'즐겨찾기 아파트 실거래가':'동별 주간 실거래가'}</h2><p>{favoritesView?'저장한 아파트들의 실제 거래를 기간과 면적으로 비교하세요.':'기간과 면적을 고르고, 여러 동의 실제 거래를 함께 비교하세요.'}</p></div><span className="badge">{selected.length}{favoritesView?'개 아파트':'개 동 선택'}</span></div>
      <div className="dong-filter-grid">
        <PeriodPicker period={period} onChange={onPeriodChange} day={day} onDayChange={onDayChange} range={week} earliestDay={earliestDay} latestDay={latestDay} error={periodError}/>
        <section className="dong-filter-card area-card" aria-label="조회 면적 설정">
          <div className="dong-filter-heading"><span className="filter-step">02</span><h3><SlidersHorizontal size={16}/>전용면적</h3><AreaUnit value={areaUnit} onChange={setAreaUnit}/></div>
          <div className="area-band-picker" role="group" aria-label="전용평대 빠른 선택">
            <div className="area-band-caption"><strong>평대 빠른 선택</strong><span>여러 구간 선택 가능</span></div>
            <div className="area-band-buttons"><button aria-pressed={!selectedBands.length} onClick={()=>setSelectedBands([])}>전체 평대</button>{areaBands.map(band=><button key={band} aria-pressed={selectedBands.includes(band)} onClick={()=>toggleBand(band)}>{band}평대</button>)}</div>
            <p>전용평 기준 · 10평대는 10평 이상~20평 미만입니다. 최소·최대 면적 조건도 함께 적용됩니다.</p>
          </div>
          <AreaRange minArea={minArea} maxArea={maxArea} ceilingM2={sliderCeiling} unit={areaUnit} onMinChange={setMinArea} onMaxChange={setMaxArea}/>
          <div className="weekly-area-filter" role="group" aria-label="주간 전용면적 필터">
            <label>최소 전용면적 ({unit})<input type="number" min="0" step="any" placeholder="제한 없음" value={minArea===''?'':areaInputValue(minArea,areaUnit)} onChange={event=>setArea(setMinArea,event.target.value)}/></label>
            <label>최대 전용면적 ({unit})<input type="number" min="0" step="any" placeholder="제한 없음" value={maxArea===''?'':areaInputValue(maxArea,areaUnit)} onChange={event=>setArea(setMaxArea,event.target.value)}/></label>
          </div>
          <div className="area-card-footer"><span>전용평 = ㎡ ÷ 3.305785</span><button className="text-button" disabled={!areaFiltered} onClick={()=>{setMinArea('');setMaxArea('');setSelectedBands([]);}}>면적 필터 초기화</button></div>
          {invalidArea&&<p className="notice error" role="alert">최소 전용면적은 최대 전용면적보다 클 수 없습니다.</p>}
        </section>
      </div>
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
      : week&&<div className="weekly-stack">{selected.map(region=><WeeklyResults key={region.region_id} region={region} week={week} dataset={datasets[region.region_code]} collected={!!manifest.districts[region.region_code]} areaUnit={areaUnit} minArea={minArea} maxArea={maxArea} selectedBands={selectedBands} includeCancelled={includeCancelled} mode={period.mode} favoriteApartments={favoriteApartments} onToggleFavorite={onToggleFavorite} onOpenApartment={favoritesView?()=>onOpenApartment(region,week):undefined} onRemove={()=>favoritesView?onRemoveFavorite(region.id):toggle(region.region_id)} onRetry={()=>setRetry(value=>value+1)}/>)}</div>}
  </div>;
}
