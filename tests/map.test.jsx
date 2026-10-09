import React,{useState} from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mock=vi.hoisted(()=>({maps:[],tiles:[],dongs:[],popup:null,markers:[],groups:[]}));
vi.mock('leaflet',()=>({default:{
  map:vi.fn(()=>{const panes={},map={setView:vi.fn(function(){return this;}),createPane:name=>panes[name]={style:{}},getPane:name=>panes[name],invalidateSize:vi.fn(),remove:vi.fn(),hasLayer:layer=>layer.visible,fitBounds:vi.fn(),removeLayer:layer=>layer.visible=false};mock.maps.push(map);return map;}),
  tileLayer:vi.fn(()=>{const layer={addTo:vi.fn(function(){return this;}),on:vi.fn(function(){return this;})};mock.tiles.push(layer);return layer;}),
  geoJSON:vi.fn((feature,options)=>{const layer={visible:false,setStyle:vi.fn(),addTo:vi.fn(function(){this.visible=true;return this;}),bindTooltip:vi.fn(),on:vi.fn((name,handler)=>{layer.click=handler;}),getBounds:()=>({})};if(feature.type==='Feature')mock.dongs.push(layer);return layer;}),
  layerGroup:()=>{const group={addTo(){return this;},remove:vi.fn()};mock.groups.push(group);return group;},
  divIcon:options=>options,
  marker:(location,options)=>{const marker={location,options,bindPopup(content){this.content=content;return this;},bindTooltip(){return this;},addTo(){return this;}};mock.markers.push(marker);return marker;},
  latLngBounds:()=>({extend:vi.fn(),isValid:()=>true}),
  popup:()=>({setLatLng(){return this;},setContent(content){this.content=content;return this;},openOn(){mock.popup=this;document.body.append(this.content);return this;}}),
}}));
import RegionMap from '../admin/RegionMap.jsx';
afterEach(()=>{cleanup();mock.popup?.content.remove();vi.unstubAllGlobals();mock.maps.length=0;mock.tiles.length=0;mock.dongs.length=0;mock.groups.length=0;mock.markers.length=0;mock.popup=null;});
it('star updates layer styles and the open popup without reloading map, tiles or fitting the viewport',async()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  const boundaries={features:[{type:'Feature',properties:{EMD_CD:'11110101'},geometry:{type:'Polygon',coordinates:[]}}]},adminBoundaries={cities:{type:'FeatureCollection',features:[]},districts:{type:'FeatureCollection',features:[]},styles:{'11110':{region_color:'#879aa7'}}};
  const catalog=[{region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_code:'11110',region_name:'서울특별시 종로구',dongs:['청운동']}],visible=['dong_11110101'];
  function Harness(){const [draft,setDraft]=useState([]);return <RegionMap boundaries={boundaries} adminBoundaries={adminBoundaries} catalog={catalog} draft={draft} saved={[]} visibleIds={visible} onToggle={id=>setDraft(current=>current.includes(id)?[]:[id])}/>;}
  render(<Harness/>);expect(mock.maps.length).toBe(1);expect(mock.tiles.length).toBe(1);
  expect((await import('leaflet')).default.tileLayer).toHaveBeenCalledWith('https://tile.openstreetmap.org/{z}/{x}/{y}.png',expect.objectContaining({referrerPolicy:'strict-origin-when-cross-origin'}));
  act(()=>mock.dongs[0].click({latlng:[37.5,127]}));
  const popup=mock.popup,fitCount=mock.maps[0].fitBounds.mock.calls.length;
  await userEvent.setup().click(screen.getByRole('button',{name:'서울특별시 종로구 청운동 수집 지역 추가'}));
  expect(screen.getByRole('button',{name:'서울특별시 종로구 청운동 수집 지역 해제'}).textContent).toBe('★');
  expect(mock.maps.length).toBe(1);expect(mock.tiles.length).toBe(1);expect(mock.popup).toBe(popup);expect(mock.maps[0].remove).not.toHaveBeenCalled();expect(mock.maps[0].fitBounds.mock.calls.length).toBe(fitCount);
  expect(mock.dongs[0].setStyle).toHaveBeenLastCalledWith(expect.objectContaining({weight:2.7,color:'#b77912',fillOpacity:0.4}));
  await userEvent.setup().click(screen.getByRole('button',{name:'서울특별시 종로구 청운동 수집 지역 해제'}));expect(mock.maps.length).toBe(1);expect(mock.popup).toBe(popup);
});

it('apartment markers follow dong filters, use safe text and update without recreating the map',()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  const boundaries={features:[]},adminBoundaries={cities:{type:'FeatureCollection',features:[]},districts:{type:'FeatureCollection',features:[]},styles:{}};
  const catalog=[{region_id:'dong_11110101',region_code:'11110',dongs:['청운동']}];
  const point={region_code:'11110',dong:'청운동',latitude:37.57,longitude:126.97,apartment:'<img src=x onerror=bad()>',road_address:'주소 <script>bad()</script>'};
  const props={boundaries,adminBoundaries,catalog,draft:[],saved:[],visibleIds:['dong_11110101'],onToggle:()=>{},coordinatePoints:[point,{...point,dong:'신교동'}]};
  const view=render(<RegionMap {...props}/>);
  expect(mock.markers).toHaveLength(1);expect(mock.markers[0].location).toEqual([37.57,126.97]);
  expect(mock.markers[0].content.querySelector('img')).toBeNull();expect(mock.markers[0].content.textContent).toContain('<img src=x');
  expect(mock.markers[0].options.title).toBe(point.apartment);
  view.rerender(<RegionMap {...props} visibleIds={[]}/>);expect(mock.groups[0].remove).toHaveBeenCalled();expect(mock.markers).toHaveLength(1);expect(mock.maps).toHaveLength(1);
});

it('public stars use favorite labels and update the popup and colors without moving or recreating the map',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const boundaries={features:[{type:'Feature',properties:{EMD_CD:'11110101'},geometry:{type:'Polygon',coordinates:[]}}]},adminBoundaries={cities:{type:'FeatureCollection',features:[]},districts:{type:'FeatureCollection',features:[]},styles:{}};
 const catalog=[{region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_code:'11110',region_name:'서울특별시 종로구',dongs:['청운동']}],visible=['dong_11110101'];
 function Harness(){const [favorites,setFavorites]=useState([]);return <RegionMap favoriteMode boundaries={boundaries} adminBoundaries={adminBoundaries} catalog={catalog} draft={favorites} saved={favorites} visibleIds={visible} onToggle={id=>setFavorites(previous=>previous.includes(id)?[]:[id])}/>;}
 render(<Harness/>);act(()=>mock.dongs[0].click({latlng:[37.5,127]}));const popup=mock.popup,fits=mock.maps[0].fitBounds.mock.calls.length;
 expect(screen.getByRole('region',{name:'서울 경기 법정동 지역 지도'})).toBeTruthy();expect(screen.getByText(/이 브라우저에 자동 저장됩니다/)).toBeTruthy();expect(screen.queryByText(/업데이트 버튼/)).toBeNull();
 await userEvent.setup().click(screen.getByRole('button',{name:'서울특별시 종로구 청운동 즐겨찾기 추가'}));expect(screen.getByRole('button',{name:'서울특별시 종로구 청운동 즐겨찾기 해제'}).getAttribute('aria-pressed')).toBe('true');
 expect(mock.maps).toHaveLength(1);expect(mock.tiles).toHaveLength(1);expect(mock.popup).toBe(popup);expect(mock.maps[0].fitBounds.mock.calls.length).toBe(fits);
 expect(mock.dongs[0].setStyle).toHaveBeenLastCalledWith(expect.objectContaining({color:'#b77912',weight:3.2}));
 await userEvent.setup().click(screen.getByRole('button',{name:'서울특별시 종로구 청운동 즐겨찾기 해제'}));expect(mock.popup).toBe(popup);
});
