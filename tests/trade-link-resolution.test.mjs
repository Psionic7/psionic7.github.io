import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTradeCandidates} from '../server/trade-link-resolution.mjs';
import {refreshApartmentFavorites,makeApartmentFavorite,favoriteTradeMatches} from '../src/apartment-favorites.js';
const trade={dong:'원천동',jibun:'35',apartment:'주공',year:1987};
const candidate=(id,changes={})=>({apartment_id:id,dong:'원천동',jibun:'35',road_address:'시험로 1',build_year:1987,...changes});
test('primary parcel prevents neighbouring attached-parcel complexes from absorbing trades',()=>{
  const result=resolveTradeCandidates(trade,[candidate('a'),candidate('b',{jibun:'36'})],new Map([['a',new Set(['주공'])],['b',new Set(['주공'])]]));
  assert.deepEqual(result.ids,['a']);
});
test('duplicate registry roots share trades only when primary parcel, official name, address and year agree',()=>{
  const aliases=new Map([['a',new Set(['주공'])],['b',new Set(['주공'])]]);
  assert.equal(resolveTradeCandidates(trade,[candidate('a'),candidate('b')],aliases).method,'shared_registry_address');
  for(const changes of [{road_address:'다른로 2'},{build_year:1988},{road_address:''}])assert.equal(resolveTradeCandidates(trade,[candidate('a'),candidate('b',changes)],aliases).method,'review');
  assert.equal(resolveTradeCandidates(trade,[candidate('a'),candidate('b')],new Map()).method,'review');
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
