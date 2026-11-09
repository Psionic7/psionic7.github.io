import test from 'node:test';
import assert from 'node:assert/strict';
import {listingGroupForFavorite,listingGroupsForFavorite,validListingObservation} from '../src/naver-listings.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
const root='hub:one',two='cohort:hub:one:two',six='cohort:hub:one:six';
const favorite=(kind,id,entity_ids=[],cohort_ids=[],root_ids=[root])=>makeApartmentFavorite({apartment:'정든마을',dong:'정자동',jibun:'199',identity_ref:{kind,id},identity_coverage:{entity_ids,cohort_ids,root_ids}},{region_code:'41135',region_name:'경기도 성남시 분당구'});
const group=(id,item,articles=[])=>({favorite:item,complexNo:id,attemptedAt:'2026-11-08T00:00:00.000Z',collectedAt:'2026-11-08T00:00:00.000Z',status:'ready',errorCode:null,coverage:'complete',articles});
test('parent collects verified child groups once while sibling phases stay separate',()=>{
 const a=group('111',favorite('cohort',two,[],[two]),[{id:'1'},{id:'2'}]),b=group('222',favorite('cohort',six,[],[six]),[{id:'2'},{id:'3'}]);
 assert.equal(listingGroupForFavorite([a,b],a.favorite),a);
 assert.deepEqual(listingGroupForFavorite([a,b],favorite('root',root)).articles.map(a=>a.id),['1','2','3']);
 assert.equal(listingGroupForFavorite([a,b],favorite('root','hub:neighbor')),null);
 assert.deepEqual(listingGroupsForFavorite([group('333',favorite('root',root))],a.favorite),[]);
});
test('source requires whole-contained membership and retains failed status for partial results',()=>{
 const entity=JSON.stringify(['41135','정자동','199','동아2']);
 const a=group('111',favorite('cohort',two,[entity],[two]),[{id:'1'}]);
 const b={...group('222',favorite('cohort',six,[],[six]),[]),status:'failed',errorCode:'timeout'};
 assert.equal(listingGroupForFavorite([a,b],favorite('source',entity)),a);
 const combined=listingGroupForFavorite([a,b],favorite('root',root));
 assert.equal(combined.status,'failed');assert.equal(combined.errorCode,'timeout');assert.equal(combined.articles.length,1);
});
test('provider observations require actual coordinate pairs and the matching complex URL',()=>{
 const observed={complex_no:'111',name:'정든마을',road_address:'불정로 179',parcel_address:'정자동 199',source_url:'https://new.land.naver.com/complexes/111',observed_at:'2026-11-08T00:00:00.000Z'};
 assert.equal(validListingObservation(observed,{complexNo:'111'}),true);
 assert.equal(validListingObservation({...observed,latitude:37.3},{complexNo:'111'}),false);
 assert.equal(validListingObservation({...observed,latitude:37.3,longitude:127.1,coordinate_role:'provider_label'},{complexNo:'111'}),true);
 assert.equal(validListingObservation(observed,{complexNo:'222'}),false);
});
test('a shared address source receives only its witnessed buildings, leaving unknown buildings for the address view',()=>{
 const entity=JSON.stringify(['41135','수내동','71','벽산']);
 const source={...favorite('source',entity),identity_listing_members:[{cohort_id:two,building_dongs:['402']}]};
 const a=group('111',favorite('cohort',two,[],[two]),[{id:'1',building:'401동'},{id:'2',building:'제402동'},{id:'3',building:''}]);
 const selected=listingGroupForFavorite([a],source);
 assert.deepEqual(selected.articles.map(article=>article.id),['2']);assert.equal(selected.unclassifiedArticleCount,1);assert.equal(selected.buildingScopeRestricted,true);
 const rootGroup={...a,favorite:favorite('root',root,[],[two])};
 assert.deepEqual(listingGroupForFavorite([rootGroup],source).articles.map(article=>article.id),['2']);
});
test('one Naver complex spanning distinct official units is partitioned for each address and preserved for the whole source',()=>{
 const a={...favorite('cohort',two,[],[two]),identity_listing_members:[{cohort_id:two,building_dongs:['101']}]};
 const b={...favorite('cohort',six,[],[six]),identity_listing_members:[{cohort_id:six,building_dongs:['201']}]};
 const ads=[{id:'1',building:'101동'},{id:'2',building:'201동'}],groups=[group('111',a,ads),group('111',b,ads)];
 assert.deepEqual(listingGroupForFavorite(groups,a).articles.map(row=>row.id),['1']);
 assert.deepEqual(listingGroupForFavorite(groups,b).articles.map(row=>row.id),['2']);
 const entity=JSON.stringify(['41135','정자동','199','통합원천']);
 const source={...favorite('source',entity),identity_listing_members:[{cohort_id:two,building_dongs:null},{cohort_id:six,building_dongs:null}]};
 assert.deepEqual(listingGroupForFavorite(groups,source).articles.map(row=>row.id),['1','2']);
 assert.deepEqual(listingGroupForFavorite(groups,{...source,identity_listing_members:source.identity_listing_members.slice(0,1)}).articles.map(row=>row.id),['1']);
 assert.equal(groups[0].articles.length,2);
});
test('a provider building label different from one official title does not by itself prove a different apartment',()=>{
 const selected={...favorite('cohort',two,[],[two]),identity_listing_members:[{cohort_id:two,building_dongs:['101']}]};
 const data=group('111',selected,[{id:'1',building:'105동'}]);
 assert.equal(listingGroupForFavorite([data],selected),data);
});
test('a later failed hint never hides a successful complete observation of the same provider complex',()=>{
 const entity=JSON.stringify(['41135','정자동','199','통합원천']);
 const source={...favorite('source',entity),identity_listing_members:[{cohort_id:two,building_dongs:null},{cohort_id:six,building_dongs:null}]};
 const good=group('111',favorite('cohort',two,[],[two]),[{id:'1',building:'101동'}]);
 const failed={...group('111',favorite('cohort',six,[],[six])),status:'failed',collectedAt:null,errorCode:'timeout',attemptedAt:'2026-11-08T01:00:00.000Z'};
 assert.deepEqual(listingGroupForFavorite([failed,good],source).articles.map(row=>row.id),['1']);
});
test('an old parent listing covering several phases cannot stand in for a single source phase',()=>{
 const entity=JSON.stringify(['41135','정자동','199','동아2']);
 const parent=group('222',favorite('root',root,[entity],[two,six]),[{id:'1',building:'601동'}]);
 const child={...favorite('source',entity,[],[two]),identity_listing_members:[{cohort_id:two,building_dongs:null}]};
 assert.equal(listingGroupForFavorite([parent],child),null);
 const whole={...child,identity_coverage:{entity_ids:[entity],cohort_ids:[two,six],root_ids:[root]}};
 assert.deepEqual(listingGroupForFavorite([parent],whole).articles.map(row=>row.id),['1']);
});
test('source-reported buildings remain market-visible without being assigned to the wrong registry unit',()=>{
 const a={...favorite('cohort',two,[],[two]),identity_listing_members:[{cohort_id:two,whole_cohort:true,building_dongs:['101']}]};
 const b={...favorite('cohort',six,[],[six]),identity_listing_members:[{cohort_id:six,whole_cohort:true,building_dongs:['201']}]};
 const ads=[{id:'1',building:'101동'},{id:'2',building:'201동'}],groups=[group('111',a,ads),group('111',b,ads)];
 const entity=JSON.stringify(['41135','정자동','199','원천신고명']);
 const source={...favorite('source',entity),identity_listing_members:a.identity_listing_members,identity_reported_buildings:['101','201']};
 assert.deepEqual(listingGroupForFavorite(groups,source).articles.map(row=>row.id),['1','2']);
 assert.deepEqual(listingGroupForFavorite(groups,a).articles.map(row=>row.id),['1']);
});
