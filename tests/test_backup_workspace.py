import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from backend import store
from scripts.backup_workspace import backup_workspace
from scripts.create_workspace import create_workspace


class WorkspaceBackupTests(unittest.TestCase):
    def test_backup_preserves_workspace_and_uploaded_documents(self):
        with tempfile.TemporaryDirectory() as folder:
            old = store.DB_PATH
            store.DB_PATH = str(Path(folder) / 'trial.db')
            try:
                port = create_workspace('trial@example.org', 'test-only-password', 'Client trial', 'New port')
                with store.connect() as db:
                    store.put(db, port, 'import_files', {'content_base64':'dGVzdA=='}, 'upload')
                target = backup_workspace()
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                with sqlite3.connect(target) as db:
                    self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                    self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 1)
                    document = json.loads(db.execute("SELECT data FROM records WHERE id='upload'").fetchone()[0])
                    self.assertEqual(document['content_base64'], 'dGVzdA==')
                with self.assertRaisesRegex(ValueError, 'public frontend'):
                    backup_workspace(store.ROOT / 'frontend' / 'backups')
            finally:
                store.DB_PATH = old

    def test_missing_database_does_not_create_one(self):
        with tempfile.TemporaryDirectory() as folder:
            old = store.DB_PATH
            store.DB_PATH = str(Path(folder) / 'missing.db')
            try:
                with self.assertRaisesRegex(ValueError, 'No workspace database'):
                    backup_workspace()
                self.assertFalse(Path(store.DB_PATH).exists())
            finally:
                store.DB_PATH = old
