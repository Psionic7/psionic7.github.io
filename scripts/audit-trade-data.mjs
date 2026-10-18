import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,paths,connect,serviceKey} from '../server/storage.mjs';
import {fetchPage,normalize,parsePage,monthsBetween,currentMonth} from '../server/collector.mjs';
import {reconcileTrades,statusChanges,tradeSample,tradeSignature,auditProblems} from '../server/trade-audit.mjs';
import {apartmentKey} from '../src/domain.mjs';
import {weeklyResultRows} from '../src/weekly/query.mjs';
import {monthBounds,publishedDay} from '../src/weekly.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const normalFields=['region_code','deal_month','deal_date','apartment','dong','jibun','price_man','area_m2','floor','build_year','cancelled','raw_json'];
const fromRaw=(item,code,month)=>{const values=normalize(item,code,month),row=Object.fromEntries(normalFields.map((field,index)=>[field,values[index]]));row.raw={cdealDay:item.cdealDay||''};delete row.raw_json;return row;};
const compact=row=>({...Object.fromEntries(['id',...normalFields.filter(field=>field!=='raw_json')].map(field=>[field,row[field]])),raw:{cdealDay:row.raw?.cdealDay||''}});
const groupMonths=rows=>{const groups=new Map();for(const row of rows){const list=groups.get(row.deal_month)||[];list.push(row);groups.set(row.deal_month,list);}return groups;};
const summary=diff=>({expected:diff.expected,actual:diff.actual,missing:diff.missing.length,extra:diff.extra.length,missingSamples:diff.missing.slice(0,8).map(tradeSample),extraSamples:diff.extra.slice(0,8).map(tradeSample)});

export async function auditTradeData({folder=path.join(ROOT,'local/data-audit-'+publishedDay(new Date().toISOString())),base='https://psionic7.github.io',upstream=false,reuseUpstreamCache=false,concurrency=4}={}){
  const origin=new URL(base);
  if(origin.username||origin.password||!['https:','http:'].includes(origin.protocol))throw new Error('Audit base URL must be a public or local HTTP origin');
  base=origin.origin;
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('Audit concurrency must be between 1 and 8');
  fs.mkdirSync(folder,{recursive:true});const cache=path.join(folder,'cache');fs.mkdirSync(cache,{recursive:true});
  const report={startedAt:new Date().toISOString(),base,readOnly:true,local:{},live:{},pipeline:[],coverage:[],archived:[],upstream:[],errors:[]};
  const save=()=>fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));
  const json=async(url,{sha256,fresh=false}={})=>{
    const file=path.join(cache,(sha256||digest(url))+'.json');
    if(!fresh&&fs.existsSync(file)){try{const bytes=fs.readFileSync(file);if(!sha256||digest(bytes)===sha256)return JSON.parse(bytes);}catch{/* Resume an interrupted cache write by fetching it again. */}}
    for(let attempt=0;attempt<3;attempt++){
      try{
        const response=await fetch(url,{cache:'no-store',headers:{'User-Agent':'home-records-data-audit'},signal:AbortSignal.timeout(60000)});
        if(!response.ok)throw new Error('Public file HTTP '+response.status+' '+new URL(url).pathname);
        const bytes=Buffer.from(await response.arrayBuffer());if(sha256&&digest(bytes)!==sha256)throw new Error('Public file checksum '+new URL(url).pathname);
        const data=JSON.parse(bytes);fs.writeFileSync(file,bytes);return data;
      }catch(error){if(attempt===2)throw error;await delay(500*(attempt+1));}
    }
  };
  const db=connect(paths.db,true),local=read(path.join(ROOT,'public/data/manifest.json')),docs=read(path.join(ROOT,'docs/data/manifest.json'));
  const liveGroups=new Map(),localGroups=new Map();
  try{
    const live=await json(base+'/data/manifest.json',{fresh:true});fs.writeFileSync(path.join(folder,'live-manifest.json'),JSON.stringify(live));
    report.local={published_at:local.published_at,count:local.count,docsCount:docs.count,manifestIdentical:JSON.stringify(local)===JSON.stringify(docs),integrity:db.prepare('PRAGMA quick_check').get()};
    report.live={published_at:live.published_at,exported_at:live.exported_at,count:live.count,checkedAt:new Date().toISOString()};
    const codes=[...new Set([...Object.keys(local.districts),...Object.keys(live.districts)])];
    for(const code of codes){
      const source=db.prepare('SELECT * FROM trades WHERE region_code=?').all(code).map(({raw_json,...row})=>({...row,raw:JSON.parse(raw_json)}));
      const exported=read(path.join(ROOT,'public/data',local.districts[code].file));
      const built=read(path.join(ROOT,'docs/data',docs.districts[code].file));
      report.pipeline.push({scope:'local-db-to-public',code,...summary(reconcileTrades(source,exported,{includeId:true}))});
      report.pipeline.push({scope:'public-to-docs',code,...summary(reconcileTrades(exported,built,{includeId:true}))});
      const published=await json(base+'/data/'+live.districts[code].file,{sha256:live.districts[code].sha256});
      const liveRows=published.map(compact),localRows=source.map(compact);liveGroups.set(code,groupMonths(liveRows));localGroups.set(code,groupMonths(localRows));
      report.pipeline.push({scope:'local-vs-live-different-snapshots',code,...summary(reconcileTrades(localRows,liveRows))});
      const normalizedErrors=[];for(const row of source){try{if(tradeSignature(fromRaw(row.raw,code,row.deal_month))!==tradeSignature(row))normalizedErrors.push(tradeSample(row));}catch(error){normalizedErrors.push({...tradeSample(row),error:error.message});}}
      report.pipeline.push({scope:'raw-fields-to-normalized',code,rows:source.length,errors:normalizedErrors.length,samples:normalizedErrors.slice(0,8)});
      const rawDongCounts=new Map();for(const row of liveRows)rawDongCounts.set(row.dong,(rawDongCounts.get(row.dong)||0)+1);
      const knownDongs=new Set(live.regions.filter(region=>region.region_code===code).flatMap(region=>region.dongs));
      report.coverage.push({code,liveCount:liveRows.length,declared:live.districts[code].count,dongs:[...rawDongCounts].map(([dong,count])=>({dong,count,hasCatalogRegion:knownDongs.has(dong)})),missingMonths:monthsBetween('200010',currentMonth()).filter(month=>!liveGroups.get(code).has(month))});
      const runs=db.prepare('SELECT * FROM collection_runs WHERE region_code=? ORDER BY deal_month,id').all(code),latest=new Map();for(const run of runs)latest.set(run.deal_month,run);
      for(const [month,run]of latest){
        const pages=db.prepare('SELECT page_no,response_xml FROM api_pages WHERE run_id=? ORDER BY page_no').all(run.id),items=[],counts=[],signatures=[];
        let error;try{for(const page of pages){const parsed=parsePage(Buffer.from(page.response_xml).toString());counts.push(parsed.total);signatures.push(digest(JSON.stringify(parsed.items)));items.push(...parsed.items.map(item=>fromRaw(item,code,month)));}}catch(reason){error=reason.message;}
        const rows=localGroups.get(code).get(month)||[],diff=reconcileTrades(items,rows);
        report.archived.push({code,month,fetched_at:run.fetched_at,api_count:run.api_count,stored_count:run.stored_count,actualRows:rows.length,pages:pages.length,parsedItems:items.length,countsConsistent:counts.every(count=>count===run.api_count),repeatedPages:signatures.length-new Set(signatures).size,error,...summary(diff)});
      }
      console.log('Local/archive comparison '+code+' complete');save();
    }
    const registry=await json(base+'/query-data/manifest.json',{fresh:true}),mastersMeta=await json(base+'/apartment-map/manifest.json',{fresh:true}),masters=await json(base+'/apartment-map/'+mastersMeta.apartments.file,{sha256:mastersMeta.apartments.sha256});
    const search=registry.search?await json(base+'/query-data/'+registry.search.file,{sha256:registry.search.sha256}):[];
    const searchable=new Map();for(const item of search)for(const key of item.master_id?item.trade_keys:[item.key]){const id=item.region_code+'|'+key;const entries=searchable.get(id)||[];entries.push(item.id);searchable.set(id,entries);}
    report.search={items:search.length,masters:masters.length,missing:[],ambiguous:[],masterTradeCoverage:[]};
    if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='apartment_trade_links'").get()){
      const counts=new Map(),masterIds=new Map(masters.map(item=>[item.id,item]));
      for(const [code,groups]of liveGroups)for(const rows of groups.values())for(const row of rows){const key=code+'|'+apartmentKey(row);counts.set(key,(counts.get(key)||0)+1);}
      report.search.localRegistryLinks=db.prepare("SELECT * FROM apartment_trade_links WHERE status!='matched'").all().map(link=>{
        const key=JSON.stringify([link.dong,link.jibun,link.trade_name]);
        return {code:link.region_code,dong:link.dong,jibun:link.jibun,apartment:link.trade_name,status:link.status,updated_at:link.updated_at,liveTrades:counts.get(link.region_code+'|'+key)||0,
          publishedCandidates:JSON.parse(link.candidates_json).filter(id=>masterIds.has(id)),linkedByPublishedMaster:masters.some(item=>item.region_code===link.region_code&&item.trade_keys?.includes(key))};
      });
    }
    for(const [code,groups]of liveGroups){
      const meta=live.districts[code].browser||registry.districts[code],index=await json(base+'/query-data/'+meta.file,{sha256:meta.sha256});
      const allKeys=new Map();for(const rows of groups.values())for(const row of rows){const key=apartmentKey(row);allKeys.set(key,(allKeys.get(key)||0)+1);}
      for(const [key,count]of allKeys){const matches=searchable.get(code+'|'+key)||[];if(!matches.length)report.search.missing.push({code,key,count});if(matches.length>1)report.search.ambiguous.push({code,key,count,matches});}
      report.pipeline.push({scope:'live-full-to-catalog-identities',code,expected:allKeys.size,actual:index.catalog.length,missing:[...allKeys.keys()].filter(key=>!index.catalog.some(row=>apartmentKey(row)===key)).length});
      const months=Object.entries(index.months),shardResults=[];let next=0;
      await Promise.all(Array.from({length:concurrency},async()=>{while(next<months.length){const [month,file]=months[next++];try{const rows=await json(base+'/query-data/'+file,{sha256:undefined});if(!file.endsWith(digest(JSON.stringify(rows)).slice(0,12)+'.json'))throw new Error('Browser shard checksum');
        const expected=groups.get(month)||[],diff=reconcileTrades(expected,rows,{includeId:true,compact:true});
        shardResults.push({month,...summary(diff)});
        const dongs=[...new Set(expected.map(row=>row.dong))];let omissions=0;for(const dong of dongs){const filtered=weeklyResultRows(rows,{region_code:code,dongs:[dong]},monthBounds(month.slice(0,4)+'-'+month.slice(4)),{includeCancelled:true});omissions+=expected.filter(row=>row.dong===dong).length-filtered.length;}
        if(omissions)report.errors.push({scope:'unfiltered-dong-query',code,month,omissions});
      }catch(error){shardResults.push({month,error:error.message});}}}));
      report.pipeline.push({scope:'live-full-to-browser-months',code,months:months.length,rows:shardResults.reduce((sum,item)=>sum+(item.actual||0),0),missingMonths:[...groups.keys()].filter(month=>!index.months[month]),issues:shardResults.filter(item=>item.error||item.missing||item.extra)});
      for(const master of masters.filter(item=>item.region_code===code)){const counts=(master.trade_keys||[]).reduce((sum,key)=>sum+(allKeys.get(key)||0),0);report.search.masterTradeCoverage.push({id:master.id,apartment:master.apartment,dong:master.dong,jibun:master.jibun,keys:master.trade_keys?.length||0,linkedTrades:counts});}
      console.log('Live/browser/search comparison '+code+' complete');save();
    }
    if(upstream){
      const key=serviceKey();if(!key)throw new Error('MOLIT_SERVICE_KEY is unavailable');
      const tasks=codes.flatMap(code=>monthsBetween('200010',currentMonth()).map(month=>({code,month}))).sort((a,b)=>b.month.localeCompare(a.month)||a.code.localeCompare(b.code));
      let next=0,done=0;report.upstreamScope={start:'200010',end:currentMonth(),districts:codes,totalMonths:tasks.length};
      await Promise.all(Array.from({length:concurrency},async()=>{while(next<tasks.length){const {code,month}=tasks[next++],file=path.join(cache,'upstream-'+code+'-'+month+'.json');try{
        let snapshot;if(reuseUpstreamCache&&fs.existsSync(file))snapshot=read(file);else{
          let total=null;const rows=[],pageHashes=[];
          for(let page=1;page<=1000;page++){const response=await fetchPage(key,code,month,page);if(total!==null&&response.total!==total)throw new Error('API total changed while paging');total=response.total;
            const hash=digest(JSON.stringify(response.items));if(response.items.length&&pageHashes.includes(hash))throw new Error('API repeated a page');pageHashes.push(hash);rows.push(...response.items.map(item=>fromRaw(item,code,month)));
            if(rows.length===total)break;if(!response.items.length||rows.length>total||page===1000)throw new Error('API page count mismatch');await delay(150);
          }
          snapshot={code,month,fetched_at:new Date().toISOString(),total,pages:pageHashes.length,rows};fs.writeFileSync(file,JSON.stringify(snapshot));
        }
        const liveRows=liveGroups.get(code).get(month)||[],localRows=localGroups.get(code).get(month)||[],diff=reconcileTrades(snapshot.rows,liveRows),status=statusChanges(diff.missing,diff.extra);
        const localDiff=reconcileTrades(snapshot.rows,localRows);
        report.upstream.push({code,month,fetched_at:snapshot.fetched_at,sourceCount:snapshot.total,pages:snapshot.pages,liveCount:liveRows.length,localCount:localRows.length,missingLive:status.missing.length,extraLive:status.extra.length,statusChanges:status.changes.length,missingLocal:localDiff.missing.length,extraLocal:localDiff.extra.length,missingSamples:status.missing.slice(0,8).map(tradeSample),extraSamples:status.extra.slice(0,8).map(tradeSample),statusSamples:status.changes.slice(0,8).map(change=>({source:tradeSample(change.expected),published:tradeSample(change.actual)}))});
      }catch(error){report.upstream.push({code,month,error:error.message});}done++;if(done%25===0||done===tasks.length){console.log('Upstream '+done+'/'+tasks.length);save();}await delay(100);}}));
    }
    report.finishedAt=new Date().toISOString();save();return report;
  }finally{db.close();save();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const argument=name=>{const index=process.argv.indexOf(name);if(index<0)return undefined;const value=process.argv[index+1];if(!value||value.startsWith('--'))throw new Error('Missing value for '+name);return value;};
    const report=await auditTradeData({base:argument('--base'),folder:argument('--output'),upstream:process.argv.includes('--upstream'),reuseUpstreamCache:process.argv.includes('--reuse-upstream-cache')});
    const issues=auditProblems(report);console.log(JSON.stringify({finishedAt:report.finishedAt,rows:report.live.count,upstreamMonths:report.upstream.length,issues:issues.length}));
    if(issues.length)process.exitCode=1;
  }
  catch(error){console.error('Audit failed: '+error.message);process.exitCode=1;}
}
