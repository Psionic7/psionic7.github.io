import {validListingSnapshot,validListingCollection} from './naver-listings.mjs';

const targets=(favorites,connections)=>({version:1,favorites,connections});
async function readJson(url,options) {
  const response=await fetch(url,{cache:'no-store',...options});
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('매물 수집 결과를 불러오지 못했습니다.');
  return response.json();
}
async function post(action,input) {
  const snapshot=await readJson('/api/naver-listings/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  if(!validListingSnapshot(snapshot))throw new Error('매물 수집 결과 형식이 올바르지 않습니다.');
  return snapshot;
}
export const listingClient={
  async status() {
    try{
      const value=await readJson('/listings/collection.json');
      if(value.version!==1||value.source!=='naver-land'||value.collection!==null&&!validListingCollection(value.collection))throw new Error('매물 일일 수집 상태 형식을 확인하세요.');
      return value.collection;
    }catch{return null;}
  },
  async load(favorites,connections) {
    let available=false;
    try{available=(await readJson('/api/naver-listings/status')).available===true;}catch{}
    const snapshot=available?await post('read',targets(favorites,connections)):await readJson('/listings/snapshot.json');
    if(!validListingSnapshot(snapshot))throw new Error('저장된 매물 자료를 확인하지 못했습니다.');
    return {available,snapshot};
  },
  async collect(favorite,complexNo) {
    return (await post('collect',{...targets([favorite],[{favoriteId:favorite.id,complexNo}]),force:true})).groups[0];
  },
};

export function downloadListingTargets(favorites,connections) {
  const blob=new Blob([JSON.stringify(targets(favorites,connections),null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download='naver-listing-targets.json';anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
