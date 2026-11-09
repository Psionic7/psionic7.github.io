import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import pointToPolygonDistance from '@turf/point-to-polygon-distance';
import {normalizeRoadAddress,normalizeParcel} from '../src/address-identity.mjs';

export const OFFICIAL_ANCHOR_CORROBORATION_METERS=150;
const observedText=value=>typeof value==='string'?value.replace(/<[^>]*>/g,'').trim().slice(0,1000):'';
export function housingPoint(value) {
  if(value?.latitude===null||value?.latitude===undefined||value?.latitude===''||value?.longitude===null||value?.longitude===undefined||value?.longitude==='')return null;
  const latitude=Number(value.latitude),longitude=Number(value.longitude);
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=28&&latitude<=40&&longitude>=122&&longitude<=135?{latitude,longitude}:null;
}
export function housingDistanceMeters(a,b) {
  const rad=value=>value*Math.PI/180,dlat=rad(a.latitude-b.latitude),dlon=rad(a.longitude-b.longitude);
  return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dlon/2)**2)));
}
export function housingRoadAddress(detail) {
  const prefix=observedText(detail?.roadAddressPrefix),road=observedText(detail?.roadAddress);
  if(!road)return '';
  return prefix&&!normalizeRoadAddress(road).startsWith(normalizeRoadAddress(prefix))?prefix+' '+road:road;
}
function usablePolygon(value) {
  if(!['Polygon','MultiPolygon'].includes(value?.type))return false;
  const polygons=value.type==='Polygon'?[value.coordinates]:value.coordinates;
  return Array.isArray(polygons)&&polygons.length>0&&polygons.every(polygon=>Array.isArray(polygon)&&polygon.length>0&&polygon.every(ring=>Array.isArray(ring)&&ring.length>=4&&ring.every(position=>Array.isArray(position)&&position.length>=2&&Number.isFinite(position[0])&&Number.isFinite(position[1])&&housingPoint({longitude:position[0],latitude:position[1]}))&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1]));
}
export function housingLocationEvidence(location,detail) {
  const point=housingPoint(detail),road_address=housingRoadAddress(detail),road=normalizeRoadAddress(road_address);
  const anchors=(location?.anchors||[]).filter(anchor=>anchor?.role==='entrance'&&anchor.crs==='EPSG:4326'&&typeof anchor.source==='string'&&anchor.source&&housingPoint(anchor));
  const polygons=(location?.primary_parcels||[]).filter(parcel=>/^\d{19}$/.test(parcel?.pnu||'')&&typeof parcel.source==='string'&&parcel.source&&usablePolygon(parcel.geometry));
  const roads=(location?.roads||[]).filter(value=>typeof value?.source==='string'&&value.source&&normalizeRoadAddress(value.road_address));
  const primaryLots=(location?.parcels||[]).filter(value=>value?.relation==='primary'&&typeof value.source==='string'&&value.source).map(value=>normalizeParcel(value.jibun)).filter(Boolean);
  const nearest_anchor_m=point&&anchors.length?Math.min(...anchors.map(anchor=>housingDistanceMeters(point,anchor))):null;
  const point_in_primary_polygon=Boolean(point&&polygons.some(parcel=>booleanPointInPolygon([point.longitude,point.latitude],parcel.geometry)));
  const nearest_primary_polygon_m=point&&polygons.length?point_in_primary_polygon?0:Math.min(...polygons.map(parcel=>pointToPolygonDistance([point.longitude,point.latitude],parcel.geometry,{units:'meters'}))):null;
  return {point,road_address,road_match:Boolean(road&&roads.some(value=>normalizeRoadAddress(value.road_address)===road)),primary_parcel_match:primaryLots.includes(normalizeParcel(detail?.detailAddress)),has_primary_polygon:polygons.length>0,point_in_primary_polygon,nearest_primary_polygon_m,nearest_anchor_m,anchor_corroborated:nearest_anchor_m!==null&&nearest_anchor_m<=OFFICIAL_ANCHOR_CORROBORATION_METERS};
}
export function housingMapViewport(location) {
  const anchors=(location?.anchors||[]).filter(anchor=>anchor?.role==='entrance'&&anchor.crs==='EPSG:4326'&&typeof anchor.source==='string'&&anchor.source).map(housingPoint).filter(Boolean);
  if(!anchors.length)for(const parcel of location?.primary_parcels||[]){
    if(!/^\d{19}$/.test(parcel?.pnu||'')||typeof parcel.source!=='string'||!parcel.source||!usablePolygon(parcel.geometry))continue;
    const rings=parcel.geometry.type==='Polygon'?parcel.geometry.coordinates:parcel.geometry.coordinates.flat();
    for(const position of rings.flat())anchors.push({latitude:position[1],longitude:position[0]});
  }
  if(!anchors.length)return null;
  return {latitude:(Math.min(...anchors.map(p=>p.latitude))+Math.max(...anchors.map(p=>p.latitude)))/2,longitude:(Math.min(...anchors.map(p=>p.longitude))+Math.max(...anchors.map(p=>p.longitude)))/2,zoom:17};
}
export function housingObservation(detail,{sourceUrl,observedAt,verificationMethod,buildingWitnesses}={}) {
  const point=housingPoint(detail),address=observedText(detail?.cortarAddress||detail?.address),parcel=observedText(detail?.detailAddress);
  const observation={complex_no:String(detail.complexNo),name:observedText(detail.complexName),road_address:housingRoadAddress(detail),parcel_address:[address,parcel].filter(Boolean).join(' '),source_url:sourceUrl,observed_at:observedAt,verification_method:verificationMethod};
  if(point)Object.assign(observation,point,{coordinate_role:'provider_label'});
  if(typeof detail.realEstateTypeCode==='string'&&detail.realEstateTypeCode)observation.real_estate_type=detail.realEstateTypeCode;
  if(buildingWitnesses?.length)observation.building_witnesses=[...buildingWitnesses];
  return observation;
}
