import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,atomicWrite,checkedBytes,secretValues} from '../server/storage.mjs';
import {synchronizeHousingIdentity,housingIdentityCatalog,publicApartmentInformation,searchApartmentInformation} from '../server/apartment-identity.mjs';
import {housingQueryInformation} from '../server/housing-export.mjs';
import {validateApartmentInformation} from '../src/apartment-identity.mjs';

const {values}=parseArgs({options:{source:{type:'string'},target:{type:'string'},query:{type:'string'}}});
const db=connect(values.source||paths.db);
try{
  const snapshotFile=path.join(ROOT,'public/listings/snapshot.json');
  const stats=synchronizeHousingIdentity(db,{snapshot:fs.existsSync(snapshotFile)?JSON.parse(fs.readFileSync(snapshotFile,'utf8')):undefined});
  const catalog=validateApartmentInformation(housingQueryInformation(publicApartmentInformation(db),housingIdentityCatalog(db)));
  atomicWrite(values.target||path.join(ROOT,'public/apartment-identity/catalog.json'),checkedBytes(JSON.stringify(catalog),secretValues(paths.env)));
  console.log(JSON.stringify({...stats,...(values.query?{matches:searchApartmentInformation(db,values.query).map(row=>({id:row.apartment_id,name:row.canonical_name,aliases:row.name_aliases,road:row.road_address,postalCode:row.postal_code,naverComplexNo:row.naver_complex_no}))}:{})},null,2));
}finally{db.close();}
