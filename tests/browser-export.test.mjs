import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserPayloads,writeBrowserPayloads,writeBrowserRegistry,checkBrowserData} from '../server/browser-export.mjs';
const row={id:1,region_code:'12345',dong:'동네',jibun:'1',apartment:'관심단지',road_address:'도로 1',area_m2:60,price_man:100000,floor:10,deal_date:'2026-09-20',deal_month:'202609',cancelled:0,raw:{cdealDay:'',unused:'large original response'}};
test('monthly browser export preserves identities and cancellation dates without copying unused raw fields',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'home-browser-'));t.after(()=>{assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('home-browser-'));fs.rmSync(folder,{recursive:true,force:true});});
  const source=[{...row,id:2,cancelled:1,deal_month:'202610',deal_date:'2026-10-01',raw:{cdealDay:'2026-10-02'}},row];
  const result=browserPayloads(new Map([['12345',source]])),manifest={districts:{'12345':{count:2,sha256:'source',browser:result.districts['12345']}}};
  writeBrowserPayloads(folder,result.payloads);writeBrowserRegistry(folder,manifest,result.districts);checkBrowserData(folder,manifest);
  const catalog=JSON.parse(fs.readFileSync(path.join(folder,result.districts['12345'].file)));
  assert.equal(catalog.catalog.length,1);assert.equal(catalog.latest[0].id,1);assert.deepEqual(Object.keys(catalog.months),['202609','202610']);
  const october=JSON.parse(fs.readFileSync(path.join(folder,catalog.months['202610'])));assert.equal(october[0].raw.cdealDay,'2026-10-02');assert.equal(october[0].jibun,'1');
  assert(![...result.payloads.values()].some(bytes=>bytes.includes('unused')));
  fs.appendFileSync(path.join(folder,catalog.months['202610']),' ');assert.throws(()=>checkBrowserData(folder,manifest));
});
