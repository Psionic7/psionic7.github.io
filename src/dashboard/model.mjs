import {apartmentKey} from '../domain.mjs';
import {publishedDay,recentRange,weekBounds} from '../weekly.mjs';
export const overviewDurations=[7,30,90];
export const validOverviewDays=value=>overviewDurations.includes(value);
export function restoreOverviewDays(params,saved) {
  const requested=params.get('tab')==='dashboard'&&params.has('days')?Number(params.get('days')):saved;
  return validOverviewDays(requested)?requested:30;
}
const dayMs=86400000;
const shiftDay=(day,offset)=>new Date(new Date(day+'T00:00:00Z').getTime()+offset*dayMs).toISOString().slice(0,10);
const dayCount=range=>Math.round((new Date(range.end+'T00:00:00Z')-new Date(range.start+'T00:00:00Z'))/dayMs)+1;
const isLatest=(row,previous)=>!previous||row.deal_date>previous.deal_date||(row.deal_date===previous.deal_date&&Number(row.id)>Number(previous.id));
function coversRange(months,range) {
  if(!Array.isArray(months)||!range)return false;
  const date=new Date(range.start.slice(0,7)+'-01T00:00:00Z'),last=range.end.slice(0,7);
  while(date.toISOString().slice(0,7)<=last){if(!months.includes(date.toISOString().slice(0,7).replace('-','')))return false;date.setUTCMonth(date.getUTCMonth()+1);}
  return true;
}
export function buildOverview({manifest,regions,apartments,datasets,days=30}) {
  const latestDay=publishedDay(manifest.published_at),first=manifest.months[0],earliest=first?first.slice(0,4)+'-'+first.slice(4)+'-01':'';
  const range=recentRange(latestDay,days,earliest);
  if(!range)return null;
  const previous={start:shiftDay(range.start,-dayCount(range)),end:shiftDay(range.start,-1)};
  const create=(item,type)=>{
    const code=item.region_code,source=manifest.districts[code],dataset=datasets[code];
    const status=!source?'uncollected':dataset?.error?'error':Array.isArray(dataset?.rows)?'ready':'loading';
    return {item,type,status,count:0,previousCount:0,latest:null,partial:status==='ready'&&!coversRange(source.months,range),comparable:status==='ready'&&(!earliest||previous.start>=earliest)&&coversRange(source.months,range)&&coversRange(source.months,previous)};
  };
  const dongGroups=regions.map(item=>create(item,'dong')),apartmentGroups=apartments.map(item=>create(item,'apartment'));
  const dongIndex=new Map(),apartmentIndex=new Map(),codes=new Set();
  for(const group of dongGroups){codes.add(group.item.region_code);for(const dong of group.item.dongs){const key=group.item.region_code+'|'+dong;const matches=dongIndex.get(key)||[];matches.push(group);dongIndex.set(key,matches);}}
  for(const group of apartmentGroups){codes.add(group.item.region_code);for(const key of group.item.master_id?group.item.trade_keys:[group.item.key]){const id=group.item.region_code+'|'+key;const matches=apartmentIndex.get(id)||[];matches.push(group);apartmentIndex.set(id,matches);}}
  const recent=new Map(),dongTrades=new Set(),apartmentTrades=new Set(),uniqueTrades=new Set();let lastValid=null;
  for(const code of codes){
    const rows=datasets[code]?.rows;if(!manifest.districts[code]||!Array.isArray(rows))continue;
    for(const row of rows){
      if(row.region_code!==code||row.deal_date>latestDay)continue;
      const dongs=dongIndex.get(code+'|'+row.dong)||[],apts=apartmentIndex.size?apartmentIndex.get(code+'|'+apartmentKey(row))||[]:[];
      if((!dongs.length&&!apts.length)||!weekBounds(row.deal_date))continue;
      const valid=row.cancelled===0,inRange=row.deal_date>=range.start&&row.deal_date<=range.end,inPrevious=row.deal_date>=previous.start&&row.deal_date<=previous.end;
      if(valid&&isLatest(row,lastValid))lastValid=row;
      for(const group of [...dongs,...apts]){
        if(group.status!=='ready')continue;
        if(valid){if(isLatest(row,group.latest))group.latest=row;if(inRange)group.count++;if(inPrevious)group.previousCount++;}
      }
      if(!inRange)continue;
      const id=code+'|'+row.id;
      recent.set(id,{row,dongIds:dongs.map(group=>group.item.region_id),apartmentIds:apts.map(group=>group.item.id)});
      if(valid){uniqueTrades.add(id);if(dongs.length)dongTrades.add(id);if(apts.length)apartmentTrades.add(id);}
    }
  }
  const step=Math.max(1,Math.ceil(dayCount(range)/10)),trend=[];
  for(let start=range.start;start<=range.end;start=shiftDay(start,step)){const end=shiftDay(start,step-1);trend.push({start,end:end>range.end?range.end:end,count:0});}
  for(const {row} of recent.values())if(row.cancelled===0){const index=Math.floor((new Date(row.deal_date+'T00:00:00Z')-new Date(range.start+'T00:00:00Z'))/dayMs/step);trend[index].count++;}
  const readyCount=groups=>groups.filter(group=>group.status==='ready').length;
  const groups=[...dongGroups,...apartmentGroups];
  return {range,previous,latestDay,step,trend,dongGroups,apartmentGroups,lastValid,recent:[...recent.values()].sort((a,b)=>b.row.deal_date.localeCompare(a.row.deal_date)||Number(b.row.id)-Number(a.row.id)),dongCount:readyCount(dongGroups)?dongTrades.size:null,apartmentCount:readyCount(apartmentGroups)?apartmentTrades.size:null,uniqueCount:readyCount(groups)?uniqueTrades.size:null,ready:readyCount(groups),loading:groups.some(group=>group.status==='loading'),failed:groups.some(group=>group.status==='error'),uncollected:groups.filter(group=>group.status==='uncollected').length,partial:groups.some(group=>group.partial)};
}
