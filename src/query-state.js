import {areaPreference,readPreferences,savePreferences,unitPreference} from './preferences.js';
import {validApartmentSelection} from './apartment-query.js';

// Explicit empty values in a shared link must override the recipient's filters.
export function applySharedFilters(params) {
  if(params.get('filters')!=='1'||!['weekly','apartments'].includes(params.get('tab')))return;
  const area=key=>!params.get(key)?'':areaPreference(Number(params.get(key)))?Number(params.get(key)):'';
  const bands=(params.get('bands')||'').split(',').filter(Boolean).map(Number);
  const scope=params.get('tab')==='weekly'?'weekly':'apartmentTransactions';
  const filters={
    minArea:area('min'),maxArea:area('max'),areaBands:[...new Set(bands.filter(value=>[10,20,30].includes(value)))],includeCancelled:params.get('cancelled')==='1',
    areaUnit:unitPreference(params.get('unit'))?params.get('unit'):readPreferences('display').areaUnit||'m2',
  };
  savePreferences(scope,{...readPreferences(scope),...filters});
  if(unitPreference(params.get('unit')))savePreferences('display',{...readPreferences('display'),areaUnit:params.get('unit')});
  return {scope,filters};
}
export function appendSharedFilters(params,filters) {
  params.set('filters','1');
  params.set('min',String(filters.minArea??''));params.set('max',String(filters.maxArea??''));
  params.set('bands',(filters.areaBands||[]).join(','));
  params.set('cancelled',filters.includeCancelled===false?'0':'1');
  params.set('unit',filters.areaUnit||'m2');
}
export function readSharedOverview(params,catalog) {
  if(params.get('view')!=='shared')return null;
  try {
    const apartments=params.getAll('viewApt').map(value=>JSON.parse(value));
    const ids=[...new Set(params.getAll('viewDong'))];
    if(ids.length>2000||!validApartmentSelection(apartments,catalog))return null;
    return {apartments,regions:ids.map(id=>catalog.find(item=>item.region_id===id&&item.dongs.length===1)).filter(Boolean)};
  }catch{return null;}
}
export function appendSharedOverview(params,overview) {
  params.set('view','shared');
  overview.regions.forEach(item=>params.append('viewDong',item.region_id));
  overview.apartments.forEach(item=>params.append('viewApt',JSON.stringify(item)));
}
