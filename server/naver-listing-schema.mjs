export const NAVER_LISTING_SCHEMA=`
CREATE TABLE IF NOT EXISTS naver_listing_connections (
 apartment_id TEXT PRIMARY KEY,complex_no TEXT NOT NULL,verified_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS naver_listing_snapshots (
 apartment_id TEXT PRIMARY KEY,collected_at TEXT NOT NULL,group_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS naver_listing_days (
 day_kst TEXT PRIMARY KEY,scope_json TEXT NOT NULL,report_json TEXT NOT NULL);
`;
