import {readInstalledBaseline,baselineHash} from './apartment-baseline-state.mjs';
import {HOUSING_IDENTITY_SCHEMA,HOUSING_IDENTITY_INVALIDATION_SCHEMA} from './housing-identity-schema.mjs';
import {housingSourceFingerprint,housingQueryInformation} from './housing-export.mjs';
import {sourceIdentityId} from '../src/housing-identity.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {listingBuildingDong} from '../src/naver-listings.mjs';
import {tradeDigest} from './trade-integrity.mjs';
import {normalizeParcel} from '../src/address-identity.mjs';

const unresolved={precision:'unresolved',root_id:null,cohort_id:null,building_id:null};
const BINDING_VERSION=2;
export const baselinePattern=row=>JSON.stringify([listingBuildingDong(JSON.parse(row.raw_json).aptDong),row.build_year]);
const stats=meta=>({version:1,row_count:meta.row_count,entity_count:meta.entity_count,cohort_count:meta.cohort_count,precision_counts:meta.precision_counts,source_fingerprint:meta.source_fingerprint,baseline_sha256:meta.baseline_sha256});

export function resolveBaselineSource(payload,row){
 const reported=sourceIdentityId(row),providerId=JSON.parse(row.raw_json).aptSeq?.trim();
 const approved=providerId?payload.providers.molit[providerId]||[]:[reported];
 const sameParcel=approved.filter(id=>{const [code,dong,jibun]=JSON.parse(id);return code===row.region_code&&dong.trim()===row.dong.trim()&&normalizeParcel(jibun)===normalizeParcel(row.jibun);});
 const source=approved.includes(reported)?reported:!payload.rules[reported]&&sameParcel.length===1?sameParcel[0]:null;
 return {reported,providerId,source,scopeConflict:Boolean(providerId&&approved.length&&!source)};
}

export function baselineTradeBinding(payload,row){
 const {reported,source}=resolveBaselineSource(payload,row);
 const rule=source&&payload.rules[source];
 if(!rule||JSON.parse(source)[0]!==row.region_code)return {entity_id:reported,...unresolved};
 const exact=rule.exceptions?.[tradeDigest(row,{includeId:false})];
 return {entity_id:source,...(exact||rule.patterns[baselinePattern(row)]||rule.default)};
}

export function deriveBaselineHousing(db){
 const baseline=readInstalledBaseline(db);
 if(!baseline)return null;
 const hasMeta=db.prepare("SELECT 1 FROM sqlite_master WHERE name='housing_identity_meta'").get();
 const saved=hasMeta&&db.prepare("SELECT value FROM housing_identity_meta WHERE key='generation'").get();
 if(saved){const meta=JSON.parse(saved.value);if(meta.baseline_sha256===baseline.manifest.generation&&meta.binding_version===BINDING_VERSION)return stats(meta);}
 db.exec(HOUSING_IDENTITY_SCHEMA+HOUSING_IDENTITY_INVALIDATION_SCHEMA);
 const rows=db.prepare('SELECT * FROM trades ORDER BY id').all(),payload=baseline.payload;
 const entities=new Map(payload.housing.entities.map(entity=>[entity.entity_id,{...structuredClone(entity),row_count:0,precision_counts:{building:0,cohort:0,complex:0,unresolved:0}}]));
 const regionNames=new Map(payload.tables.regions.rows.map(row=>[row[2],row[3]]));
 const bindings=[];
 for(const row of rows){
  const binding=baselineTradeBinding(payload,row);
  let entity=entities.get(binding.entity_id);
  if(!entity){
   const ref={kind:'source',id:binding.entity_id};
   entity={entity_id:binding.entity_id,favorite:makeApartmentFavorite({...row,identity_ref:ref,identity_coverage:{entity_ids:[ref.id],cohort_ids:[],root_ids:[]},housing_source_kind:'APT'},{...row,region_name:regionNames.get(row.region_code)||''}),state:'insufficient',method:'unapproved_provider',cohort_ids:[],root_ids:[],legal_types:[],row_count:0,precision_counts:{building:0,cohort:0,complex:0,unresolved:0}};
   entities.set(entity.entity_id,entity);
  }
  entity.row_count++;entity.precision_counts[binding.precision]++;
  bindings.push({trade_id:row.id,...binding});
 }
 const precision_counts={building:0,cohort:0,complex:0,unresolved:0};
 for(const binding of bindings)precision_counts[binding.precision]++;
 const meta={version:1,binding_version:BINDING_VERSION,row_count:rows.length,entity_count:entities.size,cohort_count:payload.housing.cohorts.length,roots:payload.housing.roots,source_fingerprint:housingSourceFingerprint(rows),generated_at:new Date().toISOString(),baseline_sha256:baseline.manifest.generation,provider_sources:payload.providers.molit,precision_counts};
 db.exec('SAVEPOINT baseline_housing');
 try{
  db.exec('DELETE FROM housing_identity_bindings; DELETE FROM housing_identity_entities; DELETE FROM housing_identity_cohorts; DELETE FROM housing_identity_members');
  const entityWrite=db.prepare('INSERT INTO housing_identity_entities VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(const entity of entities.values())entityWrite.run(entity.entity_id,JSON.stringify(entity.favorite),entity.state,entity.method,JSON.stringify(entity.cohort_ids),JSON.stringify(entity.root_ids),JSON.stringify(entity.legal_types),entity.row_count,JSON.stringify(entity.precision_counts),JSON.stringify({baseline_sha256:meta.baseline_sha256}),meta.generated_at);
  const cohortWrite=db.prepare('INSERT INTO housing_identity_cohorts VALUES(?,?,?,?,?)');
  for(const cohort of payload.housing.cohorts)cohortWrite.run(cohort.cohort_id,cohort.root_id,cohort.master_id,JSON.stringify(cohort),meta.generated_at);
  const memberWrite=db.prepare('INSERT INTO housing_identity_members VALUES(?,?,?,?)');
  for(const entity of entities.values())for(const id of entity.cohort_ids)memberWrite.run(entity.entity_id,id,'local_baseline',JSON.stringify({baseline_sha256:meta.baseline_sha256}));
  const bindingWrite=db.prepare('INSERT INTO housing_identity_bindings VALUES(?,?,?,?,?,?,?,?)');
  for(const binding of bindings)bindingWrite.run(binding.trade_id,binding.entity_id,binding.precision,binding.root_id,binding.cohort_id,binding.building_id,'local_baseline',JSON.stringify({baseline_sha256:meta.baseline_sha256}));
  db.prepare('INSERT OR REPLACE INTO housing_identity_meta VALUES(?,?)').run('generation',JSON.stringify(meta));
  db.exec('RELEASE baseline_housing');
 }catch(error){db.exec('ROLLBACK TO baseline_housing; RELEASE baseline_housing');throw error;}
 return stats(meta);
}

export function baselineApartmentInformation(db){
 const baseline=readInstalledBaseline(db);
 if(!baseline)return null;
 deriveBaselineHousing(db);
 const known=new Set(baseline.payload.information.apartments.map(item=>item.id)),extra=[];
 const entities=db.prepare('SELECT * FROM housing_identity_entities ORDER BY entity_id').all().map(row=>({entity_id:row.entity_id,favorite:JSON.parse(row.favorite_json),state:row.state,cohort_ids:JSON.parse(row.cohort_ids_json),root_ids:JSON.parse(row.root_ids_json),legal_types:JSON.parse(row.legal_types_json)}));
 const queries=new Map(housingQueryInformation(baseline.payload.information,{...baseline.payload.housing,entities}).apartments.map(item=>[item.id,item]));
 for(const row of db.prepare('SELECT favorite_json FROM housing_identity_entities ORDER BY entity_id').iterate()){
  const stored=JSON.parse(row.favorite_json);if(known.has(stored.id))continue;
  const favorite=queries.get(stored.id);
  extra.push({...favorite,selection_id:favorite.id,scope_kind:'source',root_ids:[],active:true,residential_status:'unresolved',map_visible:false,map_member_refs:[],name_aliases:[favorite.apartment],postal_code:null,addresses:[],location:{status:'missing',precision:'unknown',latitude:null,longitude:null,building_id:null,entrance_index:null,source:null,observed_at:null,anchors:[]},area:{identity_ref:favorite.identity_ref,geometry_scope:null,legal_code:'',region_ids:[],parcels:[],boundary_refs:[],boundary_ids:[],bbox:null,zoning_refs:[]}});
 }
 const information=baseline.payload.information;
 return {...information,generation:extra.length?baselineHash({generation:information.generation,extra}):information.generation,apartments:[...information.apartments,...extra],baseline_sha256:baseline.manifest.generation};
}
