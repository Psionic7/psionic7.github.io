import {PYEONG_M2} from '../domain.mjs';
import {favoriteTradeMatches} from '../apartment-favorites.js';
import {weeklyRows} from '../weekly.mjs';

export const validRecentCount=value=>value==='' || Number.isInteger(value)&&value>=1&&value<=1000;

// Check district/date first, then area/apartment, and sort only the final rows.
// weeklyRows owns the ordering and never mutates the source dataset.
export function weeklyResultRows(rows, region, range, {
  minArea = '', maxArea = '', selectedBands = [], includeCancelled = false, recentCount = '',
} = {}) {
  const filtered=weeklyRows(rows, region, range, includeCancelled, row =>
    (minArea === '' || row.area_m2 >= minArea) &&
    (maxArea === '' || row.area_m2 <= maxArea) &&
    (!selectedBands.length || selectedBands.some(band =>
      row.area_m2 >= band * PYEONG_M2 && row.area_m2 < (band + 10) * PYEONG_M2)) &&
    (!region.key || favoriteTradeMatches(region, row)));
  return recentCount!==''&&validRecentCount(recentCount)?filtered.slice(0,recentCount):filtered;
}
