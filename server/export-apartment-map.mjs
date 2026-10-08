import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {connect,paths,ROOT,regions,savedIds,secretValues,checkedBytes,atomicWrite} from './storage.mjs';
import {coordinatePoints} from './coordinates.mjs';
import {osmBoundaryFeatures,matchApartmentBoundaries,mapApartment,OSM_ATTRIBUTION,OSM_LICENSE} from './apartment-boundaries.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function exportApartmentMap({source=paths.db,target=path.join(ROOT,'public/apartment-map'),favorites=paths.favorites,secretsFile=paths.env}={}) {
  const db=connect(source,true);let apartments=[],boundarySources=[],scopeIds=[];
  try {
    if(!db.prepare("SELECT name FROM sqlite_master WHERE name='parcel_coordinates'").get())return null;
    const catalog=regions(db);scopeIds=savedIds(favorites,catalog);const selected=catalog.filter(r=>scopeIds.includes(r.region_id));
    const year=db.prepare('SELECT min(build_year) AS year FROM trades WHERE region_code=? AND dong=? AND jibun=? AND apartment=?');
    apartments=coordinatePoints(db).filter(p=>selected.some(r=>r.region_code===p.region_code&&(!r.dongs.length||r.dongs.includes(p.dong)))).map(p=>mapApartment(p,catalog.find(r=>r.region_code===p.region_code)?.region_name||'',year.get(p.region_code,p.dong,p.jibun,p.apartment).year));
    if(db.prepare("SELECT name FROM sqlite_master WHERE name='apartment_boundary_sources'").get())boundarySources=db.prepare('SELECT response_json FROM apartment_boundary_sources ORDER BY id').all();
  }finally{db.close();}
  // Cloud state may predate the local coordinate collection. Preserve the independently versioned map master.
  if(!apartments.length&&fs.existsSync(path.join(target,'manifest.json')))return null;
  const features=new Map();for(const row of boundarySources)for(const f of osmBoundaryFeatures(JSON.parse(row.response_json)))features.set(f.id,f);
  const boundaries=matchApartmentBoundaries(apartments,[...features.values()]),secrets=secretValues(secretsFile);
  const dataBytes=checkedBytes(JSON.stringify(apartments),secrets),geometryBytes=checkedBytes(JSON.stringify(boundaries),secrets);
  const files={apartments:`apartments-${hash(dataBytes).slice(0,12)}.json`,boundaries:`boundaries-${hash(geometryBytes).slice(0,12)}.geojson`};
  const manifest={version:1,generated_at:new Date().toISOString(),scope_region_ids:scopeIds,count:apartments.length,boundary_count:boundaries.features.length,boundary_apartments:boundaries.matchedApartments,
    apartments:{file:files.apartments,sha256:hash(dataBytes)},boundaries:{file:files.boundaries,sha256:hash(geometryBytes)},attribution:OSM_ATTRIBUTION,license:OSM_LICENSE};
  const manifestBytes=checkedBytes(JSON.stringify(manifest),secrets);
  atomicWrite(path.join(target,files.apartments),dataBytes);atomicWrite(path.join(target,files.boundaries),geometryBytes);atomicWrite(path.join(target,'manifest.json'),manifestBytes);
  for(const file of fs.readdirSync(target))if(/^(apartments-[a-f0-9]{12}\.json|boundaries-[a-f0-9]{12}\.geojson)$/.test(file)&&!Object.values(files).includes(file))fs.unlinkSync(path.join(target,file));
  return manifest;
}
