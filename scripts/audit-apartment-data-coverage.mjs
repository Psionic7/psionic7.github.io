import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import pointToPolygonDistance from '@turf/point-to-polygon-distance';
import {connect,paths,ROOT,atomicWrite,checkedBytes,secretValues} from '../server/storage.mjs';
import {apartmentInformation,publicApartmentInformation,housingIdentityCatalog,housingIdentityStats} from '../server/apartment-identity.mjs';
import {readApartmentInformationFile} from '../server/apartment-information-files.mjs';
import {naverMatchScope} from '../server/apartment-naver-matches.mjs';
import {dailyListingTargets} from '../server/daily-naver-listings.mjs';
import {sourceIdentityId} from '../src/housing-identity.mjs';

const {values}=parseArgs({options:{database:{type:'string'},audit:{type:'string'},output:{type:'string'}}});
const source=path.resolve(values.database||paths.db),output=path.resolve(values.output||path.join(ROOT,'local/data-validation/apartment-data-coverage.json'));
if(path.extname(output).toLowerCase()!=='.json'||output.toLowerCase()===source.toLowerCase())throw Error('감사 결과는 원본 DB와 다른 JSON 파일로 저장하세요.');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const count=(rows,key)=>rows.reduce((result,row)=>{const value=typeof key==='function'?key(row):row[key];result[value]=(result[value]||0)+1;return result;},{});
const sum=(rows,key)=>rows.reduce((result,row)=>result+row[key],0);
const brief=item=>({id:item.id,name:item.apartment,region_code:item.region_code,dong:item.dong,jibun:item.jibun,road_address:item.road_address,active:item.active,residential_status:item.residential_status});
const db=connect(source,true);
try{
 db.exec('BEGIN');
 const audit=read(values.audit||path.join(ROOT,'local/data-validation/apartment-matches-current.json'));
 const manifest=read(path.join(ROOT,'public/data/manifest.json'));
 const published=readApartmentInformationFile(path.join(ROOT,'public'),manifest,{required:true});
 const information=publicApartmentInformation(db);
 assert.equal(information.generation,published.generation,'작업 DB와 공개 공통 정보가 다릅니다. 감사 전에 공식 내보내기를 완료하세요.');
 const housing=housingIdentityCatalog(db),stats=housingIdentityStats(db);
 assert.equal(stats.source_fingerprint,audit.summary.housing_identity.source_fingerprint);
 const roots=information.apartments.filter(item=>item.scope_kind==='root'),active=roots.filter(item=>item.active),mapped=active.filter(item=>item.map_visible);
 const byId=new Map(roots.map(item=>[item.id,item])),entities=new Map(housing.entities.map(item=>[item.entity_id,item]));
 const issues=db.prepare('SELECT * FROM apartment_master_issues ORDER BY region_id,code,issue_key').all();
 const review=housing.entities.filter(item=>!['verified','out_of_scope'].includes(item.state)).map(item=>{
  const evidence=JSON.parse(db.prepare('SELECT evidence_json FROM housing_identity_entities WHERE entity_id=?').get(item.entity_id).evidence_json);
  return {id:item.entity_id,name:item.favorite.apartment,region_code:item.favorite.region_code,dong:item.favorite.dong,jibun:item.favorite.jibun,road_address:item.favorite.road_address,state:item.state,method:item.method,rows:item.row_count,precision:item.precision_counts,root_ids:item.root_ids,cohort_ids:item.cohort_ids,evidence};
 });
 const bindingByState=db.prepare('SELECT e.state,b.precision,count(*) rows FROM housing_identity_bindings b JOIN housing_identity_entities e USING(entity_id) GROUP BY e.state,b.precision ORDER BY e.state,b.precision').all();
 const outside=housing.entities.filter(item=>item.state==='out_of_scope');
 const outsideGroups=new Map();for(const item of outside){const key=item.favorite.region_code+'|'+item.favorite.dong;if(!outsideGroups.has(key))outsideGroups.set(key,{region_code:item.favorite.region_code,dong:item.favorite.dong,entities:0,rows:0});const group=outsideGroups.get(key);group.entities++;group.rows+=item.row_count;}
 const full=new Map(apartmentInformation(db,{activeOnly:false,geometry:'full'}).map(item=>[item.apartment_id,item]));
 const spatialDistance=[];let withPrimary=0,insidePrimary=0;
 for(const item of mapped){
  const polygons=full.get(item.id)?.boundaries?.features.filter(feature=>feature.properties.boundary_kind==='cadastral_parcels'&&feature.properties.relation==='primary')||[];
  if(item.location.status!=='confirmed'||!polygons.length)continue;
  withPrimary++;const point=[item.location.longitude,item.location.latitude];
  if(polygons.some(polygon=>booleanPointInPolygon(point,polygon))){insidePrimary++;continue;}
  const distance=Math.min(...polygons.map(polygon=>Math.abs(pointToPolygonDistance(point,polygon,{units:'meters'}))));
  const owned=full.get(item.id)?.boundaries?.features.filter(feature=>feature.properties.boundary_kind==='cadastral_parcels')||[];
  spatialDistance.push({...brief(item),distance_m:Math.round(distance*10)/10,building_id:item.location.building_id,latitude:item.location.latitude,longitude:item.location.longitude,primary_pnus:polygons.map(feature=>feature.properties.pnu),inside_any_owned_parcel:owned.some(feature=>booleanPointInPolygon(point,feature)),alternative_inside_primary_anchors:item.location.anchors.filter(anchor=>polygons.some(feature=>booleanPointInPolygon([anchor.longitude,anchor.latitude],feature))).length});
 }
 const duplicatePoints=new Map();for(const item of mapped.filter(item=>item.location.status==='confirmed')){const key=item.location.latitude+','+item.location.longitude;if(!duplicatePoints.has(key))duplicatePoints.set(key,[]);duplicatePoints.get(key).push(brief(item));}
 const missing={};
 for(const [key,predicate] of Object.entries({location:item=>item.location.status!=='confirmed',name:item=>item.name_status==='missing',road_address:item=>!item.road_address,postal_code:item=>!item.postal_code,year:item=>!item.build_year,parcels:item=>!item.area.parcels.length,incomplete_parcels:item=>item.area.parcels.some(parcel=>parcel.status!=='exact'),footprints:item=>!item.area.boundary_refs.some(ref=>ref.kind==='building_footprint'),zoning:item=>!item.area.zoning_refs.length,land_price:item=>item.land_price_per_m2===null}))missing[key]=mapped.filter(predicate).map(brief);
 const buildings=db.prepare("SELECT b.*,i.classification,i.region_id,i.active AS inventory_active,json_extract(i.record_json,'$.title.regstrKindCd') AS registry_kind,(SELECT count(*) FROM apartment_entrances e WHERE e.building_id=b.building_id) AS entrance_count FROM apartment_buildings b JOIN apartment_building_inventory i USING(building_id) JOIN apartment_complexes c USING(apartment_id) WHERE c.active=1 AND i.active=1").all();
 const reviewDongs=new Set(review.map(item=>item.region_code+'|'+item.dong));
 const reviewDongBuildings=buildings.filter(row=>{const root=byId.get(row.apartment_id);return root&&reviewDongs.has(root.region_code+'|'+root.dong);}).map(row=>({building_id:row.building_id,root_id:row.apartment_id,root_name:byId.get(row.apartment_id).apartment,dong:byId.get(row.apartment_id).dong,name:row.name,building_dong:row.dong_name,jibun:row.jibun,road_address:row.road_address,classification:row.classification,registry_kind:row.registry_kind,build_year:row.build_year,households:row.households}));
 const missingBuildings=buildings.filter(row=>['apartment','senior_housing'].includes(row.classification)&&!row.entrance_count).map(row=>({building_id:row.building_id,root_id:row.apartment_id,name:row.name,dong_name:row.dong_name,jibun:row.jibun,road_address:row.road_address,coordinate_status:row.coordinate_status,has_coordinate_codes:Boolean(row.coordinate_codes_json&&row.coordinate_codes_json!=='null'),root_name:byId.get(row.apartment_id)?.apartment}));
 const parcels=db.prepare('SELECT p.apartment_id,p.pnu,p.jibun,p.relation,p.boundary_status,p.spatial_status,p.spatial_fetched_at,p.attributes_json FROM apartment_parcels p JOIN apartment_complexes c USING(apartment_id) WHERE c.active=1').all();
 const config=read(path.join(ROOT,'automation/config.json')),targets=dailyListingTargets(db,config),targetById=new Map(targets.map(target=>[target.favorite.id,target]));
 const matchRows=db.prepare('SELECT target_id,state,scope_hash,complex_no,last_verified_at,last_attempted_at,reason FROM apartment_naver_matches WHERE active=1 ORDER BY target_id').all();
 const matches=matchRows.map(row=>{const target=targetById.get(row.target_id);return {...row,current_target:Boolean(target),scope_current:target?row.scope_hash===naverMatchScope(target):null};});
 const staleMatches=matches.filter(row=>row.current_target&&row.state==='verified'&&!row.scope_current);
 const nonApartmentSources=housing.entities.filter(item=>item.state==='verified'&&item.legal_types.length&&!item.legal_types.some(type=>['아파트','노인복지주택'].includes(type))).map(item=>({id:item.entity_id,name:item.favorite.apartment,dong:item.favorite.dong,jibun:item.favorite.jibun,rows:item.row_count,legal_types:item.legal_types}));
 const orphanGroups=audit.listing_identity_unresolved.map(item=>{
  const stored=db.prepare('SELECT apartment_id,group_json FROM naver_listing_snapshots WHERE json_extract(group_json,\'$.complexNo\')=?').all(item.complex_no).map(row=>{const f=JSON.parse(row.group_json).favorite;return {id:row.apartment_id,favorite:{id:f.id,master_id:f.master_id,region_code:f.region_code,apartment:f.apartment,dong:f.dong,jibun:f.jibun,road_address:f.road_address,identity_ref:f.identity_ref}};});
  const sourceRegions=new Set(stored.map(row=>row.favorite.region_code));
  const candidates=roots.filter(root=>root.dong===item.dong&&root.jibun===item.jibun&&sourceRegions.has(root.region_code));
  return {...item,candidates:candidates.map(brief),stored_selections:stored};
 });
 const summary={trade_rows:stats.row_count,source_groups:stats.entity_count,source_states:stats.states,precision_counts:stats.precision_counts,binding_by_state:bindingByState,review_groups:review.length,review_rows:sum(review,'rows'),review_unresolved_rows:review.reduce((total,item)=>total+item.precision.unresolved,0),out_of_scope_rows:sum(outside,'row_count'),root_count:roots.length,active_roots:active.length,map_roots:mapped.length,root_residential_states:count(roots,'residential_status'),missing:Object.fromEntries(Object.entries(missing).map(([key,rows])=>[key,rows.length])),residential_buildings_without_entrance:missingBuildings.length,master_issues:count(issues,'code'),spatial:{with_primary_polygon:withPrimary,inside_primary:insidePrimary,outside_primary:spatialDistance.length,outside_over_50m:spatialDistance.filter(item=>item.distance_m>50).length,duplicate_point_groups:[...duplicatePoints.values()].filter(items=>items.length>1).length},listing:{targets:targets.length,latest_run:audit.summary.listing_day,success:audit.summary.listing_ready,unmatched:audit.summary.listing_unmatched,failed:audit.summary.listing_failed,stored_identity_unresolved:orphanGroups.length,active_match_states:count(matches,'state'),verified_stale_scopes:staleMatches.length,noncurrent_active_matches:matches.filter(row=>!row.current_target).length},non_apartment_source_groups:nonApartmentSources.length,non_apartment_source_rows:sum(nonApartmentSources,'rows')};
 assert.equal(sum(bindingByState,'rows'),stats.row_count);
 assert.equal(summary.out_of_scope_rows+summary.review_unresolved_rows,stats.precision_counts.unresolved);
 const result={version:1,generated_at:new Date().toISOString(),read_only:true,data:{published_at:manifest.published_at,common_generation:published.generation,housing_sha256:manifest.housing.sha256,audit_generated_at:audit.generated_at,last_collection:db.prepare('SELECT max(fetched_at) at FROM collection_runs').get().at,last_master_observation:db.prepare('SELECT max(fetched_at) at FROM apartment_inventory_regions').get().at},summary,review_sources:review,out_of_scope_dongs:[...outsideGroups.values()].sort((a,b)=>b.rows-a.rows),out_of_scope_sources:outside.map(item=>({id:item.entity_id,name:item.favorite.apartment,region_code:item.favorite.region_code,dong:item.favorite.dong,jibun:item.favorite.jibun,rows:item.row_count})),legacy_unresolved_in_scope:audit.trade_unresolved.filter(item=>item.in_collection_scope).map(item=>({...item,modern_state:entities.get(sourceIdentityId(item))?.state,modern_precision:entities.get(sourceIdentityId(item))?.precision_counts})),missing_root_data:missing,non_apartment_sources:nonApartmentSources,unresolved_residential_buildings:missingBuildings,parcel_states:count(parcels,'boundary_status'),parcel_spatial_states:count(parcels,'spatial_status'),parcels_without_attributes:parcels.filter(row=>!row.attributes_json).map(({attributes_json,...row})=>row),outside_primary_polygon:spatialDistance.sort((a,b)=>b.distance_m-a.distance_m),duplicate_positions:[...duplicatePoints].filter(([,items])=>items.length>1).map(([point,items])=>({point,items})),master_issues:issues,listing_unresolved:audit.listing_unresolved,listing_identity_unresolved:orphanGroups,source_listing_registry_review:audit.source_listing_registry_review,naver_match_state:matches,verified_stale_match_scopes:staleMatches};
 result.review_dong_buildings=reviewDongBuildings;
 atomicWrite(output,checkedBytes(JSON.stringify(result,null,2)+'\n',secretValues(paths.env)));
 db.exec('COMMIT');console.log(JSON.stringify(summary,null,2));
}finally{db.close();}
