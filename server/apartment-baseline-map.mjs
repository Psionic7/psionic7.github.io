import path from 'node:path';
import {atomicWrite,checkedBytes} from './storage.mjs';
import {baselineHash,readInstalledBaseline} from './apartment-baseline-state.mjs';
import {baselineApartmentInformation} from './apartment-baseline-runtime.mjs';

export function exportBaselineMap(db,{target,generation}){
 const baseline=readInstalledBaseline(db);
 if(!baseline)return null;
 const map=baseline.payload.map;
 const apartmentBytes=checkedBytes(JSON.stringify(map.apartments)),boundaryBytes=checkedBytes(JSON.stringify(map.boundaries));
 const apartments={file:'apartments-'+baselineHash(apartmentBytes).slice(0,12)+'.json',sha256:baselineHash(apartmentBytes),bytes:apartmentBytes.length};
 const boundaries={file:'boundaries-'+baselineHash(boundaryBytes).slice(0,12)+'.geojson',sha256:baselineHash(boundaryBytes),bytes:boundaryBytes.length};
 const manifest={...map.manifest,generated_at:new Date().toISOString(),apartments,boundaries,apartment_information_generation:generation||baselineApartmentInformation(db).generation,apartment_baseline:{generation:baseline.manifest.generation,scope_sha256:baseline.manifest.scope_sha256,connections_sha256:baseline.manifest.connections_sha256}};
 atomicWrite(path.join(target,apartments.file),apartmentBytes);atomicWrite(path.join(target,boundaries.file),boundaryBytes);
 atomicWrite(path.join(target,'manifest.json'),JSON.stringify(manifest));
 return manifest;
}
