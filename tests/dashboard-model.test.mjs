import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOverview,restoreOverviewDays} from '../src/dashboard/model.mjs';
const region={region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',dongs:['풍덕천동']};
const apartment={id:'favorite',region_code:'41465',apartment:'같은단지',dong:'풍덕천동',jibun:'1',key:JSON.stringify(['풍덕천동','1','같은단지'])};
const months=['202608','202609','202610'],manifest={months,published_at:'2026-10-03T00:00:00Z',districts:{'41465':{months}}};
const row=(id,changes={})=>({id,region_code:'41465',dong:'풍덕천동',jibun:'1',apartment:'같은단지',deal_date:'2026-09-28',cancelled:0,price_man:100000,area_m2:85,floor:10,...changes});
const build=(rows,changes={})=>buildOverview({manifest,regions:[region],apartments:[apartment],days:30,datasets:{'41465':{rows}},...changes});
test('bounds counts by contract date and excludes cancellations, future dates and unrelated districts/lots from apartment summaries',()=>{
 const model=build([row(1,{deal_date:'2026-09-04'}),row(2,{deal_date:'2026-10-03',jibun:'2'}),row(3,{cancelled:1,price_man:900000}),row(4,{deal_date:'2026-08-05'}),row(5,{deal_date:'2026-09-03'}),row(6,{deal_date:'2026-10-04'}),row(7,{region_code:'11110'})]);
 assert.deepEqual(model.range,{start:'2026-09-04',end:'2026-10-03'});assert.deepEqual(model.previous,{start:'2026-08-05',end:'2026-09-03'});
 assert.equal(model.dongCount,2);assert.equal(model.apartmentCount,1);assert.equal(model.uniqueCount,2);assert.equal(model.recent.length,3);assert.equal(model.dongGroups[0].previousCount,2);assert.equal(model.dongGroups[0].comparable,true);assert.equal(model.apartmentGroups[0].latest.id,1);
});
test('deduplicates a transaction shared by dong and apartment favorites across the recent feed and trend',()=>{
 const model=build([row(1),row(2)]);assert.equal(model.dongCount,2);assert.equal(model.apartmentCount,2);assert.equal(model.uniqueCount,2);assert.equal(model.recent.length,2);
 assert.deepEqual(model.recent[0].dongIds,[region.region_id]);assert.deepEqual(model.recent[0].apartmentIds,[apartment.id]);assert.equal(model.trend.reduce((sum,bin)=>sum+bin.count,0),2);
});
test('matches only verified master aliases and distinguishes same-name apartments in other lots or districts',()=>{
 const master={...apartment,id:'hub:master',master_id:'hub:master',trade_keys:[apartment.key,JSON.stringify(['동천동','2','별칭단지'])]};
 const model=build([row(1),row(2,{dong:'동천동',jibun:'2',apartment:'별칭단지'}),row(3,{jibun:'99'})],{apartments:[master]});
 assert.equal(model.apartmentCount,2);assert.equal(model.uniqueCount,3);assert.equal(model.apartmentGroups[0].latest.id,2);
});
test('keeps the latest valid contract from all collected history even when the selected period is empty',()=>{
 const model=build([row(1,{deal_date:'2026-08-20'}),row(2,{deal_date:'2026-09-28',cancelled:1})]);
 assert.equal(model.apartmentCount,0);assert.equal(model.apartmentGroups[0].latest.id,1);assert.equal(model.lastValid.id,1);assert.equal(model.recent.length,1);assert.equal(model.uniqueCount,0);
});
test('does not represent uncollected, failed or still-loading favorites as zero trades',()=>{
 const third={...region,region_id:'dong_11110101',region_code:'11110',dongs:['청운동']};
 const model=build([],{regions:[region,third],datasets:{'41465':{error:true}}});assert.equal(model.dongCount,null);assert.equal(model.apartmentCount,null);assert.equal(model.failed,true);assert.equal(model.uncollected,1);assert.equal(model.dongGroups[0].status,'error');assert.equal(model.dongGroups[1].status,'uncollected');
 const loading=build([],{datasets:{}});assert.equal(loading.loading,true);assert.equal(loading.apartmentGroups[0].status,'loading');assert.equal(loading.uniqueCount,null);
});
test('reports partial collection and disables comparison when any contract month is missing',()=>{
 const model=build([row(1)],{manifest:{...manifest,districts:{'41465':{months:['202609']}}}});assert.equal(model.partial,true);assert.equal(model.dongGroups[0].comparable,false);assert.equal(model.dongCount,1);
});
test('clips recent periods to the published data start, avoids comparison against unavailable earlier history, and handles leap days',()=>{
 const model=build([row(1)],{manifest:{...manifest,months:['202609','202610']},days:90});assert.equal(model.range.start,'2026-09-01');assert.equal(model.dongGroups[0].comparable,false);
 const leap=build([],{manifest:{...manifest,months:['202402','202403'],published_at:'2024-03-01T00:00:00Z'},days:7});assert.deepEqual(leap.range,{start:'2024-02-24',end:'2024-03-01'});assert.equal(leap.trend.some(bin=>bin.start==='2024-02-29'),true);
});
test('restores only allowed overview durations and does not borrow another tab’s period',()=>{
 assert.equal(restoreOverviewDays(new URLSearchParams('tab=dashboard&days=7'),90),7);assert.equal(restoreOverviewDays(new URLSearchParams('tab=dashboard&days=999'),7),30);assert.equal(restoreOverviewDays(new URLSearchParams('tab=weekly&days=7'),90),90);assert.equal(restoreOverviewDays(new URLSearchParams('tab=dashboard'),undefined),30);
});
