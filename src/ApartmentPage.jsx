import React, {useMemo} from 'react';
import {apartmentSummary, validRows} from './domain.mjs';
import AreaUnit from './AreaUnit.jsx';
import ApartmentExplorer from './ApartmentExplorer.jsx';
import {unitPreference,useStoredState} from './preferences.js';

export default function ApartmentPage({rows, region, start, end, selectedKey, onSelect, favorites=[], onToggleFavorite}) {
  const [areaUnit,setAreaUnit] = useStoredState('display','areaUnit','m2',unitPreference);
  const valid = useMemo(()=>validRows(rows,0,Infinity),[rows]);
  const apartments = useMemo(()=>apartmentSummary(valid),[valid]);
  return <div className="apartment-page">
    <section className="dashboard-filters"><strong>아파트 상세 조회</strong><AreaUnit value={areaUnit} onChange={setAreaUnit}/></section>
    <p className="small-note area-explanation">전용평 = 전용면적(㎡) ÷ 3.305785 · 공급면적 기준의 분양 평형과 다릅니다.</p>
    <ApartmentExplorer apartments={apartments} rows={valid} selectedKey={selectedKey} onSelect={onSelect} region={region} start={start} end={end} areaUnit={areaUnit} favorites={favorites} onToggleFavorite={onToggleFavorite}/>
  </div>;
}
