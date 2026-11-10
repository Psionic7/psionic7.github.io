import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,atomicWrite,checkedBytes,secretValues} from '../server/storage.mjs';
import {synchronizeHousingIdentity,publicApartmentInformation,searchApartmentInformation} from '../server/apartment-identity.mjs';
import {writeApartmentInformationFile} from '../server/apartment-information-files.mjs';
import {validateApartmentInformation} from '../src/apartment-identity.mjs';

const {values}=parseArgs({options:{source:{type:'string'},target:{type:'string'},query:{type:'string'}}});
const db=connect(values.source||paths.db);
try{
  const snapshotFile=path.join(ROOT,'public/listings/snapshot.json');
  const stats=synchronizeHousingIdentity(db,{snapshot:fs.existsSync(snapshotFile)?JSON.parse(fs.readFileSync(snapshotFile,'utf8')):undefined});
  const catalog=validateApartmentInformation(publicApartmentInformation(db));
  if(values.target?.endsWith('.json'))atomicWrite(values.target,checkedBytes(JSON.stringify(catalog),secretValues(paths.env)));
  else writeApartmentInformationFile(values.target||path.join(ROOT,'public'),catalog,{secrets:secretValues(paths.env)});
  console.log(JSON.stringify({...stats,...(values.query?{matches:searchApartmentInformation(db,values.query).map(row=>({id:row.apartment_id,name:row.canonical_name,aliases:row.name_aliases,road:row.road_address,postalCode:row.postal_code,naverComplexNo:row.naver_complex_no}))}:{})},null,2));
}finally{db.close();}
