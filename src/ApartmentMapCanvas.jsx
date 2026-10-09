import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import ApartmentMapPopup from './ApartmentMapPopup.jsx';
import {sameApartmentFavorite} from './apartment-favorites.js';
export const boundaryStyle=(ids,saved,kind='cadastral_parcels')=>({color:ids.some(id=>saved.has(id))?'#b87916':kind==='building_footprint'?'#6251bd':'#12877f',weight:kind==='building_footprint'?1.5:2,fillColor:ids.some(id=>saved.has(id))?'#e8bb54':kind==='building_footprint'?'#9c8fe8':'#2fa99b',fillOpacity:kind==='building_footprint'?.38:.23});
export default function ApartmentMapCanvas({data,visible,filters,favorites,onToggleFavorite}){
  const container=useRef(null),mapRef=useRef(null),layersRef=useRef([]),latest=useRef({favorites}),popupRef=useRef(null);
  latest.current={favorites};
  const [selection,setSelection]=useState(null),[tileError,setTileError]=useState(false);
  useEffect(()=>{
    const map=L.map(container.current,{preferCanvas:true,zoomControl:true}).setView([37.35,127.08],12);mapRef.current=map;
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
    tiles.on('tileerror',()=>setTileError(true));tiles.on('tileload',()=>setTileError(false));
    map.on('popupclose',event=>{if(event.popup===popupRef.current){popupRef.current=null;setSelection(null);}});
    const observer=new ResizeObserver(()=>map.invalidateSize({pan:false}));observer.observe(container.current);
    return()=>{observer.disconnect();map.remove();mapRef.current=null;layersRef.current=[];};
  },[]);
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;map.closePopup();setSelection(null);
    const group=L.layerGroup().addTo(map),byId=new Map(visible.map(p=>[p.id,p])),saved=new Set(visible.filter(p=>latest.current.favorites.some(f=>sameApartmentFavorite(p,f))).map(p=>p.id));layersRef.current=[];
    const open=(apartments,latlng,boundaryName='',boundarySource='OpenStreetMap',boundaryKind='',buildingAttributes=null)=>{
      const popupContainer=document.createElement('div');
      const popup=L.popup({maxWidth:340,minWidth:260,className:'apartment-leaflet-popup',autoPan:false,autoPanPaddingTopLeft:[15,15],autoPanPaddingBottomRight:[15,15]}).setLatLng(latlng).setContent(popupContainer);
      map.closePopup();popupRef.current=popup;popup.openOn(map);setSelection({apartments,container:popupContainer,boundaryName,boundarySource,boundaryKind,buildingAttributes});
    };
    if(filters.showBoundaries)for(const feature of data.boundaries.features){
      const ids=feature.properties.apartment_ids.filter(id=>byId.has(id));if(!ids.length)continue;
      const apartments=ids.map(id=>byId.get(id));
      const polygon=L.geoJSON(feature,{style:()=>boundaryStyle(ids,saved,feature.properties.boundary_kind)}).addTo(group);
      const label=document.createElement('span');label.textContent=[...new Set(apartments.map(p=>p.apartment))].join(' · ');polygon.bindTooltip(label,{sticky:true});
      polygon.on('click',event=>open(apartments,event.latlng,feature.properties.name,feature.properties.source,feature.properties.boundary_kind,feature.properties.building_attributes||null));layersRef.current.push({ids,polygon,kind:feature.properties.boundary_kind});
    }
    if(filters.showPoints)for(const apartment of visible){
      const icon=L.divIcon({className:'public-apartment-icon'+(saved.has(apartment.id)?' favorite':''),html:'<span aria-hidden="true">▥</span>',iconSize:[20,20],iconAnchor:[10,10]});
      const marker=L.marker([apartment.latitude,apartment.longitude],{icon,title:apartment.apartment,keyboard:true}).addTo(group);
      const label=document.createElement('span');label.textContent=apartment.apartment;marker.bindTooltip(label,{direction:'top'});
      marker.on('click',event=>open([apartment],event.latlng));layersRef.current.push({ids:[apartment.id],marker});
    }

    return()=>{group.remove();layersRef.current=[];};
  },[data,visible,filters.showBoundaries,filters.showPoints]);
  useEffect(()=>{
    const map=mapRef.current;if(map&&visible.length)map.fitBounds(L.latLngBounds(visible.map(p=>[p.latitude,p.longitude])),{padding:[30,30],maxZoom:16,animate:false});
  },[visible]);
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
  return <div className={"public-apartment-map-wrap"+(selection?" popup-open":"")}><div ref={container} className="public-apartment-map" role="region" aria-label="아파트 단지 경계 지도"/>{tileError&&<p className="map-tile-warning">배경 지도 일부를 불러오지 못했습니다. 아파트 경계와 선택은 사용할 수 있습니다.</p>}<div className="public-map-legend"><span><i className="complex-swatch"/>필지 경계</span><span><i className="building-outline-swatch"/>건물 외곽선 · V-World</span><span><i className="favorite-swatch"/>즐겨찾기 아파트</span><span>▥ 출입구 위치</span></div>
    {selection&&createPortal(<ApartmentMapPopup key={selection.apartments.map(a=>a.id).join('|')} apartments={selection.apartments} boundaryName={selection.boundaryName} boundarySource={selection.boundarySource} boundaryKind={selection.boundaryKind} buildingAttributes={selection.buildingAttributes} favorites={favorites} onToggleFavorite={onToggleFavorite}/>,selection.container)}
  </div>;
}
