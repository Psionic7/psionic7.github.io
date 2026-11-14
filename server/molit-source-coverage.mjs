import {readInstalledBaseline} from './apartment-baseline-state.mjs';
import {baselineTradeBinding,resolveBaselineSource} from './apartment-baseline-runtime.mjs';

export function molitSourceCoverage(db){
 const baseline=readInstalledBaseline(db);if(!baseline)return {checked:0,regressions:[]};
 const groups=new Map();let checked=0;
 for(const row of db.prepare('SELECT * FROM trades').iterate()){
  const raw=JSON.parse(row.raw_json),providerId=raw.aptSeq?.trim();if(!providerId)continue;checked++;
  const scope=resolveBaselineSource(baseline.payload,row);
  if(scope.scopeConflict){
   const key=JSON.stringify([providerId,scope.reported]);
   if(!groups.has(key))groups.set(key,{providerId,source:scope.reported,rows:0,reason:'provider_scope_conflict',sampleTradeId:row.id});
   groups.get(key).rows++;continue;
  }
  const binding=baselineTradeBinding(baseline.payload,row);if(binding.precision!=='unresolved')continue;
  const prior=baselineTradeBinding(baseline.payload,{...row,raw_json:JSON.stringify({...raw,aptSeq:''})});
  if(prior.precision==='unresolved')continue;
  const key=JSON.stringify([providerId,prior.entity_id]);
  if(!groups.has(key))groups.set(key,{providerId,source:prior.entity_id,rows:0,reason:baseline.payload.providers.molit[providerId]?'provider_scope_conflict':'missing_local_provider',sampleTradeId:row.id});
  groups.get(key).rows++;
 }
 return {checked,regressions:[...groups.values()]};
}

export function assertMolitSourceCoverage(db){
 const report=molitSourceCoverage(db);
 if(report.regressions.length){
  const count=report.regressions.reduce((sum,item)=>sum+item.rows,0),ids=report.regressions.slice(0,5).map(item=>item.providerId).join(', ');
  const error=new Error(`데이터 검증 실패: 공식 단지 ID 연결 누락·범위 충돌 ${count}건으로 조회 자료를 게시할 수 없습니다 (${ids}). 로컬에서 data:molit:link로 검토·확정한 뒤 아파트 기준본을 다시 생성하세요.`);
  error.code='molit_source_coverage';error.report=report;throw error;
 }
 return report;
}
