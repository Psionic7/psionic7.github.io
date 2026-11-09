export const NAVER_LISTING_SCHEMA=`
CREATE TABLE IF NOT EXISTS naver_listing_connections (
 apartment_id TEXT PRIMARY KEY,complex_no TEXT NOT NULL,verified_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS naver_listing_snapshots (
 apartment_id TEXT PRIMARY KEY,collected_at TEXT NOT NULL,group_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS naver_listing_days (
 day_kst TEXT PRIMARY KEY,scope_json TEXT NOT NULL,report_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS apartment_naver_matches (
 target_id TEXT PRIMARY KEY,scope_hash TEXT NOT NULL,favorite_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','verified','review','unmatched')),
 complex_no TEXT,observation_json TEXT,evidence_json TEXT,
 first_matched_at TEXT,last_verified_at TEXT,last_attempted_at TEXT,reason TEXT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
CREATE INDEX IF NOT EXISTS apartment_naver_matches_no ON apartment_naver_matches(complex_no);
CREATE TABLE IF NOT EXISTS apartment_naver_sources (
 source_entity_id TEXT NOT NULL,target_id TEXT NOT NULL,scope_json TEXT NOT NULL,
 registry_state TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 PRIMARY KEY(source_entity_id,target_id));
CREATE VIEW IF NOT EXISTS apartment_naver_source_connections AS
 SELECT s.source_entity_id,s.target_id,s.scope_json,s.registry_state,
 m.complex_no,m.state,m.observation_json,m.last_verified_at
 FROM apartment_naver_sources s JOIN apartment_naver_matches m USING(target_id)
 WHERE s.active=1 AND m.active=1;
`;
