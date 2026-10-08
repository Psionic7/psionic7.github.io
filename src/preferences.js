import {useEffect,useState} from 'react';
import {hierarchy} from './domain.mjs';

export const PREFERENCES_KEY='home-records.preferences.v1';
const object=value=>value && typeof value==='object' && !Array.isArray(value);

function readDocument() {
  try {
    const raw=window.localStorage.getItem(PREFERENCES_KEY);
    if(!raw || raw.length>262144)return {version:1,scopes:{}};
    const value=JSON.parse(raw);
    if(value.version===1 && object(value.scopes))return value;
  }catch{}
  return {version:1,scopes:{}};
}

export function readPreferences(scope) {
  const value=readDocument().scopes[scope];
  return object(value)?value:{};
}

export function savePreferences(scope,value) {
  try {
    const document=readDocument();
    const entries=Object.entries(document.scopes).filter(([key,item])=>key!==scope && object(item));
    const persistent=new Set(['viewer','explorer','display','weekly','favoriteDashboard','transactionFilters']);
    const retained=entries.filter(([key])=>persistent.has(key));
    const scopes=[...retained,...entries.filter(([key])=>!persistent.has(key)).slice(-(79-retained.length))];
    scopes.push([scope,value]);
    window.localStorage.setItem(PREFERENCES_KEY,JSON.stringify({version:1,scopes:Object.fromEntries(scopes)}));
  }catch{}
}

export function clearPreferences() {
  try{window.localStorage.removeItem(PREFERENCES_KEY);}catch{}
}

export const textPreference=value=>typeof value==='string' && value.length<=200;
export const areaPreference=value=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100000;
export const unitPreference=value=>['m2','pyeong'].includes(value);

export function restoreExplorer(manifest,catalog,params) {
  const saved=readPreferences('explorer');
  const requested=(name,previous)=>params.has(name)?params.get(name):previous;
  const regionId=requested('region',saved.regionId);
  const region=catalog.find(item=>item.region_id===regionId);
  const sameRegion=region?.region_id===saved.regionId;
  const tab=requested('tab',saved.tab);
  const ids=params.has('dong')?params.getAll('dong'):saved.weeklyIds;
  const weeklyIds=Array.isArray(ids)?[...new Set(ids)].filter(id=>catalog.some(item=>item.region_id===id && item.dongs.length===1)):[];
  const locations=catalog.map(hierarchy);
  const province=locations.some(item=>item.province===saved.province)?saved.province:'';
  const city=locations.some(item=>(!province || item.province===province) && item.city===saved.city)?saved.city:'';
  const district=locations.some(item=>(!province || item.province===province) && (!city || item.city===city) && item.district===saved.district)?saved.district:'';
  let selectedApartment='';
  if(sameRegion && typeof saved.selectedApartment==='string' && saved.selectedApartment.length<1000) {
    try{const key=JSON.parse(saved.selectedApartment);if(Array.isArray(key) && key.length===3 && key.every(textPreference))selectedApartment=saved.selectedApartment;}catch{}
  }
  const newRegion=params.has('region') && !sameRegion;
  return {regionId:region?.region_id||'',tab:['dashboard','apartments','weekly','about'].includes(tab)?tab:'dashboard',
    weeklyIds,selectedApartment,province:newRegion?'':province,city:newRegion?'':city,district:newRegion?'':district,
    search:!newRegion && textPreference(saved.search)?saved.search:''};
}

// Small selections are saved after every change, before the next browser visit.
export function useStoredState(scope,field,fallback,validate) {
  const [value,setValue]=useState(()=>{
    const saved=readPreferences(scope)[field];
    return validate(saved)?saved:typeof fallback==='function'?fallback():fallback;
  });
  useEffect(()=>{
    savePreferences(scope,{...readPreferences(scope),[field]:value});
  },[scope,field,value]);
  return [value,setValue];
}
