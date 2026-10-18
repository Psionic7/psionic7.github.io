import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import ApartmentMapPopup from './ApartmentMapPopup.jsx';
import {geometryBounds,intersects} from './map-bounds.mjs';
import {hasMapPosition} from './apartment-map-data.js';
import {sameApartmentFavorite} from './apartment-favorites.js';
export const boundaryStyle=(ids,saved,kind='cadastral_parcels')=>({color:ids.some(id=>saved.has(id))?'#b87916':kind==='building_footprint'?'#6251bd':'#2858df',weight:kind==='building_footprint'?1.5:2,fillColor:ids.some(id=>saved.has(id))?'#e8bb54':kind==='building_footprint'?'#9c8fe8':'#7399f5',fillOpacity:kind==='building_footprint'?.38:.23});
export default function ApartmentMapCanvas({data,visible,filters,favorites,onToggleFavorite,onOpenApartment,focusApartmentId,onSelectApartment}){
  const container=useRef(null),mapRef=useRef(null),groupRef=useRef(null),layersRef=useRef([]),latest=useRef({favorites}),popupRef=useRef(null),openRef=useRef(null),pendingFocus=useRef(null);
  latest.current={favorites,onSelectApartment,visible,focusApartmentId};
  const [selection,setSelection]=useState(null),[tileError,setTileError]=useState(false),[detailed,setDetailed]=useState(!data.loadBoundaries);
  const [viewBox,setViewBox]=useState(null),[geometry,setGeometry]=useState(null),[boundaryError,setBoundaryError]=useState(''),[boundaryLoading,setBoundaryLoading]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const map=L.map(container.current,{preferCanvas:false,zoomControl:true}).setView([37.35,127.08],12);mapRef.current=map;
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
    const failedTiles=new Set(),tileKey=e=>e.tile?.src||JSON.stringify(e.coords);
    tiles.on('tileerror',e=>{failedTiles.add(tileKey(e));setTileError(true);});tiles.on('tileload',e=>{failedTiles.delete(tileKey(e));setTileError(failedTiles.size>0);});tiles.on('tileunload',e=>{failedTiles.delete(tileKey(e));setTileError(failedTiles.size>0);});
    const updateDetail=()=>{setDetailed((map.getZoom?.()??16)>=14);const bounds=map.getBounds?.();if(bounds){const padded=bounds.pad(.08);setViewBox([padded.getWest(),padded.getSouth(),padded.getEast(),padded.getNorth()]);}};map.on('zoomend',updateDetail);map.on('moveend',updateDetail);updateDetail();
    map.on('popupclose',event=>{if(event.popup===popupRef.current){popupRef.current=null;setSelection(null);}});
    let wasVisible=true;
    const observer=new ResizeObserver(()=>{map.invalidateSize({pan:false});const shown=(map.getSize?.().x??1)>0;if(shown&&!wasVisible){const located=latest.current.visible.filter(hasMapPosition),focus=located.find(item=>item.id===latest.current.focusApartmentId);if(focus)map.setView([focus.latitude,focus.longitude],16,{animate:false});else if(located.length)map.fitBounds(L.latLngBounds(located.map(item=>[item.latitude,item.longitude])),{padding:[30,30],maxZoom:16,animate:false});}wasVisible=shown;});observer.observe(container.current);
    // Remove paths while their canvas renderer is still alive.
    return()=>{observer.disconnect();groupRef.current?.remove();groupRef.current=null;map.remove();mapRef.current=null;layersRef.current=[];};
  },[]);
  useEffect(()=>{
    if(!data.loadBoundaries||!viewBox||!detailed||!filters.showBoundaries){setGeometry(null);setBoundaryLoading(false);setBoundaryError('');return;}
    let active=true;setBoundaryLoading(true);setBoundaryError('');
    data.loadBoundaries(viewBox).then(value=>{if(active)setGeometry(value);}).catch(()=>{if(active)setBoundaryError('상세 경계를 불러오지 못했습니다. 위치와 목록은 계속 사용할 수 있습니다.');}).finally(()=>{if(active)setBoundaryLoading(false);});
    return()=>{active=false;};
  },[data,viewBox,detailed,filters.showBoundaries,retry]);
  useEffect(()=>{mapRef.current?.closePopup();setSelection(null);},[visible]);
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;
    const group=L.layerGroup().addTo(map),byId=new Map(visible.map(p=>[p.id,p])),saved=new Set(visible.filter(p=>latest.current.favorites.some(f=>sameApartmentFavorite(p,f))).map(p=>p.id));groupRef.current=group;layersRef.current=[];
    const open=(apartments,latlng,boundaryName='',boundarySource='OpenStreetMap',boundaryKind='',buildingAttributes=null)=>{
      latest.current.onSelectApartment?.(apartments[0]?.id);
      const popupContainer=document.createElement('div');
      const popup=L.popup({maxWidth:340,minWidth:260,className:'apartment-leaflet-popup',autoPan:false,autoPanPaddingTopLeft:[15,15],autoPanPaddingBottomRight:[15,15]}).setLatLng(latlng).setContent(popupContainer);
      map.closePopup();popupRef.current=popup;popup.openOn(map);setSelection({apartments,container:popupContainer,boundaryName,boundarySource,boundaryKind,buildingAttributes});
    };
    openRef.current=open;
    if(detailed&&filters.showBoundaries)for(const feature of (data.loadBoundaries?geometry?.features||[]:data.boundaries.features)){
      if(viewBox&&!intersects(feature.bbox||geometryBounds(feature.geometry),viewBox))continue;
      const ids=feature.properties.apartment_ids.filter(id=>byId.has(id));if(!ids.length)continue;
      const apartments=ids.map(id=>byId.get(id));
      const polygon=L.geoJSON(feature,{style:()=>boundaryStyle(ids,saved,feature.properties.boundary_kind)}).addTo(group);
      const label=document.createElement('span');label.textContent=[...new Set(apartments.map(p=>p.apartment))].join(' · ');polygon.bindTooltip(label,{sticky:true});
      polygon.on('click',event=>open(apartments,event.latlng,feature.properties.name,feature.properties.source,feature.properties.boundary_kind,feature.properties.building_attributes||null));layersRef.current.push({ids,polygon,kind:feature.properties.boundary_kind});
    }
    if(detailed&&filters.showPoints)for(const apartment of visible.filter(p=>hasMapPosition(p)&&(!viewBox||intersects([p.longitude,p.latitude,p.longitude,p.latitude],viewBox)))){
      const icon=L.divIcon({className:'public-apartment-icon'+(saved.has(apartment.id)?' favorite':''),html:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-6h4v6"/></svg>',iconSize:[26,26],iconAnchor:[13,13]});
      const marker=L.marker([apartment.latitude,apartment.longitude],{icon,title:apartment.apartment,keyboard:true}).addTo(group);
      const label=document.createElement('span');label.textContent=apartment.apartment;marker.bindTooltip(label,{direction:'top'});
      marker.on('click',event=>open([apartment],event.latlng));layersRef.current.push({ids:[apartment.id],marker});
    }

    if(!detailed&&(filters.showPoints||filters.showBoundaries)){
      const clusters=new Map();for(const item of visible.filter(hasMapPosition)){const key=item.region_code+'|'+item.dong;const list=clusters.get(key)||[];list.push(item);clusters.set(key,list);}
      for(const list of clusters.values()){
        const center=[list.reduce((sum,p)=>sum+p.latitude,0)/list.length,list.reduce((sum,p)=>sum+p.longitude,0)/list.length];
        const marker=L.marker(center,{icon:L.divIcon({className:'apartment-cluster',html:'<span>'+list.length+'</span>',iconSize:[40,40],iconAnchor:[20,20]}),title:list[0].dong+' 아파트 '+list.length+'곳',keyboard:true}).addTo(group);
        const label=document.createElement('span');label.textContent=list[0].dong+' · '+list.length+'곳';marker.bindTooltip(label);marker.on('click',()=>map.setView(center,14,{animate:false}));
      }
    }
    if(detailed&&pendingFocus.current){const item=byId.get(pendingFocus.current);if(item&&hasMapPosition(item))open([item],L.latLng(item.latitude,item.longitude));pendingFocus.current=null;}
    return()=>{group.remove();if(groupRef.current===group)groupRef.current=null;layersRef.current=[];};
  },[data,visible,filters.showBoundaries,filters.showPoints,detailed,viewBox,geometry]);
  useEffect(()=>{
    const map=mapRef.current,located=visible.filter(hasMapPosition);if(map&&located.length)map.fitBounds(L.latLngBounds(located.map(p=>[p.latitude,p.longitude])),{padding:[30,30],maxZoom:16,animate:false});
  },[visible]);
  useEffect(()=>{const apartment=visible.find(item=>item.id===focusApartmentId);if(!apartment){pendingFocus.current=null;return;}if(hasMapPosition(apartment)&&mapRef.current&&selection?.apartments[0]?.id!==apartment.id){pendingFocus.current=apartment.id;mapRef.current.invalidateSize({pan:false});mapRef.current.setView([apartment.latitude,apartment.longitude],16,{animate:false});if(detailed){openRef.current?.([apartment],L.latLng(apartment.latitude,apartment.longitude));pendingFocus.current=null;}}},[focusApartmentId]);
  useEffect(()=>{
    if(!selection)return;
    const popup=popupRef.current,map=mapRef.current;let frame;
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(popupRef.current!==popup||!mapRef.current)return;
      const size=map.getSize(),maxWidth=Math.max(190,Math.min(340,size.x-70));
      popup.options.maxWidth=maxWidth;popup.options.minWidth=Math.min(260,maxWidth);popup.options.maxHeight=Math.max(160,Math.min(440,size.y-70));
      popup.update();
      const box=popup.getElement().getBoundingClientRect(),viewport=map.getContainer().getBoundingClientRect();
      if(!viewport.width||!viewport.height)return;
      const dx=box.left<viewport.left+15?box.left-viewport.left-15:box.right>viewport.right-15?box.right-viewport.right+15:0;
      const dy=box.top<viewport.top+15?box.top-viewport.top-15:box.bottom>viewport.bottom-15?box.bottom-viewport.bottom+15:0;
      if(dx||dy)map.panBy([dx,dy],{animate:false});
    });};
    const observer=new ResizeObserver(update);observer.observe(selection.container);observer.observe(map.getContainer());update();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[selection]);
  useEffect(()=>{
    const saved=new Set(visible.filter(p=>favorites.some(f=>sameApartmentFavorite(p,f))).map(p=>p.id));
    for(const record of layersRef.current){record.polygon?.setStyle(boundaryStyle(record.ids,saved,record.kind));const icon=record.marker?.getElement();icon?.classList.toggle('favorite',record.ids.some(id=>saved.has(id)));}
  },[favorites,visible]);
  return <div className={"public-apartment-map-wrap"+(selection?" popup-open":"")}><div ref={container} className="public-apartment-map" role="region" aria-label="아파트 단지 경계 지도"/>{tileError&&<p className="map-tile-warning">배경 지도 일부를 불러오지 못했습니다. 아파트 경계와 선택은 사용할 수 있습니다.</p>}{boundaryLoading&&<p className="map-detail-status" role="status">이 영역의 상세 경계를 불러오는 중입니다.</p>}{boundaryError&&<p className="map-detail-status error" role="alert">{boundaryError}<button onClick={()=>setRetry(value=>value+1)}>경계 다시 불러오기</button></p>}<div className="public-map-legend"><span><i className="complex-swatch"/>필지 경계</span><span><i className="building-outline-swatch"/>건물 외곽선 · V-World</span><span><i className="favorite-swatch"/>즐겨찾기 아파트</span><span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M10 21v-6h4v6"/></svg>출입구 위치</span></div>
    {selection&&createPortal(<ApartmentMapPopup key={selection.apartments.map(a=>a.id).join('|')} apartments={selection.apartments} boundaryName={selection.boundaryName} boundarySource={selection.boundarySource} boundaryKind={selection.boundaryKind} buildingAttributes={selection.buildingAttributes} favorites={favorites} onToggleFavorite={onToggleFavorite} onOpenApartment={onOpenApartment}/>,selection.container)}
  </div>;
}
