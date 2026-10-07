import test from 'node:test';
import assert from 'node:assert/strict';
import {dateBounds,monthBounds,periodBounds,recentRange,publishedDay,shiftMonth,shiftWeek,weekBounds,weeklyRows} from '../src/weekly.mjs';

test('weeks span Monday to Sunday across months and years without timezone drift',()=>{
  assert.deepEqual(weekBounds('2026-10-04'),{start:'2026-09-28',end:'2026-10-04'});
  assert.deepEqual(weekBounds('2026-01-01'),{start:'2025-12-29',end:'2026-01-04'});
  assert.equal(shiftWeek('2026-10-01',-1),'2026-09-21');
  assert.equal(shiftWeek('2026-10-01',1),'2026-10-05');
  assert.equal(weekBounds('2026-02-30'),null);
  assert.equal(weekBounds(''),null);
  assert.equal(publishedDay('2026-10-03T17:00:00Z'),'2026-10-04');
});
test('flexible periods handle leap months, year changes and inclusive recent days',()=>{
  assert.deepEqual(monthBounds('2024-02'),{start:'2024-02-01',end:'2024-02-29'});
  assert.deepEqual(monthBounds('2026-12'),{start:'2026-12-01',end:'2026-12-31'});
  assert.equal(shiftMonth('2026-12',1),'2027-01');assert.equal(shiftMonth('2026-01',-1),'2025-12');
  assert.equal(monthBounds('2026-13'),null);assert.equal(dateBounds('2026-02-30','2026-03-01'),null);
  assert.equal(dateBounds('2026-10-03','2026-10-02'),null);
  assert.deepEqual(recentRange('2026-10-07',7),{start:'2026-10-01',end:'2026-10-07'});
  assert.deepEqual(recentRange('2026-10-07',90,'2026-09-01'),{start:'2026-09-01',end:'2026-10-07'});
  assert.deepEqual(periodBounds({mode:'custom',start:'2026-09-30',end:'2026-10-02'}),{start:'2026-09-30',end:'2026-10-02'});
  const rows=['2026-08-31','2026-09-01','2026-09-30','2026-10-01'].map((deal_date,id)=>({deal_date,id,region_code:'11110',dong:'청운동',cancelled:0}));
  assert.deepEqual(weeklyRows(rows,{region_code:'11110',dongs:['청운동']},monthBounds('2026-09')).map(row=>row.id),[2,1]);
});
test('weekly transactions include both boundaries and isolate same-named dongs by district',()=>{
  const region={region_code:'41465',dongs:['풍덕천동']};
  const row=(id,deal_date,overrides={})=>({id,deal_date,region_code:'41465',dong:'풍덕천동',cancelled:0,...overrides});
  const rows=[row(1,'2026-09-27'),row(2,'2026-09-28'),row(3,'2026-10-04'),row(4,'2026-10-05'),row(5,'2026-10-01',{cancelled:1}),row(6,'2026-10-01',{region_code:'11110'}),row(7,'2026-10-01',{dong:'동천동'})];
  assert.deepEqual(weeklyRows(rows,region,weekBounds('2026-10-02')).map(item=>item.id),[3,2]);
  assert.deepEqual(weeklyRows(rows,region,weekBounds('2026-10-02'),true).map(item=>item.id),[3,5,2]);
  assert.deepEqual(weeklyRows(rows,region,null),[]);
});
