import {geometryBounds,validBounds} from '../src/map-bounds.mjs';
import {normalizeParcel} from '../src/address-identity.mjs';
import {createHash} from 'node:crypto';

const residential=value=>value==='apartment'||value==='senior_housing';
const parse=(value,fallback)=>value?JSON.parse(value):fallback;
const text=value=>String(value??'').trim();
const number=value=>value===null||value===undefined||text(value)===''?null:Number.isFinite(Number(value))?Number(value):null;
const unique=values=>[...new Set(values.filter(value=>value!==null&&value!==undefined&&value!==''))].sort();
const ref=id=>({kind:'root',id});
const hash=(...values)=>createHash('sha256').update(JSON.stringify(values)).digest('hex');
const statusFor=classes=>classes.some(residential)?'residential':classes.length&&classes.every(value=>value==='other')?'ancillary_only':'unresolved';
const group=(rows,key)=>{
  const groups=new Map();
  for(const row of rows){const id=key(row);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
  return groups;
};
const read=(db,table)=>db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table)?db.prepare('SELECT * FROM '+table).all():[];
const combinedBox=boxes=>boxes.length?[Math.min(...boxes.map(box=>box[0])),Math.min(...boxes.map(box=>box[1])),Math.max(...boxes.map(box=>box[2])),Math.max(...boxes.map(box=>box[3]))]:null;
function boxFor(geometry){
  if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type)||!Array.isArray(geometry.coordinates)||!geometry.coordinates.length)throw Error('아파트 공간 원천의 도형 형식을 확인하세요.');
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  const point=value=>Array.isArray(value)&&value.length>=2&&Number.isFinite(value[0])&&Number.isFinite(value[1])&&value[0]>=122&&value[0]<=135&&value[1]>=28&&value[1]<=40;
  if(!polygons.every(polygon=>Array.isArray(polygon)&&polygon.length&&polygon.every(ring=>Array.isArray(ring)&&ring.length>=4&&ring.every(point)&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1])))throw Error('아파트 공간 원천의 닫힌 경계 도형을 확인하세요.');
  const box=geometryBounds(geometry);
  if(!validBounds(box))throw Error('아파트 공간 원천의 경계 범위를 확인하세요.');
  return box;
}
function locationFor(anchors){
  const first=anchors[0];
  return {status:first?'confirmed':'missing',precision:first?'entrance':'unknown',latitude:first?.latitude??null,longitude:first?.longitude??null,
    building_id:first?.building_id??null,entrance_index:first?.entrance_index??null,source:first?.source??null,observed_at:first?.observed_at??null,anchors};
}

export function readApartmentSpatialContext(db,{geometry='summary'}={}){
  if(!['summary','full'].includes(geometry))throw Error('아파트 공간 조회 형식을 확인하세요.');
  const complexes=read(db,'apartment_complexes').sort((a,b)=>a.apartment_id.localeCompare(b.apartment_id));
  const inventory=new Map(read(db,'apartment_building_inventory').map(row=>[row.building_id,{...row,record:parse(row.record_json,{})}]));
  const regions=new Map(read(db,'apartment_inventory_regions').map(row=>[row.region_id,row]));
  const buildings=group(read(db,'apartment_buildings').filter(row=>inventory.get(row.building_id)?.active!==0),row=>row.apartment_id);
  const entrances=group(read(db,'apartment_entrances'),row=>row.building_id);
  const parcels=group(read(db,'apartment_parcels'),row=>row.apartment_id);
  const footprintLinks=group(read(db,'apartment_footprint_links'),row=>row.apartment_id);
  const footprints=new Map(read(db,'apartment_building_footprints').map(row=>[row.footprint_id,row]));
  const zoningLinks=group(read(db,'apartment_zoning_links'),row=>row.apartment_id);
  const zoning=new Map(read(db,'apartment_zoning_features').map(row=>[row.feature_id,row]));
  const result=new Map();
  for(const complex of complexes){
    const id=complex.apartment_id,identity=ref(id);
    const members=(buildings.get(id)||[]).sort((a,b)=>a.building_id.localeCompare(b.building_id));
    const classes=members.map(building=>inventory.get(building.building_id)?.classification||'review');
    const residentialStatus=statusFor(classes);
    const memberContext=members.map(building=>({building_id:building.building_id,region_id:inventory.get(building.building_id)?.region_id||null,legal_code:building.legal_code,
      road_address:building.road_address||'',jibun:building.jibun||'',classification:inventory.get(building.building_id)?.classification||'review',
      households:number(building.households),floors_above:number(building.floors_above),build_year:number(building.build_year),approval_date:building.approval_date||null,dwelling_units:number(inventory.get(building.building_id)?.record.title?.hoCnt)}));
    const anchors=[];
    for(const building of members){
      const record=inventory.get(building.building_id),region=regions.get(record?.region_id);
      for(const entrance of entrances.get(building.building_id)||[]){
        if(!Number.isFinite(entrance.latitude)||!Number.isFinite(entrance.longitude)||entrance.latitude<28||entrance.latitude>40||entrance.longitude<122||entrance.longitude>135)throw Error('아파트 출입구 좌표 범위를 확인하세요.');
        anchors.push({building_id:building.building_id,entrance_index:entrance.entrance_index,latitude:entrance.latitude,longitude:entrance.longitude,
          source:entrance.source||null,observed_at:entrance.fetched_at||null,region_id:record?.region_id||null,legal_code:building.legal_code||region?.legal_code||complex.legal_code,
          road_address:building.road_address||'',jibun:building.jibun||'',classification:record?.classification||'review'});
      }
    }
    anchors.sort((a,b)=>Number(residential(b.classification))-Number(residential(a.classification))||a.building_id.localeCompare(b.building_id)||a.entrance_index-b.entrance_index);
    const position=locationFor(anchors),features=[],boundaryRefs=[],parcelRows=[];
    const rawParcels=(parcels.get(id)||[]).sort((a,b)=>Number(b.relation==='primary')-Number(a.relation==='primary')||a.pnu.localeCompare(b.pnu));
    for(const parcel of rawParcels){
      const shape=parcel.boundary_status==='exact'&&parcel.geometry_json?parse(parcel.geometry_json,null):null;
      const bbox=shape?boxFor(shape):null,boundaryId=shape?'cadastral_parcels:'+parcel.pnu:null;
      const source=parcel.boundary_source||null;
      parcelRows.push({pnu:parcel.pnu,legal_code:parcel.legal_code,jibun:parcel.jibun,relation:parcel.relation,status:parcel.boundary_status||'pending',source,boundary_id:boundaryId,bbox});
      if(shape){
        boundaryRefs.push({id:boundaryId,kind:'cadastral_parcels',pnu:parcel.pnu,source,observed_at:parcel.fetched_at||null,bbox,identity_ref:identity,sha256:hash(shape,parse(parcel.attributes_json,{}))});
        if(geometry==='full')features.push({type:'Feature',id:boundaryId,geometry:shape,properties:{name:complex.name||'',source,observed_at:parcel.fetched_at||null,boundary_kind:'cadastral_parcels',pnu:parcel.pnu,relation:parcel.relation,identity_ref:identity,apartment_ids:[id]}});
      }
    }
    const seenFootprints=new Set();
    for(const link of (footprintLinks.get(id)||[]).sort((a,b)=>a.footprint_id.localeCompare(b.footprint_id)||a.pnu.localeCompare(b.pnu))){
      if(seenFootprints.has(link.footprint_id))continue;
      seenFootprints.add(link.footprint_id);
      const footprint=footprints.get(link.footprint_id);
      if(!footprint)throw Error('아파트 건물 외곽선 참조가 없습니다.');
      const shape=parse(footprint.geometry_json,null),bbox=boxFor(shape),attributes=parse(footprint.properties_json,{}),source=footprint.source||null;
      boundaryRefs.push({id:footprint.footprint_id,kind:'building_footprint',pnu:link.pnu,source,observed_at:footprint.fetched_at||null,bbox,identity_ref:identity,sha256:hash(shape,attributes)});
      if(geometry==='full')features.push({type:'Feature',id:footprint.footprint_id,geometry:shape,properties:{name:text(attributes.bld_nm)||complex.name||'',source,observed_at:footprint.fetched_at||null,boundary_kind:'building_footprint',pnu:link.pnu,building_attributes:attributes,identity_ref:identity,apartment_ids:[id]}});
    }
    const zoneRefs=[],seenZones=new Set();
    for(const link of (zoningLinks.get(id)||[]).sort((a,b)=>a.feature_id.localeCompare(b.feature_id))){
      if(seenZones.has(link.feature_id))continue;
      seenZones.add(link.feature_id);
      const feature=zoning.get(link.feature_id);
      if(!feature)throw Error('아파트 용도지역 참조가 없습니다.');
      const properties=parse(feature.properties_json,{});
      zoneRefs.push({id:feature.feature_id,name:text(properties.uname),source:feature.source||null,observed_at:feature.fetched_at||null,identity_ref:identity,sha256:hash(parse(feature.geometry_json,null),properties)});
    }
    const senior=classes.includes('senior_housing')&&!classes.includes('apartment');
    const seniorUnits=members.filter(building=>inventory.get(building.building_id)?.classification==='senior_housing').map(building=>number(inventory.get(building.building_id)?.record.title?.hoCnt));
    const priceParcel=rawParcels.find(parcel=>parcel.attributes_json),parcelAttributes=parse(priceParcel?.attributes_json,{});
    const observedAt=unique(members.map(building=>regions.get(inventory.get(building.building_id)?.region_id)?.fetched_at)).at(-1)||complex.fetched_at||null;
    const facts={build_year:complex.build_year??null,approval_date:complex.approval_date??null,household_count:complex.household_count??null,
      building_count:complex.building_count??null,max_floors:complex.max_floors??null,structure:complex.structure??null,source:complex.source||null,fetched_at:observedAt,
      housing_type:senior?'senior_housing':classes.includes('apartment')?'apartment':null,housing_type_label:senior?'노인복지주택':classes.includes('apartment')?'아파트':'용도 미확인',
      dwelling_unit_count:senior&&seniorUnits.length&&seniorUnits.every(value=>value!==null)?seniorUnits.reduce((sum,value)=>sum+value,0):null,
      official_name:complex.name||null,name_status:complex.name?'confirmed':'missing',position_source:position.source,boundary_kind:'cadastral_parcels',
      land_price_per_m2:number(parcelAttributes.jiga),land_price_year:text(parcelAttributes.gosi_year),land_price_month:text(parcelAttributes.gosi_month),land_price_parcel_pnu:priceParcel?.pnu||null,
      zoning_names:unique(zoneRefs.map(zone=>zone.name)),building_footprint_count:seenFootprints.size};
    const area={identity_ref:identity,geometry_scope:identity,legal_code:complex.legal_code,region_ids:unique(members.map(building=>inventory.get(building.building_id)?.region_id)),
      parcels:parcelRows,boundary_refs:boundaryRefs,boundary_ids:boundaryRefs.map(boundary=>boundary.id),bbox:combinedBox(boundaryRefs.map(boundary=>boundary.bbox)),zoning_refs:zoneRefs};
    result.set(id,{residential_status:residentialStatus,primary_building_id:position.building_id,primary_entrance_index:position.entrance_index,location:position,area,facts,buildings:memberContext,
      ...(geometry==='full'?{boundaries:{type:'FeatureCollection',features,matchedApartments:features.length?1:0}}:{})});
  }
  return result;
}

export function scopeApartmentSpatialContext(context,cohort){
  const identity={kind:'cohort',id:cohort.cohort_id};
  const ids=new Set(cohort.building_ids||[]),lots=new Set((cohort.parcels||[]).map(normalizeParcel).filter(Boolean));
  const buildings=context.buildings.filter(building=>ids.has(building.building_id));
  const anchors=context.location.anchors.filter(anchor=>ids.has(anchor.building_id));
  const legalCodes=new Set(buildings.map(building=>building.legal_code).filter(Boolean));
  const parcels=context.area.parcels.filter(parcel=>lots.has(normalizeParcel(parcel.jibun))&&(!legalCodes.size||legalCodes.has(parcel.legal_code)));
  const pnus=new Set(parcels.map(parcel=>parcel.pnu));
  const refs=context.area.boundary_refs.filter(boundary=>pnus.has(boundary.pnu));
  // The links prove root ownership, not exclusive ownership by this address cohort.
  const area={...context.area,identity_ref:identity,legal_code:legalCodes.size===1?[...legalCodes][0]:context.area.legal_code,region_ids:unique(buildings.map(building=>building.region_id)),
    parcels,boundary_refs:refs,boundary_ids:refs.map(boundary=>boundary.id),bbox:combinedBox(refs.map(boundary=>boundary.bbox))};
  const position=locationFor(anchors);
  const homes=buildings.filter(building=>residential(building.classification)),senior=homes.length>0&&homes.every(building=>building.classification==='senior_housing');
  const sum=field=>homes.length&&homes.every(building=>building[field]!==null)?homes.reduce((value,building)=>value+building[field],0):null;
  const years=homes.map(building=>building.build_year).filter(value=>value!==null),floors=homes.map(building=>building.floors_above).filter(value=>value!==null),approvals=homes.map(building=>building.approval_date).filter(Boolean).sort();
  const hasPrice=pnus.has(context.facts.land_price_parcel_pnu);
  const facts={...context.facts,build_year:years.length?Math.min(...years):null,approval_date:approvals[0]||null,household_count:sum('households'),building_count:buildings.length,max_floors:floors.length?Math.max(...floors):null,
    housing_type:senior?'senior_housing':homes.length?'apartment':null,housing_type_label:senior?'노인복지주택':homes.length?'아파트':'용도 미확인',dwelling_unit_count:senior?sum('dwelling_units'):null,
    land_price_per_m2:hasPrice?context.facts.land_price_per_m2:null,land_price_year:hasPrice?context.facts.land_price_year:'',land_price_month:hasPrice?context.facts.land_price_month:'',land_price_parcel_pnu:hasPrice?context.facts.land_price_parcel_pnu:null,
    position_source:position.source,building_footprint_count:refs.filter(boundary=>boundary.kind==='building_footprint').length};
  return {...context,residential_status:statusFor(buildings.map(building=>building.classification)),primary_building_id:position.building_id,primary_entrance_index:position.entrance_index,location:position,area,facts,buildings,
    ...(context.boundaries?{boundaries:{...context.boundaries,features:context.boundaries.features.filter(feature=>pnus.has(feature.properties.pnu))}}:{})};
}
