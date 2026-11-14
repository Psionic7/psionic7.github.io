import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {atomicWrite,checkedBytes,ROOT} from './storage.mjs';
import {publicApartmentInformation,housingIdentityCatalog,housingTradeBindings} from './apartment-identity.mjs';
import {dailyListingTargets} from './daily-naver-listings.mjs';
import {readNaverMatch} from './apartment-naver-matches.mjs';
import {BASELINE_DIRECTORY,BASELINE_COLUMNS,baselineHash,baselineScopeHash,baselineConnections,readBaselineTable,readInstalledBaseline} from './apartment-baseline-state.mjs';
import {baselinePattern,baselineTradeBinding} from './apartment-baseline-runtime.mjs';
import {sourceIdentityId} from '../src/housing-identity.mjs';
import {tradeDigest} from './trade-integrity.mjs';
import {validateApartmentInformation,validateIdentityMap} from '../src/apartment-identity.mjs';
import {approvedMolitProviders} from './molit-source-connections.mjs';

const fields=['precision','root_id','cohort_id','building_id'];
const shape=binding=>Object.fromEntries(fields.map(field=>[field,binding[field]]));
const unresolved={precision:'unresolved',root_id:null,cohort_id:null,building_id:null};

export function createApartmentBaseline(db,{config,publicRoot=path.join(ROOT,'public'),directory=BASELINE_DIRECTORY}={}){
 if(readInstalledBaseline(db))throw Error('기준본은 로컬에서 확정한 원본 DB로 생성하세요.');
 const information=validateApartmentInformation(publicApartmentInformation(db)),housing=housingIdentityCatalog(db),bindings=housingTradeBindings(db);
 for(const entity of housing.entities){entity.row_count=0;entity.precision_counts={building:0,cohort:0,complex:0,unresolved:0};}
 const targets=dailyListingTargets(db,config);
 for(const target of targets){const match=readNaverMatch(db,target);if(!match||match.state==='verified'&&!match.scopeCurrent)throw Error('현재 범위와 일치하는 로컬 단지 연결을 먼저 확인하세요.');}
 const tables=Object.fromEntries(Object.keys(BASELINE_COLUMNS).map(name=>[name,readBaselineTable(db,name)]));
 const mapManifest=JSON.parse(fs.readFileSync(path.join(publicRoot,'apartment-map/manifest.json'),'utf8'));
 const readMap=meta=>{
  if(!/^(apartments-[a-f0-9]{12}\.json|boundaries-[a-f0-9]{12}\.geojson)$/.test(meta?.file||''))throw Error('기준 지도 파일 경로 오류');
  const bytes=fs.readFileSync(path.join(publicRoot,'apartment-map',meta.file));
  if(baselineHash(bytes)!==meta.sha256)throw Error('기준 지도 해시 불일치');return JSON.parse(bytes.toString('utf8'));
 };
 const map={manifest:{...mapManifest},apartments:readMap(mapManifest.apartments),boundaries:readMap(mapManifest.boundaries)};
 if(mapManifest.apartment_information_generation!==information.generation)throw Error('지도와 로컬 공통 정보의 기준 버전이 다릅니다. 먼저 내보내세요.');
 validateIdentityMap(map.apartments,information);delete map.manifest.generated_at;
 const rules={};
 for(const entity of housing.entities){
  rules[entity.entity_id]={default:{...unresolved},patterns:{},exceptions:{}};
 }
 const rows=db.prepare('SELECT * FROM trades ORDER BY id').all(),patterns=new Map(),providers={molit:approvedMolitProviders(db)};
 for(const row of rows){
  const binding=bindings.get(row.id),entity=sourceIdentityId(row);
  if(!binding||binding.entity_id!==entity||!rules[entity])throw Error('로컬 거래 배정이 누락됐습니다. 공통 정보를 재구성하세요.');
  const key=JSON.stringify([entity,baselinePattern(row)]),value=shape(binding);
  if(!patterns.has(key))patterns.set(key,new Map());patterns.get(key).set(JSON.stringify(value),value);
  const provider=JSON.parse(row.raw_json).aptSeq?.trim();
  if(provider&&!providers.molit[provider]?.includes(entity))throw Error('공식 실거래 단지 ID를 로컬에서 먼저 연결하세요: pnpm data:molit:link --apply');
 }
 for(const [key,values] of patterns){const [entity,pattern]=JSON.parse(key);if(values.size===1)rules[entity].patterns[pattern]=[...values.values()][0];}
 for(const row of rows){
  const entity=sourceIdentityId(row),rule=rules[entity],expected=shape(bindings.get(row.id));
  if(!rule.patterns[baselinePattern(row)])rule.exceptions[tradeDigest(row,{includeId:false})]=expected;
 }
 const payload={version:1,scope:{region_ids:[...config.region_ids].sort()},tables,information,housing,targets,rules,providers,map,
  memberships:db.prepare('SELECT DISTINCT c.apartment_id,i.region_id FROM apartment_complexes c JOIN apartment_buildings b USING(apartment_id) JOIN apartment_building_inventory i USING(building_id) WHERE c.active=1 AND i.active=1').all(),
  links:db.prepare("SELECT * FROM apartment_trade_links WHERE status IN ('matched','ambiguous')").all()};
 for(const row of rows)if(JSON.stringify(baselineTradeBinding(payload,row))!==JSON.stringify(bindings.get(row.id)))throw Error('기준 규칙이 기존 거래 배정을 재현하지 못했습니다.');
 const bytes=checkedBytes(JSON.stringify(payload)),generation=baselineHash(bytes),packed=checkedBytes(gzipSync(bytes));
 const file='baseline-'+generation.slice(0,12)+'.json.gz';
 const manifest={version:1,generation,scope_sha256:baselineScopeHash(config),connections_sha256:baselineHash(baselineConnections(payload)),payload:{file,sha256:baselineHash(packed),bytes:packed.length,uncompressed_sha256:generation,uncompressed_bytes:bytes.length},targets:targets.length,verifiedTargets:targets.filter(target=>readNaverMatch(db,target).state==='verified').length};
 atomicWrite(path.join(directory,file),packed);atomicWrite(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 for(const name of fs.readdirSync(directory))if(/^baseline-[a-f0-9]{12}\.json\.gz$/.test(name)&&name!==file)fs.unlinkSync(path.join(directory,name));
 return manifest;
}
