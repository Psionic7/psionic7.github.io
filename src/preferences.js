import {useEffect,useState} from 'react';
import {hierarchy} from './domain.mjs';
import {dateBounds,monthBounds,publishedDay,weekBounds} from './weekly.mjs';

export const PREFERENCES_KEY='home-records.preferences.v1';
const MAX_PREFERENCE_CHARACTERS=2*1024*1024;
const STORAGE_EVENT='home-records:storage-status';
let storageProblem='';
const reportStorageFailure=()=>{storageProblem='일부 설정을 이 브라우저에 저장하지 못했습니다. 저장 공간과 사이트 데이터 허용 설정을 확인해 주세요. 창을 닫으면 이번 변경이 남지 않을 수 있습니다.';window.dispatchEvent(new Event(STORAGE_EVENT));};
export const preferenceStorageProblem=()=>storageProblem;
export const subscribePreferenceStorage=listener=>{window.addEventListener(STORAGE_EVENT,listener);return()=>window.removeEventListener(STORAGE_EVENT,listener);};
const object=value=>value && typeof value==='object' && !Array.isArray(value);

function readDocument(strict=false) {
  try {
    const raw=window.localStorage.getItem(PREFERENCES_KEY);
    if(!raw)return {version:1,scopes:{}};
    if(raw.length>MAX_PREFERENCE_CHARACTERS)throw new Error('설정 크기 초과');
    const value=JSON.parse(raw);
    if(value.version===1 && object(value.scopes))return value;
  }catch(error){if(strict&&!(error instanceof SyntaxError))throw error;}
  return {version:1,scopes:{}};
}

export function readPreferences(scope) {
  const value=readDocument().scopes[scope];
  return object(value)?value:{};
}

export function savePreferences(scope,value) {
  try {
    const document=readDocument(true);
    const entries=Object.entries(document.scopes).filter(([key,item])=>key!==scope && object(item));
    const persistent=new Set(['viewer','explorer','display','weekly','favoriteDashboard','apartmentMap','regionMap','apartmentTransactions','apartmentSearch','overview']);
    const retained=entries.filter(([key])=>persistent.has(key));
    const scopes=[...retained,...entries.filter(([key])=>!persistent.has(key)).slice(-(79-retained.length))];
    scopes.push([scope,value]);
    return writeDocument({version:1,scopes:Object.fromEntries(scopes)});
  }catch{reportStorageFailure();return false;}
}

function writeDocument(document){
  const raw=JSON.stringify(document);
  if(raw.length>MAX_PREFERENCE_CHARACTERS)throw new Error('설정 크기 초과');
  window.localStorage.setItem(PREFERENCES_KEY,raw);return true;
}
export function clearPreferences() {
  try{window.localStorage.removeItem(PREFERENCES_KEY);storageProblem='';window.dispatchEvent(new Event(STORAGE_EVENT));}catch{reportStorageFailure();}
}
export const snapshotPreferences=()=>readDocument();
export function restorePreferences(document){try{return writeDocument(document);}catch{reportStorageFailure();return false;}}
export function resetQueries(){const document=readDocument();restorePreferences({version:1,scopes:{viewer:document.scopes.viewer||{}}});}
export function clearFavorites(){savePreferences('viewer',{...readPreferences('viewer'),apartments:[],regions:[]});}

export const textPreference=value=>typeof value==='string' && value.length<=200;
export const areaPreference=value=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100000;
export const unitPreference=value=>['m2','pyeong'].includes(value);

export function restoreExplorer(manifest,catalog,params) {
  const saved=readPreferences('explorer');
  const requested=(name,previous)=>params.has(name)?params.get(name):previous;
  const regionId=requested('region',saved.regionId);
  const region=catalog.find(item=>item.region_id===regionId);
  const months=manifest.districts[region?.region_code]?.months || manifest.months;
  const sameRegion=region?.region_id===saved.regionId;
  const requestedEnd=requested('end',sameRegion?saved.end:undefined);
  const end=months.includes(requestedEnd)?requestedEnd:months.at(-1)||'';
  const requestedStart=requested('start',sameRegion?saved.start:undefined);
  const start=months.includes(requestedStart) && requestedStart<=end?requestedStart:months.filter(month=>month<=end).slice(-12)[0]||'';
  const tab=requested('tab',saved.tab);
  const ids=params.has('dong')?params.getAll('dong'):saved.weeklyIds;
  const weeklyIds=Array.isArray(ids)?[...new Set(ids)].filter(id=>catalog.some(item=>item.region_id===id && item.dongs.length===1)):[];
  const latest=weekBounds(publishedDay(manifest.published_at))?.start||'';
  const first=manifest.months[0];
  const earliest=first?weekBounds(`${first.slice(0,4)}-${first.slice(4)}-01`)?.start:'';
  const sharedWeekly=!params.has('tab')||params.get('tab')==='weekly';
  const week=weekBounds(sharedWeekly?requested('week',saved.weeklyDay):saved.weeklyDay)?.start;
  const weeklyDay=week && (!earliest || week>=earliest) && (!latest || week<=latest)?week:latest;
  const lastDay=publishedDay(manifest.published_at),firstDay=first?`${first.slice(0,4)}-${first.slice(4)}-01`:'';
  const fallbackPeriod={mode:'week',month:lastDay.slice(0,7),start:firstDay&&weeklyDay<firstDay?firstDay:weeklyDay,end:lastDay};
  const sharedPeriod=sharedWeekly&&(params.has('period')||params.has('week'));
  const previousPeriod=object(saved.weeklyPeriod)?saved.weeklyPeriod:{};
  const mode=sharedPeriod?(params.get('period')||'week'):previousPeriod.mode;
  const getPeriod=(key,parameter)=>sharedPeriod?(params.get(parameter)||fallbackPeriod[key]):previousPeriod[key]||fallbackPeriod[key];
  const candidate={mode,month:getPeriod('month','month'),start:getPeriod('start','from'),end:getPeriod('end','to')};
  const validMonth=monthBounds(candidate.month)&&(!firstDay||candidate.month>=firstDay.slice(0,7))&&(!lastDay||candidate.month<=lastDay.slice(0,7));
  const validRange=dateBounds(candidate.start,candidate.end)&&(!firstDay||candidate.start>=firstDay)&&(!lastDay||candidate.end<=lastDay);
  const weeklyPeriod=['week','month','custom'].includes(mode)&&(mode!=='month'||validMonth)&&(mode!=='custom'||validRange)?{...candidate,month:validMonth?candidate.month:fallbackPeriod.month,start:validRange?candidate.start:fallbackPeriod.start,end:validRange?candidate.end:fallbackPeriod.end}:fallbackPeriod;
  const locations=catalog.map(hierarchy);
  const province=locations.some(item=>item.province===saved.province)?saved.province:'';
  const city=locations.some(item=>(!province || item.province===province) && item.city===saved.city)?saved.city:'';
  const district=locations.some(item=>(!province || item.province===province) && (!city || item.city===city) && item.district===saved.district)?saved.district:'';
  let selectedApartment='';
  if(sameRegion && typeof saved.selectedApartment==='string' && saved.selectedApartment.length<1000) {
    try{const key=JSON.parse(saved.selectedApartment);if(Array.isArray(key) && key.length===3 && key.every(textPreference))selectedApartment=saved.selectedApartment;}catch{}
  }
  const newRegion=params.has('region') && !sameRegion;
  return {regionId:region?.region_id||'',start,end,tab:['dashboard','apartments','weekly','map','regions','about'].includes(tab)?tab:'apartments',
    weeklyIds,weeklyDay,weeklyPeriod,selectedApartment,province:newRegion?'':province,city:newRegion?'':city,district:newRegion?'':district,
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
