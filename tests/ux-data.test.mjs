import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchIndex} from '../src/search-index.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {mapTilePayloads,digest} from '../server/map-tiles.mjs';
import {intersects} from '../src/map-bounds.mjs';
import {createJsonCache} from '../src/json-cache.mjs';
const region={region_code:'41465',region_name:'경기도 용인시 수지구'};
const trade={region_code:'41465',dong:'풍덕천동',jibun:'1',apartment:'옛 이름',road_address:'도로 1',deal_date:'2026-09-01'};
test('transaction search includes unlocated trades and reconciles linked aliases without merging different lots',()=>{
 const master={...makeApartmentFavorite({...trade,apartment:'새 이름',master_id:'hub:one'},region),trade_keys:[JSON.stringify(['풍덕천동','1','옛 이름'])],name_aliases:['공식 별칭']};
 const missing={...trade,apartment:'지도에 없는 아파트',jibun:'2'};
 const otherLot={...trade,jibun:'3'};
 const result=buildSearchIndex(new Map([['41465',[trade,{...trade,deal_date:'2026-10-01'},missing,otherLot]]]),[region],[master]);
 assert.equal(result.length,3);const linked=result.find(r=>r.master_id);
 assert.equal(linked.id,'hub:one');assert.equal(linked.last_deal_date,'2026-10-01');assert(linked.name_aliases.includes('옛 이름'));assert(linked.name_aliases.includes('공식 별칭'));
 assert(result.some(r=>r.apartment==='지도에 없는 아파트'));assert(result.some(r=>r.jibun==='3'&&!r.master_id));
});
test('spatial pieces preserve cross-cell geometry and every feature exactly once',()=>{
 const feature=(id,x)=>({type:'Feature',id,properties:{apartment_ids:['one']},geometry:{type:'Polygon',coordinates:[[[x,37],[x+.03,37],[x+.03,37.01],[x,37.01],[x,37]]]}});
 const source={features:[feature('crossing',127),feature('far',128)]};
 const {manifest,payloads}=mapTilePayloads(source,'source');assert.equal(manifest.feature_count,2);
 const ids=[];for(const tile of manifest.tiles){const bytes=payloads.get(tile.file);assert.equal(digest(bytes),tile.sha256);assert(tile.file.includes(tile.sha256.slice(0,12)));for(const f of JSON.parse(bytes).features)ids.push(f.id);}
 assert.deepEqual(ids.sort(),['crossing','far']);
 const view=[127,37,127.005,37.005],selected=manifest.tiles.filter(t=>intersects(t.bbox,view));assert.equal(selected.length,1);assert.equal(JSON.parse(payloads.get(selected[0].file)).features[0].id,'crossing');
});
test('JSON cache deduplicates in-flight work, retries failure and evicts old settled entries by size',async()=>{
 const calls=[];let release;
 const cache=createJsonCache(async key=>{calls.push(key);if(key==='wait'&&calls.filter(item=>item==='wait').length===1)await new Promise(resolve=>release=resolve);if(key==='bad')throw new Error('offline');return key;},{maxEntries:2,maxCharacters:7,sizeOf:s=>s.length});
 const first=cache('wait'),second=cache('wait');assert.equal(first,second);await Promise.resolve();release();await first;
 await assert.rejects(cache('bad'),/offline/);await assert.rejects(cache('bad'),/offline/);assert.equal(calls.filter(k=>k==='bad').length,2);
 await cache('abc');await cache('def');await cache('wait');assert.equal(calls.filter(k=>k==='wait').length,2);
});
