import {useCallback,useEffect,useMemo,useState} from 'react';
import {PYEONG_M2} from './domain.mjs';
import {areaPreference,readPreferences,savePreferences,unitPreference} from './preferences.js';
import {dateBounds,monthBounds,periodBounds,publishedDay,weekBounds} from './weekly.mjs';
export const AREA_BANDS=[10,20,30];
const optionalArea=value=>value===''||areaPreference(value);
const validBands=value=>Array.isArray(value)&&value.length<=3&&new Set(value).size===value.length&&value.every(band=>AREA_BANDS.includes(band));
export function filterBounds(manifest) {
  const first=manifest.months[0];return {earliestDay:first?`${first.slice(0,4)}-${first.slice(4)}-01`:'',latestDay:publishedDay(manifest.published_at)};
}
export function restoreTransactionFilters(manifest,params=new URLSearchParams()) {
  const {earliestDay,latestDay}=filterBounds(manifest),latestWeek=weekBounds(latestDay)?.start||'';
  const explorer=readPreferences('explorer'),saved=readPreferences('transactionFilters').value;
  const tab=params.get('tab')||explorer.tab;
  const legacy=tab==='apartments'?{}:readPreferences(tab==='dashboard'?'favoriteDashboard':'weekly');
  const previous=saved&&typeof saved==='object'?saved:{day:tab==='dashboard'?legacy.day:explorer.weeklyDay,period:tab==='dashboard'?legacy.period:explorer.weeklyPeriod,minArea:legacy.minArea,maxArea:legacy.maxArea,areaBands:legacy.areaBands};
  const requestedDay=params.has('week')?params.get('week'):previous.day;
  const requestedWeek=weekBounds(requestedDay)?.start;
  const day=requestedWeek&&(!earliestDay||requestedWeek>=weekBounds(earliestDay).start)&&requestedWeek<=latestWeek?requestedWeek:latestWeek;
  const defaults={mode:'week',month:manifest.months.at(-1)?.replace(/^(\d{4})(\d{2})$/,'$1-$2')||latestDay.slice(0,7),start:earliestDay&&day<earliestDay?earliestDay:day,end:latestDay};
  const shared=params.has('period')||params.has('week');
  let period={...defaults,...previous.period};
  if(shared)period={...defaults,mode:params.get('period')||'week',month:params.get('month')||defaults.month,start:params.get('from')||defaults.start,end:params.get('to')||defaults.end};
  else if(params.has('start')&&params.has('end')){
    const from=monthBounds(params.get('start').replace(/^(\d{4})(\d{2})$/,'$1-$2')),to=monthBounds(params.get('end').replace(/^(\d{4})(\d{2})$/,'$1-$2'));
    if(from&&to)period={...defaults,mode:'custom',start:from.start,end:to.end>latestDay?latestDay:to.end};
  }else if(!saved&&tab==='apartments'&&explorer.start&&explorer.end){
    const from=monthBounds(explorer.start.replace(/^(\d{4})(\d{2})$/,'$1-$2')),to=monthBounds(explorer.end.replace(/^(\d{4})(\d{2})$/,'$1-$2'));
    if(from&&to)period={...defaults,mode:'custom',start:from.start,end:to.end>latestDay?latestDay:to.end};
  }
  const monthValid=!!monthBounds(period.month)&&(!earliestDay||period.month>=earliestDay.slice(0,7))&&period.month<=latestDay.slice(0,7);
  const rangeValid=!!dateBounds(period.start,period.end)&&(!earliestDay||period.start>=earliestDay)&&period.end<=latestDay;
  if(!['week','month','custom'].includes(period.mode)||period.mode==='month'&&!monthValid||period.mode==='custom'&&!rangeValid)period={...defaults};
  else period={...period,month:monthValid?period.month:defaults.month,start:rangeValid?period.start:defaults.start,end:rangeValid?period.end:defaults.end};
  const area=(field)=>{const candidate=params.has(field)?params.get(field)===''?'':Number(params.get(field)):previous[field];return optionalArea(candidate)?candidate:'';};
  let minArea=area('minArea'),maxArea=area('maxArea');
  if(!saved&&tab==='apartments'&&!params.has('minArea')&&explorer.selectedApartment){
    const exact=readPreferences('apartment:'+explorer.regionId+':'+explorer.selectedApartment).area;
    if(typeof exact==='string'&&exact!==''&&areaPreference(Number(exact)))minArea=maxArea=Number(exact);
  }
  const bands=params.has('bands')?(params.get('bands')?params.get('bands').split(',').map(Number):[]):previous.areaBands;
  const requestedUnit=params.has('unit')?params.get('unit'):saved?.areaUnit||readPreferences('display').areaUnit;
  return {day,period,minArea,maxArea,areaBands:validBands(bands)?bands:[],areaUnit:unitPreference(requestedUnit)?requestedUnit:'m2'};
}
export function areaMatches(row,filters) {
  return (filters.minArea===''||row.area_m2>=filters.minArea)&&(filters.maxArea===''||row.area_m2<=filters.maxArea)&&(!filters.areaBands.length||filters.areaBands.some(band=>row.area_m2>=band*PYEONG_M2&&row.area_m2<(band+10)*PYEONG_M2));
}
export function filterTransactions(rows,filters) {
  return filters.range?rows.filter(row=>row.deal_date>=filters.range.start&&row.deal_date<=filters.range.end&&areaMatches(row,filters)):[];
}
export function appendFilterParams(params,filters) {
  params.set('period',filters.period.mode);
  if(filters.period.mode==='week')params.set('week',filters.day);
  if(filters.period.mode==='month')params.set('month',filters.period.month);
  if(filters.period.mode==='custom'){params.set('from',filters.period.start);params.set('to',filters.period.end);}
  params.set('minArea',filters.minArea);params.set('maxArea',filters.maxArea);params.set('bands',filters.areaBands.join(','));params.set('unit',filters.areaUnit);
}
export function useTransactionFilters(manifest,initialValue) {
  const [value,setValue]=useState(()=>initialValue||restoreTransactionFilters(manifest,new URLSearchParams(window.location.search)));
  const update=useCallback(patch=>setValue(previous=>({...previous,...(typeof patch==='function'?patch(previous):patch)})),[]);
  useEffect(()=>{savePreferences('transactionFilters',{value});savePreferences('display',{...readPreferences('display'),areaUnit:value.areaUnit});},[value]);
  const {earliestDay,latestDay}=filterBounds(manifest);
  return useMemo(()=>{
    const requestedRange=periodBounds(value.period,value.day);let periodError=!requestedRange?'올바른 조회 날짜를 선택해 주세요.':'';
    if(value.period.mode==='custom'&&value.period.start&&value.period.end&&value.period.start>value.period.end)periodError='조회 시작일은 종료일보다 늦을 수 없습니다.';
    if(requestedRange&&value.period.mode==='custom'&&((earliestDay&&requestedRange.start<earliestDay)||(latestDay&&requestedRange.end>latestDay)))periodError='공개 자료 범위 안에서 시작일과 종료일을 선택해 주세요.';
    if(requestedRange&&value.period.mode==='month'&&((earliestDay&&value.period.month<earliestDay.slice(0,7))||(latestDay&&value.period.month>latestDay.slice(0,7))))periodError='공개 자료 범위 안에서 조회 월을 선택해 주세요.';
    return {...value,update,earliestDay,latestDay,range:periodError?null:requestedRange,periodError,areaFiltered:value.minArea!==''||value.maxArea!==''||value.areaBands.length>0,invalidArea:value.minArea!==''&&value.maxArea!==''&&value.minArea>value.maxArea};
  },[value,update,earliestDay,latestDay]);
}
