import React,{useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function dongStyle(code,selected,styles) {return {color:selected?'#b77912':(styles[code]?.region_color||'#64748b'),weight:selected?2.7:0.75,fillColor:styles[code]?.region_color||'#739a99',fillOpacity:selected?0.4:0.1,opacity:selected?1:0.85};}
export default function RegionMap({boundaries,adminBoundaries,catalog,draft,saved,visibleIds,onToggle}) {
  const container=useRef(null),mapRef=useRef(null),layers=useRef(new Map()),popupRef=useRef(null);
  const latest=useRef({draft,saved,onToggle});latest.current={draft,saved,onToggle};
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
        const update=()=>{const selected=latest.current.draft.includes(id);star.textContent=selected?'★':'☆';star.setAttribute('aria-label',`${r.label} 수집 지역 ${selected?'해제':'추가'}`);star.title=selected?'수집 지역 해제 (아직 저장되지 않음)':'수집 지역 추가 (아직 저장되지 않음)';};
        update();star.addEventListener('click',e=>{e.stopPropagation();latest.current.onToggle(id);});
        const heading=document.createElement('strong');heading.textContent=r.dongs[0]||r.label;
        const location=document.createElement('p');location.textContent=r.region_name;
        const code=document.createElement('small');code.textContent=`법정동 ${feature.properties.EMD_CD} · API ${r.region_code}`;
        const note=document.createElement('p');note.className='popup-note';note.textContent='별표로 수집 대상을 편집하세요. 업데이트 버튼을 누르면 저장됩니다.';
        box.append(star,heading,location,code,note);popupRef.current={id,update};
        L.popup({maxWidth:290,minWidth:240,autoPan:true}).setLatLng(event.latlng).setContent(box).openOn(map);
      });
      layers.current.set(id,layer);
    }
    const resize=new ResizeObserver(()=>map.invalidateSize({pan:false}));resize.observe(container.current);
    return ()=>{resize.disconnect();map.remove();mapRef.current=null;layers.current.clear();popupRef.current=null;};
  },[boundaries,adminBoundaries,catalog]);
  useEffect(()=>{
    const selected=new Set(draft);
    for(const [id,layer] of layers.current) layer.setStyle(dongStyle(id.slice(5,10),selected.has(id),adminBoundaries.styles));
    popupRef.current?.update();
    // Do not recreate the map, tile layer, popup or viewport when stars change.
  },[draft,adminBoundaries]);
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;const visible=new Set(visibleIds),bounds=L.latLngBounds([]);
    for(const [id,layer] of layers.current){if(visible.has(id)){if(!map.hasLayer(layer))layer.addTo(map);bounds.extend(layer.getBounds());}else if(map.hasLayer(layer))map.removeLayer(layer);}
    if(bounds.isValid())map.fitBounds(bounds,{padding:[15,15],maxZoom:13,animate:false});
  },[visibleIds]);
  return <div className="map-wrap"><div ref={container} className="region-map" aria-label="서울 경기 법정동 수집 지역 지도"/>{tileError&&<div className="tile-warning">배경 지도 일부를 불러오지 못했습니다. 경계와 선택은 유지됩니다.</div>}<div className="map-legend"><strong>지역 경계</strong><span><i className="city-line"/>시·군: 굵은 실선 / 지역별 색</span><span><i className="gu-line"/>구: 점선 / 지역별 색</span><span><i className="dong-line"/>동·읍·면: 가는 실선</span><span><i className="selected-swatch"/>수집 대상: 진한 채움 + 금색 테두리</span></div></div>;
}
