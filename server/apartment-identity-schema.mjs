export const APARTMENT_IDENTITY_SCHEMA=`
CREATE TABLE IF NOT EXISTS apartment_identity (
 apartment_id TEXT PRIMARY KEY REFERENCES apartment_complexes(apartment_id),
 canonical_name TEXT NOT NULL,region_code TEXT NOT NULL,region_name TEXT NOT NULL,legal_code TEXT NOT NULL,
 dong TEXT NOT NULL,jibun TEXT NOT NULL,road_address TEXT NOT NULL,
 postal_code TEXT CHECK(postal_code IS NULL OR (length(postal_code)=5 AND postal_code NOT GLOB '*[^0-9]*')),
 postal_source TEXT,naver_complex_no TEXT,naver_name TEXT,active INTEGER NOT NULL,
 sources_json TEXT NOT NULL,updated_at TEXT NOT NULL);
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
