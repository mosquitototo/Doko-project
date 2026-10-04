import hashlib
import os
import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

import psycopg

from django.db import connections
from django.conf import settings

from .models import InstanceBackup


BACKUP_DIR = Path(getattr(settings, "INSTANCE_BACKUP_DIR", "/tmp/doko_backups"))
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_RESTORE_EXTENSIONS = (".dump", ".backup")

MAX_RESTORE_SIZE = 250 * 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _looks_like_pg_custom_dump(path: Path) -> bool:
    try:
        with path.open("rb") as fh:
            return fh.read(5) == b"PGDMP"
    except Exception:
        return False
    

def create_database_backup(*, user=None) -> InstanceBackup:
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
    filename = f"doko-db-{timestamp}.dump"
    backup_path = BACKUP_DIR / filename

    env = os.environ.copy()
    env["PGPASSWORD"] = os.environ["POSTGRES_PASSWORD"]

    dump_cmd = [
        "pg_dump",
        "-Fc",
        "-h",
        os.environ.get("POSTGRES_HOST", "db"),
        "-p",
        os.environ.get("POSTGRES_PORT", "5432"),
        "-U",
        os.environ["POSTGRES_USER"],
        "-d",
        os.environ["POSTGRES_DB"],
        "-f",
        str(backup_path),
    ]

    result = subprocess.run(
        dump_cmd,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        detail = (result.stderr or "").strip() or (result.stdout or "").strip()
        raise RuntimeError(f"pg_dump error: {detail or result.returncode}")

    backup = InstanceBackup.objects.create(
        filename=filename,
        file_path=str(backup_path),
        file_size=backup_path.stat().st_size,
        content_type="application/octet-stream",
        created_by=user,
        sha256=sha256_file(backup_path),
    )
    return backup


def validate_restore_upload(uploaded_file) -> None:
    if not uploaded_file:
        raise ValueError("Backup file is required.")

    if uploaded_file.size > MAX_RESTORE_SIZE:
        raise ValueError("Backup file is too large.")

    lower_name = uploaded_file.name.lower()
    if not lower_name.endswith(ALLOWED_RESTORE_EXTENSIONS):
        raise ValueError("Unsupported backup file type. Only .dump and .backup are allowed.")



def restore_database_backup(uploaded_file) -> None:
    validate_restore_upload(uploaded_file)

    db_host = os.environ.get("POSTGRES_HOST", "db")
    db_port = os.environ.get("POSTGRES_PORT", "5432")
    db_name = os.environ["POSTGRES_DB"]
    db_user = os.environ["POSTGRES_USER"]
    db_password = os.environ["POSTGRES_PASSWORD"]

    env = os.environ.copy()
    env["PGPASSWORD"] = db_password

    with tempfile.TemporaryDirectory(prefix="doko-restore-") as tmpdir:
        tmpdir_path = Path(tmpdir)
        restore_path = tmpdir_path / "restore.dump"

        with restore_path.open("wb") as dst:
            for chunk in uploaded_file.chunks():
                dst.write(chunk)

        if not _looks_like_pg_custom_dump(restore_path):
            raise ValueError("Invalid backup format.")

        def run_command(command):
            result = subprocess.run(command, env=env, check=False, capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError((result.stderr or "").strip() or f"{command[0]} failed")
            return result.stdout

        catalog = run_command(["pg_restore", "--list", str(restore_path)])
        sql_path = tmpdir_path / "restore.sql"
        run_command(["pg_restore", "--no-owner", "--no-privileges", "--file", str(sql_path), str(restore_path)])

        with psycopg.connect(host=db_host, port=db_port, dbname=db_name, user=db_user, password=db_password, autocommit=True) as lock_connection:
            locked = lock_connection.execute("SELECT pg_try_advisory_lock(1685023599, 1)").fetchone()[0]
            if not locked:
                raise RuntimeError("A database restore is already in progress.")
            backup = create_database_backup()
            backup_path = Path(backup.file_path)
            if not backup_path.is_file() or backup_path.stat().st_size != backup.file_size or sha256_file(backup_path) != backup.sha256:
                raise RuntimeError("Recovery backup verification failed.")
            run_command(["pg_restore", "--list", str(backup_path)])

            reset_path = tmpdir_path / "reset.sql"
            reset_sql = """
SET LOCAL lock_timeout = '30s';
DO $$ DECLARE item record; BEGIN
    FOR item IN SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
    LOOP EXECUTE format('DROP SCHEMA %I CASCADE', item.nspname); END LOOP;
END $$;
SELECT lo_unlink(oid) FROM pg_largeobject_metadata;
"""
            if not re.search(r"^\d+; \d+ \d+ SCHEMA - public(?:\s|$)", catalog, re.MULTILINE):
                reset_sql += "CREATE SCHEMA public;\n"
            reset_path.write_text(reset_sql, encoding="utf-8")
            connections.close_all()
            run_command([
                "psql", "--no-psqlrc", "--single-transaction", "-v", "ON_ERROR_STOP=1",
                "-h", db_host, "-p", db_port, "-U", db_user, "-d", db_name,
                "-f", str(reset_path), "-f", str(sql_path),
            ])
