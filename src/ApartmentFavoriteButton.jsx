import React,{useState} from 'react';
import './apartment-favorites.css';
import {Star} from 'lucide-react';
import {sameApartmentFavorite,apartmentFavoriteLabel,makeApartmentFavorite,mapApartmentFavorite,mapApartmentFavoriteMatches} from './apartment-favorites.js';
export default function ApartmentFavoriteButton({apartment,region,favorites=[],onToggle,compact=false,mapScope=false}) {
  const [pending,setPending]=useState(false),[failed,setFailed]=useState(false);
  if(!onToggle)return null;
  const selected=mapScope?mapApartmentFavorite(apartment,favorites):null;
  const related=mapScope?favorites.filter(favorite=>mapApartmentFavoriteMatches(apartment,favorite)):[];
  const mixed=mapScope&&!selected&&related.length>1;
  const item=selected||makeApartmentFavorite(apartment,region),saved=mixed||favorites.some(favorite=>sameApartmentFavorite(favorite,item));
  const action=saved?'즐겨찾기 해제':'즐겨찾기 추가';
  const toggle=async()=>{
    setPending(true);setFailed(false);
    try{setFailed(await onToggle(item)===false);}catch{setFailed(true);}finally{setPending(false);}
  };
  return <button className={`apartment-favorite-button ${compact?'compact':''}`} aria-label={apartmentFavoriteLabel(item)+' '+(mixed?'저장한 구역 '+related.length+'곳':action)} aria-pressed={mixed?'mixed':saved} aria-busy={pending} disabled={pending||mixed} title={mixed?'단지 거래에서 저장한 구역을 각각 확인하거나 해제하세요.':failed?'즐겨찾기를 저장하지 못했습니다.':action} onClick={toggle}><Star size={16} fill={saved?'currentColor':'none'}/>{!compact&&(pending?'변경 중…':failed?'저장 실패':mixed?'저장한 구역 '+related.length+'곳':saved?'즐겨찾기 저장됨':action)}{failed&&<span className="sr-only" role="alert">즐겨찾기를 저장하지 못했습니다.</span>}</button>;
}
