import React from 'react';
import WeeklyPage from './WeeklyPage.jsx';
import {publishedDay,weekBounds,monthBounds,dateBounds} from './weekly.mjs';
import {useStoredState} from './preferences.js';
export default function Dashboard({manifest,catalog,favorites,onRemoveFavorite,onOpenApartment,onAddApartments,districtLoader}) {
  const latest=publishedDay(manifest.published_at),first=manifest.months[0];
  const earliest=first?`${first.slice(0,4)}-${first.slice(4)}-01`:'';
  const latestWeek=weekBounds(latest)?.start||'';
  const [day,setDay]=useStoredState('favoriteDashboard','day',latestWeek,value=>!!weekBounds(value)&&(!earliest||value>=weekBounds(earliest).start)&&value<=latestWeek);
  const validMonth=value=>!!monthBounds(value)&&(!earliest||value>=earliest.slice(0,7))&&value<=latest.slice(0,7);
  const validRange=value=>!!dateBounds(value?.start,value?.end)&&(!earliest||value.start>=earliest)&&value.end<=latest;
  const [period,setPeriod]=useStoredState('favoriteDashboard','period',{mode:'week',month:manifest.months.at(-1)?.replace(/^(\d{4})(\d{2})$/,'$1-$2')||latest.slice(0,7),start:earliest&&day<earliest?earliest:day,end:latest},value=>value&&['week','month','custom'].includes(value.mode)&&validMonth(value.month)&&validRange(value));
  return <WeeklyPage favoritesView manifest={manifest} catalog={catalog} favoriteApartments={favorites} day={day} onDayChange={value=>setDay(weekBounds(value)?.start||'')} period={period} onPeriodChange={setPeriod} onRemoveFavorite={onRemoveFavorite} onOpenApartment={onOpenApartment} onAddApartments={onAddApartments} districtLoader={districtLoader}/>;
}
