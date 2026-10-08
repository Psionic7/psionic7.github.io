import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,act,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mock=vi.hoisted(()=>({maps:[],polygons:[],markers:[],popup:null}));
vi.mock('leaflet',()=>({default:{
 map:()=>{const events={};const map={setView(){return this;},on(name,handler){events[name]=handler;return this;},invalidateSize(){},getSize:()=>({x:900,y:600}),getContainer:()=>document.body,panBy:vi.fn(),remove:vi.fn(),fitBounds:vi.fn(),closePopup(){if(mock.popup){const popup=mock.popup;mock.popup=null;events.popupclose?.({popup});popup.container.remove();}}};mock.maps.push(map);return map;},
 tileLayer:()=>({addTo(){return this;},on(){return this;}}),
 layerGroup:()=>({addTo(){return this;},remove:vi.fn()}),
 geoJSON:(feature)=>{const layer={feature,setStyle:vi.fn(),addTo(){return this;},bindTooltip(){return this;},on(name,handler){this.click=handler;return this;}};mock.polygons.push(layer);return layer;},
 marker:()=>{const element=document.createElement('div');const layer={addTo(){return this;},bindTooltip(){return this;},on(name,handler){this.click=handler;return this;},getElement(){return element;}};mock.markers.push(layer);return layer;},
 divIcon:options=>options,
 latLngBounds:value=>value,
 popup:options=>({options,getElement(){return this.container;},update:vi.fn(),setLatLng(){return this;},setContent(container){this.container=container;return this;},openOn(){document.body.append(this.container);mock.popup=this;return this;}}),
}}));
import ApartmentMapPage from '../src/ApartmentMapPage.jsx';
import ApartmentMapPopup from '../src/ApartmentMapPopup.jsx';
import {mapApartment} from '../server/apartment-boundaries.mjs';
import {useStoredState,readPreferences,restoreExplorer} from '../src/preferences.js';
import {validApartmentFavorites} from '../src/apartment-favorites.js';
import {buildCatalog} from '../src/domain.mjs';
const one=mapApartment({region_code:'41117',apartment:'단지 하나',dong:'영통동',jibun:'1',road_address:'도로명주소 1',longitude:127.001,latitude:37.001},'경기도 수원시 영통구',2000);
const two=mapApartment({...one,apartment:'단지 둘',jibun:'2',dong:'다른동',road_address:'도로명주소 2'},one.region_name);
const region={region_id:'dong_41117102',region_code:'41117',region_name:one.region_name,label:one.region_name+' 영통동',dongs:['영통동']};
const manifest={regions:[region],favorite_region_ids:[region.region_id],districts:{'41117':{}},months:['202601'],published_at:'2026-10-01T00:00:00Z'};
const boundary={type:'Feature',id:'way/1',properties:{name:'단지 하나',apartment_ids:[one.id]},geometry:{type:'Polygon',coordinates:[[[127,37],[127.002,37],[127.002,37.002],[127,37.002],[127,37]]]}};
const data={apartments:[one,two],boundaries:{type:'FeatureCollection',features:[boundary]},manifest:{count:2}};
const mapLoader=async()=>data;
beforeEach(()=>{window.localStorage.clear();window.history.replaceState(null,'','/');vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});});
afterEach(()=>{cleanup();mock.popup?.container.remove();mock.popup=null;mock.maps.length=0;mock.polygons.length=0;mock.markers.length=0;vi.unstubAllGlobals();});
it('polygon popup favorite add/remove keeps map and popup alive and persists in the dashboard store',async()=>{
 const user=userEvent.setup();function Harness(){const [favorites,setFavorites]=useStoredState('viewer','apartments',[],validApartmentFavorites);return <ApartmentMapPage manifest={manifest} mapLoader={mapLoader} favorites={favorites} onToggleFavorite={item=>setFavorites(previous=>previous.some(p=>p.id===item.id)?previous.filter(p=>p.id!==item.id):[...previous,item])}/>;}
 const view=render(<Harness/>);await waitFor(()=>expect(mock.polygons.length).toBe(1));expect(mock.markers.length).toBe(1);
 act(()=>mock.polygons[0].click({latlng:[37.001,127.001]}));await screen.findByRole('dialog',{name:'단지 하나 아파트 정보'});expect(screen.getByText('도로명주소 1')).toBeTruthy();expect(screen.getByText('2000')).toBeTruthy();expect(screen.queryByText('유효 거래')).toBeNull();expect(screen.queryByText('최저가')).toBeNull();expect(screen.queryByText('최고가')).toBeNull();expect(screen.queryByRole('button',{name:'실거래 상세'})).toBeNull();
 expect(screen.getByRole('button',{name:/단지 하나.*즐겨찾기 추가/}).textContent).toBe('');
 const popup=mock.popup,map=mock.maps[0],fits=map.fitBounds.mock.calls.length;
 await user.click(screen.getByRole('button',{name:/단지 하나.*즐겨찾기 추가/}));expect(screen.getByRole('button',{name:/단지 하나.*즐겨찾기 해제/})).toBeTruthy();expect(readPreferences('viewer').apartments[0].id).toBe(one.id);expect(mock.popup).toBe(popup);expect(mock.polygons).toHaveLength(1);expect(map.fitBounds.mock.calls.length).toBe(fits);
 await user.click(screen.getByRole('button',{name:/단지 하나.*즐겨찾기 해제/}));expect(readPreferences('viewer').apartments).toEqual([]);expect(mock.popup).toBe(popup);
 await user.click(screen.getByRole('button',{name:/단지 하나.*즐겨찾기 추가/}));view.unmount();render(<Harness/>);await waitFor(()=>expect(mock.polygons.length).toBe(2));act(()=>mock.polygons.at(-1).click({latlng:[37.001,127.001]}));expect(screen.getByRole('button',{name:/단지 하나.*즐겨찾기 해제/})).toBeTruthy();
});
it('only collected dongs appear; layer, search and favorite-only filters update the map and persist',async()=>{
 const user=userEvent.setup();render(<ApartmentMapPage manifest={manifest} mapLoader={mapLoader} favorites={[one]}/>);
 await waitFor(()=>expect(mock.markers.length).toBe(1));expect(screen.queryByRole('option',{name:'다른동'})).toBeNull();
 await user.click(screen.getByRole('checkbox',{name:'단지 경계'}));expect(readPreferences('apartmentMap').filters.showBoundaries).toBe(false);
 await user.type(screen.getByRole('searchbox',{name:'아파트·주소 검색'}),'없는 단지');await screen.findByText('조건에 맞는 아파트가 없습니다.');
 await user.click(screen.getByRole('button',{name:'필터 초기화'}));await user.click(screen.getByRole('checkbox',{name:'즐겨찾기만'}));expect(readPreferences('apartmentMap').filters.favoriteOnly).toBe(true);
});
it('popup switches basic apartment information within one boundary',async()=>{
 const user=userEvent.setup();render(<ApartmentMapPopup apartments={[one,two]} favorites={[]}/>);
 await user.selectOptions(screen.getByRole('combobox',{name:'이 영역의 아파트'}),two.id);expect(screen.getByRole('dialog',{name:'단지 둘 아파트 정보'})).toBeTruthy();expect(screen.getByText('도로명주소 2')).toBeTruthy();expect(screen.queryByText('전용면적')).toBeNull();
});
it('map tab restores from shared URL and browser preference',()=>{
 expect(restoreExplorer(manifest,buildCatalog(manifest.regions),new URLSearchParams('tab=map')).tab).toBe('map');
});
