import {useEffect,useState} from 'react';
import {listingClient} from '../naver-listings-client.js';

export default function useApartmentListings(apartments,client=listingClient) {
  const key=JSON.stringify(apartments);
  const [attempt,setAttempt]=useState(0),[result,setResult]=useState({key:'',status:'loading'});
  useEffect(()=>{
    if(!apartments.length)return;
    let active=true;
    setResult({key,status:'loading'});
    client.load(apartments,[]).then(({snapshot})=>{
      if(active)setResult({key,status:'ready',snapshot});
    }).catch(()=>{if(active)setResult({key,status:'error'});});
    return()=>{active=false;};
  },[key,client,attempt]);
  return {...(result.key===key?result:{status:'loading'}),retry:()=>setAttempt(value=>value+1)};
}
