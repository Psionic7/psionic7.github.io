import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {saleListingGroup,validListingSnapshot} from '../src/naver-listings.mjs';
import {validRegionalListingReport} from '../src/naver-listing-report.mjs';
import {writeListingSnapshot} from '../server/naver-listings.mjs';
import {atomicWrite,checkedBytes} from '../server/storage.mjs';

// Filter saved observations without claiming that a new network collection occurred.
const directory=fileURLToPath(new URL('../public/listings/',import.meta.url));
const filename=path.join(directory,'snapshot.json'),previous=JSON.parse(fs.readFileSync(filename,'utf8'));
if(!validListingSnapshot(previous))throw Error('기존 매물 스냅샷 검증 실패');
const snapshot={...previous,groups:previous.groups.map(saleListingGroup).filter(Boolean)};
const reports=fs.readdirSync(directory).filter(file=>/^region-\d{5}-report\.json$/.test(file)).map(file=>{
  const region=file.match(/\d{5}/)[0],report=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
  if(!validRegionalListingReport(report,previous,region))throw Error('기존 지역 보고서 검증 실패');
  const groups=new Map(snapshot.groups.map(group=>[group.favorite.id,group]));
  report.tradeType='A1';
  report.results=report.results.map(row=>{
    if(!['complete','partial'].includes(row.status))return row;
    const group=groups.get(row.favoriteId);
    return group?{...row,articleCount:group.articles.length}:{favoriteId:row.favoriteId,apartment:row.apartment,status:'failed',errorCode:'incomplete'};
  });
  const saved=report.results.filter(row=>['complete','partial'].includes(row.status)).map(row=>groups.get(row.favoriteId));
  report.summary={targetCount:report.results.length,...Object.fromEntries([['completeTargets','complete'],['partialTargets','partial'],['unmatchedTargets','unmatched'],['failedTargets','failed'],['notAttemptedTargets','not_attempted']].map(([key,status])=>[key,report.results.filter(row=>row.status===status).length])),complexCount:new Set(saved.map(g=>g.complexNo)).size,advertisementCount:new Set(saved.flatMap(g=>g.articles.map(a=>a.id))).size};
  if(!validRegionalListingReport(report,snapshot,region))throw Error('매매 필터 적용 후 지역 보고서 검증 실패');
  checkedBytes(JSON.stringify(report));return {file,report};
});
checkedBytes(JSON.stringify(snapshot));
writeListingSnapshot(filename,snapshot);
for(const {file,report} of reports)atomicWrite(path.join(directory,file),JSON.stringify(report,null,2)+'\n');
console.log(`매매 광고만 유지: ${new Set(snapshot.groups.flatMap(group=>group.articles.map(a=>a.id))).size}건 · 기존 관찰 시각 유지`);
