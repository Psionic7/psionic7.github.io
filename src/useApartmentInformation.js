import {useEffect,useState} from 'react';
import {cachedJson} from './data.js';
import {validateApartmentInformation} from './apartment-identity.mjs';

export const loadApartmentInformation=async()=>validateApartmentInformation(await cachedJson('/apartment-identity/catalog.json')).apartments;
const EMPTY=[];
export default function useApartmentInformation() {
  const [information,setInformation]=useState(EMPTY);
  useEffect(()=>{let active=true;loadApartmentInformation().then(rows=>{if(active)setInformation(rows);}).catch(()=>{});return()=>{active=false;};},[]);
  return information;
}
