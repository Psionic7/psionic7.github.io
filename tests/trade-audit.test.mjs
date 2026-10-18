import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileTrades,statusChanges,auditProblems} from '../server/trade-audit.mjs';
const row={region_code:'41465',deal_month:'202609',deal_date:'2026-09-28',apartment:'테스트단지',dong:'풍덕천동',jibun:'1',price_man:100000,area_m2:84.9,floor:10,build_year:2000,cancelled:0,raw:{cdealDay:''}};
test('audit failure summaries include source, pipeline, archive and search errors but permit genuinely empty months',()=>{
 const good={coverage:[{liveCount:0,declared:0,missingMonths:['200010']}],archived:[{api_count:0,stored_count:0,parsedItems:0,actualRows:0,countsConsistent:true}],pipeline:[{missing:0,extra:0,errors:0}],upstream:[{missingLive:0,extraLive:0,statusChanges:0}],search:{missing:[],ambiguous:[]}};
 assert.deepEqual(auditProblems(good),[]);
 const bad={...good,pipeline:[{errors:1}],upstream:[{statusChanges:1},{error:'HTTP 503'}],archived:[{api_count:1,stored_count:0,parsedItems:0,actualRows:0}],search:{missing:[{key:'missing'}],ambiguous:[]}};
 assert.equal(auditProblems(bad).length,5);
});
test('audit preserves identical-looking contracts and finds deficits despite matching unique keys',()=>{
 const diff=reconcileTrades([row,row],[row]);assert.equal(diff.missing.length,1);assert.equal(diff.extra.length,0);
 const reversed=reconcileTrades([row],[row,row]);assert.equal(reversed.extra.length,1);
});
test('audit distinguishes replacement records even when total counts match',()=>{
 const diff=reconcileTrades([row],[{...row,price_man:110000}]);assert.equal(diff.missing.length,1);assert.equal(diff.extra.length,1);
 const changes=statusChanges(diff.missing,diff.extra);assert.equal(changes.changes.length,0);assert.equal(changes.missing.length,1);
});
test('audit separates cancellation corrections from absent contracts without merging different apartments',()=>{
 const published={...row,cancelled:1,raw:{cdealDay:'2026-10-01'}};
 const diff=reconcileTrades([row,{...row,jibun:'2'}],[published]);const changes=statusChanges(diff.missing,diff.extra);
 assert.equal(changes.changes.length,1);assert.equal(changes.missing.length,1);assert.equal(changes.missing[0].jibun,'2');
});
test('pipeline audit checks identities while compact browser comparison allows intentionally omitted build years',()=>{
 assert.equal(reconcileTrades([{...row,id:1}],[{...row,id:2}],{includeId:true}).missing.length,1);
 const browser={...row,id:1};delete browser.build_year;
 assert.equal(reconcileTrades([{...row,id:1}],[browser],{includeId:true,compact:true}).missing.length,0);
 assert.equal(reconcileTrades([{...row,id:1}],[browser],{includeId:true}).missing.length,1);
});
