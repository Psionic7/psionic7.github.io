import test from 'node:test';
import assert from 'node:assert/strict';
import {PYEONG_M2, apartmentKey} from '../src/domain.mjs';
import {weeklyRows} from '../src/weekly.mjs';
import {favoriteTradeMatches} from '../src/apartment-favorites.js';
import {weeklyResultRows} from '../src/weekly/query.mjs';

const region = {region_code: '41465', dongs: ['동A', '동B']};
const range = {start: '2026-10-05', end: '2026-10-11'};
const rows = Array.from({length: 240}, (_, id) => Object.freeze({
  id, region_code: id % 7 ? '41465' : '11110', dong: id % 3 ? '동A' : '동B',
  jibun: String(id % 4), apartment: `단지${id % 5}`,
  deal_date: `2026-10-${String(3 + id % 11).padStart(2, '0')}`,
  area_m2: (10 + id % 31) * PYEONG_M2, cancelled: id % 9 === 0 ? 1 : 0,
}));
Object.freeze(rows);

test('filter-before-sort matches the original query for periods, cancellation, areas and master aliases', () => {
  const favorites = [region, {...region, key: apartmentKey(rows[1])}, {
    ...region, key: apartmentKey(rows[1]), master_id: 'hub:test',
    trade_keys: [apartmentKey(rows[1]), apartmentKey(rows[3])],
  }];
  let cases = 0;
  for (const selection of favorites) for (const includeCancelled of [false, true]) {
    for (const [minArea, maxArea] of [['', ''], [20 * PYEONG_M2, 30 * PYEONG_M2], [90, 50]]) {
      for (const selectedBands of [[], [10], [10, 30]]) {
        const expected = weeklyRows(rows, selection, range, includeCancelled).filter(row =>
          (!selection.key || favoriteTradeMatches(selection, row)) &&
          (minArea === '' || row.area_m2 >= minArea) &&
          (maxArea === '' || row.area_m2 <= maxArea) &&
          (!selectedBands.length || selectedBands.some(band => row.area_m2 >= band * PYEONG_M2 && row.area_m2 < (band + 10) * PYEONG_M2)));
        assert.deepEqual(weeklyResultRows(rows, selection, range, {minArea, maxArea, selectedBands, includeCancelled}), expected);
        cases++;
      }
    }
  }
  assert.equal(cases, 54);
  assert.deepEqual(weeklyResultRows(rows, region, null), []);
});
