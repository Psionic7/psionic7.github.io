import {useEffect,useState} from 'react';
import {cachedJson} from './data.js';
import {validateApartmentInformation} from './apartment-identity.mjs';

export const loadApartmentInformation=async(version='')=>validateApartmentInformation(await cachedJson('/apartment-identity/catalog.json'+(version?'?v='+encodeURIComponent(version):''))).apartments;
const EMPTY=[];
export default function useApartmentInformation(version='') {
  const [information,setInformation]=useState({version:null,rows:EMPTY});
  useEffect(()=>{let active=true;loadApartmentInformation(version).then(rows=>{if(active)setInformation({version,rows});}).catch(()=>{});return()=>{active=false;};},[version]);
  return information.version===version?information.rows:EMPTY;
}
