import {recentMonths} from '../automation/config.mjs';
import {collectMonth} from './collector.mjs';

export const REPAIR_KEY = 'trade-repair-2026-10-18';
export const REPAIR_MONTHS = {
  '41117': ['202605', '202607', '202608'],
  '41135': ['202605'],
  '41465': ['202605', '202606', '202607'],
};

// The cursor advances only after a successful collection of the entire batch.
// A failed job retries the same historical months instead of skipping them.
export function refreshPlan(db, settings, now = new Date()) {
  const recent = recentMonths(settings.recent_months, now);
  const first = db.prepare('SELECT min(month) AS month FROM (SELECT deal_month AS month FROM trades UNION ALL SELECT deal_month AS month FROM collection_runs)').get().month;
  const older = [];
  if (first) {
    const date = new Date(`${first.slice(0,4)}-${first.slice(4)}-01T00:00:00Z`);
    for (let month=first;month<recent[0];month=date.toISOString().slice(0,7).replace('-','')) {
      older.push(month);date.setUTCMonth(date.getUTCMonth()+1);
    }
  }
  const cursor = db.prepare("SELECT value FROM metadata WHERE key='historical_refresh_cursor'").get()?.value || '';
  const ordered = [...older.filter(month => month > cursor), ...older.filter(month => month <= cursor)];
  const history = ordered.slice(0, 12);
  return {months: [...new Set([...recent, ...history])].sort(), recent, history};
}

export async function repairTradeData(db, key, {collector = collectMonth, onProgress = console.log} = {}) {
  if (db.prepare('SELECT value FROM metadata WHERE key=?').get(REPAIR_KEY)) return {changed: false, tasks: 0};
  if (!key) throw new Error('실거래 API 키를 설정하세요.');
  let tasks = 0;
  for (const [code, months] of Object.entries(REPAIR_MONTHS)) {
    const name = db.prepare('SELECT region_name FROM regions WHERE region_code=? LIMIT 1').get(code)?.region_name || code;
    for (const month of months) {
      const count = await collector(db, key, code, month, name);
      onProgress(`원천 재대조 ${name} ${month}: ${count}건`);
      tasks++;
    }
  }
  db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(REPAIR_KEY, new Date().toISOString());
  return {changed: true, tasks};
}
