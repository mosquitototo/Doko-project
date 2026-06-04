import hashlib
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from django.db import connections
from django.conf import settings

from .models import InstanceBackup


BACKUP_DIR = Path(getattr(settings, "INSTANCE_BACKUP_DIR", "/tmp/doko_backups"))
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_RESTORE_EXTENSIONS = (".dump", ".backup")

MAX_RESTORE_SIZE = 250 * 1024 * 1024


def build_backup_filename() -> str:
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    return f"doko-db-{timestamp}.sql.gz"


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
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
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

        connections.close_all()

        safe_db_name = db_name.replace("'", "''")

        terminate_sql = f"""
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '{safe_db_name}'
        AND pid <> pg_backend_pid();
        """

        terminate_cmd = [
            "psql",
            "-h", db_host,
            "-p", db_port,
            "-U", db_user,
            "-d", "postgres",
            "-v", "ON_ERROR_STOP=1",
            "-c", terminate_sql,
        ]

        drop_cmd = [
            "dropdb",
            "-h", db_host,
            "-p", db_port,
            "-U", db_user,
            "--if-exists",
            db_name,
        ]

        create_cmd = [
            "createdb",
            "-h", db_host,
            "-p", db_port,
            "-U", db_user,
            db_name,
        ]

        restore_cmd = [
            "pg_restore",
            "-h", db_host,
            "-p", db_port,
            "-U", db_user,
            "-d", db_name,
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
            str(restore_path),
        ]

        for cmd in (terminate_cmd, drop_cmd, create_cmd, restore_cmd):
            result = subprocess.run(
                cmd,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                detail = (result.stderr or "").strip() or (result.stdout or "").strip()
                raise RuntimeError(detail or f"Command failed: {' '.join(cmd)}")
