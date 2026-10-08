import osmtogeojson from 'osmtogeojson';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import pointToPolygonDistance from '@turf/point-to-polygon-distance';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';

export const OSM_ATTRIBUTION='© OpenStreetMap contributors';
export const OSM_LICENSE='https://opendatacommons.org/licenses/odbl/1-0/';
export const normalizeApartmentName=value=>String(value||'').toLowerCase().replace(/아파트|apartment|apt/gi,'').replace(/[^\p{L}\p{N}]/gu,'');
const sameName=(name,apartment)=>{const a=normalizeApartmentName(name),b=normalizeApartmentName(apartment);return a.length>=3&&b.length>=3&&(a===b||a.startsWith(b)||b.startsWith(a));};
export function osmBoundaryFeatures(payload) {
  if(!Array.isArray(payload?.elements)||payload.remark)throw new Error('아파트 경계 응답을 확인하세요.');
  const converted=osmtogeojson(payload,{flatProperties:false});
  return converted.features.filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type)&&!f.properties?.tainted).map(f=>{
    const tags=f.properties.tags||{};return {type:'Feature',id:f.id,geometry:f.geometry,properties:{osm_id:f.id,name:tags.name||'',residential:tags.residential||'',landuse:tags.landuse||''}};
  });
}
export function matchApartmentBoundaries(apartments,features) {
  const groups=new Map(),matches=new Set();
  for(const apartment of apartments) {
    const point=[apartment.longitude,apartment.latitude],candidates=[];
    for(const feature of features) {
      const named=sameName(feature.properties.name,apartment.apartment);
      if(!named&&feature.properties.residential!=='apartments')continue;
      const inside=booleanPointInPolygon(point,feature);
      // Entrance coordinates may sit just outside the fence. Only a matching name permits that tolerance.
      const distance=inside?0:named?pointToPolygonDistance(point,feature,{units:'meters'}):Infinity;
      if(distance>25)continue;
      const score=(named?100:0)+(inside?20:0)-distance;
      candidates.push({feature,score,method:inside?'inside':'named_entrance'});
    }
    candidates.sort((a,b)=>b.score-a.score||String(a.feature.id).localeCompare(String(b.feature.id)));
    if(!candidates.length)continue;
    // Equally plausible boundaries are withheld rather than assigned arbitrarily.
    if(candidates.length>1&&Math.abs(candidates[0].score-candidates[1].score)<1)continue;
    const {feature,method}=candidates[0];matches.add(apartment.id);
    if(!groups.has(feature.id))groups.set(feature.id,{...feature,properties:{osm_id:feature.id,name:feature.properties.name,source:'OpenStreetMap',license:OSM_LICENSE,apartment_ids:[],match_methods:[]}});
    const properties=groups.get(feature.id).properties;properties.apartment_ids.push(apartment.id);if(!properties.match_methods.includes(method))properties.match_methods.push(method);
  }
  return {type:'FeatureCollection',attribution:OSM_ATTRIBUTION,license:OSM_LICENSE,features:[...groups.values()],matchedApartments:matches.size};
}
export function mapApartment(point,regionName,buildYear=null) {
  const favorite=makeApartmentFavorite(point,{region_code:point.region_code,region_name:regionName});
  return {...favorite,latitude:point.latitude,longitude:point.longitude,build_year:buildYear};
}
