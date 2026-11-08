import test from 'node:test';
import assert from 'node:assert/strict';
import {listingQueryName,listingPhase,listingPhaseMatches,listingFavoritePhase} from '../server/naver-listing-names.mjs';

test('a verified numbered alias gives a precise query instead of the generic village name',()=>{
 assert.equal(listingQueryName({apartment:'백현마을',name_aliases:['백현마을8단지(대림)','백현마을8단지아파트']},'백현마을'),'백현마을8단지');
 assert.equal(listingQueryName({apartment:'수지삼성래미안1차아파트',name_aliases:['삼성1차']},'삼성'),'삼성1차');
});
test('conflicting or compound phase names do not impose a single phase',()=>{
 assert.equal(listingPhase(['양지마을1단지','양지마을2단지']),null);
 assert.equal(listingPhase(['주공4-1단지']),null);
 assert.equal(listingQueryName({apartment:'양지마을',name_aliases:['양지마을1단지','양지마을2단지']},'양지마을'),'양지마을');
});
test('a registered phase rejects a different explicit phase and retains unnumbered names',()=>{
 assert.equal(listingPhaseMatches('8','백현마을7단지'),false);
 assert.equal(listingPhaseMatches('8','백현마을8단지'),true);
 assert.equal(listingPhaseMatches('8','백현마을'),true);
 assert.equal(listingFavoritePhase({apartment:'백현마을',trade_keys:[JSON.stringify(['백현동','558','백현마을8단지'])],name_aliases:['백현마을7단지']}),'8');
});
