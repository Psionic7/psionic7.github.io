import React,{useState} from 'react';
import ApartmentFavoriteButton from './ApartmentFavoriteButton.jsx';
export default function ApartmentMapPopup({apartments,favorites,onToggleFavorite,boundaryName='',boundarySource='OpenStreetMap',boundaryKind='',buildingAttributes=null}){
  const [id,setId]=useState(apartments[0].id);
  const apartment=apartments.find(a=>a.id===id)||apartments[0];
  const currentYear=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date()));
  const buildYear=Number(apartment.build_year);
  const yearNumber=Number.isInteger(buildYear)&&buildYear>0&&buildYear<=currentYear?currentYear-buildYear+1:null;
  return <div className="apartment-info-popup" role="dialog" aria-label={`${apartment.apartment} 아파트 정보`}>
    <div className="map-popup-favorite"><ApartmentFavoriteButton apartment={apartment} region={apartment} favorites={favorites} onToggle={onToggleFavorite} compact/></div>
    {apartments.length>1&&<label className="map-popup-select">이 영역의 아파트<select value={apartment.id} onChange={e=>setId(e.target.value)}>{apartments.map(a=><option key={a.id} value={a.id}>{a.apartment} · {a.dong} {a.jibun}</option>)}</select></label>}
    {apartment.name_status==='missing'&&<p className="small-note">공식 대장의 단지명이 없어 주소로 표시합니다.</p>}
    <p className="map-popup-eyebrow">{apartment.region_name} · {apartment.dong}</p><h3>{apartment.apartment}</h3><p className="map-popup-address">{apartment.road_address||`${apartment.region_name} ${apartment.dong} ${apartment.jibun}`}</p>
    <dl className="map-popup-facts">{apartment.housing_type_label&&<div><dt>주거 유형</dt><dd>{apartment.housing_type_label}</dd></div>}<div><dt>지번</dt><dd>{apartment.dong} {apartment.jibun}</dd></div><div><dt>건축년도</dt><dd>{apartment.build_year||'미상'}{yearNumber!==null&&<span className="map-popup-building-age"> ({yearNumber}년차)</span>}</dd></div>{apartment.household_count!=null&&!(apartment.housing_type==='senior_housing'&&apartment.household_count===0)&&<div><dt>세대수</dt><dd>{apartment.household_count.toLocaleString()}세대</dd></div>}{apartment.housing_type==='senior_housing'&&!(apartment.household_count>0)&&apartment.dwelling_unit_count!=null&&<div><dt>주거 호수</dt><dd>{apartment.dwelling_unit_count.toLocaleString()}호</dd></div>}{apartment.building_count!=null&&<div><dt>건물 동수</dt><dd>{apartment.building_count}개 동</dd></div>}{apartment.land_price_per_m2!=null&&<div><dt>개별공시지가</dt><dd>{Number(apartment.land_price_per_m2).toLocaleString()}원/㎡{apartment.land_price_year&&<span> ({apartment.land_price_year}년{apartment.land_price_month?` ${Number(apartment.land_price_month)}월`:''})</span>}</dd></div>}{apartment.zoning_names?.length>0&&<div><dt>용도지역</dt><dd>{apartment.zoning_names.join(' · ')}</dd></div>}{apartment.max_floors!=null&&<div><dt>최고 층수</dt><dd>{apartment.max_floors}층</dd></div>}</dl>
    {boundaryName&&<p className="map-popup-source">{boundaryKind==='cadastral_parcels'?'필지 경계':boundaryKind==='building_footprint'?'건물 외곽선':'경계 이름'}: {boundaryName} · {boundarySource}</p>}{buildingAttributes&&<dl className="map-popup-facts">
      <div><dt>지상 층수</dt><dd>{buildingAttributes.grnd_flr||'—'}층</dd></div>
      <div><dt>지하 층수</dt><dd>{buildingAttributes.ugrnd_flr||'—'}층</dd></div>
    </dl>}
  </div>;
}
