const DAY = 86400000;
const iso = date => date.toISOString().slice(0,10);

export function dateBounds(start,end) {
  if(!weekBounds(start)||!weekBounds(end)||start>end)return null;
  return {start,end};
}
export function monthBounds(month) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return null;
  const first=new Date(`${month}-01T00:00:00Z`);
  const last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  return {start:iso(first),end:iso(last)};
}
export function shiftMonth(month,direction) {
  const bounds=monthBounds(month);if(!bounds)return '';
  const date=new Date(`${bounds.start}T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+direction);
  return iso(date).slice(0,7);
}
export function recentRange(day,count,earliest='') {
  if(!weekBounds(day)||!Number.isInteger(count)||count<1)return null;
  const start=iso(new Date(new Date(`${day}T00:00:00Z`).getTime()-(count-1)*DAY));
  return dateBounds(earliest&&start<earliest?earliest:start,day);
}
export function periodBounds(period,day) {
  return period.mode==='month'?monthBounds(period.month):period.mode==='custom'?dateBounds(period.start,period.end):weekBounds(day);
}

export function weekBounds(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day||'')) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || iso(date)!==day) return null;
  const monday = new Date(date.getTime()-((date.getUTCDay()+6)%7)*DAY);
  return {start:iso(monday),end:iso(new Date(monday.getTime()+6*DAY))};
}

export function shiftWeek(day, direction) {
  const week=weekBounds(day);
  return week ? iso(new Date(new Date(`${week.start}T00:00:00Z`).getTime()+direction*7*DAY)) : '';
}

export function publishedDay(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const value = type => parts.find(part=>part.type===type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function weeklyRows(rows, region, week, includeCancelled = false) {
  if (!week) return [];
  return rows.filter(row=>row.region_code===region.region_code && region.dongs.includes(row.dong) && (includeCancelled || row.cancelled===0) && row.deal_date>=week.start && row.deal_date<=week.end)
    .sort((a,b)=>b.deal_date.localeCompare(a.deal_date)||b.id-a.id);
}
