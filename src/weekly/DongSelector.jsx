import React from 'react';
import {MapPin,Search,Star,X} from 'lucide-react';
import {formatNumber,hierarchy} from '../domain.mjs';
import {textPreference,useStoredState} from '../preferences.js';
import FilterGroup from './FilterGroup.jsx';
const unique=values=>[...new Set(values)].sort((a,b)=>a.localeCompare(b,'ko'));
export default function DongSelector({manifest,catalog,selected,selectedIds,onChange,favoriteRegions=[]}) {
  const dongs=catalog.filter(region=>region.dongs.length===1),locations=dongs.map(hierarchy),favoriteDongs=favoriteRegions.filter(region=>region.dongs.length===1);
  const [province,setProvince]=useStoredState('weekly','province','',value=>value===''||locations.some(item=>item.province===value));
  const [city,setCity]=useStoredState('weekly','city','',value=>value===''||locations.some(item=>(!province||item.province===province)&&item.city===value));
  const [district,setDistrict]=useStoredState('weekly','district','',value=>value===''||locations.some(item=>(!province||item.province===province)&&(!city||item.city===city)&&item.district===value));
  const [search,setSearch]=useStoredState('weekly','search','',textPreference);
  const provinces=unique(dongs.map(region=>hierarchy(region).province));
  const cities=unique(dongs.filter(region=>!province||hierarchy(region).province===province).map(region=>hierarchy(region).city));
  const districts=unique(dongs.filter(region=>(!province||hierarchy(region).province===province)&&(!city||hierarchy(region).city===city)).map(region=>hierarchy(region).district));
  const choices=dongs.filter(region=>{const location=hierarchy(region);return(!province||location.province===province)&&(!city||location.city===city)&&(!district||location.district===district)&&(!search.trim()||region.label.includes(search.trim()));});
  const toggle=id=>onChange(selectedIds.includes(id)?selectedIds.filter(value=>value!==id):[...selectedIds,id]);
  return <FilterGroup number="03" title="조회할 동" label="조회 지역 설정" icon={MapPin} className="region-card" actions={<button className="text-button" disabled={!selectedIds.length} onClick={()=>onChange([])}>선택 모두 해제</button>}>
        <section className="weekly-favorite-dongs" aria-label="즐겨찾기한 동">
          <div className="weekly-picker-title"><strong><Star size={14} fill="currentColor"/>즐겨찾기한 동 <span className="badge">{formatNumber(favoriteDongs.length)}곳</span></strong><small>아래 검색 조건과 관계없이 선택할 수 있습니다.</small></div>
          {favoriteDongs.length?<div className="weekly-dong-picker" role="group" aria-label="즐겨찾기한 동 선택">{favoriteDongs.map(region=><label key={region.region_id} className={selectedIds.includes(region.region_id)?'selected':''}><input type="checkbox" checked={selectedIds.includes(region.region_id)} onChange={()=>toggle(region.region_id)}/><span>{region.dongs[0]}<small>{region.region_name}{manifest.districts[region.region_code]?'':' · 미수집'}</small></span></label>)}</div>:<p className="small-note">지역 지도에서 별표로 동을 즐겨찾기하면 여기에 표시됩니다.</p>}
        </section>
        <div className="weekly-location">
          <label>시도<select aria-label="주간 시도" value={province} onChange={event=>{setProvince(event.target.value);setCity('');setDistrict('');}}><option value="">전체 시도</option>{provinces.map(value=><option key={value}>{value}</option>)}</select></label>
          <label>시·군<select aria-label="주간 시" value={city} onChange={event=>{setCity(event.target.value);setDistrict('');}}><option value="">전체 시·군</option>{cities.map(value=><option key={value}>{value}</option>)}</select></label>
          <label>구<select aria-label="주간 구" value={district} onChange={event=>setDistrict(event.target.value)}><option value="">전체 구</option>{districts.map(value=><option key={value}>{value}</option>)}</select></label>
          <label className="search-input"><span>동·지역 검색</span><Search size={16}/><input aria-label="주간 동 검색" type="search" placeholder="동 이름 또는 시·구 이름" value={search} onChange={event=>setSearch(event.target.value)}/></label>
        </div>
        <div className="weekly-selected" aria-label="선택한 주간 조회 동">{selected.map(region=><button key={region.region_id} aria-label={region.label+' 선택 해제'} onClick={()=>toggle(region.region_id)}>{region.dongs[0]}<small>{region.region_name}</small><X size={13}/></button>)}{!selected.length&&<span className="selection-placeholder">아래 목록에서 비교할 동을 선택하세요.</span>}</div>
        <div className="weekly-picker-title"><span>검색 결과 {formatNumber(choices.length)}곳</span><small>여러 지역을 함께 선택할 수 있습니다.</small></div>
        <div className="weekly-dong-picker" role="group" aria-label="주간 조회할 동 선택">{choices.map(region=><label key={region.region_id} className={selectedIds.includes(region.region_id)?'selected':''}><input type="checkbox" checked={selectedIds.includes(region.region_id)} onChange={()=>toggle(region.region_id)}/><span>{region.dongs[0]}<small>{region.region_name}{manifest.districts[region.region_code]?'':' · 미수집'}</small></span></label>)}{!choices.length&&<p className="small-note">검색 조건과 일치하는 동이 없습니다.</p>}</div>
      </FilterGroup>;
}
