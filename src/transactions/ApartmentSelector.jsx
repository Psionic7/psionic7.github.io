import React,{useEffect,useMemo,useState} from 'react';
import {Building2,Search,Star,X} from 'lucide-react';
import {apartmentAddress,apartmentSummary,formatNumber,hierarchy,scopeRows} from '../domain.mjs';
import {makeApartmentFavorite,sameApartmentFavorite,apartmentFavoriteLabel} from '../apartment-favorites.js';
import {readPreferences,textPreference,useStoredState} from '../preferences.js';
import {Loading} from '../ViewState.jsx';
import ApartmentFavoriteButton from '../ApartmentFavoriteButton.jsx';
import FilterGroup from '../weekly/FilterGroup.jsx';
import './apartment-selector.css';
const emptyRows=[];
const unique=values=>[...new Set(values)].sort((a,b)=>a.localeCompare(b,'ko'));
const emptyFilters={province:'',city:'',district:'',search:''};
function ApartmentOptions({items,selected,onToggle,favorites,onToggleFavorite,label}) {
  return <div className="weekly-dong-picker apartment-options" role="group" aria-label={label}>{items.map(item=><div className={selected.some(saved=>sameApartmentFavorite(saved,item))?'apartment-option selected':'apartment-option'} key={item.id}>
    <label><input type="checkbox" aria-label={apartmentFavoriteLabel(item)+' 조회 선택'} checked={selected.some(saved=>sameApartmentFavorite(saved,item))} onChange={()=>onToggle(item)}/><span>{item.apartment}<small>{item.region_name} {item.dong} · 지번 {item.jibun||'미상'}</small></span></label>
    <ApartmentFavoriteButton apartment={item} region={item} favorites={favorites} onToggle={onToggleFavorite} compact/>
  </div>)}</div>;
}
export default function ApartmentSelector({manifest,catalog,favorites,favoriteRegions,selected,onToggle,onClear,searchRegion,onSearchRegionChange,filters,setFilters,dataset,onRetry,onToggleFavorite}) {
  const [query,setQuery]=useStoredState('apartmentSearch','query',()=>readPreferences('apartments:'+searchRegion?.region_id).search||'',textPreference);
  const [limit,setLimit]=useState(100);
  useEffect(()=>setLimit(100),[searchRegion?.region_id,query]);
  const provinces=unique(catalog.map(region=>hierarchy(region).province));
  const province=provinces.includes(filters.province)?filters.province:'';
  const cities=unique(catalog.filter(region=>!province||hierarchy(region).province===province).map(region=>hierarchy(region).city));
  const city=cities.includes(filters.city)?filters.city:'';
  const districts=unique(catalog.filter(region=>(!province||hierarchy(region).province===province)&&(!city||hierarchy(region).city===city)).map(region=>hierarchy(region).district));
  const district=districts.includes(filters.district)?filters.district:'';
  const choices=catalog.filter(region=>{const location=hierarchy(region);return(!province||location.province===province)&&(!city||location.city===city)&&(!district||location.district===district)&&(!filters.search.trim()||region.label.includes(filters.search.trim()));});
  const update=patch=>setFilters(previous=>({...previous,...patch}));
  const chooseRegion=id=>{onSearchRegionChange(id);setQuery('');};
  const rows=dataset?.rows||emptyRows;
  const candidates=useMemo(()=>searchRegion?apartmentSummary(scopeRows(rows,searchRegion)).map(item=>makeApartmentFavorite(item,searchRegion)):[],[rows,searchRegion]);
  const apartments=useMemo(()=>candidates.map(candidate=>favorites.find(saved=>sameApartmentFavorite(saved,candidate))||selected.find(saved=>sameApartmentFavorite(saved,candidate))||candidate),[candidates,favorites,selected]);
  const uniqueApartments=useMemo(()=>[...new Map(apartments.map(item=>[item.id,item])).values()].sort((a,b)=>a.apartment.localeCompare(b.apartment,'ko')||a.dong.localeCompare(b.dong,'ko')||a.jibun.localeCompare(b.jibun,'ko')),[apartments]);
  const needle=query.trim().toLocaleLowerCase();
  const matches=uniqueApartments.filter(item=>(item.apartment+' '+apartmentAddress(item,item.region_name)+' '+item.dong+' '+item.jibun).toLocaleLowerCase().includes(needle));
  return <FilterGroup number="03" title="조회할 아파트" label="조회 아파트 설정" icon={Building2} className="region-card" actions={<button className="text-button" disabled={!selected.length} onClick={onClear}>선택 모두 해제</button>}>
    <section className="weekly-favorite-dongs" aria-label="즐겨찾기한 아파트"><div className="weekly-picker-title"><strong><Star size={14} fill="currentColor"/>즐겨찾기한 아파트 <span className="badge">{formatNumber(favorites.length)}곳</span></strong><small>조회할 아파트를 선택하세요.</small></div>
      {favorites.length?<ApartmentOptions items={favorites} selected={selected} onToggle={onToggle} favorites={favorites} onToggleFavorite={onToggleFavorite} label="즐겨찾기 아파트 선택"/>:<p className="small-note">검색 목록이나 아파트 지도의 별표로 아파트를 즐겨찾기하면 여기에 표시됩니다.</p>}
    </section>
    <div className="weekly-selected" aria-label="선택한 조회 아파트">{selected.map(item=><button key={item.id} aria-label={apartmentFavoriteLabel(item)+' 조회 선택 해제'} onClick={()=>onToggle(item)}>{item.apartment}<small>{item.region_name} {item.dong} · 지번 {item.jibun||'미상'}</small><X size={13}/></button>)}{!selected.length&&<span className="selection-placeholder">즐겨찾기나 아래 검색 목록에서 비교할 아파트를 선택하세요.</span>}</div>
    <div className="weekly-picker-title"><strong>지역·아파트 찾기</strong><button className="text-button" onClick={()=>{setFilters(emptyFilters);setQuery('');}}>검색 초기화</button></div>
    {favoriteRegions.length>0&&<section className="apartment-search-regions" aria-label="즐겨찾기 지역"><span>즐겨찾기 지역</span><div>{favoriteRegions.map(region=><button key={region.region_id} onClick={()=>{setFilters(emptyFilters);chooseRegion(region.region_id);}}><Star size={12}/>{region.dongs[0]}<small>{region.region_name}</small></button>)}</div></section>}
    <div className="weekly-location">
      <label>시도<select value={province} onChange={event=>update({province:event.target.value,city:'',district:''})}><option value="">전체 시도</option>{provinces.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>시<select value={city} onChange={event=>update({city:event.target.value,district:''})}><option value="">전체 시·군</option>{cities.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>구<select value={district} onChange={event=>update({district:event.target.value})}><option value="">전체 구</option>{districts.map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="search-input"><span>지역 검색</span><Search size={16}/><input type="search" placeholder="동 이름 또는 지역명" value={filters.search} onChange={event=>update({search:event.target.value})}/></label>
    </div>
    <div className="apartment-search-controls"><label>조회 지역<select value={searchRegion?.region_id||''} onChange={event=>chooseRegion(event.target.value)}><option value="">지역 선택 ({formatNumber(choices.length)}곳)</option>{searchRegion&&!choices.some(item=>item.region_id===searchRegion.region_id)&&<option value={searchRegion.region_id}>{searchRegion.label}</option>}{choices.map(item=><option value={item.region_id} key={item.region_id}>{item.label}{manifest.districts[item.region_code]?'':' · 미수집'}</option>)}</select></label>
      <label className="search-input"><span>아파트 검색</span><Search size={16}/><input type="search" placeholder="아파트명 · 도로명주소 · 법정동 · 지번" value={query} onChange={event=>setQuery(event.target.value)}/></label>
    </div>
    <p className="small-note">검색은 선택한 지역의 전체 수집 자료에서 찾습니다. 조회 기간에 거래가 없는 단지도 선택할 수 있습니다.{searchRegion&&<button className="text-button clear-region" onClick={()=>chooseRegion('')}>조회 선택 해제</button>}</p>
    {!searchRegion?<p className="small-note">아파트를 찾을 지역을 선택해 주세요.</p>:!manifest.districts[searchRegion.region_code]?<p className="notice">아직 수집된 자료가 없는 지역입니다. 즐겨찾기한 아파트는 위에서 선택할 수 있습니다.</p>:dataset?.error?<div role="alert" className="notice error">이 지역의 아파트 목록을 불러오지 못했습니다.<button onClick={onRetry}>다시 불러오기</button></div>:!dataset?.rows?<Loading text="이 지역의 아파트 목록을 불러오는 중입니다."/>:<>
      <div className="weekly-picker-title"><span>검색 결과 {formatNumber(matches.length)}곳</span><small>여러 아파트를 함께 선택할 수 있습니다.</small></div>
      {matches.length?<ApartmentOptions items={matches.slice(0,limit)} selected={selected} onToggle={onToggle} favorites={favorites} onToggleFavorite={onToggleFavorite} label="검색 아파트 선택"/>:<p className="small-note">검색 조건과 일치하는 아파트가 없습니다.</p>}
      {matches.length>limit&&<button className="apartment-more" onClick={()=>setLimit(previous=>previous+100)}>아파트 더 보기 ({formatNumber(limit)} / {formatNumber(matches.length)})</button>}
    </>}
  </FilterGroup>;
}
