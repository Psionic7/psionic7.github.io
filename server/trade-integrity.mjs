import {createHash} from 'node:crypto';

export const normalizedTradeFields=['region_code','deal_month','deal_date','apartment','dong','jibun','price_man','area_m2','floor','build_year','cancelled'];
const browserFields=normalizedTradeFields.filter(key=>key!=='build_year');
const ordered=value=>Object.keys(value).sort().map(key=>[key,value[key]]);
export function tradeDigest(row,{includeId=true,compact=false,includeAddress=false}={}) {
  const required=[...(includeId?['id']:[]),...(compact?browserFields:normalizedTradeFields),...(compact||includeAddress?['road_address']:[])];
  if(required.some(key=>!Object.hasOwn(row,key)))throw new Error('데이터 검증 실패: 거래 필수 필드 누락');
  const raw=row.raw??JSON.parse(row.raw_json);
  const values=[...(includeId?[row.id]:[]),...(compact?browserFields:normalizedTradeFields).map(key=>row[key]??null)];
  values.push(...(compact?[row.road_address||'',raw.cdealDay||'']:[ordered(raw)]));
  if(includeAddress&&!compact)values.push(row.road_address||'');
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

// Count occurrences, not unique keys: identical contracts must stay separate.
export function assertTradeRows(expected,actual,{scope='거래',...options}={}) {
  const counts=new Map();let expectedCount=0,actualCount=0,extra=0;
  for(const row of expected){const key=tradeDigest(row,options);counts.set(key,(counts.get(key)||0)+1);expectedCount++;}
  for(const row of actual){const key=tradeDigest(row,options),count=counts.get(key)||0;actualCount++;if(!count)extra++;else if(count===1)counts.delete(key);else counts.set(key,count-1);}
  const missing=[...counts.values()].reduce((sum,count)=>sum+count,0);
  if(missing||extra)throw new Error(`데이터 검증 실패: ${scope} 누락 ${missing}건 / 초과·변경 ${extra}건 (예상 ${expectedCount}, 실제 ${actualCount})`);
  return actualCount;
}

export function assertSameValues(expected,actual,scope) {
  const signature=rows=>rows.map(ordered).map(row=>JSON.stringify(row)).sort();
  if(JSON.stringify(signature(expected))!==JSON.stringify(signature(actual)))throw new Error(`데이터 검증 실패: ${scope} 불일치`);
}
