import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTradeCandidates} from '../server/trade-link-resolution.mjs';
import {refreshApartmentFavorites,makeApartmentFavorite,favoriteTradeMatches} from '../src/apartment-favorites.js';
import {normalizeApartmentName} from '../server/apartment-boundaries.mjs';
const trade={dong:'원천동',jibun:'35',apartment:'주공',year:1987};
const candidate=(id,changes={})=>({apartment_id:id,dong:'원천동',jibun:'35',road_address:'시험로 1',build_year:1987,...changes});
test('primary parcel prevents neighbouring attached-parcel complexes from absorbing trades',()=>{
  const result=resolveTradeCandidates(trade,[candidate('a'),candidate('b',{jibun:'36'})],new Map([['a',new Set(['주공'])],['b',new Set(['주공'])]]));
  assert.deepEqual(result.ids,['a']);
});

test('normalized road and a verified name find a changed parcel but never override a conflicting name or year',()=>{
 const expected=candidate('a',{jibun:'산 151-2',road_address:'경기도 용인시 수지구 수풍로 89 (동천동)',name:'더샵 동천이스트포레'});
 const aliases=new Map([['a',new Set(['더샵동천이스트포레'])]]);
 const input={...trade,apartment:'더샵동천이스트포레',jibun:'산151-2',road_address:'경기도용인시수지구 수풍로89 (동천동, 더샵 동천이스트포레)'};
 assert.deepEqual(resolveTradeCandidates(input,[expected],aliases).ids,['a']);
 assert.equal(resolveTradeCandidates(input,[expected],aliases).method,'road_and_verified_name');
 assert.deepEqual(resolveTradeCandidates({...input,apartment:'정든동아2단지'},[expected],aliases).ids,[]);
 assert.deepEqual(resolveTradeCandidates({...input,year:1990},[expected],aliases).ids,[]);
 assert.equal(resolveTradeCandidates(input,[expected,{...expected,apartment_id:'b',build_year:1988}],new Map([...aliases,['b',aliases.get('a')]])).method,'review');
});

test('a previous trade alias cannot override a conflicting phase in independent official names',()=>{
 const aliases=new Map([['a',new Set(['동아2단지','우성6단지'])]]),roadAliases=new Map([['a',new Set(['우성6단지'])]]);
 const result=resolveTradeCandidates({...trade,apartment:'동아2단지',road_address:'시험로 1'},[candidate('a')],aliases,{roadAliases});
 assert.deepEqual(result.ids,[]);assert.equal(result.method,'road_name_conflict');
});

test('an existing address-verified alias is retained only with the primary parcel, exact road and same year',()=>{
 const aliases=new Map([['a',new Set(['원천신미주'])]]),roadAliases=new Map([['a',new Set(['신미주'])]]);
 const input={...trade,apartment:'원천신미주',road_address:'시험로1'};
 assert.equal(resolveTradeCandidates(input,[candidate('a')],aliases,{roadAliases}).method,'road_and_existing_link');
 assert.deepEqual(resolveTradeCandidates({...input,year:1980},[candidate('a')],aliases,{roadAliases}).ids,[]);
 assert.deepEqual(resolveTradeCandidates(input,[candidate('a',{jibun:'36'})],aliases,{roadAliases}).ids,[]);
});

test('road candidates keep a unique verified primary parcel and do not confuse compound phase numbers',()=>{
 const input={...trade,apartment:'광교마을46-1단지광교스타클래스',road_address:'시험로 1'};
 const a=candidate('a'),b=candidate('b',{jibun:'36'}),aliases=new Map([['a',new Set([normalizeApartmentName(input.apartment)])],['b',new Set([normalizeApartmentName(input.apartment)])]]);
 const roadAliases=new Map([['a',new Set(['광교마을46단지'])],['b',new Set(['광교마을46단지'])]]);
 assert.deepEqual(resolveTradeCandidates(input,[a,b],aliases,{roadAliases}).ids,['a']);
});
test('duplicate registry roots share trades only when primary parcel, official name, address and year agree',()=>{
  const aliases=new Map([['a',new Set(['주공'])],['b',new Set(['주공'])]]);
  assert.equal(resolveTradeCandidates(trade,[candidate('a'),candidate('b')],aliases).method,'shared_registry_address');
  for(const changes of [{road_address:'다른로 2'},{build_year:1988},{road_address:''}])assert.equal(resolveTradeCandidates(trade,[candidate('a'),candidate('b',changes)],aliases).method,'review');
  assert.equal(resolveTradeCandidates(trade,[candidate('a'),candidate('b')],new Map()).method,'review');
  assert.equal(resolveTradeCandidates(trade,[candidate('a',{road_address:'(원천동)'}),candidate('b',{road_address:' (원천동) '})],aliases).method,'review');
  assert.deepEqual(resolveTradeCandidates({...trade,year:1980},[candidate('a')],aliases).ids,[]);
});
test('saved master selections adopt corrected keys including removals without altering legacy identities or unknown masters',()=>{
  const item=makeApartmentFavorite({master_id:'hub:a',apartment:'주공',dong:'원천동',jibun:'35',trade_keys:[]},{region_code:'41117',region_name:'영통구'});
  const row={apartment:'주공',dong:'원천동',jibun:'35'},key=JSON.stringify(['원천동','35','주공']);
  const saved=[item],current=[{...item,trade_keys:[key]}],next=refreshApartmentFavorites(saved,current);
  assert.equal(favoriteTradeMatches(next[0],row),true);assert.equal(saved[0].trade_keys.length,0);
  assert.equal(refreshApartmentFavorites(next,current),next);assert.equal(refreshApartmentFavorites(saved,[]),saved);
  assert.equal(refreshApartmentFavorites(next,saved)[0].trade_keys.length,0);
});
