import {LISTING_SOURCE,LISTING_ERRORS,validListingSnapshot,validComplexNo} from './naver-listings.mjs';

export function validRegionalListingReport(report,snapshot,regionCode) {
  const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  if(!report||report.version!==1||report.source!==LISTING_SOURCE||!/^\d{5}$/.test(regionCode)||report.regionCode!==regionCode||typeof report.firstPageOnly!=='boolean'||!time(report.startedAt)||!time(report.finishedAt)||report.startedAt>report.finishedAt||!validListingSnapshot(snapshot))return false;
  if(!Array.isArray(report.results)||report.results.length>1000||new Set(report.results.map(r=>r?.favoriteId)).size!==report.results.length)return false;
  const counts={complete:0,partial:0,unmatched:0,failed:0,not_attempted:0},groups=new Map(snapshot.groups.filter(g=>g.favorite.region_code===regionCode).map(g=>[g.favorite.id,g])),saved=[];
  for(const row of report.results){
    if(!row||typeof row.favoriteId!=='string'||!row.favoriteId||typeof row.apartment!=='string'||!Object.hasOwn(counts,row.status))return false;
    counts[row.status]++;
    if(row.status==='complete'||row.status==='partial'){
      const group=groups.get(row.favoriteId);
      if(!validComplexNo(row.complexNo)||!integer(row.articleCount)||!time(row.collectedAt)||row.collectedAt>report.finishedAt||!group||group.status!=='ready'||group.complexNo!==row.complexNo||group.articles.length!==row.articleCount||group.collectedAt!==row.collectedAt||group.coverage!==row.status)return false;
      saved.push(group);
    }else if(!Object.hasOwn(LISTING_ERRORS,row.errorCode))return false;
  }
  const summary=report.summary;
  if(!summary||!Object.values(summary).every(integer)||summary.targetCount!==report.results.length||summary.completeTargets!==counts.complete||summary.partialTargets!==counts.partial||summary.unmatchedTargets!==counts.unmatched||summary.failedTargets!==counts.failed||summary.notAttemptedTargets!==counts.not_attempted)return false;
  return summary.complexCount===new Set(saved.map(g=>g.complexNo)).size&&summary.advertisementCount===new Set(saved.flatMap(g=>g.articles.map(a=>a.id))).size;
}
