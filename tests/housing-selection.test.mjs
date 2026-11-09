import test from 'node:test';
import assert from 'node:assert/strict';
import {apartmentKey} from '../src/domain.mjs';
import {sourceIdentityId,identityRef,identityTradeMatches,identitySelectionEqual,selectIdentityRows} from '../src/housing-identity.mjs';
import {apartmentFavoriteId,makeApartmentFavorite,validApartmentFavorites,favoriteTradeMatches,sameApartmentFavorite,refreshApartmentFavorites} from '../src/apartment-favorites.js';

const region={region_code:'41135',region_name:'경기도 성남시 분당구'};
const root='hub:mixed',cohort2='cohort:hub:mixed:road179',cohort6='cohort:hub:mixed:road195';
const row=(id,changes={})=>({id,region_code:region.region_code,dong:'정자동',jibun:'198',apartment:'정든마을(2단지)(동아)',price_man:100000,area_m2:84,floor:10,deal_date:'2026-10-01',...changes});
const coverage=(entity_ids=[],cohort_ids=[],root_ids=[])=>({entity_ids,cohort_ids,root_ids});
const assignment=(source,precision,changes={})=>({entity_id:source,precision,root_id:null,cohort_id:null,building_id:null,...changes});
const favorite=(ref,changes={})=>makeApartmentFavorite({apartment:'정든마을',dong:'정자동',jibun:'198',road_address:'경기도 성남시 분당구 불정로 179 (정자동)',identity_ref:ref,...changes},region);
const selectedIds=(rows,item)=>selectIdentityRows(rows,item).map(value=>value.id);

test('different phases inside one registry root remain separate selections and row sets',()=>{
 const source2=sourceIdentityId(row(1)),six=row(2,{apartment:'정든마을(6단지)(우성)'}),source6=sourceIdentityId(six);
 const rows=[
  {...row(1),identity:assignment(source2,'building',{root_id:root,cohort_id:cohort2,building_id:'building201'})},
  {...six,identity:assignment(source6,'cohort',{root_id:root,cohort_id:cohort6})},
  {...row(3),identity:assignment(source2,'complex')},
  {...six,id:4,identity:assignment(source6,'complex')},
  {...row(5),identity:assignment(source2,'unresolved')},
 ];
 const two=favorite({kind:'cohort',id:cohort2},{master_id:root,identity_coverage:coverage([source2],[cohort2],[root])});
 const sixFavorite=favorite({kind:'cohort',id:cohort6},{master_id:root,identity_coverage:coverage([source6],[cohort6],[root])});
 const aggregate=favorite({kind:'root',id:root},{master_id:root,identity_coverage:coverage([source2,source6],[cohort2,cohort6],[root])});
 assert.deepEqual(selectedIds(rows,two),[1,3]);
 assert.deepEqual(selectedIds(rows,sixFavorite),[2,4]);
 assert.deepEqual(selectedIds(rows,aggregate),[1,2,3,4]);
 assert.deepEqual(selectedIds(rows,favorite({kind:'source',id:source2})),[1,3,5]);
 assert.equal(identitySelectionEqual(two,sixFavorite),false);
 assert.equal(sameApartmentFavorite(aggregate,two),false);
 assert.equal(sameApartmentFavorite(two,sixFavorite),false);
});

test('multi-root historical rows stay available once at source scope without entering every root',()=>{
 const first=row(11,{dong:'수내동',jibun:'71',apartment:'푸른마을(벽산)'}),entity=sourceIdentityId(first);
 const rows=[
  {...first,identity:assignment(entity,'building',{root_id:'hub:parcel71',cohort_id:'cohort:hub:parcel71:road',building_id:'101'})},
  {...first,id:12,identity:assignment(entity,'building',{root_id:'hub:parcel72',cohort_id:'cohort:hub:parcel72:road',building_id:'201'})},
  {...first,id:13,identity:assignment(entity,'complex')},
  {...first,id:14,identity:assignment(entity,'unresolved')},
 ];
 const source=makeApartmentFavorite({...first,identity_ref:{kind:'source',id:entity}},region);
 const one=makeApartmentFavorite({...first,master_id:'hub:parcel71',identity_coverage:coverage([],['cohort:hub:parcel71:road'],['hub:parcel71'])},region);
 const two=makeApartmentFavorite({...first,master_id:'hub:parcel72',identity_coverage:coverage([],['cohort:hub:parcel72:road'],['hub:parcel72'])},region);
 assert.deepEqual(selectedIds(rows,source),[11,12,13,14]);
 assert.deepEqual(selectedIds(rows,one),[11]);
 assert.deepEqual(selectedIds(rows,two),[12]);
 assert.equal(sameApartmentFavorite(source,one),false);
});

test('whole-contained complex history requires an explicit coverage grant, never a stale key',()=>{
 const original=row(20),entity=sourceIdentityId(original),legacy=makeApartmentFavorite({...original,master_id:root,trade_keys:[apartmentKey(original)]},region);
 const historical={...original,identity:assignment(entity,'complex')};
 assert.equal(favoriteTradeMatches(legacy,original),false);
 assert.equal(favoriteTradeMatches(legacy,historical),false);
 assert.equal(favoriteTradeMatches({...legacy,identity_coverage:coverage([entity],[],[root])},historical),true);
 assert.equal(favoriteTradeMatches({...legacy,identity_coverage:coverage([entity],[],[root])},{...historical,identity:assignment(entity,'unresolved')}),false);
 assert.equal(favoriteTradeMatches(legacy,{...original,identity:assignment(entity,'building',{root_id:'hub:neighbor',cohort_id:'cohort:hub:neighbor:road',building_id:'101'})}),false);
 assert.equal(favoriteTradeMatches({...legacy,trade_keys:[]},{...row(21,{apartment:'새 원천 이름'}),identity:assignment(entity,'cohort',{root_id:root,cohort_id:cohort2})}),true);
});

test('source selection preserves identical legitimate transactions and legacy raw selection behavior',()=>{
 const first=row(30),second={...first,id:31},entity=sourceIdentityId(first),source=makeApartmentFavorite(first,region);
 const annotated=[first,second].map(value=>({...value,identity:assignment(entity,'unresolved')}));
 assert.deepEqual(selectedIds(annotated,source),[30,31]);
 assert.deepEqual(selectedIds([first,second,row(32,{jibun:'199'}),row(33,{region_code:'41465'})],source),[30,31]);
 assert.equal(source.id,JSON.stringify([region.region_code,first.dong,first.jibun,first.apartment]));
 assert.deepEqual(identityRef(source),{kind:'source',id:entity});
 assert.equal(identityTradeMatches({...source,apartment:'대표 표시 이름',identity_ref:{kind:'source',id:entity}},annotated[0]),true);
 assert.equal(identitySelectionEqual(source,{...source,identity_ref:{kind:'source',id:entity}}),true);
 assert.equal(validApartmentFavorites([source]),true);
 const legacyQuery={region_code:region.region_code,key:apartmentKey(first)};
 assert.deepEqual(selectedIds([first,second,row(32,{jibun:'199'})],legacyQuery),[30,31]);
 assert.equal(identityTradeMatches({region_code:region.region_code,key:'broken'},first),false);
 assert.equal(identityRef({region_code:region.region_code,key:JSON.stringify('abc')}),null);
 assert.equal(identitySelectionEqual({},{}),false);
});

test('favorite IDs prefer precise refs and copied metadata does not mutate catalog records',()=>{
 const entity=sourceIdentityId(row(1)),input={apartment:'정든마을2단지',dong:'정자동',jibun:'199',road_address:'불정로 179',master_id:root,trade_keys:[apartmentKey(row(1))],identity_ref:{kind:'cohort',id:cohort2},identity_coverage:coverage([entity],[cohort2],[root]),identity_related_sources:[entity]};
 const result=makeApartmentFavorite(input,region);
 assert.equal(result.id,cohort2);
 assert.equal(apartmentFavoriteId(result),cohort2);
 assert.equal(validApartmentFavorites([result]),true);
 assert.notEqual(result.identity_ref,input.identity_ref);
 assert.notEqual(result.identity_coverage,input.identity_coverage);
 assert.notEqual(result.identity_related_sources,input.identity_related_sources);
 result.identity_coverage.entity_ids.pop();result.identity_related_sources.pop();result.trade_keys.pop();
 assert.equal(input.identity_coverage.entity_ids.length,1);
 assert.equal(input.identity_related_sources.length,1);
 assert.equal(input.trade_keys.length,1);
 assert.equal(validApartmentFavorites([{...result,id:root}]),false);
 assert.equal(validApartmentFavorites([{...result,identity_ref:{kind:'cohort',id:cohort2,unknown:true}}]),false);
 assert.equal(validApartmentFavorites([{...result,identity_coverage:coverage(['not-a-source'],[cohort2],[root])}]),false);
 const source=makeApartmentFavorite(row(1),region);
 assert.equal(validApartmentFavorites([{...source,identity_ref:{kind:'source',id:source.id},region_code:'41465'}]),false);
});

test('legacy root favorites migrate only with a unique same-road cohort proof',()=>{
 const entity=sourceIdentityId(row(1)),saved=makeApartmentFavorite({apartment:'정든마을',dong:'정자동',jibun:'198',road_address:'경기도 성남시 분당구 불정로179 (정자동, 정든마을)',master_id:root},region);
 const aggregate=favorite({kind:'root',id:root},{apartment:'정든마을 전체',master_id:root,identity_coverage:coverage([entity],[cohort2,cohort6],[root]),identity_related_sources:[]});
 const two=favorite({kind:'cohort',id:cohort2},{apartment:'정든마을2단지',master_id:root,identity_coverage:coverage([entity],[cohort2],[root]),identity_related_sources:[]});
 const six=favorite({kind:'cohort',id:cohort6},{apartment:'정든마을6단지',road_address:'경기도 성남시 분당구 불정로 195',master_id:root,identity_coverage:coverage([], [cohort6],[root]),identity_related_sources:[entity]});
 const catalog=[aggregate,two,six],refreshed=refreshApartmentFavorites([saved],catalog);
 assert.equal(refreshed[0].id,cohort2);
 assert.equal(refreshed[0].apartment,'정든마을2단지');
 assert.equal(validApartmentFavorites(refreshed),true);
 assert.equal(refreshApartmentFavorites(refreshed,catalog),refreshed);
 assert.equal(refreshApartmentFavorites([aggregate],catalog)[0].id,root);
 const collision={...six,road_address:two.road_address};
 const ambiguous=refreshApartmentFavorites([saved],[aggregate,two,collision]);
 assert.equal(ambiguous[0].id,root);
 assert.deepEqual(ambiguous[0].identity_ref,{kind:'root',id:root});
 assert.equal(ambiguous[0].apartment,'정든마을 전체');
 const unproven={...two};delete unproven.identity_coverage;
 assert.equal(refreshApartmentFavorites([saved],[aggregate,unproven])[0].id,root);
});

test('unproven old roots remain explicit aggregates and ordinary favorites remain loadable',()=>{
 const raw=makeApartmentFavorite(row(1),region),legacy=makeApartmentFavorite({...row(1),master_id:root},region),saved=[legacy];
 assert.equal(validApartmentFavorites([raw,legacy]),true);
 assert.equal(refreshApartmentFavorites(saved,[]),saved);
 const unrelated=favorite({kind:'cohort',id:'cohort:hub:neighbor:road'},{master_id:'hub:neighbor',identity_coverage:coverage([],['cohort:hub:neighbor:road'],['hub:neighbor'])});
 const updated=refreshApartmentFavorites(saved,[unrelated]);
 assert.equal(updated[0].id,root);
 assert.deepEqual(updated[0].identity_ref,{kind:'root',id:root});
 assert.deepEqual(updated[0].identity_coverage.entity_ids,[]);
 const ordinary=[raw];
 assert.equal(refreshApartmentFavorites(ordinary,[{...raw,road_address:'업데이트된 표시 주소'}]),ordinary);
 const source=makeApartmentFavorite({...row(1),identity_ref:{kind:'source',id:raw.id},identity_coverage:coverage()},region);
 assert.deepEqual(refreshApartmentFavorites(ordinary,[source])[0].identity_ref,source.identity_ref);
});
