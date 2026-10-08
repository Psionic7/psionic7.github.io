import React from 'react';
import WeeklyPage from './WeeklyPage.jsx';
export default function Dashboard({manifest,catalog,favorites,filters,onRemoveFavorite,onOpenApartment,onAddApartments,districtLoader}) {
  return <WeeklyPage favoritesView manifest={manifest} catalog={catalog} favoriteApartments={favorites} filters={filters} onRemoveFavorite={onRemoveFavorite} onOpenApartment={onOpenApartment} onAddApartments={onAddApartments} districtLoader={districtLoader}/>;
}
