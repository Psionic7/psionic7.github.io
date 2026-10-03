import test from 'node:test';
import assert from 'node:assert/strict';
import { apartmentSummary, areaSummary, buildCatalog, csv, favoriteRegions, filterRaw, filterError, monthSequence, monthly, rawFields, scopeRows, stats, validRows } from '../src/domain.mjs';
const make = (id, overrides={}) => ({id,region_code:'41465',deal_month:'202601',deal_date:'2026-01-05',apartment:'같은이름',dong:'풍덕천동',jibun:'1',price_man:100000,area_m2:85,floor:4,build_year:2000,cancelled:0,raw:{aptNm:'같은이름',dealAmount:'100,000',floor:'4',aptDong:'',unknown:'새 필드'},...overrides});
test('legacy presets disappear and favorites only use explicit valid saved IDs',()=>{
  const regions=[{region_id:'suji',region_code:'41465',region_name:'경기도 용인시 수지구',label:'용인 수지구',dongs:[]},
    {region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',label:'경기도 용인시 수지구 풍덕천동',dongs:['풍덕천동']}];
  const catalog=buildCatalog(regions);
  assert.ok(!catalog.some(region=>region.region_id==='suji'));
  assert.ok(catalog.some(region=>region.region_id==='area_41465'));
  assert.deepEqual(favoriteRegions({regions}),[]);
  assert.deepEqual(favoriteRegions({regions,favorite_region_ids:['missing','dong_41465101','dong_41465101']}).map(region=>region.region_id),['dong_41465101']);
});
test('region scopes, inclusive dates/areas and cancellations reproduce existing rules',()=>{
  const rows=[make(1),make(2,{dong:'죽전동'}),make(3,{cancelled:1}),make(4,{deal_month:'202602'}),make(5,{region_code:'41135'})];
  const scoped=scopeRows(rows,{region_code:'41465',dongs:['풍덕천동']},'202601','202601');
  assert.deepEqual(scoped.map(row=>row.id),[1,3]);
  assert.deepEqual(validRows(scoped,85,85).map(row=>row.id),[1]);
  assert.equal(scopeRows(rows,{region_code:'41465',dongs:[]},'202601','202602').length,4);
});
test('median and apartment identity keep equal-name, different-lot trades separate',()=>{
  const rows=[make(1),make(2,{price_man:120000}),make(3,{jibun:'2',price_man:50000})];
  const result=stats(rows);
  assert.equal(result.median,10); assert.equal(result.apartments,2);
  assert.ok(Math.abs(result.pyeong-100000*3.305785/85)<1e-9);
  const groups=apartmentSummary(rows); assert.equal(groups[0].count,2); assert.equal(groups[0].median,11);
});
test('monthly gaps stay empty rather than inventing a zero price',()=>{
  assert.deepEqual(monthSequence('202512','202602'),['202512','202601','202602']);
  const result=monthly([make(1)],'202512','202602');
  assert.equal(result[0].count,0); assert.equal(result[0].median,null); assert.equal(result[1].median,10);
  assert.deepEqual(monthSequence('202613','202614'),[]);
});
test('area bands are right-inclusive at 60, 85, 102 and 135',()=>{
  const result=areaSummary([60,85,102,135,136].map((area_m2,index)=>make(index,{area_m2})));
  assert.deepEqual(result.map(row=>row.count),[1,1,1,1,1]);
});
test('all seven raw column filters combine and never normalize original strings',()=>{
  const rows=[make(1),make(2,{raw:{aptNm:'OTHER',dealAmount:'50,000',floor:'',aptDong:'101'}})];
  assert.equal(filterRaw(rows,{aptNm:{op:'contains',value:'같은'},dealAmount:{op:'gte',value:'90,000'}}).length,1);
  assert.equal(filterRaw(rows,{aptNm:{op:'equals',value:'other'}})[0].id,2);
  assert.equal(filterRaw(rows,{aptNm:{op:'excludes',value:'other'}})[0].id,1);
  assert.equal(filterRaw(rows,{aptDong:{op:'empty'}})[0].id,1);
  assert.equal(filterRaw(rows,{aptDong:{op:'not_empty'}})[0].id,2);
  assert.equal(filterRaw(rows,{dealAmount:{op:'lte',value:'50,000'}})[0].id,2);
  assert.equal(filterRaw(rows,{floor:{op:'gte',value:'0'}}).length,1);
  assert.ok(filterError({floor:{op:'gte',value:'wrong'}}));
  assert.equal(rows[0].raw.dealAmount,'100,000'); assert.ok(rawFields(rows).includes('unknown'));
  assert.equal(filterRaw(rows,{aptNm:{op:'equals',value:' OTHER '}}).length,0);
});
test('CSV keeps commas, quotes, newlines, blanks and every selected result',()=>{
  const rows=[make(1,{raw:{aptNm:'a,"b"\nc',floor:''}})];
  assert.equal(csv(rows,['aptNm','floor']),'\uFEFF"아파트명","층"\r\n"a,""b""\nc",""');
});
