import React,{useState} from 'react';
import ApartmentFavoriteButton from './ApartmentFavoriteButton.jsx';
export default function ApartmentMapPopup({apartments,favorites,onToggleFavorite,boundaryName=''}){
  const [id,setId]=useState(apartments[0].id);
  const apartment=apartments.find(a=>a.id===id)||apartments[0];
  const currentYear=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date()));
  const buildYear=Number(apartment.build_year);
  const yearNumber=Number.isInteger(buildYear)&&buildYear>0&&buildYear<=currentYear?currentYear-buildYear+1:null;
  return <div className="apartment-info-popup" role="dialog" aria-label={`${apartment.apartment} 아파트 정보`}>
    <div className="map-popup-favorite"><ApartmentFavoriteButton apartment={apartment} region={apartment} favorites={favorites} onToggle={onToggleFavorite} compact/></div>
    {apartments.length>1&&<label className="map-popup-select">이 영역의 아파트<select value={apartment.id} onChange={e=>setId(e.target.value)}>{apartments.map(a=><option key={a.id} value={a.id}>{a.apartment} · {a.dong} {a.jibun}</option>)}</select></label>}
    <p className="map-popup-eyebrow">{apartment.region_name} · {apartment.dong}</p><h3>{apartment.apartment}</h3><p className="map-popup-address">{apartment.road_address||`${apartment.region_name} ${apartment.dong} ${apartment.jibun}`}</p>
    <dl className="map-popup-facts"><div><dt>지번</dt><dd>{apartment.dong} {apartment.jibun}</dd></div><div><dt>건축년도</dt><dd>{apartment.build_year||'미상'}{yearNumber!==null&&<span className="map-popup-building-age"> ({yearNumber}년차)</span>}</dd></div></dl>
    {boundaryName&&<p className="map-popup-source">경계 이름: {boundaryName} · OpenStreetMap</p>}
  </div>;
}
