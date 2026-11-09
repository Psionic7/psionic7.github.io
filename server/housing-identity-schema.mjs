export const HOUSING_IDENTITY_SCHEMA=`
CREATE TABLE IF NOT EXISTS housing_identity_entities (
 entity_id TEXT PRIMARY KEY,favorite_json TEXT NOT NULL,state TEXT NOT NULL,method TEXT NOT NULL,
 cohort_ids_json TEXT NOT NULL,root_ids_json TEXT NOT NULL,legal_types_json TEXT NOT NULL,
 row_count INTEGER NOT NULL,precision_counts_json TEXT NOT NULL,evidence_json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS housing_identity_cohorts (
 cohort_id TEXT PRIMARY KEY,root_id TEXT NOT NULL,master_id TEXT,
 data_json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS housing_cohort_root ON housing_identity_cohorts(root_id);
CREATE TABLE IF NOT EXISTS housing_identity_members (
 entity_id TEXT NOT NULL,cohort_id TEXT NOT NULL,method TEXT NOT NULL,evidence_json TEXT NOT NULL,
 PRIMARY KEY(entity_id,cohort_id));
CREATE TABLE IF NOT EXISTS housing_identity_bindings (
 trade_id INTEGER PRIMARY KEY,entity_id TEXT NOT NULL,
 precision TEXT NOT NULL CHECK(precision IN ('building','cohort','complex','unresolved')),
 root_id TEXT,cohort_id TEXT,building_id TEXT,method TEXT NOT NULL,evidence_json TEXT NOT NULL,
 CHECK((precision='building' AND root_id IS NOT NULL AND cohort_id IS NOT NULL AND building_id IS NOT NULL)
    OR (precision='cohort' AND root_id IS NOT NULL AND cohort_id IS NOT NULL AND building_id IS NULL)
    OR (precision IN ('complex','unresolved') AND root_id IS NULL AND cohort_id IS NULL AND building_id IS NULL)));
CREATE INDEX IF NOT EXISTS housing_binding_entity ON housing_identity_bindings(entity_id,trade_id);
CREATE INDEX IF NOT EXISTS housing_binding_cohort ON housing_identity_bindings(cohort_id,trade_id);
CREATE TABLE IF NOT EXISTS housing_identity_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
`;

export const HOUSING_IDENTITY_INVALIDATION_SCHEMA=`
CREATE TRIGGER IF NOT EXISTS housing_identity_trade_insert AFTER INSERT ON trades BEGIN
 DELETE FROM housing_identity_meta WHERE key='generation'; END;
CREATE TRIGGER IF NOT EXISTS housing_identity_trade_update AFTER UPDATE ON trades BEGIN
 DELETE FROM housing_identity_meta WHERE key='generation'; END;
CREATE TRIGGER IF NOT EXISTS housing_identity_trade_delete AFTER DELETE ON trades BEGIN
 DELETE FROM housing_identity_meta WHERE key='generation'; END;
`;
