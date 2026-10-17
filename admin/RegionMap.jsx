import React,{useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const noCoverage=[];
const dongColors=['#8eb7df','#7ec9c0','#b5a2d8','#dca4bb','#9bc18b','#9fcbd6'];
export function dongStyle(code,selected,styles,legalCode) {
  if(legalCode)return {color:selected?'#b77912':'#64748b',weight:selected?3.2:0.9,fillColor:selected?'#f1c85b':dongColors[Number(legalCode)%dongColors.length],fillOpacity:selected?0.42:0.14,opacity:selected?1:0.75};
  return {color:selected?'#b77912':(styles[code]?.region_color||'#64748b'),weight:selected?2.7:0.75,fillColor:styles[code]?.region_color||'#739a99',fillOpacity:selected?0.4:0.1,opacity:selected?1:0.85};
}
export default function RegionMap({boundaries,adminBoundaries,catalog,draft,saved,visibleIds,onToggle,onOpenRegion,coveredIds=noCoverage,focusRegionId,onSelectRegion,disabled=false,saveLabel='업데이트',coordinatePoints=[],favoriteMode=false}) {
  const container=useRef(null),mapRef=useRef(null),layers=useRef(new Map()),popupRef=useRef(null),applyStyle=useRef(null);
  const latest=useRef({draft,saved,onToggle,onOpenRegion,disabled});latest.current={draft,saved,onToggle,onOpenRegion,onSelectRegion,coveredIds,focusRegionId,visibleIds,disabled};
  const [tileError,setTileError]=useState(false);
  useEffect(()=>{
    // SVG avoids stale canvas redraws when React remounts a map during navigation.
    const map=L.map(container.current,{preferCanvas:false,zoomControl:true}).setView([37.45,127.1],10);mapRef.current=map;
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · 경계: V-World / kr-admin-geojson'}).addTo(map);
    tiles.on('tileerror',()=>setTileError(true));tiles.on('tileload',()=>setTileError(false));
    map.createPane('cityBoundaries');map.getPane('cityBoundaries').style.zIndex='430';map.getPane('cityBoundaries').style.pointerEvents='none';
    map.createPane('guBoundaries');map.getPane('guBoundaries').style.zIndex='440';map.getPane('guBoundaries').style.pointerEvents='none';
    const cityLayer=L.geoJSON(adminBoundaries.cities,{pane:'cityBoundaries',interactive:false,style:f=>({color:f.properties.color,weight:favoriteMode?1.8:4,fill:false,opacity:favoriteMode?0.7:0.9})}).addTo(map);
    const districtLayer=L.geoJSON(adminBoundaries.districts,{pane:'guBoundaries',interactive:false,style:f=>({color:f.properties.color,weight:favoriteMode?1.1:2.2,dashArray:'7 5',fill:false,opacity:favoriteMode?0.7:0.95})}).addTo(map);
    const byId=new Map(catalog.map(r=>[r.region_id,r]));
    for(const feature of boundaries.features) {
      const id='dong_'+feature.properties.EMD_CD,r=byId.get(id);if(!r)continue;
      const layer=L.geoJSON(feature,{style:()=>dongStyle(r.region_code,latest.current.draft.includes(id),adminBoundaries.styles,favoriteMode?feature.properties.EMD_CD:undefined)});
      layer.bindTooltip(r.label,{sticky:true,direction:'top'});
      layer.on('click',event=>{
        latest.current.onSelectRegion?.(id);
        const box=document.createElement('div');box.className='region-popup';
        const star=document.createElement('button');star.type='button';star.className='popup-star';
        const update=()=>{const selected=latest.current.draft.includes(id);star.textContent=selected?'★':'☆';if(favoriteMode)star.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="'+(selected?'currentColor':'none')+'" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.78 5.63 6.22.91-4.5 4.38 1.06 6.2L12 17.19l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91L12 3Z"/></svg>';star.disabled=latest.current.disabled;star.setAttribute('aria-label',`${r.label} ${favoriteMode?'즐겨찾기':'수집 지역'} ${selected?'해제':'추가'}`);star.setAttribute('aria-pressed',String(selected));star.title=favoriteMode?(selected?'즐겨찾기 해제':'즐겨찾기 추가'):(selected?'수집 지역 해제 (아직 저장되지 않음)':'수집 지역 추가 (아직 저장되지 않음)');};
        update();star.addEventListener('click',e=>{e.stopPropagation();if(!latest.current.disabled)latest.current.onToggle(id);});
        const heading=document.createElement('strong');heading.textContent=r.dongs[0]||r.label;
        const location=document.createElement('p');location.textContent=r.region_name;
        const code=document.createElement('small');code.textContent=favoriteMode?(latest.current.coveredIds.includes(id)?'거래 자료 제공 지역':'거래 자료 미수집 · 거래가 없다는 뜻은 아닙니다.'):`법정동 ${feature.properties.EMD_CD} · API ${r.region_code}`;
        const note=document.createElement('p');note.className='popup-note';note.textContent=favoriteMode?'별표로 지역 즐겨찾기를 추가·해제하세요. 이 브라우저에 자동 저장됩니다.':`별표로 수집 대상을 편집하세요. ${saveLabel} 버튼을 누르면 저장됩니다.`;
        box.append(star,heading,location,code,note);popupRef.current={id,update};
        if(favoriteMode&&latest.current.onOpenRegion){const query=document.createElement('button');query.type='button';query.className='primary map-transaction-link';query.textContent=latest.current.coveredIds.includes(id)?'이 동네 실거래가 보기 →':'거래 자료 미수집';query.disabled=!latest.current.coveredIds.includes(id);query.addEventListener('click',()=>latest.current.onOpenRegion(r));box.append(query);}
        L.popup({maxWidth:290,minWidth:240,autoPan:true}).setLatLng(event.latlng).setContent(box).openOn(map);
      });
      layers.current.set(id,layer);
    }
    const styleAtZoom=()=>{
      if(!favoriteMode)return;
      const zoom=map.getZoom?.()??12,covered=new Set(latest.current.coveredIds);
      cityLayer.setStyle({weight:zoom<11?1.8:0.8,opacity:0.6,color:'#64748b'});
      districtLayer.setStyle({weight:zoom>=10?1.2:0,opacity:0.65,color:'#64748b'});
      for(const [id,layer] of layers.current){const selected=latest.current.draft.includes(id),available=covered.has(id);layer.setStyle({color:selected?'#b77912':available?'#2858df':'#94a3b8',weight:selected?3.2:zoom>=11?0.8:0,fillColor:selected?'#f1c85b':available?'#7399f5':'#cbd5e1',fillOpacity:selected?0.42:available?0.24:0.04,opacity:0.8});}
    };
    applyStyle.current=styleAtZoom;map.on?.('zoomend',styleAtZoom);styleAtZoom();
    let wasVisible=true;
    const resize=new ResizeObserver(()=>{
      map.invalidateSize({pan:false});
      const visible=(map.getSize?.().x??1)>0;
      if(visible&&!wasVisible){const focused=layers.current.get(latest.current.focusRegionId);if(focused)map.fitBounds(focused.getBounds(),{padding:[25,25],maxZoom:14,animate:false});else{const bounds=L.latLngBounds([]);for(const id of latest.current.visibleIds||[]){const layer=layers.current.get(id);if(layer)bounds.extend(layer.getBounds());}if(bounds.isValid())map.fitBounds(bounds,{padding:[15,15],maxZoom:13,animate:false});}}
      wasVisible=visible;
    });resize.observe(container.current);
    // Dispose vector layers before Leaflet destroys their canvas renderers.
    return ()=>{resize.disconnect();for(const layer of layers.current.values())layer.remove();cityLayer.remove();districtLayer.remove();map.remove();mapRef.current=null;layers.current.clear();popupRef.current=null;};
  },[boundaries,adminBoundaries,catalog,favoriteMode]);
  useEffect(()=>{
    const selected=new Set(draft);
    for(const [id,layer] of layers.current) layer.setStyle(dongStyle(id.slice(5,10),selected.has(id),adminBoundaries.styles,favoriteMode?id.slice(5):undefined));
    applyStyle.current?.();
    popupRef.current?.update();
    // Do not recreate the map, tile layer, popup or viewport when stars change.
  },[draft,adminBoundaries,disabled,favoriteMode,coveredIds]);
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;const visible=new Set(visibleIds),bounds=L.latLngBounds([]);
    for(const [id,layer] of layers.current){if(visible.has(id)){if(!map.hasLayer(layer))layer.addTo(map);bounds.extend(layer.getBounds());}else if(map.hasLayer(layer))map.removeLayer(layer);}
    if(bounds.isValid())map.fitBounds(bounds,{padding:[15,15],maxZoom:13,animate:false});
  },[visibleIds]);
  useEffect(()=>{const map=mapRef.current,layer=layers.current.get(focusRegionId);if(map&&layer){map.invalidateSize({pan:false});map.fitBounds(layer.getBounds(),{padding:[25,25],maxZoom:14,animate:false});}},[focusRegionId]);
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
  const Legend=favoriteMode?'details':'div';
  return <div className="map-wrap"><div ref={container} className={favoriteMode?"region-map favorite-region-map":"region-map"} role="region" aria-label={favoriteMode?"서울 경기 법정동 지역 지도":"서울 경기 법정동 수집 지역 지도"}/>{tileError&&<div className="tile-warning">배경 지도 일부를 불러오지 못했습니다. 경계와 선택은 유지됩니다.</div>}<Legend className="map-legend">{favoriteMode?<summary>지도 범례</summary>:<strong>지역 경계</strong>}{coordinatePoints.length>0&&<span><i className="apartment-swatch">▥</i>좌표가 확인된 아파트</span>}<span><i className="city-line"/>시·군: 굵은 실선 / 지역별 색</span><span><i className="gu-line"/>구: 점선 / 지역별 색</span><span><i className="dong-line"/>{favoriteMode?'확대 시 동 경계 · 파랑: 자료 제공 / 회색: 미수집':'동·읍·면: 가는 실선'}</span><span><i className="selected-swatch"/>{favoriteMode?'즐겨찾기 지역: 금색 채움 + 굵은 테두리':'수집 대상: 진한 채움 + 금색 테두리'}</span></Legend></div>;
}
