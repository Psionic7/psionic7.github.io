import React,{useEffect,useMemo,useState} from 'react';
import {Map as MapIcon,Search,Layers,Star,RotateCcw} from 'lucide-react';
import {loadApartmentMap,mapVisibleApartments,mapCollectedApartments} from './apartment-map-data.js';
import {useStoredState,textPreference} from './preferences.js';
import {formatNumber} from './domain.mjs';
import {Loading,Empty} from './ViewState.jsx';
import ApartmentMapCanvas from './ApartmentMapCanvas.jsx';
import './apartment-map.css';
const emptyFavorites=[];
const defaults={regionCode:'',dong:'',query:'',favoriteOnly:false,showBoundaries:true,showPoints:true};
const validFilters=p=>p&&['regionCode','dong','query'].every(k=>textPreference(p[k]))&&['favoriteOnly','showBoundaries','showPoints'].every(k=>typeof p[k]==='boolean');
export default function ApartmentMapPage({manifest,favorites=[],onToggleFavorite,mapLoader=loadApartmentMap,MapComponent=ApartmentMapCanvas}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [filters,setFilters]=useStoredState('apartmentMap','filters',defaults,validFilters);
  useEffect(()=>{let active=true;setError('');mapLoader().then(d=>{if(active)setData({...d,apartments:mapCollectedApartments(d.apartments,manifest)});}).catch(e=>active&&setError(e.message));return()=>{active=false;};},[mapLoader,retry,manifest]);
  const regionChoices=useMemo(()=>[...new Map((data?.apartments||[]).map(p=>[p.region_code,p.region_name])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'ko')),[data]);
  const regionCode=regionChoices.some(([id])=>id===filters.regionCode)?filters.regionCode:'';
  const dongs=useMemo(()=>[...new Set((data?.apartments||[]).filter(p=>!regionCode||p.region_code===regionCode).map(p=>p.dong))].sort((a,b)=>a.localeCompare(b,'ko')),[data,regionCode]);
  const dong=dongs.includes(filters.dong)?filters.dong:'';
  const favoriteFilter=filters.favoriteOnly?favorites:emptyFavorites;
  const visible=useMemo(()=>mapVisibleApartments(data?.apartments||[],{...filters,regionCode,dong},favoriteFilter),[data,filters,regionCode,dong,favoriteFilter]);
  const ids=new Set(visible.map(p=>p.id)),boundaryApartments=new Set((data?.boundaries.features||[]).flatMap(f=>f.properties.apartment_ids).filter(id=>ids.has(id)));
  const update=patch=>setFilters(previous=>({...previous,...patch}));
  if(error)return <section className="panel"><div role="alert" className="notice error">{error}</div><button className="button" onClick={()=>setRetry(r=>r+1)}>지도 자료 다시 불러오기</button></section>;
  if(!data)return <Loading text="아파트 위치와 단지 경계를 불러오고 있습니다."/>;
  return <section className="panel apartment-map-page" aria-label="아파트 지도"><div className="panel-heading"><MapIcon size={20}/><h2>아파트 지도</h2><span className="badge">현재 수집 지역</span></div><p className="small-note">단지 영역이나 위치 아이콘을 누르면 아파트 정보와 즐겨찾기 버튼이 열립니다.</p>
    <div className="apartment-map-filters"><label>지도 지역<select value={regionCode} onChange={e=>update({regionCode:e.target.value,dong:''})}><option value="">수집 지역 전체</option>{regionChoices.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label><label>지도 법정동<select value={dong} onChange={e=>update({dong:e.target.value})}><option value="">전체 동</option>{dongs.map(d=><option key={d}>{d}</option>)}</select></label><label className="map-search">아파트·주소 검색<div><Search size={16}/><input type="search" value={filters.query} onChange={e=>update({query:e.target.value})} placeholder="아파트 이름 또는 도로명주소"/></div></label></div>
    <div className="apartment-map-toolbar"><div className="map-layer-options" aria-label="지도 레이어"><Layers size={16}/><label><input type="checkbox" checked={filters.showBoundaries} onChange={e=>update({showBoundaries:e.target.checked})}/>단지 경계</label><label><input type="checkbox" checked={filters.showPoints} onChange={e=>update({showPoints:e.target.checked})}/>아파트 위치</label></div><label className="map-favorites-only"><input type="checkbox" checked={filters.favoriteOnly} onChange={e=>update({favoriteOnly:e.target.checked})}/><Star size={15}/>즐겨찾기만</label><button className="text-button" onClick={()=>setFilters(defaults)}><RotateCcw size={14}/>필터 초기화</button></div>
    <div className="apartment-map-summary"><span>표시 아파트 <strong>{formatNumber(visible.length)}개</strong></span><span>경계 확인 <strong>{formatNumber(boundaryApartments.size)}개</strong></span><span>전체 위치 <strong>{formatNumber(data.apartments.length)}개</strong></span></div>
    <MapComponent data={data} visible={visible} filters={filters} favorites={favorites} onToggleFavorite={onToggleFavorite}/>
    {!visible.length&&<Empty title="조건에 맞는 아파트가 없습니다.">지역·검색 조건을 바꾸거나 즐겨찾기만 표시를 해제하세요.</Empty>}
    <p className="small-note map-coverage-note">색칠된 영역은 OpenStreetMap에서 확인한 단지 경계입니다. 경계 미확인 단지는 위치 아이콘으로 표시합니다. 지도 경계는 법적 지적 경계와 다를 수 있으며, 현재 저장된 수집 지역의 좌표 확인 아파트만 표시합니다. <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a></p>
  </section>;
}
