import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {connect,paths,ROOT,regions,savedIds,secretValues,checkedBytes,atomicWrite} from './storage.mjs';
import {coordinatePoints} from './coordinates.mjs';
import {masterMapData,masterStats} from './apartment-master.mjs';
import {osmBoundaryFeatures,matchApartmentBoundaries,mapApartment,OSM_ATTRIBUTION,OSM_LICENSE} from './apartment-boundaries.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function exportApartmentMap({source=paths.db,target=path.join(ROOT,'public/apartment-map'),favorites=paths.favorites,secretsFile=paths.env}={}) {
  const db=connect(source,true);let apartments=[],boundarySources=[],scopeIds=[],master=null;
  try {
    const catalog=regions(db);scopeIds=savedIds(favorites,catalog);
    const coverage=masterStats(db,scopeIds);
    if(coverage.regions.length){
      if(coverage.regions.length!==scopeIds.length||coverage.regions.some(r=>r.status!=='scanned'))return null;
      master=masterMapData(db,catalog,scopeIds);
    }
    if(!master&&!db.prepare("SELECT name FROM sqlite_master WHERE name='parcel_coordinates'").get())return null;
    const selected=catalog.filter(r=>scopeIds.includes(r.region_id));
    const year=master?null:db.prepare('SELECT min(build_year) AS year FROM trades WHERE region_code=? AND dong=? AND jibun=? AND apartment=?');
    if(!master)apartments=coordinatePoints(db).filter(p=>selected.some(r=>r.region_code===p.region_code&&(!r.dongs.length||r.dongs.includes(p.dong)))).map(p=>mapApartment(p,catalog.find(r=>r.region_code===p.region_code)?.region_name||'',year.get(p.region_code,p.dong,p.jibun,p.apartment).year));
    if(db.prepare("SELECT name FROM sqlite_master WHERE name='apartment_boundary_sources'").get())boundarySources=db.prepare('SELECT response_json FROM apartment_boundary_sources ORDER BY id').all();
  }finally{db.close();}
  // An older cloud transaction DB must not replace an independently collected registry map.
  const manifestPath=path.join(target,'manifest.json');
  const prior=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
  if(!master&&(prior?.version===2&&prior.data_mode==='registry_master'||!apartments.length&&prior))return null;
  if(master)apartments=master.apartments;
  const features=new Map();for(const row of boundarySources)for(const f of osmBoundaryFeatures(JSON.parse(row.response_json)))features.set(f.id,f);
  const boundaries=master?.boundaries||matchApartmentBoundaries(apartments,[...features.values()]),secrets=secretValues(secretsFile);
  const dataBytes=checkedBytes(JSON.stringify(apartments),secrets),geometryBytes=checkedBytes(JSON.stringify(boundaries),secrets);
  const files={apartments:`apartments-${hash(dataBytes).slice(0,12)}.json`,boundaries:`boundaries-${hash(geometryBytes).slice(0,12)}.geojson`};
  const manifest={version:master?2:1,data_mode:master?'registry_master':'trade_bootstrap',...(master?{coverage:master.coverage}:{}),generated_at:new Date().toISOString(),scope_region_ids:scopeIds,count:apartments.length,boundary_count:boundaries.features.length,boundary_apartments:boundaries.matchedApartments,
    apartments:{file:files.apartments,sha256:hash(dataBytes)},boundaries:{file:files.boundaries,sha256:hash(geometryBytes)},attribution:master?'건축HUB 건축물대장 · 주소정보누리집 · 국토교통부/V-World 연속지적도':OSM_ATTRIBUTION,license:master?'https://www.kogl.or.kr/info/licenseType1.do':OSM_LICENSE};
  const manifestBytes=checkedBytes(JSON.stringify(manifest),secrets);
  atomicWrite(path.join(target,files.apartments),dataBytes);atomicWrite(path.join(target,files.boundaries),geometryBytes);atomicWrite(path.join(target,'manifest.json'),manifestBytes);
  for(const file of fs.readdirSync(target))if(/^(apartments-[a-f0-9]{12}\.json|boundaries-[a-f0-9]{12}\.geojson)$/.test(file)&&!Object.values(files).includes(file))fs.unlinkSync(path.join(target,file));
  return manifest;
}
