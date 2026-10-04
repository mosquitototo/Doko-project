import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch

import psycopg
from psycopg import sql
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TransactionTestCase

from core.instance_backups import restore_database_backup


@skipUnless(shutil.which("pg_dump") and shutil.which("psql"), "PostgreSQL client tools required")
class RestoreSafetyTests(TransactionTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="doko-restore-test-")
        self.addCleanup(self.temp.cleanup)
        self.name = "doko_restore_test_" + uuid.uuid4().hex
        self.connection = dict(host=os.environ.get("POSTGRES_HOST", "db"), port=os.environ.get("POSTGRES_PORT", "5432"),
                               user=os.environ["POSTGRES_USER"], password=os.environ["POSTGRES_PASSWORD"])
        with psycopg.connect(dbname="postgres", autocommit=True, **self.connection) as conn:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(self.name)))
        self.addCleanup(self.drop_database)
        self.env = patch.dict(os.environ, {"POSTGRES_DB": self.name})
        self.env.start()
        self.addCleanup(self.env.stop)
        directory = patch("core.instance_backups.BACKUP_DIR", Path(self.temp.name))
        directory.start()
        self.addCleanup(directory.stop)
        self.query("CREATE TABLE evidence (value text)")
        self.query("INSERT INTO evidence VALUES ('original')")
        self.archive = Path(self.temp.name) / "input.dump"
        subprocess.run(["pg_dump", "-Fc", "-h", self.connection["host"], "-p", self.connection["port"], "-U", self.connection["user"], "-d", self.name, "-f", str(self.archive)],
                       env={**os.environ, "PGPASSWORD": self.connection["password"]}, check=True, capture_output=True)
        self.query("UPDATE evidence SET value='current'")

    def drop_database(self):
        with psycopg.connect(dbname="postgres", autocommit=True, **self.connection) as conn:
            conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(self.name)))

    def query(self, statement):
        with psycopg.connect(dbname=self.name, **self.connection) as conn:
            cursor = conn.execute(statement)
            return cursor.fetchall() if cursor.description else None

    def upload(self, content=None):
        return SimpleUploadedFile("restore.dump", self.archive.read_bytes() if content is None else content)

    def test_corrupt_archive_preserves_current_database(self):
        with self.assertRaises((ValueError, RuntimeError)):
            restore_database_backup(self.upload(self.archive.read_bytes()[:40]))
        self.assertEqual(self.query("SELECT value FROM evidence"), [("current",)])

    def test_backup_failure_aborts_without_modifying_data(self):
        with patch("core.instance_backups.create_database_backup", side_effect=RuntimeError("backup unavailable")):
            with self.assertRaises(RuntimeError):
                restore_database_backup(self.upload())
        self.assertEqual(self.query("SELECT value FROM evidence"), [("current",)])

    def test_concurrent_restore_is_rejected_without_changing_data(self):
        with psycopg.connect(dbname=self.name, autocommit=True, **self.connection) as conn:
            conn.execute("SELECT pg_advisory_lock(1685023599, 1)")
            with self.assertRaisesRegex(RuntimeError, "already in progress"):
                restore_database_backup(self.upload())
        self.assertEqual(self.query("SELECT value FROM evidence"), [("current",)])

    def test_success_replaces_schema_and_keeps_verified_rescue_archive(self):
        self.query("CREATE TABLE obsolete (id int)")
        restore_database_backup(self.upload())
        self.assertEqual(self.query("SELECT value FROM evidence"), [("original",)])
        self.assertEqual(self.query("SELECT to_regclass('public.obsolete')"), [(None,)])
        self.assertEqual(len(list(Path(self.temp.name).glob("doko-db-*.dump"))), 1)

    def test_error_during_restore_rolls_back_all_changes(self):
        real_run = subprocess.run
        def run(command, **kwargs):
            if command[0] == "psql" and "--single-transaction" in command:
                restore_sql = Path(command[-1])
                with restore_sql.open("a") as stream:
                    stream.write("\nSELECT missing_restore_function();\n")
            return real_run(command, **kwargs)
        with patch("core.instance_backups.subprocess.run", side_effect=run):
            with self.assertRaises(RuntimeError):
                restore_database_backup(self.upload())
        self.assertEqual(self.query("SELECT value FROM evidence"), [("current",)])
