// Compare multisets: identical-looking contracts may be separate transactions.
const fields=['region_code','deal_month','deal_date','apartment','dong','jibun','price_man','area_m2','floor','build_year'];
export const cancellationDay=row=>String(row.raw?.cdealDay||'').trim();
export function tradeSignature(row,{includeId=false,includeStatus=true,compact=false}={}){
  return JSON.stringify([...(includeId?[row.id]:[]),...fields.filter(field=>!compact||field!=='build_year').map(field=>row[field]??null),...(includeStatus?[row.cancelled,cancellationDay(row)]:[])]);
}
export function reconcileTrades(expected,actual,options={}){
  const remaining=new Map();
  for(const row of actual){const key=tradeSignature(row,options),items=remaining.get(key)||[];items.push(row);remaining.set(key,items);}
  const missing=[];
  for(const row of expected){const items=remaining.get(tradeSignature(row,options));if(items?.length)items.pop();else missing.push(row);}
  return {expected:expected.length,actual:actual.length,missing,extra:[...remaining.values()].flat()};
}
export function statusChanges(missing,extra){
  const byCore=new Map();for(const row of extra){const key=tradeSignature(row,{includeStatus:false}),items=byCore.get(key)||[];items.push(row);byCore.set(key,items);}
  const changes=[],unmatched=[];
  for(const row of missing){const items=byCore.get(tradeSignature(row,{includeStatus:false}));if(items?.length)changes.push({expected:row,actual:items.pop()});else unmatched.push(row);}
  return {changes,missing:unmatched,extra:[...byCore.values()].flat()};
}
export const tradeSample=row=>Object.fromEntries(['region_code','deal_month','deal_date','apartment','dong','jibun','price_man','area_m2','floor','build_year','cancelled'].map(field=>[field,row[field]??null]).concat([['cancellation_day',cancellationDay(row)]]));
export function auditProblems(report) {
  const issues=[...(report.errors||[])];
  for(const section of ['pipeline','archived','upstream'])for(const row of report[section]||[]) {
    const archiveMismatch=section==='archived'&&(row.api_count!==row.stored_count||row.api_count!==row.parsedItems||row.stored_count!==row.actualRows);
    if(row.error||row.errors||row.missing||row.extra||row.missingLive||row.extraLive||row.statusChanges||row.missingLocal||row.extraLocal||row.issues?.length||row.missingMonths?.length||row.countsConsistent===false||row.repeatedPages||archiveMismatch)issues.push({section,...row});
  }
  for(const row of report.coverage||[])if(row.liveCount!==row.declared)issues.push({section:'coverage',...row});
  for(const key of ['missing','ambiguous'])for(const row of report.search?.[key]||[])issues.push({section:'search-'+key,...row});
  return issues;
}
