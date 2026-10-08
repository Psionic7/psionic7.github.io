import React from 'react';
import {SlidersHorizontal} from 'lucide-react';
import {areaInputValue,areaM2,areaUnitLabel} from './domain.mjs';
import {weekBounds} from './weekly.mjs';
import {AREA_BANDS} from './transaction-filters.js';
import AreaUnit from './AreaUnit.jsx';
import AreaRange from './AreaRange.jsx';
import PeriodPicker from './PeriodPicker.jsx';
import './dong-filters.css';
export default function TransactionFilters({filters,knownMaxArea=300}) {
  const {day,period,range:week,periodError,earliestDay,latestDay,areaUnit,minArea,maxArea,areaBands:selectedBands,areaFiltered,invalidArea,update}=filters;
  const unit=areaUnitLabel(areaUnit),areaBands=AREA_BANDS;
  const sliderCeiling=Math.max(Math.ceil(knownMaxArea/50)*50,300,minArea||0,maxArea||0);
  const setMinArea=value=>update({minArea:value}),setMaxArea=value=>update({maxArea:value});
  const setSelectedBands=value=>update({areaBands:value}),setAreaUnit=value=>update({areaUnit:value});
  const onPeriodChange=value=>update({period:value}),onDayChange=value=>update({day:weekBounds(value)?.start||''});
  const setArea=(field,value)=>update({[field]:value===''?'':areaM2(Math.max(0,Number(value)),areaUnit)});
  const toggleBand=band=>update(previous=>({areaBands:previous.areaBands.includes(band)?previous.areaBands.filter(value=>value!==band):[...previous.areaBands,band].sort((a,b)=>a-b)}));
  return <div role="group" aria-label="공통 조회 필터">
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
          <div className="weekly-area-filter" role="group" aria-label="전용면적 필터">
            <label>최소 전용면적 ({unit})<input type="number" min="0" step="any" placeholder="제한 없음" value={minArea===''?'':areaInputValue(minArea,areaUnit)} onChange={event=>setArea('minArea',event.target.value)}/></label>
            <label>최대 전용면적 ({unit})<input type="number" min="0" step="any" placeholder="제한 없음" value={maxArea===''?'':areaInputValue(maxArea,areaUnit)} onChange={event=>setArea('maxArea',event.target.value)}/></label>
          </div>
          <div className="area-card-footer"><span>전용평 = ㎡ ÷ 3.305785</span><button className="text-button" disabled={!areaFiltered} onClick={()=>update({minArea:'',maxArea:'',areaBands:[]})}>면적 필터 초기화</button></div>
          {invalidArea&&<p className="notice error" role="alert">최소 전용면적은 최대 전용면적보다 클 수 없습니다.</p>}
        </section>
      </div>
  </div>;
}
