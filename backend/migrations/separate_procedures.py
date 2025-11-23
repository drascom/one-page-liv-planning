"""One-time migration to move procedure fields out of `patients` and into `procedures`.

This script is intentionally verbose and idempotent so it can be executed safely on
existing databases. It will:

- Export the current `patients` (and any existing `procedures`) tables to a timestamped
  JSON backup file before making changes.
- Ensure a `procedures` table exists with the expected columns.
- Copy procedure-related columns from every patient into the `procedures` table while
  keeping a `patient_id` reference.
- Skip patients that already have a procedure row so the migration can be rerun.

Run with `python backend/migrations/separate_procedures.py` from the repository root.
Use `--dry-run` to preview actions without modifying the database.
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List

# Ensure the project root is on the import path so we can import the local backend package.
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend import database  # noqa: E402

LOGGER = logging.getLogger("separate_procedures")

# Columns we expect to migrate from the patients table into the procedures table.
PROCEDURE_FIELD_MAP = {
    "patient_id": lambda row: row["id"],
    "procedure_date": lambda row: database._date_only(row["procedure_date"]),
    "procedure_type": lambda row: row["procedure_type"],
    "status": lambda row: row["status"],
    "grafts": lambda row: row["grafts"],
    "payment": lambda row: row["payment"],
    "consultation": lambda row: json.dumps(database._deserialize_consultation(row["consultation"])),
    "forms": lambda row: row["forms"] or "[]",
    "consents": lambda row: row["consents"] or "[]",
    "photos": lambda row: row["photos"],
    "photo_files": lambda row: row["photo_files"] or "[]",
    "created_at": lambda _row: datetime.utcnow().isoformat(timespec="seconds"),
}


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    )
    return cursor.fetchone() is not None


def get_columns(conn: sqlite3.Connection, table_name: str) -> List[str]:
    cursor = conn.execute("PRAGMA table_info(%s)" % table_name)
    return [row[1] for row in cursor.fetchall()]


def ensure_procedures_table(conn: sqlite3.Connection) -> None:
    """Create the procedures table if it does not exist."""
    if table_exists(conn, "procedures"):
        LOGGER.info("Procedures table already exists; skipping creation.")
        return

    LOGGER.info("Creating procedures table...")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS procedures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            procedure_date TEXT,
            procedure_type TEXT,
            status TEXT,
            grafts TEXT NOT NULL DEFAULT '',
            payment TEXT,
            consultation TEXT,
            forms TEXT,
            consents TEXT,
            photos INTEGER NOT NULL DEFAULT 0,
            photo_files TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(patient_id) REFERENCES patients(id)
        )
        """
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_procedures_patient_date ON procedures (patient_id, procedure_date)"
    )
    conn.commit()


def export_table(conn: sqlite3.Connection, table: str, dest_dir: Path, timestamp: str) -> None:
    if not table_exists(conn, table):
        LOGGER.info("Skipping export for missing table: %s", table)
        return
    cursor = conn.execute(f"SELECT * FROM {table}")
    records = [dict(row) for row in cursor.fetchall()]
    dest_dir.mkdir(parents=True, exist_ok=True)
    output_path = dest_dir / f"{table}_{timestamp}.json"
    output_path.write_text(json.dumps(records, indent=2, default=str))
    LOGGER.info("Exported %s rows from %s to %s", len(records), table, output_path)


def backup_tables(conn: sqlite3.Connection, dest_dir: Path) -> None:
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    LOGGER.info("Writing JSON backups to %s", dest_dir)
    export_table(conn, "patients", dest_dir, timestamp)
    export_table(conn, "procedures", dest_dir, timestamp)


def normalize_patient_rows(conn: sqlite3.Connection) -> List[sqlite3.Row]:
    cursor = conn.execute(
        """
        SELECT
            id, month_label, week_label, week_range, week_order, day_label, day_order,
            procedure_date, first_name, last_name, email, phone, city, status,
            procedure_type, grafts, payment, consultation, forms, consents, photos,
            photo_files
        FROM patients
        WHERE deleted IS NULL OR deleted = 0
        """
    )
    return cursor.fetchall()


def build_procedure_payload(row: sqlite3.Row, available_columns: Iterable[str]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    for column in available_columns:
        if column not in PROCEDURE_FIELD_MAP:
            continue
        payload[column] = PROCEDURE_FIELD_MAP[column](row)
    return payload


def insert_procedure(conn: sqlite3.Connection, payload: Dict[str, Any]) -> bool:
    if not payload:
        return False
    columns = list(payload.keys())
    placeholders = ", ".join(["?"] * len(columns))
    column_list = ", ".join(columns)
    values = [payload[col] for col in columns]
    cursor = conn.execute(
        f"INSERT OR IGNORE INTO procedures ({column_list}) VALUES ({placeholders})",
        values,
    )
    return cursor.rowcount > 0


def migrate(dry_run: bool = False, backup_dir: Path | None = None) -> None:
    with sqlite3.connect(database.DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        if backup_dir:
            backup_tables(conn, backup_dir)

        ensure_procedures_table(conn)
        available_columns = get_columns(conn, "procedures")
        required_columns = {"patient_id", "procedure_date"}
        missing = required_columns - set(available_columns)
        if missing:
            raise SystemExit(
                f"Procedures table is missing required columns: {', '.join(sorted(missing))}"
            )

        LOGGER.info("Loading patients for migration...")
        patient_rows = normalize_patient_rows(conn)
        existing_cursor = conn.execute("SELECT DISTINCT patient_id FROM procedures")
        existing_patient_ids = {row[0] for row in existing_cursor.fetchall()}

        inserted = 0
        skipped = 0
        for row in patient_rows:
            if row["id"] in existing_patient_ids:
                skipped += 1
                continue
            payload = build_procedure_payload(row, available_columns)
            if dry_run:
                LOGGER.info("[DRY RUN] Would insert procedure for patient %s", row["id"])
                inserted += 1
                continue
            if insert_procedure(conn, payload):
                inserted += 1
            else:
                skipped += 1

        if not dry_run:
            conn.commit()

        LOGGER.info(
            "Migration complete. Inserted %s procedure rows, skipped %s patients.", inserted, skipped
        )


def parse_args(args: List[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview migration actions without modifying the database",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "backups",
        help="Directory where JSON backups will be written before migration",
    )
    parser.add_argument(
        "--skip-backup",
        action="store_true",
        help="Skip automatic backups (not recommended)",
    )
    return parser.parse_args(args)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    options = parse_args()
    migrate(dry_run=options.dry_run, backup_dir=None if options.skip_backup else options.backup_dir)
