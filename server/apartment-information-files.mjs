import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicWrite,checkedBytes} from './storage.mjs';
import {validateApartmentInformation} from '../src/apartment-identity.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function informationFolder(publicRoot){
 const folder=path.join(publicRoot,'apartment-identity');
 if(fs.existsSync(folder)&&fs.readdirSync(folder).some(file=>!/^catalog(?:-[a-f0-9]{12})?\.json$/.test(file)||!fs.statSync(path.join(folder,file)).isFile()))throw Error('공통 아파트 정보 폴더에 허용되지 않은 파일이 있습니다.');
 return folder;
}

export function readApartmentInformationFile(publicRoot,manifest,{required=false}={}){
 const folder=informationFolder(publicRoot),meta=manifest?.apartment_information;
 if(meta!==undefined){
  if(!meta||!/^catalog-[a-f0-9]{12}\.json$/.test(meta.file||'')||!hash(meta.sha256)||meta.file!==`catalog-${meta.sha256.slice(0,12)}.json`||!Number.isSafeInteger(meta.bytes)||meta.bytes<=0||meta.schema_version!==2||!hash(meta.generation)||meta.housing_sha256!==(manifest.housing?.sha256||null))throw Error('공통 아파트 정보의 경로·버전 연결을 확인하세요.');
  const file=path.join(folder,meta.file);
  if(!fs.existsSync(file))throw Error('공통 아파트 정보 파일이 없습니다. 자료를 다시 내보내세요.');
  const bytes=fs.readFileSync(file);
  if(bytes.length!==meta.bytes||digest(bytes)!==meta.sha256)throw Error('공통 아파트 정보 체크섬·크기 불일치');
  const catalog=validateApartmentInformation(JSON.parse(bytes));
  if(catalog.schema_version!==2||catalog.generation!==meta.generation)throw Error('공통 아파트 정보 생성 버전 불일치');
  return catalog;
 }
 const legacy=path.join(folder,'catalog.json');
 if(fs.existsSync(legacy))return validateApartmentInformation(JSON.parse(fs.readFileSync(legacy,'utf8')));
 if(required)throw Error('건축물대장 기반 조회에는 공통 아파트 정보가 필요합니다.');
 return null;
}

export function writeApartmentInformationFile(publicRoot,catalog,{housingSha256,secrets=[]}={}){
 validateApartmentInformation(catalog);
 if(catalog.schema_version!==2||!hash(catalog.generation)||housingSha256!==undefined&&housingSha256!==null&&!hash(housingSha256))throw Error('게시할 공통 아파트 정보의 생성 버전을 확인하세요.');
 const folder=informationFolder(publicRoot),bytes=checkedBytes(JSON.stringify(catalog),secrets),sha256=digest(bytes),file=`catalog-${sha256.slice(0,12)}.json`;
 atomicWrite(path.join(folder,file),bytes);
 return {file,sha256,bytes:bytes.length,schema_version:2,housing_sha256:housingSha256||null,generation:catalog.generation};
}
