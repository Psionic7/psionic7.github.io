import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {currentMonth,fetchMolitMonth,fetchMolitPage,MOLIT_ENDPOINTS,normalize} from '../server/collector.mjs';
import {normalizedTradeFields,tradeComparisonDigest} from '../server/trade-integrity.mjs';
import {atomicWrite,checkedBytes,connect,paths,ROOT,serviceKey} from '../server/storage.mjs';

export function compareDetailedTrades(existing,items,code,month) {
  const byContract=new Map();
  function contract(key) {
    if(!byContract.has(key))byContract.set(key,{tradeIds:[],detailedRows:[],providerIds:new Set(),existingProviderIds:new Set(),missingId:false});
    return byContract.get(key);
  }

  for(const row of existing) {
    const entry=contract(tradeComparisonDigest(row));
    entry.tradeIds.push(row.id);
    const id=JSON.parse(row.raw_json).aptSeq?.trim();
    if(id)entry.existingProviderIds.add(id);
  }
  for(const [index,item] of items.entries()) {
    const values=normalize(item,code,month);
    const row=Object.fromEntries(normalizedTradeFields.map((field,i)=>[field,values[i]]));
    const entry=contract(tradeComparisonDigest({...row,raw:item}));
    entry.detailedRows.push(index+1);
    if(item.aptSeq?.trim())entry.providerIds.add(item.aptSeq);
    else entry.missingId=true;
  }

  const candidates=[],unresolved=[];
  for(const {tradeIds,detailedRows,providerIds,existingProviderIds,missingId} of byContract.values()) {
    const observation={tradeIds,detailedRows,aptSeqValues:[...providerIds].sort()};
    let reason;
    if(!tradeIds.length)reason='detailed_only';
    else if(!detailedRows.length)reason='basic_only';
    else if(tradeIds.length!==detailedRows.length)reason='count_mismatch';
    else if(providerIds.size>1)reason='conflicting_apt_seq';
    else if([...existingProviderIds].some(id=>!providerIds.has(id)))reason='conflicting_existing_apt_seq';
    else if(missingId)reason='missing_apt_seq';
    if(reason)unresolved.push({...observation,reason});
    else candidates.push({tradeIds,detailedRows,provider:'molit',provider_apartment_id:observation.aptSeqValues[0]});
  }

  return {
    existingRows:existing.length,
    detailedRows:items.length,
    candidateTradeRows:candidates.reduce((sum,row)=>sum+row.tradeIds.length,0),
    unresolvedTradeRows:unresolved.reduce((sum,row)=>sum+row.tradeIds.length,0),
    unresolvedDetailedRows:unresolved.reduce((sum,row)=>sum+row.detailedRows.length,0),
    candidates,
    unresolved,
  };
}

export async function compareMolitMonth({database=paths.db,key=serviceKey(),code='41135',month=currentMonth(),fetcher=fetch,signal,pause}={}) {
  const fetched=await fetchMolitMonth(key,code,month,{
    signal,pause,
    fetcher:(key,code,month,page,signal)=>fetchMolitPage({service:'detailed',key,code,month,page,signal,fetcher}),
  });
  const db=connect(database,true);
  try {
    const rows=db.prepare('SELECT * FROM trades WHERE region_code=? AND deal_month=? ORDER BY id').all(code,month);
    return {
      version:1,provider:'molit',endpoint:MOLIT_ENDPOINTS.detailed,regionCode:code,month,observedAt:new Date().toISOString(),total:fetched.total,
      pages:fetched.pages.map(([pageNo,xml])=>({pageNo,xml:xml.toString('utf8')})),
      comparison:compareDetailedTrades(rows,fetched.items,code,month),
    };
  }finally{db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const {values}=parseArgs({options:{database:{type:'string'},'region-code':{type:'string',default:'41135'},month:{type:'string',default:currentMonth()},output:{type:'string'}}});
    const timestamp=new Date().toISOString().replaceAll(':','-');
    const filename=path.resolve(values.output||path.join(ROOT,'local/molit-detailed',`${values['region-code']}-${values.month}-${timestamp}.json`));
    if(!filename.startsWith(path.join(ROOT,'local')+path.sep))throw Error('대조 결과는 local 디렉터리에 저장하세요.');
    const result=await compareMolitMonth({database:values.database,code:values['region-code'],month:values.month});
    atomicWrite(filename,checkedBytes(JSON.stringify(result,null,2)+'\n'));
    const {candidates,unresolved,...counts}=result.comparison;
    console.log(JSON.stringify({...counts,pages:result.pages.length,output:filename},null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
