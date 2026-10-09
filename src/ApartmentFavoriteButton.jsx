import React from 'react';
import './apartment-favorites.css';
import {Star} from 'lucide-react';
import {sameApartmentFavorite,apartmentFavoriteLabel,makeApartmentFavorite} from './apartment-favorites.js';
export default function ApartmentFavoriteButton({apartment,region,favorites=[],onToggle,compact=false}) {
  if(!onToggle)return null;
  const item=makeApartmentFavorite(apartment,region),saved=favorites.some(favorite=>sameApartmentFavorite(favorite,item));
  const action=saved?'즐겨찾기 해제':'즐겨찾기 추가';
  return <button className={`apartment-favorite-button ${compact?'compact':''}`} aria-label={apartmentFavoriteLabel(item)+' '+action} aria-pressed={saved} title={action} onClick={()=>onToggle(item)}><Star size={16} fill={saved?'currentColor':'none'}/>{!compact&&action}</button>;
}
