import {validIdentityRef} from './housing-identity.mjs';

export function housingBindingsMap(payload) {
  if(payload?.version!==1||!Array.isArray(payload.entities)||!Array.isArray(payload.cohorts)||!Array.isArray(payload.roots)||!Array.isArray(payload.dictionary)||!Array.isArray(payload.assignments)||payload.row_count!==payload.assignments.length)throw Error('주거 연결 공개 자료 형식 오류');
  const entities=new Set(payload.entities.map(item=>item.entity_id)),cohorts=new Map(payload.cohorts.map(item=>[item.cohort_id,item])),roots=new Set(payload.roots.map(item=>item.root_id));
  if(payload.provider_sources!==undefined&&(!payload.provider_sources||Array.isArray(payload.provider_sources)||typeof payload.provider_sources!=='object'||Object.entries(payload.provider_sources).some(([id,values])=>!id||!Array.isArray(values)||values.some(value=>!entities.has(value)))))throw Error('공식 단지 ID의 로컬 승인 목록 오류');
  if(entities.size!==payload.entities.length||cohorts.size!==payload.cohorts.length||roots.size!==payload.roots.length)throw Error('주거 연결 식별자 중복');
  if(payload.entities.some(item=>!validIdentityRef({kind:'source',id:item.entity_id}))||payload.roots.some(item=>!validIdentityRef({kind:'root',id:item.root_id}))||payload.cohorts.some(item=>!validIdentityRef({kind:'cohort',id:item.cohort_id})||!roots.has(item.root_id)))throw Error('주거 연결 상위 식별자 오류');
  for(const item of payload.dictionary){
    if(!item||!entities.has(item.entity_id)||!validIdentityRef({kind:'source',id:item.entity_id})||!['building','cohort','complex','unresolved'].includes(item.precision))throw Error('주거 연결 배정 형식 오류');
    if(item.provider_apartment_id!==undefined&&(typeof item.provider_apartment_id!=='string'||!payload.provider_sources?.[item.provider_apartment_id]?.includes(item.entity_id)))throw Error('공식 단지 ID의 로컬 승인 연결 오류');
    if(['building','cohort'].includes(item.precision)){
      const cohort=cohorts.get(item.cohort_id);
      if(!cohort||cohort.root_id!==item.root_id||item.precision==='building'&&!cohort.building_ids.includes(item.building_id)||item.precision==='cohort'&&item.building_id!==null)throw Error('주거 연결 건물 참조 오류');
    }else if(item.root_id||item.cohort_id||item.building_id)throw Error('주거 연결 정밀도 모순');
  }
  const result=new Map();
  for(const pair of payload.assignments){
    if(!Array.isArray(pair)||pair.length!==2)throw Error('주거 연결 공개 배정 오류');
    const [id,index]=pair;
    if(!Number.isSafeInteger(id)||!Number.isSafeInteger(index)||!payload.dictionary[index]||result.has(id))throw Error('주거 연결 공개 배정 오류');
    result.set(id,payload.dictionary[index]);
  }
  return result;
}
