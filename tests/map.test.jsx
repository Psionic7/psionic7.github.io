import React,{useState} from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mock=vi.hoisted(()=>({maps:[],tiles:[],dongs:[],popup:null}));
vi.mock('leaflet',()=>({default:{
  map:vi.fn(()=>{const panes={},map={setView:vi.fn(function(){return this;}),createPane:name=>panes[name]={style:{}},getPane:name=>panes[name],invalidateSize:vi.fn(),remove:vi.fn(),hasLayer:layer=>layer.visible,fitBounds:vi.fn(),removeLayer:layer=>layer.visible=false};mock.maps.push(map);return map;}),
  tileLayer:vi.fn(()=>{const layer={addTo:vi.fn(function(){return this;}),on:vi.fn(function(){return this;})};mock.tiles.push(layer);return layer;}),
  geoJSON:vi.fn((feature,options)=>{const layer={visible:false,setStyle:vi.fn(),addTo:vi.fn(function(){this.visible=true;return this;}),bindTooltip:vi.fn(),on:vi.fn((name,handler)=>{layer.click=handler;}),getBounds:()=>({})};if(feature.type==='Feature')mock.dongs.push(layer);return layer;}),
  latLngBounds:()=>({extend:vi.fn(),isValid:()=>true}),
  popup:()=>({setLatLng(){return this;},setContent(content){this.content=content;return this;},openOn(){mock.popup=this;document.body.append(this.content);return this;}}),
}}));
import RegionMap from '../admin/RegionMap.jsx';
afterEach(()=>{cleanup();mock.popup?.content.remove();vi.unstubAllGlobals();});
it('star updates layer styles and the open popup without reloading map, tiles or fitting the viewport',async()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  const boundaries={features:[{type:'Feature',properties:{EMD_CD:'11110101'},geometry:{type:'Polygon',coordinates:[]}}]},adminBoundaries={cities:{type:'FeatureCollection',features:[]},districts:{type:'FeatureCollection',features:[]},styles:{'11110':{region_color:'#879aa7'}}};
  const catalog=[{region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_code:'11110',region_name:'서울특별시 종로구',dongs:['청운동']}],visible=['dong_11110101'];
  function Harness(){const [draft,setDraft]=useState([]);return <RegionMap boundaries={boundaries} adminBoundaries={adminBoundaries} catalog={catalog} draft={draft} saved={[]} visibleIds={visible} onToggle={id=>setDraft(current=>current.includes(id)?[]:[id])}/>;}
  render(<Harness/>);expect(mock.maps.length).toBe(1);expect(mock.tiles.length).toBe(1);
  act(()=>mock.dongs[0].click({latlng:[37.5,127]}));
  const popup=mock.popup,fitCount=mock.maps[0].fitBounds.mock.calls.length;
  await userEvent.setup().click(screen.getByRole('button',{name:'서울특별시 종로구 청운동 수집 지역 추가'}));
  expect(screen.getByRole('button',{name:'서울특별시 종로구 청운동 수집 지역 해제'}).textContent).toBe('★');
  expect(mock.maps.length).toBe(1);expect(mock.tiles.length).toBe(1);expect(mock.popup).toBe(popup);expect(mock.maps[0].remove).not.toHaveBeenCalled();expect(mock.maps[0].fitBounds.mock.calls.length).toBe(fitCount);
  expect(mock.dongs[0].setStyle).toHaveBeenLastCalledWith(expect.objectContaining({weight:2.7,color:'#b77912',fillOpacity:0.4}));
  await userEvent.setup().click(screen.getByRole('button',{name:'서울특별시 종로구 청운동 수집 지역 해제'}));expect(mock.maps.length).toBe(1);expect(mock.popup).toBe(popup);
});
