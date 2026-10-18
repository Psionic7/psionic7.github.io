import React,{useEffect,useMemo,useState} from 'react';
import {Map as MapIcon,Search,Layers,Star,RotateCcw} from 'lucide-react';
import {loadApartmentMap,mapVisibleApartments,mapCollectedApartments,hasMapPosition} from './apartment-map-data.js';
import ApartmentFavoriteButton from './ApartmentFavoriteButton.jsx';
import {useStoredState,textPreference} from './preferences.js';
import {formatNumber} from './domain.mjs';
import {Loading,Empty} from './ViewState.jsx';
import ApartmentMapCanvas from './ApartmentMapCanvas.jsx';
import './apartment-map.css';
import useMediaQuery from './useMediaQuery.js';
const emptyFavorites=[];
const defaults={regionCode:'',dong:'',query:'',favoriteOnly:false,showBoundaries:true,showPoints:true};
const validFilters=p=>p&&['regionCode','dong','query'].every(k=>textPreference(p[k]))&&['favoriteOnly','showBoundaries','showPoints'].every(k=>typeof p[k]==='boolean');
export default function ApartmentMapPage({manifest,favorites=[],onToggleFavorite,onOpenApartment,mapLoader=loadApartmentMap,MapComponent=ApartmentMapCanvas}) {
  const [activeId,setActiveId]=useState(''),[listLimit,setListLimit]=useState(30),[mobileView,setMobileView]=useStoredState('apartmentMap','view','map',value=>['map','list'].includes(value));
  const mobile=useMediaQuery('(max-width:650px)');
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
  const unlocated=visible.filter(p=>!hasMapPosition(p));
  const update=patch=>{setActiveId('');setListLimit(30);setFilters(previous=>({...previous,...patch}));};
  if(error)return <section className="panel"><div role="alert" className="notice error">{error}</div><button className="button" onClick={()=>setRetry(r=>r+1)}>지도 자료 다시 불러오기</button></section>;
  if(!data)return <Loading text="아파트 목록과 위치를 불러오고 있습니다."/>;
  return <section className="panel apartment-map-page" aria-label="아파트 지도"><div className="panel-heading"><MapIcon size={20}/><h2>아파트 지도</h2><span className="badge">현재 수집 지역</span></div><p className="small-note">단지 영역이나 위치 아이콘을 누르면 주거 단지 정보와 즐겨찾기 버튼이 열립니다.</p>
    <p className="map-intro">숫자는 동네의 단지 수입니다. 확대하거나 목록에서 선택하면 개별 단지를 볼 수 있습니다.</p>
    <div className="apartment-map-filters"><label>지도 지역<select value={regionCode} onChange={e=>update({regionCode:e.target.value,dong:''})}><option value="">수집 지역 전체</option>{regionChoices.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label><label>지도 법정동<select value={dong} onChange={e=>update({dong:e.target.value})}><option value="">전체 동</option>{dongs.map(d=><option key={d}>{d}</option>)}</select></label><label className="map-search">아파트·주소 검색<div><Search size={16}/><input type="search" value={filters.query} onChange={e=>update({query:e.target.value})} placeholder="아파트 이름 또는 도로명주소"/></div></label></div>
    <div className="apartment-map-toolbar"><div className="map-layer-options" aria-label="지도 레이어"><Layers size={16}/><label><input type="checkbox" checked={filters.showBoundaries} onChange={e=>update({showBoundaries:e.target.checked})}/>단지 경계</label><label><input type="checkbox" checked={filters.showPoints} onChange={e=>update({showPoints:e.target.checked})}/>아파트 위치</label></div><label className="map-favorites-only"><input type="checkbox" checked={filters.favoriteOnly} onChange={e=>update({favoriteOnly:e.target.checked})}/><Star size={15}/>즐겨찾기만</label><button className="text-button" onClick={()=>setFilters(defaults)}><RotateCcw size={14}/>필터 초기화</button></div>
    <div className="apartment-map-summary"><span>조회 아파트 <strong>{formatNumber(visible.length)}개</strong></span><span>지도 위치 <strong>{formatNumber(visible.length-unlocated.length)}개</strong></span><span>{data.loadBoundaries?'상세 경계는 확대 시 표시':<>영역 표시 <strong>{formatNumber(boundaryApartments.size)}개</strong></>}</span><span>수집 목록 <strong>{formatNumber(data.apartments.length)}개</strong></span></div>
    <div className="mobile-map-switch" role="group" aria-label="아파트 탐색 보기"><button aria-pressed={mobileView==='map'} onClick={()=>setMobileView('map')}>지도</button><button aria-pressed={mobileView==='list'} onClick={()=>setMobileView('list')}>단지 목록</button></div>
    <div className="map-explorer" data-mobile-view={mobileView}>
      <section className="map-results-list" aria-label="탐색할 아파트"><div className="map-list-heading"><strong>단지 {formatNumber(visible.length)}곳</strong><span>선택하면 지도에 표시</span></div>{[...visible].sort((a,b)=>Number(b.id===activeId)-Number(a.id===activeId)).slice(0,listLimit).map(item=><article key={item.id} className={activeId===item.id?'active':''}><button className="map-list-select" aria-pressed={activeId===item.id} onClick={()=>{setActiveId(item.id);setMobileView('map');}}><strong>{item.apartment}</strong><small>{item.region_name} {item.dong}</small><span>{item.build_year?`${item.build_year}년 준공`:''}{!hasMapPosition(item)?' · 위치 미확인':''}</span></button><div className="map-list-actions">{onOpenApartment&&<button className="map-list-query" onClick={()=>onOpenApartment(item)}>실거래가 보기 →</button>}<ApartmentFavoriteButton apartment={item} region={item} favorites={favorites} onToggle={onToggleFavorite} compact/></div></article>)}{visible.length>listLimit&&<button className="map-list-more" onClick={()=>setListLimit(value=>value+30)}>단지 더 보기</button>}</section>
      {(!mobile||mobileView==='map')&&<MapComponent data={data} visible={visible} filters={filters} favorites={favorites} focusApartmentId={activeId} onSelectApartment={setActiveId} onToggleFavorite={onToggleFavorite} onOpenApartment={onOpenApartment}/>}
    </div>
    {unlocated.length>0&&<section className="map-unlocated" aria-label="위치 미확인 아파트"><h3>위치 미확인 아파트 {formatNumber(unlocated.length)}개</h3><p className="small-note">공식 좌표가 없어 지도에 배치할 수 없는 항목입니다.</p>{unlocated.map(p=><article key={p.id}><div><strong>{p.apartment}</strong><p>{p.road_address||[p.region_name,p.dong,p.jibun].filter(Boolean).join(' ')}</p><span>건축년도 {p.build_year||'미확인'}</span></div><ApartmentFavoriteButton apartment={p} region={p} favorites={favorites} onToggle={onToggleFavorite} compact/></article>)}</section>}
    {!visible.length&&<Empty title="조건에 맞는 아파트가 없습니다.">지역·검색 조건을 바꾸거나 즐겨찾기만 표시를 해제하세요.</Empty>}
    <details className="map-data-details"><summary>지도 자료 범위와 정확도</summary>    {data.manifest?.data_mode!=='registry_master'&&<p className="notice">현재 지도 자료는 지역 내 모든 아파트를 포함하지 않습니다. 전체 아파트 정보 수집이 완료되면 반영됩니다.</p>}
    {data.manifest?.data_mode==='registry_master'&&data.manifest.coverage?.complete!==true&&<p className="notice">공식 대장에서 아파트·노인복지주택으로 확인한 {formatNumber(data.apartments.length)}개 항목을 표시합니다. 이름 {formatNumber(data.manifest.coverage?.mapUnnamed||0)}개 · 위치 {formatNumber(data.manifest.coverage?.mapUnlocated||0)}개가 미확인입니다. 전체 필지 경계는 {formatNumber(data.manifest.coverage?.withBoundary||0)}개 단지에서 확인했습니다. 일부 공동주택의 유형과 필지 연결은 검토 중입니다.</p>}
</details>
    <p className="small-note map-coverage-note">{data.manifest?.data_mode==='registry_master'?'파란색은 건축물대장에 연결된 대표·부속 필지, 보라색은 V-World GIS 건물 외곽선입니다. 실제 단지 담장과 다를 수 있습니다.':'색칠된 영역은 OpenStreetMap에서 확인한 단지 경계입니다. 경계 미확인 단지는 위치 아이콘으로 표시합니다. 지도 경계는 법적 지적 경계와 다를 수 있습니다.'} <a href={data.manifest?.license||'https://www.openstreetmap.org/copyright'} target="_blank" rel="noreferrer">{data.manifest?.attribution||'© OpenStreetMap contributors · ODbL'}</a></p>
  </section>;
}
