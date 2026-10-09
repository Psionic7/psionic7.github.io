export const APARTMENT_MASTER_SCHEMA = `
CREATE TABLE IF NOT EXISTS apartment_inventory_runs (
 id INTEGER PRIMARY KEY,started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,scope_json TEXT NOT NULL,owner_pid INTEGER,owner_host TEXT,error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS apartment_inventory_regions (
 region_id TEXT PRIMARY KEY,legal_code TEXT NOT NULL,dong TEXT NOT NULL,status TEXT NOT NULL,run_id INTEGER,source_counts_json TEXT NOT NULL DEFAULT '{}',fetched_at TEXT,error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS apartment_inventory_pages (
 run_id INTEGER NOT NULL,region_id TEXT NOT NULL,dataset TEXT NOT NULL,page INTEGER NOT NULL,total_count INTEGER NOT NULL,items_json TEXT NOT NULL,PRIMARY KEY(run_id,region_id,dataset,page));
CREATE TABLE IF NOT EXISTS apartment_building_inventory (
 building_id TEXT PRIMARY KEY,region_id TEXT NOT NULL,legal_code TEXT NOT NULL,parent_id TEXT,classification TEXT NOT NULL CHECK(classification IN ('apartment','other','review')),record_json TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,run_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS apartment_complexes (
 apartment_id TEXT PRIMARY KEY,registry_root_id TEXT NOT NULL,region_code TEXT NOT NULL,legal_code TEXT NOT NULL,dong TEXT NOT NULL,name TEXT,jibun TEXT NOT NULL DEFAULT '',road_address TEXT NOT NULL DEFAULT '',approval_date TEXT,build_year INTEGER,household_count INTEGER,building_count INTEGER,max_floors INTEGER,structure TEXT,active INTEGER NOT NULL DEFAULT 1,source TEXT NOT NULL DEFAULT '건축HUB 건축물대장',fetched_at TEXT NOT NULL,inventory_run_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS apartment_buildings (
 building_id TEXT PRIMARY KEY,apartment_id TEXT NOT NULL,legal_code TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',dong_name TEXT NOT NULL DEFAULT '',jibun TEXT NOT NULL DEFAULT '',road_address TEXT NOT NULL DEFAULT '',main_use_code TEXT NOT NULL DEFAULT '',main_use_name TEXT NOT NULL DEFAULT '',other_use TEXT NOT NULL DEFAULT '',approval_date TEXT,build_year INTEGER,households INTEGER,floors_above INTEGER,floors_below INTEGER,structure TEXT NOT NULL DEFAULT '',gross_area_m2 REAL,site_area_m2 REAL,coordinate_codes_json TEXT,coordinate_status TEXT NOT NULL DEFAULT 'pending',coordinate_fetched_at TEXT,source TEXT NOT NULL DEFAULT '건축HUB 건축물대장',FOREIGN KEY(apartment_id) REFERENCES apartment_complexes(apartment_id));
CREATE TABLE IF NOT EXISTS apartment_parcels (
 apartment_id TEXT NOT NULL,pnu TEXT NOT NULL,legal_code TEXT NOT NULL,jibun TEXT NOT NULL,relation TEXT NOT NULL CHECK(relation IN ('primary','attached')),geometry_json TEXT,boundary_status TEXT NOT NULL DEFAULT 'pending',boundary_source TEXT,fetched_at TEXT,attributes_json TEXT,spatial_status TEXT NOT NULL DEFAULT 'pending',spatial_fetched_at TEXT,PRIMARY KEY(apartment_id,pnu),FOREIGN KEY(apartment_id) REFERENCES apartment_complexes(apartment_id));
CREATE TABLE IF NOT EXISTS apartment_district_boundaries (\n district_code TEXT PRIMARY KEY,geometry_json TEXT NOT NULL,properties_json TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'V-World 시군구 경계',fetched_at TEXT NOT NULL);\nCREATE TABLE IF NOT EXISTS apartment_region_boundaries (\n region_id TEXT PRIMARY KEY,legal_code TEXT NOT NULL,geometry_json TEXT NOT NULL,properties_json TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'V-World 법정동 경계',fetched_at TEXT NOT NULL);\nCREATE TABLE IF NOT EXISTS apartment_building_footprints (
 footprint_id TEXT PRIMARY KEY,geometry_json TEXT NOT NULL,properties_json TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'V-World GIS 건물통합정보',fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS apartment_footprint_links (
 apartment_id TEXT NOT NULL,footprint_id TEXT NOT NULL,pnu TEXT NOT NULL,PRIMARY KEY(apartment_id,footprint_id,pnu),FOREIGN KEY(apartment_id) REFERENCES apartment_complexes(apartment_id),FOREIGN KEY(footprint_id) REFERENCES apartment_building_footprints(footprint_id));
CREATE TABLE IF NOT EXISTS apartment_zoning_features (
 feature_id TEXT PRIMARY KEY,geometry_json TEXT NOT NULL,properties_json TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'V-World 용도지역정보',fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS apartment_zoning_links (
 apartment_id TEXT NOT NULL,feature_id TEXT NOT NULL,pnu TEXT NOT NULL,PRIMARY KEY(apartment_id,feature_id,pnu),FOREIGN KEY(apartment_id) REFERENCES apartment_complexes(apartment_id),FOREIGN KEY(feature_id) REFERENCES apartment_zoning_features(feature_id));
CREATE TABLE IF NOT EXISTS apartment_entrances (
 building_id TEXT NOT NULL,entrance_index INTEGER NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,ent_x REAL NOT NULL,ent_y REAL NOT NULL,source TEXT NOT NULL DEFAULT '주소정보누리집 좌표 API',fetched_at TEXT NOT NULL,PRIMARY KEY(building_id,entrance_index),FOREIGN KEY(building_id) REFERENCES apartment_buildings(building_id));
CREATE TABLE IF NOT EXISTS apartment_aliases (
 apartment_id TEXT NOT NULL,name TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(apartment_id,name),FOREIGN KEY(apartment_id) REFERENCES apartment_complexes(apartment_id));
CREATE TABLE IF NOT EXISTS apartment_master_issues (
 issue_key TEXT PRIMARY KEY,region_id TEXT NOT NULL,apartment_id TEXT,building_id TEXT,code TEXT NOT NULL,detail TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS apartment_trade_links (
 region_code TEXT NOT NULL,dong TEXT NOT NULL,jibun TEXT NOT NULL,trade_name TEXT NOT NULL,apartment_id TEXT,status TEXT NOT NULL CHECK(status IN ('matched','ambiguous','unmatched')),method TEXT NOT NULL,candidates_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(region_code,dong,jibun,trade_name));
CREATE INDEX IF NOT EXISTS master_complex_region ON apartment_complexes(legal_code,active);
CREATE INDEX IF NOT EXISTS master_building_complex ON apartment_buildings(apartment_id);
CREATE INDEX IF NOT EXISTS master_parcel_pnu ON apartment_parcels(pnu);
CREATE INDEX IF NOT EXISTS master_trade_complex ON apartment_trade_links(apartment_id,status);
`;
