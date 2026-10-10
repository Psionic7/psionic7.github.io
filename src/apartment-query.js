import {makeApartmentFavorite,validApartmentFavorites,sameApartmentFavorite} from './apartment-favorites.js';
import {readPreferences,textPreference} from './preferences.js';
import {publishedDay,weekBounds,monthBounds,dateBounds} from './weekly.mjs';
export function validApartmentSelection(value,catalog) {
  return validApartmentFavorites(value)&&value.every(item=>catalog.some(region=>region.region_code===item.region_code))&&value.every((item,index)=>!value.slice(0,index).some(other=>sameApartmentFavorite(other,item)));
}
export function apartmentQueryRegion(item) {
  return {...item,region_id:item.id,label:item.apartment+' · '+item.region_name+' '+item.dong+' · 지번 '+(item.jibun||'미상'),dongs:item.master_id?[...new Set([item.dong,...item.trade_keys.map(key=>JSON.parse(key)[0])])]:[item.dong]};
}
export function restoreApartmentQuery(manifest,catalog,params,favorites) {
  const saved=readPreferences('apartmentTransactions'),legacy=readPreferences('favoriteDashboard'),explorer=readPreferences('explorer');
  const current=!params.has('tab')||params.get('tab')==='apartments';
  const requested=current?params:new URLSearchParams();
  const regionId=requested.has('region')?requested.get('region'):saved.regionId??explorer.regionId;
  const region=catalog.find(item=>item.region_id===regionId);
  let selected=validApartmentSelection(saved.selected,catalog)?saved.selected:[];
  if(requested.has('apt')) {
    try{const values=requested.getAll('apt').filter(Boolean);if(values.length>1000||values.some(value=>value.length>262144))throw new Error();const items=values.map(value=>JSON.parse(value));selected=validApartmentSelection(items,catalog)?items:[];}catch{selected=[];}
  }else if(requested.has('region'))selected=[];
  else if(!Array.isArray(saved.selected)) {
    if(region&&explorer.selectedApartment){try{const [dong,jibun,apartment]=JSON.parse(explorer.selectedApartment);const item=makeApartmentFavorite({dong,jibun,apartment},region);if(validApartmentSelection([item],catalog))selected=[item];}catch{}}
    else if(requested.get('tab')==='dashboard'||explorer.tab==='dashboard')selected=favorites.filter(item=>catalog.some(region=>region.region_code===item.region_code));
  }
  const latest=publishedDay(manifest.published_at),first=manifest.months[0],earliest=first?first.slice(0,4)+'-'+first.slice(4)+'-01':'';
  const lastWeek=weekBounds(latest)?.start||'',candidateDay=weekBounds(requested.get('week')||saved.day||legacy.day)?.start;
  const day=candidateDay&&(!earliest||candidateDay>=weekBounds(earliest).start)&&candidateDay<=lastWeek?candidateDay:lastWeek;
  const fallback={mode:'week',month:latest.slice(0,7),start:earliest&&day<earliest?earliest:day,end:latest};
  const shared=requested.has('period')||requested.has('week');let candidate=shared?{mode:requested.get('period')||'week',month:requested.get('month')||fallback.month,start:requested.get('from')||fallback.start,end:requested.get('to')||fallback.end}:{...fallback,...(saved.period||legacy.period)};
  if(!shared&&(requested.has('start')||requested.has('end'))){const start=monthBounds((requested.get('start')||'').replace(/^(\d{4})(\d{2})$/,'$1-$2')),end=monthBounds((requested.get('end')||'').replace(/^(\d{4})(\d{2})$/,'$1-$2'));if(start&&end)candidate={...fallback,mode:'custom',start:start.start,end:end.end>latest?latest:end.end};}
  const month=monthBounds(candidate.month)&&(!earliest||candidate.month>=earliest.slice(0,7))&&candidate.month<=latest.slice(0,7)?candidate.month:fallback.month;
  const validRange=dateBounds(candidate.start,candidate.end)&&(!earliest||candidate.start>=earliest)&&candidate.end<=latest;
  const period=['week','month','custom'].includes(candidate.mode)&&(candidate.mode!=='custom'||validRange)&&(candidate.mode!=='month'||month===candidate.month)?{...candidate,month,start:validRange?candidate.start:fallback.start,end:validRange?candidate.end:fallback.end}:fallback;
  const emptyFilters={province:'',city:'',district:'',search:''},previous=readPreferences('apartmentSearch').filters||explorer;
  const filters=requested.has('region')&&requested.get('region')!==(saved.regionId??explorer.regionId)?emptyFilters:{...emptyFilters,...Object.fromEntries(Object.keys(emptyFilters).filter(key=>textPreference(previous[key])).map(key=>[key,previous[key]]))};
  return {selected,regionId:region?.region_id||'',day,period,filters};
}
export function appendTransactionPeriod(params,period,day) {
  params.set('period',period.mode);
  if(period.mode==='week'&&day)params.set('week',day);
  if(period.mode==='month')params.set('month',period.month);
  if(period.mode==='custom'){params.set('from',period.start);params.set('to',period.end);}
}
