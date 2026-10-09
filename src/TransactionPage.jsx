import React, {useMemo, useState} from 'react';
import {CalendarDays, SlidersHorizontal, Settings2} from 'lucide-react';
import {areaInputValue, areaM2, areaUnitLabel} from './domain.mjs';
import {periodBounds,publishedDay} from './weekly.mjs';
import {Empty} from './ViewState.jsx';
import AreaUnit from './AreaUnit.jsx';
import AreaRange from './AreaRange.jsx';
import PeriodPicker from './PeriodPicker.jsx';
import './dong-filters.css';
import {areaPreference,readPreferences,unitPreference,useStoredState} from './preferences.js';

import TransactionResults from './transactions/TransactionResults.jsx';
import FilterGroup from './weekly/FilterGroup.jsx';
import {useDistrictDatasets} from './weekly/useDistrictDatasets.js';

const optionalArea=value=>value==='' || areaPreference(value);
const areaBands=[10,20,30];
const validAreaBands=value=>Array.isArray(value) && value.length<=areaBands.length && new Set(value).size===value.length && value.every(band=>areaBands.includes(band));
function useFilterPreference(scope,field,fallback,validate) {
  return useStoredState(scope,field,()=>{const previous=scope==='apartmentTransactions'?readPreferences('favoriteDashboard')[field]:undefined;return validate(previous)?previous:fallback;},validate);
}
export default function TransactionPage({manifest,regions,day,onDayChange,period,onPeriodChange,districtLoader,apartmentView=false,searchRegionCode,renderSelection,onRemove,filterScope='weekly'}) {
  const selected=regions;
  const [areaUnit,setAreaUnit]=useStoredState('display','areaUnit','m2',unitPreference);
  // Store exact square metres; unit changes only affect the input display.
  const [minArea,setMinArea]=useFilterPreference(filterScope,'minArea','',optionalArea);
  const [maxArea,setMaxArea]=useFilterPreference(filterScope,'maxArea','',optionalArea);
  const [selectedBands,setSelectedBands]=useFilterPreference(filterScope,'areaBands',[],validAreaBands);
  const [includeCancelled,setIncludeCancelled]=useFilterPreference(filterScope,'includeCancelled',true,value=>typeof value==='boolean');
  const setArea=(setter,value)=>setter(value===''?'':areaM2(Math.max(0,Number(value)),areaUnit));
  const areaFiltered=minArea!=='' || maxArea!=='' || selectedBands.length>0;
  const selectBands=bands=>{
    setSelectedBands(bands);
    setMinArea(bands.length?areaM2(Math.min(...bands),'pyeong'):'');
    setMaxArea(bands.length?areaM2(Math.max(...bands)+10,'pyeong'):'');
  };
  const toggleBand=band=>selectBands(selectedBands.includes(band)?selectedBands.filter(value=>value!==band):[...selectedBands,band].sort((a,b)=>a-b));
  const invalidArea=minArea!=='' && maxArea!=='' && minArea>maxArea;
  const unit=areaUnitLabel(areaUnit);
  const [retry,setRetry]=useState(0);
  const selectedCodes=useMemo(()=>[...new Set(selected.map(region=>region.region_code))].sort(),[selected]);
  const codes=useMemo(()=>[...new Set([...selectedCodes,...(searchRegionCode?[searchRegionCode]:[])])].sort(),[selectedCodes,searchRegionCode]);
  const datasets=useDistrictDatasets(manifest,codes,districtLoader,retry);
  const knownMaxArea=useMemo(()=>selectedCodes.reduce((max,code)=>(datasets[code]?.rows||[]).reduce((value,row)=>Math.max(value,Number(row.area_m2)||0),max),300),[selectedCodes,datasets]);
  const sliderCeiling=Math.max(Math.ceil(knownMaxArea/50)*50,minArea||0,maxArea||0);
  const latestDay=publishedDay(manifest.published_at),requestedRange=periodBounds(period,day);
  const firstMonth=manifest.months[0], earliestDay=firstMonth?`${firstMonth.slice(0,4)}-${firstMonth.slice(4)}-01`:undefined;
  let periodError=!requestedRange?'올바른 조회 날짜를 선택해 주세요.':'';
  if(period.mode==='custom'&&period.start&&period.end&&period.start>period.end)periodError='조회 시작일은 종료일보다 늦을 수 없습니다.';
  if(requestedRange&&period.mode==='custom'&&((earliestDay&&requestedRange.start<earliestDay)||(latestDay&&requestedRange.end>latestDay)))periodError='공개 자료 범위 안에서 시작일과 종료일을 선택해 주세요.';
  if(requestedRange&&period.mode==='month'&&((earliestDay&&period.month<earliestDay.slice(0,7))||(latestDay&&period.month>latestDay.slice(0,7))))periodError='공개 자료 범위 안에서 조회 월을 선택해 주세요.';
  const week=periodError?null:requestedRange;
  return <div className="weekly-page">
    <section className="panel weekly-controls" aria-label={apartmentView?"즐겨찾기 아파트 조회 조건":"동 별 실거래가 조회 조건"}>
      <div className="section-title weekly-controls-title"><div><h2><CalendarDays size={19}/>{apartmentView?'아파트별 실거래가':'동 별 실거래가'}</h2><p>{apartmentView?'즐겨찾기나 검색으로 아파트를 선택하고 실제 거래를 함께 비교하세요.':'기간과 면적을 고르고, 여러 동의 실제 거래를 함께 비교하세요.'}</p></div><span className="badge">{selected.length}{apartmentView?'개 아파트':'개 동 선택'}</span></div>
      <div className="dong-filter-grid">
        <PeriodPicker period={period} onChange={onPeriodChange} day={day} onDayChange={onDayChange} range={week} earliestDay={earliestDay} latestDay={latestDay} error={periodError}/>
        <FilterGroup number="02" title="전용면적" label="조회 면적 설정" icon={SlidersHorizontal} className="area-card" actions={<AreaUnit value={areaUnit} onChange={setAreaUnit}/>}>
          <div className="area-band-picker" role="group" aria-label="전용평대 빠른 선택">
            <div className="area-band-caption"><strong>평대 빠른 선택</strong><span>여러 구간 선택 가능</span></div>
            <div className="area-band-buttons"><button aria-pressed={!selectedBands.length} onClick={()=>selectBands([])}>전체 평대</button>{areaBands.map(band=><button key={band} aria-pressed={selectedBands.includes(band)} onClick={()=>toggleBand(band)}>{band}평대</button>)}</div>
            <p>전용평 기준 · 10평대는 10평 이상~20평 미만입니다. 선택하면 아래 슬라이더와 최소·최대 면적도 함께 바뀝니다.</p>
          </div>
          <AreaRange minArea={minArea} maxArea={maxArea} ceilingM2={sliderCeiling} unit={areaUnit} onMinChange={setMinArea} onMaxChange={setMaxArea}/>
          <div className="weekly-area-filter" role="group" aria-label="주간 전용면적 필터">
            <label>최소 전용면적 ({unit})<input type="number" min="0" step="any" placeholder="제한 없음" value={minArea===''?'':areaInputValue(minArea,areaUnit)} onChange={event=>setArea(setMinArea,event.target.value)}/></label>
            <label>최대 전용면적 ({unit})<input type="number" min="0" step="any" placeholder="제한 없음" value={maxArea===''?'':areaInputValue(maxArea,areaUnit)} onChange={event=>setArea(setMaxArea,event.target.value)}/></label>
          </div>
          <div className="area-card-footer"><span>전용평 = ㎡ ÷ 3.305785</span><button className="text-button" disabled={!areaFiltered} onClick={()=>selectBands([])}>면적 필터 초기화</button></div>
          {invalidArea&&<p className="notice error" role="alert">최소 전용면적은 최대 전용면적보다 클 수 없습니다.</p>}
        </FilterGroup>
      </div>
      {renderSelection({datasets,onRetry:()=>setRetry(value=>value+1)})}
      <FilterGroup number="04" title="기타 옵션" icon={Settings2} className="other-card"><div className="weekly-display-options"><label className="weekly-cancel-toggle"><input type="checkbox" checked={includeCancelled} onChange={event=>setIncludeCancelled(event.target.checked)}/>해제 거래 포함</label><p>최근 자료는 신고 지연으로 추가될 수 있습니다.</p></div></FilterGroup>
    </section>
    {!!selected.length&&week&&<div className="weekly-results-context"><strong>조회 결과 · {selected.length}{apartmentView?'개 아파트':'개 동'}</strong><span>{week.start} — {week.end}</span><small>{period.mode==='week'?'주간':period.mode==='month'?'월간':'직접 지정'} · {includeCancelled?'해제 포함':'유효 거래만'}</small></div>}
    {!selected.length ? <section className="panel"><Empty title={apartmentView?'실거래가를 볼 아파트를 선택해 주세요.':'실거래가를 볼 동을 선택해 주세요.'}>{apartmentView?'위의 즐겨찾기 아파트나 지역·아파트 검색에서 조회할 단지를 선택하세요.':'서로 다른 시·구의 동도 함께 선택할 수 있습니다.'}</Empty></section>
      : week&&<div className="weekly-stack">{selected.map(region=><TransactionResults key={region.region_id} region={region} week={week} dataset={datasets[region.region_code]} collected={!!manifest.districts[region.region_code]} minArea={minArea} maxArea={maxArea} selectedBands={selectedBands} includeCancelled={includeCancelled} mode={period.mode} onRemove={()=>onRemove(region)} onRetry={()=>setRetry(value=>value+1)}/>)}</div>}
  </div>;
}
