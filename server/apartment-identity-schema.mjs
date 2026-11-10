import {HOUSING_IDENTITY_DATA_SCHEMA} from './housing-identity-schema.mjs';

export const APARTMENT_IDENTITY_SCHEMA=`
CREATE TABLE IF NOT EXISTS apartment_identity (
 apartment_id TEXT PRIMARY KEY REFERENCES apartment_complexes(apartment_id),
 canonical_name TEXT NOT NULL,region_code TEXT NOT NULL,region_name TEXT NOT NULL,legal_code TEXT NOT NULL,
 dong TEXT NOT NULL,jibun TEXT NOT NULL,road_address TEXT NOT NULL,
 postal_code TEXT CHECK(postal_code IS NULL OR (length(postal_code)=5 AND postal_code NOT GLOB '*[^0-9]*')),
 postal_source TEXT,naver_complex_no TEXT,naver_name TEXT,active INTEGER NOT NULL,
 sources_json TEXT NOT NULL,updated_at TEXT NOT NULL,
 residential_status TEXT NOT NULL DEFAULT 'unresolved' CHECK(residential_status IN ('residential','ancillary_only','unresolved')),
 primary_building_id TEXT,primary_entrance_index INTEGER,spatial_generation TEXT,
 classification_evidence_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS apartment_identity_addresses (
 apartment_id TEXT NOT NULL REFERENCES apartment_complexes(apartment_id),
 road_address TEXT NOT NULL,jibun_address TEXT NOT NULL,postal_code TEXT,
 building_management_no TEXT NOT NULL,road_code TEXT NOT NULL,source TEXT NOT NULL,observed_at TEXT NOT NULL,
 PRIMARY KEY(apartment_id,road_address,building_management_no));
CREATE INDEX IF NOT EXISTS identity_parcel ON apartment_identity(region_code,dong,jibun);
CREATE INDEX IF NOT EXISTS identity_postal ON apartment_identity(postal_code);
CREATE INDEX IF NOT EXISTS identity_alias_name ON apartment_aliases(name);
CREATE INDEX IF NOT EXISTS identity_road ON apartment_identity_addresses(road_address);
CREATE VIEW IF NOT EXISTS apartment_information AS
 SELECT i.*,(SELECT json_group_array(name) FROM (SELECT name FROM apartment_aliases a WHERE a.apartment_id=i.apartment_id ORDER BY name)) AS name_aliases_json
 FROM apartment_identity i;
`;

const identityFields=['apartment_id','canonical_name','region_code','region_name','legal_code','dong','jibun','road_address','postal_code','postal_source','naver_complex_no','naver_name','active','sources_json','updated_at','residential_status','primary_building_id','primary_entrance_index','spatial_generation','classification_evidence_json'];
const rootFields=identityFields.map(field=>'i.'+field).join(',');
function relatedFields(kind){
 const favorite=kind==='cohort'?"json_extract(c.data_json,'$.favorite')":'s.favorite_json';
 const own=field=>`json_extract(${favorite},'$.${field}')`;
 const fields={apartment_id:kind==='cohort'?'c.root_id':"CASE WHEN json_array_length(s.root_ids_json)=1 THEN json_extract(s.root_ids_json,'$[0]') END",canonical_name:own('apartment'),region_code:own('region_code'),region_name:own('region_name'),legal_code:kind==='cohort'?'i.legal_code':'NULL',dong:own('dong'),jibun:own('jibun'),road_address:`coalesce(${own('road_address')},'')`,active:kind==='cohort'?'coalesce(i.active,1)':'1',sources_json:"coalesce(i.sources_json,'{}')",updated_at:kind==='cohort'?'c.updated_at':'s.updated_at',residential_status:kind==='cohort'?"coalesce(i.residential_status,'residential')":"CASE WHEN s.state='verified' THEN 'residential' ELSE 'unresolved' END",primary_building_id:'e.building_id',primary_entrance_index:'e.entrance_index',spatial_generation:'i.spatial_generation',classification_evidence_json:"coalesce(i.classification_evidence_json,'{}')"};
 return identityFields.map(field=>(fields[field]||'i.'+field)+' AS '+field).join(',');
}
const aliases="(SELECT json_group_array(name) FROM (SELECT name FROM apartment_aliases a WHERE a.apartment_id=i.apartment_id ORDER BY name))";
const positionFields='e.latitude,e.longitude,e.source AS position_source,e.fetched_at AS position_observed_at';
const view=`CREATE VIEW apartment_information AS
 SELECT ${rootFields},i.apartment_id AS selection_id,'root' AS scope_kind,${aliases} AS name_aliases_json,${positionFields},json_array(i.apartment_id) AS root_ids_json
 FROM apartment_identity i LEFT JOIN apartment_entrances e ON e.building_id=i.primary_building_id AND e.entrance_index=i.primary_entrance_index
 UNION ALL
 SELECT ${relatedFields('cohort')},c.cohort_id AS selection_id,'cohort' AS scope_kind,coalesce(json_extract(c.data_json,'$.favorite.name_aliases'),'[]') AS name_aliases_json,${positionFields},json_array(c.root_id) AS root_ids_json
 FROM housing_identity_cohorts c LEFT JOIN apartment_identity i ON i.apartment_id=c.root_id
 LEFT JOIN apartment_entrances e ON e.rowid=(SELECT ee.rowid FROM apartment_entrances ee WHERE ee.building_id IN (SELECT value FROM json_each(c.data_json,'$.building_ids')) ORDER BY ee.building_id,ee.entrance_index LIMIT 1)
 UNION ALL
 SELECT ${relatedFields('source')},s.entity_id AS selection_id,'source' AS scope_kind,coalesce(json_extract(s.favorite_json,'$.name_aliases'),'[]') AS name_aliases_json,${positionFields},s.root_ids_json
 FROM housing_identity_entities s LEFT JOIN apartment_identity i ON json_array_length(s.root_ids_json)=1 AND i.apartment_id=json_extract(s.root_ids_json,'$[0]')
 LEFT JOIN apartment_entrances e ON 0;`;

export function initializeApartmentIdentity(db){
 db.exec(APARTMENT_IDENTITY_SCHEMA+HOUSING_IDENTITY_DATA_SCHEMA);
 const columns=new Set(db.prepare('PRAGMA table_info(apartment_identity)').all().map(row=>row.name));
 for(const [name,definition] of Object.entries({residential_status:"TEXT NOT NULL DEFAULT 'unresolved' CHECK(residential_status IN ('residential','ancillary_only','unresolved'))",primary_building_id:'TEXT',primary_entrance_index:'INTEGER',spatial_generation:'TEXT',classification_evidence_json:"TEXT NOT NULL DEFAULT '{}'"}))if(!columns.has(name))db.exec(`ALTER TABLE apartment_identity ADD COLUMN ${name} ${definition}`);
 const current=db.prepare("SELECT sql FROM sqlite_master WHERE name='apartment_information'").get()?.sql;
 if(current!==view.slice(0,-1)){db.exec('DROP VIEW IF EXISTS apartment_information;'+view);}
}
