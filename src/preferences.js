import {useEffect,useState} from 'react';
import {hierarchy} from './domain.mjs';
import {dateBounds,monthBounds,publishedDay,weekBounds} from './weekly.mjs';

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
    const persistent=new Set(['viewer','explorer','display','weekly','favoriteDashboard','apartmentMap']);
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
  const week=weekBounds(requested('week',saved.weeklyDay))?.start;
  const weeklyDay=week && (!earliest || week>=earliest) && (!latest || week<=latest)?week:latest;
  const lastDay=publishedDay(manifest.published_at),firstDay=first?`${first.slice(0,4)}-${first.slice(4)}-01`:'';
  const fallbackPeriod={mode:'week',month:lastDay.slice(0,7),start:firstDay&&weeklyDay<firstDay?firstDay:weeklyDay,end:lastDay};
  const sharedPeriod=params.has('period')||params.has('week');
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
  return {regionId:region?.region_id||'',start,end,tab:['dashboard','apartments','weekly','map','about'].includes(tab)?tab:'dashboard',
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
