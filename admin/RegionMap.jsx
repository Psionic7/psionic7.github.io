import React,{useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function dongStyle(code,selected,styles) {return {color:selected?'#b77912':(styles[code]?.region_color||'#64748b'),weight:selected?2.7:0.75,fillColor:styles[code]?.region_color||'#739a99',fillOpacity:selected?0.4:0.1,opacity:selected?1:0.85};}
export default function RegionMap({boundaries,adminBoundaries,catalog,draft,saved,visibleIds,onToggle,disabled=false,saveLabel='업데이트',coordinatePoints=[],favoriteMode=false}) {
  const container=useRef(null),mapRef=useRef(null),layers=useRef(new Map()),popupRef=useRef(null);
  const latest=useRef({draft,saved,onToggle,disabled});latest.current={draft,saved,onToggle,disabled};
  const [tileError,setTileError]=useState(false);
  useEffect(()=>{
    const map=L.map(container.current,{preferCanvas:true,zoomControl:true}).setView([37.45,127.1],10);mapRef.current=map;
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · 경계: V-World / kr-admin-geojson'}).addTo(map);
    tiles.on('tileerror',()=>setTileError(true));tiles.on('tileload',()=>setTileError(false));
    map.createPane('cityBoundaries');map.getPane('cityBoundaries').style.zIndex='430';map.getPane('cityBoundaries').style.pointerEvents='none';
    map.createPane('guBoundaries');map.getPane('guBoundaries').style.zIndex='440';map.getPane('guBoundaries').style.pointerEvents='none';
    L.geoJSON(adminBoundaries.cities,{pane:'cityBoundaries',interactive:false,style:f=>({color:f.properties.color,weight:4,fill:false,opacity:0.9})}).addTo(map);
    L.geoJSON(adminBoundaries.districts,{pane:'guBoundaries',interactive:false,style:f=>({color:f.properties.color,weight:2.2,dashArray:'7 5',fill:false,opacity:0.95})}).addTo(map);
    const byId=new Map(catalog.map(r=>[r.region_id,r]));
    for(const feature of boundaries.features) {
      const id='dong_'+feature.properties.EMD_CD,r=byId.get(id);if(!r)continue;
      const layer=L.geoJSON(feature,{style:()=>dongStyle(r.region_code,latest.current.draft.includes(id),adminBoundaries.styles)});
      layer.bindTooltip(r.label,{sticky:true,direction:'top'});
      layer.on('click',event=>{
        const box=document.createElement('div');box.className='region-popup';
        const star=document.createElement('button');star.type='button';star.className='popup-star';
        const update=()=>{const selected=latest.current.draft.includes(id);star.textContent=selected?'★':'☆';star.disabled=latest.current.disabled;star.setAttribute('aria-label',`${r.label} ${favoriteMode?'즐겨찾기':'수집 지역'} ${selected?'해제':'추가'}`);star.setAttribute('aria-pressed',String(selected));star.title=favoriteMode?(selected?'즐겨찾기 해제':'즐겨찾기 추가'):(selected?'수집 지역 해제 (아직 저장되지 않음)':'수집 지역 추가 (아직 저장되지 않음)');};
        update();star.addEventListener('click',e=>{e.stopPropagation();if(!latest.current.disabled)latest.current.onToggle(id);});
        const heading=document.createElement('strong');heading.textContent=r.dongs[0]||r.label;
        const location=document.createElement('p');location.textContent=r.region_name;
        const code=document.createElement('small');code.textContent=favoriteMode?`법정동 ${feature.properties.EMD_CD}`:`법정동 ${feature.properties.EMD_CD} · API ${r.region_code}`;
        const note=document.createElement('p');note.className='popup-note';note.textContent=favoriteMode?'별표로 지역 즐겨찾기를 추가·해제하세요. 이 브라우저에 자동 저장됩니다.':`별표로 수집 대상을 편집하세요. ${saveLabel} 버튼을 누르면 저장됩니다.`;
        box.append(star,heading,location,code,note);popupRef.current={id,update};
        L.popup({maxWidth:290,minWidth:240,autoPan:true}).setLatLng(event.latlng).setContent(box).openOn(map);
      });
      layers.current.set(id,layer);
    }
    const resize=new ResizeObserver(()=>map.invalidateSize({pan:false}));resize.observe(container.current);
    return ()=>{resize.disconnect();map.remove();mapRef.current=null;layers.current.clear();popupRef.current=null;};
  },[boundaries,adminBoundaries,catalog,favoriteMode]);
  useEffect(()=>{
    const selected=new Set(draft);
    for(const [id,layer] of layers.current) layer.setStyle(dongStyle(id.slice(5,10),selected.has(id),adminBoundaries.styles));
    popupRef.current?.update();
    // Do not recreate the map, tile layer, popup or viewport when stars change.
  },[draft,adminBoundaries,disabled]);
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;const visible=new Set(visibleIds),bounds=L.latLngBounds([]);
    for(const [id,layer] of layers.current){if(visible.has(id)){if(!map.hasLayer(layer))layer.addTo(map);bounds.extend(layer.getBounds());}else if(map.hasLayer(layer))map.removeLayer(layer);}
    if(bounds.isValid())map.fitBounds(bounds,{padding:[15,15],maxZoom:13,animate:false});
  },[visibleIds]);
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;
    if(!coordinatePoints.length)return;
    const visibleRegions=catalog.filter(r=>visibleIds.includes(r.region_id));
    const byCode=new Map();for(const r of visibleRegions){const scope=byCode.get(r.region_code)||{all:false,dongs:new Set()};if(!r.dongs.length)scope.all=true;r.dongs.forEach(d=>scope.dongs.add(d));byCode.set(r.region_code,scope);}
    const group=L.layerGroup().addTo(map);
    for(const point of coordinatePoints){
      const scope=byCode.get(point.region_code);
      if(!scope||(!scope.all&&!scope.dongs.has(point.dong)))continue;
      const marker=L.marker([point.latitude,point.longitude],{icon:L.divIcon({className:'apartment-map-icon',html:'<span aria-hidden="true">▥</span>',iconSize:[22,22],iconAnchor:[11,11]}),title:point.apartment,keyboard:true});
      const box=document.createElement('div');box.className='apartment-popup';
      const title=document.createElement('strong');title.textContent=point.apartment;
      const address=document.createElement('p');address.textContent=point.road_address;
      const note=document.createElement('small');note.textContent='도로명주소 출입구 위치 · 주소정보누리집';box.append(title,address,note);
      marker.bindPopup(box);marker.bindTooltip(point.apartment,{direction:'top'});marker.addTo(group);
    }
    return ()=>{group.remove();};
  },[coordinatePoints,visibleIds,catalog,boundaries,adminBoundaries]);
  return <div className="map-wrap"><div ref={container} className="region-map" role="region" aria-label={favoriteMode?"서울 경기 법정동 지역 지도":"서울 경기 법정동 수집 지역 지도"}/>{tileError&&<div className="tile-warning">배경 지도 일부를 불러오지 못했습니다. 경계와 선택은 유지됩니다.</div>}<div className="map-legend"><strong>지역 경계</strong>{coordinatePoints.length>0&&<span><i className="apartment-swatch">▥</i>좌표가 확인된 아파트</span>}<span><i className="city-line"/>시·군: 굵은 실선 / 지역별 색</span><span><i className="gu-line"/>구: 점선 / 지역별 색</span><span><i className="dong-line"/>동·읍·면: 가는 실선</span><span><i className="selected-swatch"/>{favoriteMode?'즐겨찾기 지역':'수집 대상'}: 진한 채움 + 금색 테두리</span></div></div>;
}
