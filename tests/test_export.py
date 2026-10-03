from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('export_data', Path(__file__).resolve().parents[1] / 'scripts/export_data.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.sqlite3'
        self.target = self.root / 'public'
        self.secret = 'fake-private-key-for-test-only-1234567'
        self.env = self.root / '.env'
        self.env.write_text('MOLIT_SERVICE_KEY=' + self.secret, encoding='utf-8')
        self.raw = {'aptNm': '원문', 'dealAmount': '100,000', 'aptDong': '', 'unknown': '새 값'}
        with closing(sqlite3.connect(self.source)) as conn:
            conn.executescript(exporter.SCHEMA + 'CREATE TABLE api_pages (response_xml TEXT); CREATE TABLE collection_runs (id INTEGER);')
            conn.execute('INSERT INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                         (1, '41465', '202601', '2026-01-02', '원문', '풍덕천동', '1', 100000, 85, 3, 2000, 0, json.dumps(self.raw, ensure_ascii=False)))
            conn.execute('INSERT INTO regions VALUES (?,?,?,?,?,?,?)', ('suji', '용인 수지구', '41465', '경기도 용인시 수지구', '[]', 37.32, 127.09))
            conn.execute('INSERT INTO regions VALUES (?,?,?,?,?,?,?)', ('dong_41465101', '경기도 용인시 수지구 풍덕천동', '41465', '경기도 용인시 수지구', '["풍덕천동"]', 37.32, 127.09))
            conn.execute('INSERT INTO api_pages VALUES (?)', (self.secret,))
            conn.execute('INSERT INTO metadata VALUES (?,?)', ('private_key', self.secret))
            conn.commit()

    def tearDown(self):
        self.temp.cleanup()

    def test_allowlist_preserves_raw_and_omits_private_tables_metadata_and_secrets(self):
        manifest = exporter.export(self.source, self.target, self.env)
        with closing(sqlite3.connect(self.target / 'public.sqlite3')) as conn:
            self.assertEqual({row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}, {'trades', 'regions', 'metadata'})
            self.assertEqual(conn.execute('SELECT key FROM metadata').fetchone()[0], 'published_at')
        rows = json.loads((self.target / manifest['districts']['41465']['file']).read_text(encoding='utf-8'))
        self.assertEqual(rows[0]['raw'], self.raw)
        self.assertTrue(all(self.secret.encode() not in path.read_bytes() for path in self.target.iterdir()))

    def test_rejects_secret_before_changing_existing_snapshot(self):
        exporter.export(self.source, self.target, self.env)
        before = {path.name: path.read_bytes() for path in self.target.iterdir()}
        with closing(sqlite3.connect(self.source)) as conn:
            conn.execute('UPDATE trades SET raw_json=?', (json.dumps({'aptNm': self.secret}),))
            conn.commit()
        with self.assertRaises(ValueError):
            exporter.export(self.source, self.target, self.env)
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.target.iterdir()})

    def test_empty_dataset_exports_valid_empty_manifest(self):
        with closing(sqlite3.connect(self.source)) as conn:
            conn.execute('DELETE FROM trades')
            conn.commit()
        manifest = exporter.export(self.source, self.target, self.env)
        self.assertEqual(manifest['count'], 0)
        self.assertEqual(manifest['districts'], {})

    def test_no_file_or_empty_favorites_never_seeds_default_regions(self):
        self.assertEqual(exporter.export(self.source, self.target, self.env)['favorite_region_ids'], [])
        favorites=self.root/'selection.json'
        favorites.write_text(json.dumps({'version':1,'regions':[]}),encoding='utf-8')
        self.assertEqual(exporter.export(self.source,self.target,self.env,favorites)['favorite_region_ids'], [])

    def test_favorites_only_export_allowlisted_ids_without_private_metadata(self):
        favorites=self.root/'selection.json'
        favorites.write_text(json.dumps({'version':1,'updated_at':'private timestamp', 'regions':[
            {'region_id':'dong_41465101','private_note':self.secret}]}),encoding='utf-8')
        manifest=exporter.export(self.source,self.target,self.env,favorites)
        self.assertEqual(manifest['favorite_region_ids'],['dong_41465101'])
        self.assertNotIn('private timestamp',json.dumps(manifest))
        self.assertNotIn(self.secret,json.dumps(manifest))

    def test_invalid_favorites_preserve_the_existing_manifest(self):
        exporter.export(self.source,self.target,self.env)
        before=(self.target/'manifest.json').read_bytes()
        favorites=self.root/'selection.json'
        favorites.write_text(json.dumps({'version':1,'regions':[{'region_id':'not-registered'}]}),encoding='utf-8')
        with self.assertRaises(ValueError):
            exporter.export(self.source,self.target,self.env,favorites)
        self.assertEqual((self.target/'manifest.json').read_bytes(),before)

    def test_legacy_group_is_expanded_to_actual_dongs_instead_of_preset(self):
        favorites=self.root/'selection.json'
        favorites.write_text(json.dumps({'version':1,'regions':[{'region_id':'suji'}]}),encoding='utf-8')
        manifest=exporter.export(self.source,self.target,self.env,favorites)
        self.assertEqual(manifest['favorite_region_ids'],['dong_41465101'])


if __name__ == '__main__':
    unittest.main()
