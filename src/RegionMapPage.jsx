import React, {useMemo} from 'react';
import {MapPin,Search,Star,RotateCcw} from 'lucide-react';
import CloudRegionMap from './CloudRegionMap.jsx';
import {formatNumber,hierarchy} from './domain.mjs';
import {textPreference,useStoredState} from './preferences.js';
import './region-map.css';

const emptyFavorites=[];
const defaults={province:'',city:'',district:'',query:'',favoriteOnly:false};
const validFilters=value=>value&&['province','city','district','query'].every(key=>textPreference(value[key]))&&typeof value.favoriteOnly==='boolean';
const unique=values=>[...new Set(values)].sort((a,b)=>a.localeCompare(b,'ko'));

export default function RegionMapPage({catalog,favorites=emptyFavorites,onToggleFavorite,MapComponent=CloudRegionMap}) {
  const regions=useMemo(()=>catalog.filter(region=>/^dong_\d{8}$/.test(region.region_id)&&region.dongs.length===1),[catalog]);
  const [filters,setFilters]=useStoredState('regionMap','filters',defaults,validFilters);
  const provinces=useMemo(()=>unique(regions.map(region=>hierarchy(region).province)),[regions]);
  const province=provinces.includes(filters.province)?filters.province:'';
  const cities=useMemo(()=>unique(regions.filter(region=>!province||hierarchy(region).province===province).map(region=>hierarchy(region).city)),[regions,province]);
  const city=cities.includes(filters.city)?filters.city:'';
  const districts=useMemo(()=>unique(regions.filter(region=>(!province||hierarchy(region).province===province)&&(!city||hierarchy(region).city===city)).map(region=>hierarchy(region).district)),[regions,province,city]);
  const district=districts.includes(filters.district)?filters.district:'';
  const favoriteFilter=filters.favoriteOnly?favorites:emptyFavorites;
  const visible=useMemo(()=>regions.filter(region=>{
    const location=hierarchy(region);
    return (!province||location.province===province)&&(!city||location.city===city)&&(!district||location.district===district)&&(!filters.query.trim()||region.label.includes(filters.query.trim()))&&(!filters.favoriteOnly||favoriteFilter.includes(region.region_id));
  }),[regions,province,city,district,filters.query,filters.favoriteOnly,favoriteFilter]);
  const visibleIds=useMemo(()=>visible.map(region=>region.region_id),[visible]);
  const savedRegions=useMemo(()=>{const byId=new Map(regions.map(region=>[region.region_id,region]));return favorites.map(id=>byId.get(id)).filter(Boolean);},[regions,favorites]);
  const update=patch=>setFilters(previous=>({...previous,...patch}));
  return <section className="panel region-map-page" aria-label="지역 지도">
    <div className="panel-heading"><MapPin size={20}/><h2>지역 지도</h2><span className="badge">즐겨찾기 {formatNumber(savedRegions.length)}곳</span></div>
    <p className="small-note">동·읍·면을 누르면 지역 정보가 열립니다. 팝업의 별표로 즐겨찾기를 추가하거나 해제하면 이 브라우저에 자동 저장됩니다.</p>
    <div className="region-map-filters">
      <label>지역 지도 시도<select value={province} onChange={event=>update({province:event.target.value,city:'',district:''})}><option value="">전체 시도</option>{provinces.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>지역 지도 시·군<select value={city} onChange={event=>update({city:event.target.value,district:''})}><option value="">전체 시·군</option>{cities.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>지역 지도 구<select value={district} onChange={event=>update({district:event.target.value})}><option value="">전체 구</option>{districts.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>동·지역 검색<div className="region-map-search"><Search size={16}/><input type="search" aria-label="지역 지도 검색" value={filters.query} onChange={event=>update({query:event.target.value})} placeholder="동 이름 또는 시·구 이름"/></div></label>
    </div>
    <div className="region-map-toolbar"><label><input type="checkbox" checked={filters.favoriteOnly} onChange={event=>update({favoriteOnly:event.target.checked})}/><Star size={15}/>즐겨찾기 지역만</label><span className="small-note">지도에 표시 {formatNumber(visible.length)}곳</span><button className="text-button" onClick={()=>setFilters(defaults)}><RotateCcw size={14}/>필터 초기화</button></div>
    <MapComponent catalog={regions} draft={favorites} saved={favorites} visibleIds={visibleIds} onToggle={onToggleFavorite} favoriteMode errorMessage="지역 경계 지도를 불러오지 못했습니다. 지도 다시 불러오기를 눌러 주세요."/>
    {!visible.length&&<p className="notice">조건에 맞는 지역이 없습니다. 검색 조건이나 즐겨찾기 지역만 표시를 변경해 주세요.</p>}
    <section className="region-map-favorites" aria-label="즐겨찾기 지역 목록"><h3><Star size={16}/>즐겨찾기 지역 <span className="badge">{formatNumber(savedRegions.length)}곳</span></h3>
      {savedRegions.length?<div className="region-map-favorite-list">{savedRegions.map(region=><article key={region.region_id}><div><strong>{region.dongs[0]}</strong><small>{region.region_name}</small></div><button className="region-favorite-remove" aria-label={region.label+' 즐겨찾기 해제'} title="즐겨찾기 해제" onClick={()=>onToggleFavorite(region.region_id)}><Star size={16} fill="currentColor"/></button></article>)}</div>:<p className="small-note">아직 즐겨찾기한 지역이 없습니다. 지도에서 동을 선택하고 별표를 눌러 주세요.</p>}
      <p className="small-note">즐겨찾기한 지역은 아파트별 실거래가의 조회 조건에서도 선택할 수 있습니다.</p>
    </section>
    <p className="small-note">경계 기준: 2023-07-29 · V-World / kr-admin-geojson. 시·군·구 경계와 동·읍·면 경계를 함께 표시합니다.</p>
  </section>;
}
