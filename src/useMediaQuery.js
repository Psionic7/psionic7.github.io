import {useEffect,useState} from 'react';
export default function useMediaQuery(query){
  const [matches,setMatches]=useState(()=>window.matchMedia?.(query).matches||false);
  useEffect(()=>{const media=window.matchMedia?.(query);if(!media)return;const change=()=>setMatches(media.matches);change();media.addEventListener?.('change',change);return()=>media.removeEventListener?.('change',change);},[query]);
  return matches;
}
