import {useEffect,useState} from 'react';
import {cachedJson,fetchJson,jsonCharacterSize} from './data.js';
import {validateApartmentInformation} from './apartment-identity.mjs';
import {validApartmentInformationMetadata} from './manifest.mjs';
import {createJsonCache} from './json-cache.mjs';

export const apartmentInformationVersion=manifest=>manifest?.apartment_information?.sha256||manifest?.housing?.sha256||manifest?.published_at||'';
const metadataKey=source=>JSON.stringify({file:source?.file,sha256:source?.sha256,bytes:source?.bytes,schema_version:source?.schema_version,housing_sha256:source?.housing_sha256,generation:source?.generation});
const informationKey=source=>typeof source==='string'?'legacy:'+source:metadataKey(source);
const commonCatalog=createJsonCache(async key=>{
  const metadata=JSON.parse(key),value=validateApartmentInformation(await fetchJson('/apartment-identity/'+metadata.file,false,metadata));
  if(value.schema_version!==metadata.schema_version||value.generation!==metadata.generation)throw Error('공통 아파트 정보 생성 버전 불일치');
  return value;
},{maxEntries:2,maxCharacters:32*1024*1024,sizeOf:jsonCharacterSize});
export async function loadApartmentInformation(source=''){
  if(typeof source==='string')return validateApartmentInformation(await cachedJson('/apartment-identity/catalog.json'+(source?'?v='+encodeURIComponent(source):''))).apartments;
  if(!validApartmentInformationMetadata(source))throw Error('공통 아파트 정보의 경로·버전을 확인하세요.');
  return (await commonCatalog(metadataKey(source))).apartments;
}
const EMPTY=[];
export default function useApartmentInformation(source='') {
  const version=informationKey(source),[information,setInformation]=useState({version:null,rows:EMPTY});
  useEffect(()=>{let active=true;loadApartmentInformation(source).then(rows=>{if(active)setInformation({version,rows});}).catch(()=>{});return()=>{active=false;};},[version]);
  return information.version===version?information.rows:EMPTY;
}
