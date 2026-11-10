import {intersects,validBounds} from './map-bounds.mjs';
import {createJsonCache} from './json-cache.mjs';
import {fetchJson,cachedJson,jsonCharacterSize} from './data.js';
import {validApartmentFavorites,mapApartmentFavoriteMatches} from './apartment-favorites.js';
export const hasMapPosition=p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&p.latitude>=28&&p.latitude<=40&&p.longitude>=122&&p.longitude<=135;
const searchName=value=>String(value||'').toLocaleLowerCase().replace(/[\s·()_-]/g,'').replace(/아파트/g,'').replace(/(\d+)차/g,'$1');
export function validateApartmentMap(data) {
  if(!data||!Array.isArray(data.apartments)||data.apartments.length>50000||new Set(data.apartments.map(p=>p.id)).size!==data.apartments.length||data.apartments.some(p=>!validApartmentFavorites([p]))||data.apartments.some(p=>!hasMapPosition(p)&&!(p.master_id&&p.location_status==='missing'&&p.latitude===null&&p.longitude===null))||data.apartments.some(p=>p.name_aliases!==undefined&&(!Array.isArray(p.name_aliases)||p.name_aliases.length>1000||p.name_aliases.some(n=>typeof n!=='string'||n.length>500)))||data.boundaries?.type!=='FeatureCollection'||!Array.isArray(data.boundaries.features))throw new Error('아파트 지도 자료 형식이 올바르지 않습니다.');
  const validGeometry=geometry=>{
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    return Array.isArray(polygons)&&polygons.length>0&&polygons.every(poly=>Array.isArray(poly)&&poly.length>0&&poly.every(ring=>Array.isArray(ring)&&ring.length>=4&&ring.every(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=122&&p[0]<=135&&p[1]>=28&&p[1]<=40)&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1]));
  };
  const ids=new Set(data.apartments.map(p=>p.id));
  for(const f of data.boundaries.features){if(f.type!=='Feature'||!['Polygon','MultiPolygon'].includes(f.geometry?.type)||!validGeometry(f.geometry)||!Array.isArray(f.properties?.apartment_ids)||!f.properties.apartment_ids.length||f.properties.apartment_ids.some(id=>!ids.has(id)))throw new Error('아파트 경계 연결 정보가 올바르지 않습니다.');}
  return data;
}
const loadMapVersion=createJsonCache(async key=>{
  const manifest=JSON.parse(key),apartments=await (manifest.apartment_information_generation?fetchJson('/apartment-map/'+manifest.apartments.file,false,manifest.apartments):cachedJson('/apartment-map/'+manifest.apartments.file));
  const data=validateApartmentMap({manifest,apartments,boundaries:{type:'FeatureCollection',features:[]}});
  let indexPromise;
  const tiles=createJsonCache(async key=>{
    const meta=JSON.parse(key),boundaries=await fetchJson('/map-data/'+meta.file,false,manifest.apartment_information_generation?meta:null);
    return validateApartmentMap({apartments,boundaries}).boundaries;
  },{maxEntries:12,maxCharacters:2*1024*1024,sizeOf:jsonCharacterSize});
  data.loadBoundaries=async bounds=>{
    if(!indexPromise)indexPromise=fetchJson('/map-data/manifest.json?v='+manifest.boundaries.sha256,true).then(index=>{
      if(index.version!==1||index.source_sha256!==manifest.boundaries.sha256||(manifest.apartment_information_generation&&index.apartment_information_generation!==manifest.apartment_information_generation)||!Array.isArray(index.tiles)||index.tiles.some(t=>!/^tile-\d+_\d+-[a-f0-9]{12}\.json$/.test(t.file)||!validBounds(t.bbox)||(manifest.apartment_information_generation&&(!/^[a-f0-9]{64}$/.test(t.sha256||'')||!t.file.endsWith('-'+t.sha256.slice(0,12)+'.json')||!Number.isSafeInteger(t.bytes)||t.bytes<=0))))throw new Error('상세 경계 자료가 갱신 중입니다. 잠시 후 다시 불러와 주세요.');
      return index;
    }).catch(error=>{indexPromise=null;throw error;});
    const index=await indexPromise,selected=index.tiles.filter(tile=>intersects(tile.bbox,bounds)),parts=[];
    for(let i=0;i<selected.length;i+=4)parts.push(...await Promise.all(selected.slice(i,i+4).map(tile=>tiles(JSON.stringify(tile)))));
    return {type:'FeatureCollection',features:parts.flatMap(part=>part.features).filter(f=>intersects(f.bbox,bounds))};
  };
  return data;
},{maxEntries:2});
export async function loadApartmentMap(expectedGeneration='') {
  const manifest=await fetchJson('/apartment-map/manifest.json'+(expectedGeneration?'?v='+encodeURIComponent(expectedGeneration):''),true);
  if(!/^apartments-[a-f0-9]{12}\.json$/.test(manifest?.apartments?.file||'')||!/^boundaries-[a-f0-9]{12}\.geojson$/.test(manifest?.boundaries?.file||''))throw new Error('아파트 지도 파일 경로가 올바르지 않습니다.');
  if(expectedGeneration&&manifest.apartment_information_generation!==expectedGeneration)throw new Error('지도와 공통 아파트 정보 버전이 다릅니다. 새 자료를 불러온 뒤 다시 시도하세요.');
  if(manifest.apartment_information_generation&&(!/^[a-f0-9]{64}$/.test(manifest.apartments.sha256||'')||manifest.apartments.file!==`apartments-${manifest.apartments.sha256.slice(0,12)}.json`||!/^[a-f0-9]{64}$/.test(manifest.boundaries.sha256||'')||manifest.boundaries.file!==`boundaries-${manifest.boundaries.sha256.slice(0,12)}.geojson`))throw new Error('아파트 지도 파일 체크섬 경로를 확인하세요.');
  return loadMapVersion(JSON.stringify(manifest));
}
export const mapVisibleApartments=(apartments,{regionCode='',dong='',query='',favoriteOnly=false},favorites=[])=>{
  const text=searchName(query);
  return apartments.filter(p=>(!regionCode||p.region_code===regionCode)&&(!dong||p.dong===dong)&&(!favoriteOnly||favorites.some(f=>mapApartmentFavoriteMatches(p,f)))&&(!text||[p.apartment,p.road_address,p.region_name,p.dong,p.jibun,p.postal_code,...(p.name_aliases||[])].some(s=>searchName(s).includes(text))));
};

export function mapCollectedApartments(apartments,manifest){
  const regions=Array.isArray(manifest.favorite_region_ids)?manifest.regions.filter(r=>manifest.favorite_region_ids.includes(r.region_id)):manifest.regions;
  return apartments.filter(p=>p.map_visible!==false&&p.active!==false&&p.residential_status!=='ancillary_only'&&(p.master_id||manifest.districts[p.region_code])&&regions.some(r=>r.region_code===p.region_code&&(!r.dongs.length||r.dongs.includes(p.dong))));
}
