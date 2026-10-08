import React,{useMemo} from 'react';
import {apartmentSummary,validRows} from './domain.mjs';
import {filterTransactions} from './transaction-filters.js';
import ApartmentExplorer from './ApartmentExplorer.jsx';
export default function ApartmentPage({rows,region,filters,selectedKey,onSelect,favorites=[],onToggleFavorite}) {
  const valid=useMemo(()=>validRows(rows,0,Infinity),[rows]);
  const apartments=useMemo(()=>apartmentSummary(valid),[valid]);
  const filtered=useMemo(()=>filterTransactions(valid,filters),[valid,filters]);
  const start=filters.range?.start.replaceAll('-','').slice(0,6)||'',end=filters.range?.end.replaceAll('-','').slice(0,6)||'';
  return <div className="apartment-page">
    <ApartmentExplorer apartments={apartments} rows={filtered} selectedKey={selectedKey} onSelect={onSelect} region={region} start={start} end={end} areaUnit={filters.areaUnit} onSelectArea={area=>filters.update({minArea:area,maxArea:area,areaBands:[]})} favorites={favorites} onToggleFavorite={onToggleFavorite}/>
  </div>;
}
