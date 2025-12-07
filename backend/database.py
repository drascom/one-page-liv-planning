"""SQLite helpers for the Liv planning backend."""
from __future__ import annotations

import json
import random
import re
import secrets
import sqlite3
import string
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .timezone import london_now_iso

DB_PATH = Path(__file__).resolve().parent / "liv_planning.db"
DEFAULT_PROCEDURE_TIME = "08:30"


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (table_name,)
    )
    return cursor.fetchone() is not None

FIELD_OPTION_FIELDS: List[str] = [
    "status",
    "procedure_type",
    "package_type",
    "agency",
    "forms",
    "consents",
    "consultation",
    "payment",
]

SEQUENTIAL_OPTION_PREFIXES: Dict[str, str] = {
    "forms": "form",
    "consents": "consent",
}


def _date_only(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    date_part = text.split("T", 1)[0].split(" ", 1)[0]
    try:
        return datetime.fromisoformat(date_part).date().isoformat()
    except ValueError:
        try:
            return datetime.strptime(date_part, "%Y-%m-%d").date().isoformat()
        except ValueError:
            return date_part


def _normalize_time(value: Optional[str]) -> str:
    """Return HH:MM string, falling back to DEFAULT_PROCEDURE_TIME."""
    text = (value or "").strip()
    if not text:
        return DEFAULT_PROCEDURE_TIME
    parts = text.split(":")
    try:
        hours = int(parts[0])
        minutes = int(parts[1]) if len(parts) > 1 else 0
    except (ValueError, IndexError):
        return DEFAULT_PROCEDURE_TIME
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        return DEFAULT_PROCEDURE_TIME
    return f"{hours:02d}:{minutes:02d}"


def _create_weekly_plans(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS weekly_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            week_start TEXT NOT NULL,
            focus_area TEXT NOT NULL,
            objectives TEXT NOT NULL,
            metrics TEXT,
            notes TEXT
        )
        """
    )


def _reset_patients_table(conn: sqlite3.Connection) -> None:
    """Ensure patients table holds only personal information."""
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    desired = {
        "id",
        "first_name",
        "last_name",
        "email",
        "phone",
        "address",
        "drive_folder_id",
        "photo_count",
        "deleted",
        "created_at",
        "updated_at",
    }
    if columns:
        legacy_city_column = "city" in columns and "address" not in columns
        if legacy_city_column:
            conn.execute("ALTER TABLE patients ADD COLUMN address TEXT")
            conn.execute("UPDATE patients SET address = city WHERE address IS NULL OR address = ''")
            columns.add("address")
        missing = desired - columns
        alterable = {"drive_folder_id", "photo_count"}
        extra = columns - desired
        allowed_extras = {"city"}
        if not missing and not (extra - allowed_extras):
            return
        # If we only need to add simple columns, do it without dropping the table
        if missing and missing.issubset(alterable) and not (extra - allowed_extras):
            if "drive_folder_id" in missing:
                conn.execute("ALTER TABLE patients ADD COLUMN drive_folder_id TEXT")
            if "photo_count" in missing:
                conn.execute("ALTER TABLE patients ADD COLUMN photo_count INTEGER NOT NULL DEFAULT 0")
            conn.commit()
            return
        # If there are unexpected columns (e.g., legacy file_details), recreate the table
        if extra - allowed_extras:
            conn.execute("DROP TABLE IF EXISTS patients")

    # Drop legacy table if present; caller already decided data can be discarded
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            drive_folder_id TEXT,
            photo_count INTEGER NOT NULL DEFAULT 0,
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _ensure_patient_address_column(conn: sqlite3.Connection) -> None:
    """Add the address column when missing (while keeping legacy city column intact)."""
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    if "address" in columns:
        return
    if "city" in columns:
        conn.execute("ALTER TABLE patients ADD COLUMN address TEXT")
        conn.execute("UPDATE patients SET address = city WHERE address IS NULL OR address = ''")
        conn.commit()


def _reset_procedures_table(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(procedures)")
    column_rows = cursor.fetchall()
    columns = {row[1] for row in column_rows}
    column_types = {row[1]: (row[2] or "").upper() for row in column_rows}
    desired = {
        "id",
        "patient_id",
        "procedure_date",
        "procedure_time",
        "status",
        "procedure_type",
        "package_type",
        "agency",
        "grafts",
        "outstanding_balance",
        "payment",
        "consultation",
        "forms",
        "consents",
        "notes",
        "deleted",
        "created_at",
        "updated_at",
    }
    if columns:
        missing = desired - columns
        alterable = {"package_type", "agency", "outstanding_balance", "notes", "procedure_time"}
        grafts_type = column_types.get("grafts", "")
        grafts_numeric = grafts_type in {"REAL", "INTEGER", "NUMERIC", "FLOAT", "DOUBLE"}
        if not missing and grafts_numeric:
            return
        if missing.issubset(alterable) and grafts_numeric:
            if "package_type" in missing:
                conn.execute("ALTER TABLE procedures ADD COLUMN package_type TEXT NOT NULL DEFAULT ''")
            if "agency" in missing:
                conn.execute("ALTER TABLE procedures ADD COLUMN agency TEXT NOT NULL DEFAULT ''")
            if "outstanding_balance" in missing:
                conn.execute("ALTER TABLE procedures ADD COLUMN outstanding_balance REAL")
            if "notes" in missing:
                conn.execute("ALTER TABLE procedures ADD COLUMN notes TEXT NOT NULL DEFAULT '[]'")
            if "procedure_time" in missing:
                conn.execute(
                    f"ALTER TABLE procedures ADD COLUMN procedure_time TEXT NOT NULL DEFAULT '{DEFAULT_PROCEDURE_TIME}'"
                )
            conn.commit()
            return
        _migrate_procedures_table(conn, columns)
        return
    _create_procedures_table(conn)


def _create_procedures_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS procedures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            procedure_date TEXT,
            procedure_time TEXT NOT NULL DEFAULT '08:30',
            status TEXT NOT NULL,
            procedure_type TEXT NOT NULL,
            package_type TEXT NOT NULL DEFAULT '',
            agency TEXT NOT NULL DEFAULT '',
            grafts REAL NOT NULL DEFAULT 0,
            outstanding_balance REAL,
            payment TEXT NOT NULL,
            consultation TEXT NOT NULL DEFAULT '[]',
            forms TEXT NOT NULL DEFAULT '[]',
            consents TEXT NOT NULL DEFAULT '[]',
            notes TEXT NOT NULL DEFAULT '[]',
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_procedures_patient_id ON procedures(patient_id)")


def _migrate_procedures_table(conn: sqlite3.Connection, existing_columns: set[str]) -> None:
    """Recreate procedures table to enforce numeric grafts while preserving data."""
    conn.execute("ALTER TABLE procedures RENAME TO procedures_legacy")
    _create_procedures_table(conn)
    def col(name: str, default_sql: str) -> str:
        return name if name in existing_columns else f"{default_sql} AS {name}"

    balance_column = "outstanding_balance"
    if "outstanding_balance" not in existing_columns and "outstaning_balance" in existing_columns:
        balance_column = "outstaning_balance"

    conn.execute(
        f"""
        INSERT INTO procedures (
            id,
            patient_id,
            procedure_date,
            procedure_time,
            status,
            procedure_type,
            package_type,
            agency,
            grafts,
            outstanding_balance,
            payment,
            consultation,
            forms,
            consents,
            notes,
            deleted,
            created_at,
            updated_at
        )
        SELECT
            id,
            patient_id,
            procedure_date,
            {col('procedure_time', f"'{DEFAULT_PROCEDURE_TIME}'")},
            status,
            procedure_type,
            {col('package_type', "''")},
            {col('agency', "''")},
            CAST({col('grafts', '0')} AS REAL),
            {col(balance_column, 'NULL')},
            payment,
            {col('consultation', "'[]'")},
            {col('forms', "'[]'")},
            {col('consents', "'[]'")},
            {col('notes', "'[]'")},
            {col('deleted', '0')},
            {col('created_at', 'CURRENT_TIMESTAMP')},
            {col('updated_at', 'CURRENT_TIMESTAMP')}
        FROM procedures_legacy
        """
    )
    conn.execute("DROP TABLE procedures_legacy")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_procedures_patient_id ON procedures(patient_id)")


def _create_payments_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'GBP',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
        """
    )


def seed_default_admin_user(
    password_hash: str,
    username: str = "admin",
    automation_username: str = "automation",
) -> None:
    """Ensure the default admin and automation users exist."""
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT username FROM users")
        existing_usernames = {row[0] for row in cursor.fetchall()}
        inserts: List[Tuple[str, int]] = []
        if username not in existing_usernames:
            inserts.append((username, 1))
        if automation_username and automation_username not in existing_usernames:
            inserts.append((automation_username, 0))
        if not inserts:
            return
        conn.executemany(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
            [(name, password_hash, is_admin) for name, is_admin in inserts],
        )
        conn.commit()


def list_users() -> List[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT id, username, is_admin FROM users ORDER BY username")
        return [dict(row) for row in cursor.fetchall()]


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT id, username, password_hash, is_admin FROM users WHERE username = ?", (username,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_user(user_id: int) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT id, username, password_hash, is_admin FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def create_user(username: str, password_hash: str, is_admin: bool = False) -> Dict[str, Any]:
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
            (username, password_hash, 1 if is_admin else 0),
        )
        conn.commit()
        return get_user(cursor.lastrowid)


def update_user_password(user_id: int, password_hash: str) -> bool:
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (password_hash, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def update_user_admin_flag(user_id: int, is_admin: bool) -> bool:
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            "UPDATE users SET is_admin = ? WHERE id = ?",
            (1 if is_admin else 0, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_user(user_id: int) -> bool:
    with closing(get_connection()) as conn:
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return cursor.rowcount > 0

DEFAULT_FIELD_OPTIONS: Dict[str, List[Dict[str, str]]] = {
    "status": [
        {"value": "confirmed", "label": "Confirmed"},
        {"value": "reserved", "label": "Reserved"},
        {"value": "cancelled", "label": "Cancelled"},
        {"value": "done", "label": "Done"},
    ],
    "procedure_type": [
        {"value": "hair_transplant", "label": "Hair Transplant"},
        {"value": "beard", "label": "Beard Transplant"},
        {"value": "woman", "label": "Woman Transplant"},
        {"value": "eyebrow", "label": "Eyebrow Transplant"},
        {"value": "face_to_face_consultation", "label": "Face to Face Consultation"},
        {"value": "video_consultation", "label": "Video Consultation"},
    ],
    "package_type": [
        {"value": "na", "label": "N/A"},
        {"value": "small", "label": "Small"},
        {"value": "big", "label": "Big"},
    ],
    "agency": [
        {"value": "want_hair", "label": "Want Hair"},
        {"value": "liv_hair", "label": "Liv Hair"},
    ],
    "forms": [
        {"value": "form_1", "label": "Form 1"},
        {"value": "form_2", "label": "Form 2"},
        {"value": "form_3", "label": "Form 3"},
        {"value": "form_4", "label": "Form 4"},
        {"value": "form_5", "label": "Form 5"},
    ],
    "consents": [
        {"value": "consent_1", "label": "Consent 1"},
        {"value": "consent_2", "label": "Consent 2"},
        {"value": "consent_3", "label": "Consent 3"},
    ],
    "consultation": [
        {"value": "consultation_1", "label": "Consultation 1"},
        {"value": "consultation_2", "label": "Consultation 2"},
    ],
    "payment": [
        {"value": "waiting", "label": "Waiting"},
        {"value": "paid", "label": "Paid"},
        {"value": "partially_paid", "label": "Partially Paid"},
    ],
}


def init_db() -> None:
    """Create the database tables for patients, procedures, photos, payments, and ancillary data."""
    with closing(sqlite3.connect(DB_PATH)) as conn:
        _create_weekly_plans(conn)
        _reset_patients_table(conn)
        _reset_procedures_table(conn)
        _create_payments_table(conn)
        _create_procedure_bookings(conn)
        _create_field_options(conn)
        _create_users(conn)
        _create_api_tokens(conn)
        _create_api_requests(conn)
        _create_activity_feed_table(conn)
        _ensure_procedure_booking_updated_at_trigger(conn)
        _ensure_api_token_user_column(conn)
        _ensure_field_options(conn)
        conn.commit()


def _ensure_field_options(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("SELECT field FROM field_options")
    existing = {row[0] for row in cursor.fetchall()}
    updated = False
    if "surgery_type" in existing and "procedure_type" not in existing:
        conn.execute("UPDATE field_options SET field = 'procedure_type' WHERE field = 'surgery_type'")
        existing.remove("surgery_type")
        existing.add("procedure_type")
        updated = True
    for field in FIELD_OPTION_FIELDS:
        if field not in existing:
            conn.execute(
                "INSERT INTO field_options (field, options) VALUES (?, ?)",
                (field, json.dumps(DEFAULT_FIELD_OPTIONS[field])),
            )
            updated = True
        elif _normalize_sequential_field_options(conn, field):
            updated = True
    if updated:
        conn.commit()


def _ensure_api_token_user_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(api_tokens)")
    columns = {row[1] for row in cursor.fetchall()}
    if "user_id" not in columns:
        conn.execute("ALTER TABLE api_tokens ADD COLUMN user_id INTEGER")
        conn.commit()
        conn.execute(
            """
            UPDATE api_tokens
            SET user_id = (
                SELECT id FROM users ORDER BY is_admin DESC, id ASC LIMIT 1
            )
            WHERE user_id IS NULL
            """
        )
        conn.commit()


def _ensure_procedure_booking_updated_at_trigger(conn: sqlite3.Connection) -> None:
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'procedure_bookings_updated_at'"
    )
    if cursor.fetchone():
        return
    conn.execute(
        """
        CREATE TRIGGER procedure_bookings_updated_at
        AFTER UPDATE ON procedure_bookings
        FOR EACH ROW
        BEGIN
            UPDATE procedure_bookings SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
        END;
        """
    )
    conn.commit()


def _normalize_consultation_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("SELECT id, consultation FROM patients WHERE consultation IS NOT NULL")
    rows = cursor.fetchall()
    updated = False
    for patient_id, value in rows:
        if not value:
            new_value = json.dumps([])
        else:
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                continue
            if isinstance(parsed, str):
                new_value = json.dumps([parsed])
            elif parsed is None:
                new_value = json.dumps([])
            else:
                new_value = json.dumps([value])
        conn.execute("UPDATE patients SET consultation = ? WHERE id = ?", (new_value, patient_id))
        updated = True
    if updated:
        conn.commit()


def _deserialize_field_option_payload(payload: Optional[str]) -> Optional[List[Dict[str, str]]]:
    if not payload:
        return None
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    normalized: List[Dict[str, str]] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        value = str(entry.get("value", "")).strip()
        label = str(entry.get("label", "")).strip() or value
        if not value:
            continue
        normalized.append({"value": value, "label": label})
    return normalized


def _extract_sequential_suffix(base: str, value: str) -> Optional[int]:
    """Return the numeric suffix when the value matches the expected prefix."""
    if not value:
        return None
    match = re.match(rf"^{re.escape(base)}-?(\d+)$", value)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _normalize_sequential_field_options(conn: sqlite3.Connection, field: str) -> bool:
    """
    Convert legacy values (e.g., form1) to the new dashed format (form-1) while preserving order.
    """
    base = SEQUENTIAL_OPTION_PREFIXES.get(field)
    if not base:
        return False
    cursor = conn.execute("SELECT options FROM field_options WHERE field = ?", (field,))
    row = cursor.fetchone()
    if not row:
        return False
    raw_options = row[0]
    options = _deserialize_field_option_payload(raw_options)
    if not options:
        return False
    changed = False
    normalized: list[dict[str, str]] = []
    next_suffix = 1
    for option in options:
        suffix = _extract_sequential_suffix(base, option["value"])
        if suffix is None:
            suffix = next_suffix
            changed = True
        next_suffix = max(next_suffix, suffix + 1)
        new_value = f"{base}-{suffix}"
        if new_value != option["value"]:
            changed = True
        normalized.append({"value": new_value, "label": option["label"]})
    if changed:
        conn.execute(
            "UPDATE field_options SET options = ? WHERE field = ?",
            (json.dumps(normalized), field),
        )
    return changed


def list_field_options() -> Dict[str, List[Dict[str, str]]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT field, options FROM field_options")
        data = {row[0]: _deserialize_field_option_payload(row[1]) for row in cursor.fetchall()}
    result: Dict[str, List[Dict[str, str]]] = {}
    for field in FIELD_OPTION_FIELDS:
        options = data.get(field)
        result[field] = options if options is not None else DEFAULT_FIELD_OPTIONS[field]
    return result


def get_field_options(field: str) -> List[Dict[str, str]]:
    if field not in FIELD_OPTION_FIELDS:
        raise ValueError("Unknown field option")
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT options FROM field_options WHERE field = ?", (field,))
        row = cursor.fetchone()
    if not row:
        return DEFAULT_FIELD_OPTIONS[field]
    options = _deserialize_field_option_payload(row["options"])
    return options if options is not None else DEFAULT_FIELD_OPTIONS[field]


def update_field_options(field: str, options: List[Dict[str, str]]) -> List[Dict[str, str]]:
    if field not in FIELD_OPTION_FIELDS:
        raise ValueError("Unknown field option")
    sequential_base = SEQUENTIAL_OPTION_PREFIXES.get(field)
    next_suffix = 1
    if sequential_base:
        for option in options:
            candidate = str(option.get("value", "")).strip()
            suffix = _extract_sequential_suffix(sequential_base, candidate) if candidate else None
            if suffix is not None:
                next_suffix = max(next_suffix, suffix + 1)
    normalized: List[Dict[str, str]] = []
    seen: set[str] = set()
    for option in options:
        value = str(option.get("value", "")).strip()
        label = str(option.get("label", "")).strip() or value
        if sequential_base:
            if not label and not value:
                continue
            candidate = value if value and value not in seen else ""
            if candidate:
                suffix = _extract_sequential_suffix(sequential_base, candidate)
                if suffix is not None and suffix >= next_suffix:
                    next_suffix = suffix + 1
            while not candidate or candidate in seen:
                candidate = f"{sequential_base}-{next_suffix}"
                next_suffix += 1
            value = candidate
        else:
            if not value:
                continue
            if value in seen:
                continue
        seen.add(value)
        normalized.append({"value": value, "label": label})
    with closing(get_connection()) as conn:
        conn.execute(
            "INSERT INTO field_options (field, options) VALUES (?, ?) ON CONFLICT(field) DO UPDATE SET options = excluded.options",
            (field, json.dumps(normalized)),
        )
        conn.commit()
    return normalized


def get_connection() -> sqlite3.Connection:
    """Return a connection with row results as dictionaries."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _create_procedure_bookings(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS procedure_bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            scheduled_at TEXT,
            provider TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(patient_id) REFERENCES patients(id)
        )
        """
    )


def _create_field_options(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS field_options (
            field TEXT PRIMARY KEY,
            options TEXT NOT NULL
        )
        """
    )


def _create_users(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0
        )
        """
    )


def _create_api_tokens(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS api_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            user_id INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )


def _create_api_requests(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS api_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            method TEXT NOT NULL,
            payload TEXT,
            response TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    _ensure_api_response_column(conn)


def _create_activity_feed_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS activity_feed (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            entity TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_identifier TEXT,
            summary TEXT NOT NULL,
            data TEXT NOT NULL,
            actor TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_activity_feed_created_at ON activity_feed(created_at DESC, id DESC)"
    )


def _ensure_api_response_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(api_requests)")
    columns = set()
    for row in cursor.fetchall():
        try:
            columns.add(row["name"])
        except (TypeError, IndexError, KeyError):
            if len(row) > 1:
                columns.add(row[1])
    if "response" not in columns:
        conn.execute("ALTER TABLE api_requests ADD COLUMN response TEXT")


def _row_to_plan(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "week_start": row["week_start"],
        "focus_area": row["focus_area"],
        "objectives": row["objectives"],
        "metrics": row["metrics"],
        "notes": row["notes"],
    }


def _deserialize_consultation(value: Optional[str]) -> List[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return [value]
    if isinstance(parsed, list):
        return [str(item) for item in parsed]
    if isinstance(parsed, str):
        return [parsed]
    return []


def _deserialize_json_list(value: Optional[str]) -> List[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return [value] if isinstance(value, str) else []
    if isinstance(parsed, list):
        return [str(item) for item in parsed]
    if isinstance(parsed, str):
        return [parsed]
    return []


def _flatten_note_entries(entries: Any) -> List[Any]:
    """Flatten nested note payloads into a simple list of candidate entries."""
    flattened: List[Any] = []

    def _walk(item: Any, inherited: Optional[Dict[str, Any]] = None) -> None:
        if item is None:
            return
        if isinstance(item, list):
            for sub in item:
                _walk(sub, inherited=inherited)
            return
        if isinstance(item, dict):
            text_value = item.get("text")
            # When the text itself is a list of note dictionaries, merge parent defaults.
            if isinstance(text_value, list):
                parent = dict(item)
                parent.pop("text", None)
                for sub in text_value:
                    merged: Dict[str, Any]
                    if isinstance(sub, dict):
                        merged = {**parent, **sub}
                    else:
                        merged = dict(parent)
                        merged["text"] = sub
                    _walk(merged, inherited=None)
                return
            merged_entry = dict(inherited or {})
            merged_entry.update(item)
            flattened.append(merged_entry)
            return
        flattened.append(item if inherited is None else dict(inherited, text=item))

    for entry in entries or []:
        _walk(entry)
    return flattened


def _normalize_note_entry(
    entry: Any,
    *,
    default_author: Optional[str] = None,
    default_user: Optional[int] = None,
    existing: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Normalize a single note entry into a consistent dictionary."""
    if hasattr(entry, "model_dump"):
        try:
            entry = entry.model_dump()
        except Exception:
            pass
    base: Dict[str, Any] = {}
    if isinstance(entry, dict):
        base = dict(entry)
        text = str(
            base.get("text")
            or base.get("note")
            or base.get("value")
            or base.get("description")
            or ""
        ).strip()
    elif isinstance(entry, str):
        text = entry.strip()
    else:
        return None
    if not text:
        return None

    existing_note = existing or {}
    note_id = str(
        base.get("id")
        or base.get("_id")
        or base.get("uuid")
        or existing_note.get("id")
        or secrets.token_hex(8)
    )
    created_at = base.get("created_at") or existing_note.get("created_at") or london_now_iso()
    completed = bool(base.get("completed", existing_note.get("completed", False)))
    user_id_value = base.get("user_id", existing_note.get("user_id", default_user))
    try:
        user_id = int(user_id_value) if user_id_value is not None else None
    except (TypeError, ValueError):
        user_id = None
    author = base.get("author", existing_note.get("author", default_author))

    return {
        "id": note_id,
        "text": text,
        "completed": completed,
        "user_id": user_id if user_id is not None else None,
        "author": author,
        "created_at": created_at,
    }


def normalize_notes_payload(
    notes: Any,
    *,
    user_id: Optional[int] = None,
    author: Optional[str] = None,
    existing: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Normalize a list of raw note entries into structured dictionaries."""
    existing_map = {
        note.get("id"): note for note in (existing or []) if isinstance(note, dict) and note.get("id")
    }
    if notes is None:
        return []
    raw_items = _flatten_note_entries(notes if isinstance(notes, list) else [notes])
    normalized: List[Dict[str, Any]] = []
    for entry in raw_items:
        base_existing = None
        if isinstance(entry, dict) and entry.get("id") in existing_map:
            base_existing = existing_map.get(entry.get("id"))
        normalized_entry = _normalize_note_entry(
            entry,
            default_author=author,
            default_user=user_id,
            existing=base_existing,
        )
        if normalized_entry:
            normalized.append(normalized_entry)
    return normalized


def _deserialize_json_payload(value: Optional[str]) -> Any:
    if not value:
        return []
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return []


def _row_to_patient(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a patient row to a dictionary (personal info only)."""
    address_value = None
    if "address" in row.keys():
        address_value = row["address"]
    elif "city" in row.keys():
        address_value = row["city"]
    return {
        "id": row["id"],
        "first_name": (row["first_name"] or "").strip(),
        "last_name": (row["last_name"] or "").strip(),
        "email": row["email"],
        "phone": row["phone"],
        "address": address_value or "",
        "drive_folder_id": row["drive_folder_id"] if "drive_folder_id" in row.keys() else None,
        "photo_count": row["photo_count"] if "photo_count" in row.keys() else 0,
        "deleted": bool(row["deleted"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_procedure(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a procedure row to a dictionary."""
    forms = _deserialize_json_list(row["forms"])
    consents = _deserialize_json_list(row["consents"])
    notes_raw = row["notes"] if "notes" in row.keys() and row["notes"] is not None else "[]"
    try:
        loaded_notes = json.loads(notes_raw) if notes_raw else []
    except Exception:
        loaded_notes = _deserialize_json_list(notes_raw)
    notes = normalize_notes_payload(loaded_notes)
    photo_count_value = 0
    if "photo_count" in row.keys():
        try:
            photo_count_value = int(row["photo_count"] or 0)
        except (TypeError, ValueError):
            photo_count_value = 0
    elif "patient_photo_count" in row.keys():
        try:
            photo_count_value = int(row["patient_photo_count"] or 0)
        except (TypeError, ValueError):
            photo_count_value = 0
    procedure_date = _date_only(row["procedure_date"]) or ""
    balance: Optional[float] = None
    balance_raw = row["outstanding_balance"] if "outstanding_balance" in row.keys() else None
    try:
        balance = float(balance_raw) if balance_raw is not None else None
    except (TypeError, ValueError):
        balance = None
    try:
        grafts_value = float(row["grafts"])
    except (TypeError, ValueError):
        grafts_value = 0
    return {
        "id": row["id"],
        "patient_id": row["patient_id"],
        "procedure_date": procedure_date,
        "procedure_time": (
            row["procedure_time"]
            if "procedure_time" in row.keys() and row["procedure_time"]
            else DEFAULT_PROCEDURE_TIME
        ),
        "status": row["status"],
        "procedure_type": row["procedure_type"],
        "package_type": (row["package_type"] if "package_type" in row.keys() else "") or "",
        "agency": (row["agency"] if "agency" in row.keys() else "") or "",
        "grafts": grafts_value,
        "payment": row["payment"],
        "consultation": _deserialize_consultation(row["consultation"]),
        "forms": forms,
        "consents": consents,
        "notes": notes,
        "outstanding_balance": balance,
        "photos": max(0, photo_count_value),
        "deleted": bool(row["deleted"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_payment(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a payment row to a dictionary."""
    return {
        "id": row["id"],
        "patient_id": row["patient_id"],
        "amount": row["amount"],
        "currency": row["currency"],
        "created_at": row["created_at"],
    }


def fetch_weekly_plans() -> List[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            "SELECT id, week_start, focus_area, objectives, metrics, notes FROM weekly_plans ORDER BY week_start DESC"
        )
        return [_row_to_plan(row) for row in cursor.fetchall()]


def fetch_weekly_plan(plan_id: int) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            "SELECT id, week_start, focus_area, objectives, metrics, notes FROM weekly_plans WHERE id = ?",
            (plan_id,),
        )
        row = cursor.fetchone()
        return _row_to_plan(row) if row else None


def create_weekly_plan(data: Dict[str, Any]) -> Dict[str, Any]:
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO weekly_plans (week_start, focus_area, objectives, metrics, notes)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                data["week_start"],
                data["focus_area"],
                data["objectives"],
                data.get("metrics"),
                data.get("notes"),
            ),
        )
        conn.commit()
        new_id = cursor.lastrowid
    created = fetch_weekly_plan(new_id)
    if not created:
        raise RuntimeError("Failed to fetch plan after creation")
    return created


def update_weekly_plan(plan_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            UPDATE weekly_plans
            SET week_start = ?, focus_area = ?, objectives = ?, metrics = ?, notes = ?
            WHERE id = ?
            """,
            (
                data["week_start"],
                data["focus_area"],
                data["objectives"],
                data.get("metrics"),
                data.get("notes"),
                plan_id,
            ),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return fetch_weekly_plan(plan_id)


def delete_weekly_plan(plan_id: int) -> bool:
    with closing(get_connection()) as conn:
        cursor = conn.execute("DELETE FROM weekly_plans WHERE id = ?", (plan_id,))
        conn.commit()
        return cursor.rowcount > 0


def fetch_patients(include_deleted: bool = False, only_deleted: bool = False) -> List[Dict[str, Any]]:
    records = _fetch_patient_rows(include_deleted=include_deleted, only_deleted=only_deleted)
    if records or include_deleted or only_deleted:
        return records
    if _has_any_patients():
        return []
    # Auto-seed demo data when the table has zero rows so the UI always has content.
    seed_patients_if_empty()
    return _fetch_patient_rows(include_deleted=include_deleted, only_deleted=only_deleted)


def _fetch_patient_rows(include_deleted: bool = False, only_deleted: bool = False) -> List[Dict[str, Any]]:
    clauses: list[str] = []
    if only_deleted:
        clauses.append("deleted = 1")
    elif not include_deleted:
        clauses.append("deleted = 0")
    where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    order_clause = "ORDER BY id DESC" if only_deleted else "ORDER BY last_name ASC, first_name ASC"
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            f"""
            SELECT patients.*
            FROM patients
            {where_clause}
            {order_clause}
            """
        )
        return [_row_to_patient(row) for row in cursor.fetchall()]


def fetch_patient(patient_id: int, *, include_deleted: bool = False) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        query = """
            SELECT patients.*
            FROM patients
            WHERE id = ?
        """
        params: Tuple[int, ...] = (patient_id,)
        if not include_deleted:
            query += " AND deleted = 0"
        cursor = conn.execute(query, params)
        row = cursor.fetchone()
        return _row_to_patient(row) if row else None


def _full_name_candidates(full_name: str) -> List[Tuple[str, str]]:
    """
    Generate candidate (first, last) pairs for a full name.

    The search endpoint receives unstructured names, so we try a few reasonable
    splits to cope with middle names (e.g., "Steven Levan Kwok" should match a
    stored "Steven Kwok").
    """
    normalized = " ".join(full_name.split())
    if not normalized:
        raise ValueError("Full name is required")
    parts = normalized.split(" ")
    if len(parts) < 2:
        raise ValueError("Full name must include both first and last name")

    raw_pairs = [
        (parts[0], " ".join(parts[1:])),         # first + everything else
        (" ".join(parts[:-1]), parts[-1]),       # everything but last + last
    ]
    if len(parts) > 2:
        raw_pairs.append((parts[0], parts[-1]))  # first + last token only

    candidates: list[Tuple[str, str]] = []
    seen: set[Tuple[str, str]] = set()
    for first_name, last_name in raw_pairs:
        first = first_name.strip()
        last = last_name.strip()
        if not first or not last:
            continue
        key = (first.lower(), last.lower())
        if key in seen:
            continue
        seen.add(key)
        candidates.append((first, last))
    return candidates


def find_patient_by_full_name(full_name: str) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        for first_name, last_name in _full_name_candidates(full_name):
            normalized_first = first_name.lower().strip()
            normalized_last = last_name.lower().strip()
            cursor = conn.execute(
                """
                SELECT * FROM patients
                WHERE LOWER(TRIM(first_name)) = ? AND LOWER(TRIM(last_name)) = ? AND deleted = 0
                ORDER BY id ASC
                LIMIT 1
                """,
                (normalized_first, normalized_last),
            )
            row = cursor.fetchone()
            if row:
                return _row_to_patient(row)
    return None


def find_patients_by_full_name(full_name: str) -> List[Dict[str, Any]]:
    """Return all patients that match any reasonable split of the supplied name."""
    seen_ids: set[int] = set()
    matches: list[Dict[str, Any]] = []
    with closing(get_connection()) as conn:
        for first_name, last_name in _full_name_candidates(full_name):
            normalized_first = first_name.lower().strip()
            normalized_last = last_name.lower().strip()
            cursor = conn.execute(
                """
                SELECT * FROM patients
                WHERE LOWER(TRIM(first_name)) = ? AND LOWER(TRIM(last_name)) = ? AND deleted = 0
                ORDER BY id ASC
                """,
                (normalized_first, normalized_last),
            )
            rows = cursor.fetchall()
            for row in rows:
                patient = _row_to_patient(row)
                if not patient or patient["id"] in seen_ids:
                    continue
                seen_ids.add(patient["id"])
                matches.append(patient)
    return matches


def find_patient_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Find a patient by email address."""
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            SELECT * FROM patients
            WHERE LOWER(TRIM(email)) = ? AND deleted = 0
            ORDER BY id ASC
            LIMIT 1
            """,
            (email.lower().strip(),),
        )
        row = cursor.fetchone()
        return _row_to_patient(row) if row else None
    
    
    def find_patient_by_name_and_date(first_name: str, last_name: str, procedure_date: Optional[str]) -> Optional[Dict[str, Any]]:
        """Find a patient by name and look for a procedure with the given date."""
    if not procedure_date:
        return None
    normalized_date = _date_only(procedure_date)
    if not normalized_date:
        return None
    with closing(get_connection()) as conn:
        # First find the patient by name
        cursor = conn.execute(
            """
            SELECT * FROM patients
            WHERE LOWER(TRIM(first_name)) = ? AND LOWER(TRIM(last_name)) = ? AND deleted = 0
            ORDER BY id ASC
            LIMIT 1
            """,
            (first_name.lower().strip(), last_name.lower().strip()),
        )
        row = cursor.fetchone()
        if not row:
            return None
        patient = _row_to_patient(row)
        # Verify they have a procedure on that date
        procedure_cursor = conn.execute(
            """
            SELECT COUNT(*) FROM procedures
            WHERE patient_id = ? AND procedure_date = ? AND deleted = 0
            """,
            (patient["id"], normalized_date),
        )
        if procedure_cursor.fetchone()[0] > 0:
            return patient
        return None


def find_procedure_by_metadata(
    patient_id: Optional[int],
    procedure_date: Optional[str],
    *,
    status: Optional[str] = None,
    grafts_number: Optional[str | float] = None,
    package_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Locate a single procedure by optional patient/date/status metadata."""
    clauses = ["deleted = 0"]
    params: List[Any] = []
    if patient_id is not None:
        clauses.append("patient_id = ?")
        params.append(patient_id)
    normalized_date = _date_only(procedure_date) if procedure_date else None
    if procedure_date and not normalized_date:
        raise ValueError("date is invalid")
    if normalized_date:
        clauses.append("procedure_date = ?")
        params.append(normalized_date)
    if status:
        clauses.append("LOWER(status) = ?")
        params.append(status.lower().strip())
    if grafts_number:
        try:
            normalized_grafts = float(grafts_number)
        except (TypeError, ValueError):
            raise ValueError("grafts_number is invalid")
        clauses.append("grafts = ?")
        params.append(normalized_grafts)
    if package_type:
        clauses.append("LOWER(package_type) = ?")
        params.append(package_type.lower().strip())
    where = " AND ".join(clauses)
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            f"""
            SELECT * FROM procedures
            WHERE {where}
            ORDER BY id ASC
            LIMIT 1
            """,
            params,
        )
        row = cursor.fetchone()
        return _row_to_procedure(row) if row else None


def list_procedures(
    patient_id: Optional[int] = None,
    *,
    include_deleted: bool = False,
    only_deleted: bool = False,
) -> List[Dict[str, Any]]:
    """List procedures, optionally filtered by patient."""
    clauses: list[str] = []
    params: list[Any] = []
    if patient_id is not None:
        clauses.append("procedures.patient_id = ?")
        params.append(patient_id)
    if only_deleted:
        clauses.append("procedures.deleted = 1")
    elif not include_deleted:
        clauses.append("procedures.deleted = 0")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            f"""
            SELECT procedures.*, patients.photo_count AS patient_photo_count
            FROM procedures
            LEFT JOIN patients ON patients.id = procedures.patient_id
            {where}
            ORDER BY
                CASE WHEN procedure_date IS NULL OR procedure_date = '' THEN 1 ELSE 0 END,
                procedure_date ASC,
                id ASC
            """,
            params,
        )
        return [_row_to_procedure(row) for row in cursor.fetchall()]


def log_api_request(path: str, method: str, payload: Any, response_payload: Any | None = None) -> None:
    timestamp = london_now_iso()
    try:
        payload_text = json.dumps(payload)
    except Exception:
        payload_text = str(payload)
    response_text = None
    if response_payload is not None:
        try:
            response_text = json.dumps(response_payload)
        except Exception:
            response_text = str(response_payload)
    with closing(get_connection()) as conn:
        conn.execute(
            "INSERT INTO api_requests (path, method, payload, response, created_at) VALUES (?, ?, ?, ?, ?)",
            (path, method, payload_text, response_text, timestamp),
        )
        conn.commit()


def fetch_api_requests(limit: int = 100) -> List[Dict[str, Any]]:
    safe_limit = max(1, min(limit, 500))
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            "SELECT id, path, method, payload, response, created_at FROM api_requests ORDER BY id DESC LIMIT ?",
            (safe_limit,),
        )
        rows = cursor.fetchall()
        return [
            {
                "id": row["id"],
                "path": row["path"],
                "method": row["method"],
                "payload": row["payload"],
                "response": row["response"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]


def run_data_integrity_check(limit: int = 50) -> Dict[str, Any]:
    """Scan patient/procedure tables for missing required data."""
    safe_limit = max(1, min(limit, 500))
    checked_at = london_now_iso()

    def _blank(value: Any) -> bool:
        if value is None:
            return True
        if isinstance(value, str):
            return not value.strip()
        return False

    issue_entries: List[Dict[str, Any]] = []
    with closing(get_connection()) as conn:
        patients = conn.execute(
            "SELECT id, first_name, last_name, email, phone, COALESCE(address, city, '') AS address FROM patients"
        ).fetchall()
        procedures = conn.execute(
            """
            SELECT id, patient_id, procedure_date, status, procedure_type, payment, grafts
            FROM procedures
            """
        ).fetchall()

    patient_ids = {row["id"] for row in patients}
    for patient in patients:
        missing_fields = [
            field
            for field in ("first_name", "last_name", "email", "phone", "address")
            if _blank(patient[field])
        ]
        if missing_fields:
            issue_entries.append(
                {
                    "issue_type": "patient_missing_fields",
                    "entity": "patient",
                    "record_id": patient["id"],
                    "patient_id": patient["id"],
                    "missing_fields": missing_fields,
                    "message": f"Patient #{patient['id']} missing required fields: {', '.join(missing_fields)}",
                }
            )

    for procedure in procedures:
        missing_fields = [
            field
            for field in ("procedure_date", "status", "procedure_type", "payment")
            if _blank(procedure[field])
        ]
        if procedure["grafts"] is None:
            missing_fields.append("grafts")
        if missing_fields:
            issue_entries.append(
                {
                    "issue_type": "procedure_missing_fields",
                    "entity": "procedure",
                    "record_id": procedure["id"],
                    "patient_id": procedure["patient_id"],
                    "missing_fields": missing_fields,
                    "message": f"Procedure #{procedure['id']} missing required fields: {', '.join(missing_fields)}",
                }
            )
        if procedure["patient_id"] not in patient_ids:
            issue_entries.append(
                {
                    "issue_type": "missing_patient_record",
                    "entity": "procedure",
                    "record_id": procedure["id"],
                    "patient_id": procedure["patient_id"],
                    "missing_fields": [],
                    "message": f"Procedure #{procedure['id']} references missing patient #{procedure['patient_id']}",
                }
            )

    issue_entries.sort(key=lambda entry: (entry.get("entity") or "", entry.get("record_id") or 0))
    return {
        "checked_at": checked_at,
        "total_patients": len(patients),
        "total_procedures": len(procedures),
        "issue_count": len(issue_entries),
        "truncated": len(issue_entries) > safe_limit,
        "issues": issue_entries[:safe_limit],
    }


def record_activity_event(event: Dict[str, Any], limit: int = 10) -> None:
    """Persist an activity event and prune older rows to keep the table small."""
    payload_data = event.get("data") or {}
    entity_identifier = event.get("entityId")
    with closing(get_connection()) as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO activity_feed (
                event_id,
                entity,
                action,
                entity_identifier,
                summary,
                data,
                actor,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.get("id"),
                event.get("entity"),
                event.get("action"),
                str(entity_identifier) if entity_identifier is not None else None,
                event.get("summary"),
                json.dumps(payload_data),
                event.get("actor", "Another user"),
                event.get("timestamp"),
            ),
        )
        conn.execute(
            """
            DELETE FROM activity_feed
            WHERE id NOT IN (
                SELECT id FROM activity_feed
                ORDER BY datetime(created_at) DESC, id DESC
                LIMIT ?
            )
            """,
            (max(1, limit),),
        )
        conn.commit()


def list_activity_events(limit: int = 10) -> List[Dict[str, Any]]:
    safe_limit = max(1, min(limit, 50))
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            SELECT
                event_id,
                entity,
                action,
                entity_identifier,
                summary,
                data,
                actor,
                created_at
            FROM activity_feed
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
            """,
            (safe_limit,),
        )
        rows = cursor.fetchall()
    events: List[Dict[str, Any]] = []
    for row in rows:
        try:
            payload = json.loads(row["data"]) if row["data"] else {}
        except json.JSONDecodeError:
            payload = {}
        event = {
            "id": row["event_id"],
            "entity": row["entity"],
            "action": row["action"],
            "type": f"{row['entity']}.{row['action']}",
            "entityId": row["entity_identifier"],
            "summary": row["summary"],
            "data": payload,
            "actor": row["actor"],
            "timestamp": row["created_at"],
        }
        events.append(event)
    return events


def _serialize_patient_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """Serialize patient data (personal info only)."""
    normalized_first = (data.get("first_name") or "").strip()
    normalized_last = (data.get("last_name") or "").strip()
    normalized_address = (data.get("address") or data.get("city") or "").strip()
    photo_count_value = data.get("photo_count")
    try:
        normalized_photo_count = max(0, int(photo_count_value))
    except (TypeError, ValueError):
        normalized_photo_count = 0
    
    return {
        "first_name": normalized_first,
        "last_name": normalized_last,
        "email": data.get("email", ""),
        "phone": data.get("phone", ""),
        "address": normalized_address,
        "drive_folder_id": data.get("drive_folder_id"),
        "photo_count": normalized_photo_count,
    }


def _serialize_procedure_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """Serialize procedure data."""
    if "outstaning_balance" in data and "outstanding_balance" not in data:
        raise ValueError("outstanding_balance is invalid")

    consultation_value = data.get("consultation") or []
    if isinstance(consultation_value, str):
        consultation_list: List[str] = [consultation_value]
    else:
        consultation_list = list(consultation_value)

    grafts_value = data.get("grafts", 0)
    if grafts_value in ("", None):
        grafts_number: float = 0
    else:
        try:
            grafts_number = float(grafts_value)
        except (TypeError, ValueError):
            raise ValueError("grafts is invalid")

    balance_value = data.get("outstanding_balance")
    if balance_value in (None, "", "null"):
        normalized_balance = None
    else:
        try:
            normalized_balance = float(balance_value)
        except (TypeError, ValueError):
            raise ValueError("outstanding_balance is invalid")

    normalized_date = _date_only(data.get("procedure_date"))
    if not normalized_date:
        raise ValueError("procedure_date is required")
    normalized_time = _normalize_time(data.get("procedure_time"))

    return {
        "procedure_date": normalized_date,
        "procedure_time": normalized_time,
        "status": data.get("status", ""),
        "procedure_type": data.get("procedure_type", ""),
        "package_type": data.get("package_type") or "",
        "agency": data.get("agency") or "",
        "grafts": grafts_number,
        "payment": (data.get("payment") or ""),
        "consultation": json.dumps(consultation_list),
        "outstanding_balance": normalized_balance,
        "forms": json.dumps(data.get("forms") or []),
        "consents": json.dumps(data.get("consents") or []),
        "notes": json.dumps(normalize_notes_payload(data.get("notes"))),
    }


def create_patient(data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new patient record (personal info only)."""
    payload = _serialize_patient_payload(data)
    with closing(get_connection()) as conn:
        _ensure_patient_address_column(conn)
        cursor = conn.execute(
            """
            INSERT INTO patients (
                first_name, last_name, email, phone, address,
                drive_folder_id, photo_count
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["address"],
                payload["drive_folder_id"],
                payload["photo_count"],
            ),
        )
        conn.commit()
        new_id = cursor.lastrowid
    created = fetch_patient(new_id)
    if not created:
        raise RuntimeError("Failed to fetch patient after creation")
    return created


def update_patient(patient_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update patient personal information."""
    payload = _serialize_patient_payload(data)
    with closing(get_connection()) as conn:
        _ensure_patient_address_column(conn)
        cursor = conn.execute(
            """
            UPDATE patients
            SET
                first_name = ?,
                last_name = ?,
                email = ?,
                phone = ?,
                address = ?,
                drive_folder_id = ?,
                photo_count = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["address"],
                payload["drive_folder_id"],
                payload["photo_count"],
                patient_id,
            ),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return fetch_patient(patient_id)


def delete_patient(patient_id: int) -> bool:
    """Soft delete a patient (also soft deletes all their procedures via trigger/cascade)."""
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            UPDATE patients
            SET deleted = 1
            WHERE id = ? AND deleted = 0
            """,
            (patient_id,),
        )
        # Also soft delete all procedures for this patient
        conn.execute(
            """
            UPDATE procedures
            SET deleted = 1
            WHERE patient_id = ? AND deleted = 0
            """,
            (patient_id,),
        )
        conn.commit()
        return cursor.rowcount > 0


def merge_patients(
    target_patient_id: int,
    source_patient_ids: List[int],
    *,
    updates: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Merge duplicate patient records into the target record."""
    if not source_patient_ids:
        raise ValueError("Provide at least one duplicate patient to merge.")

    target = fetch_patient(target_patient_id)
    if not target:
        raise ValueError("Target patient was not found or is deleted.")

    merged_values = {
        "first_name": target["first_name"],
        "last_name": target["last_name"],
        "email": target["email"],
        "phone": target["phone"],
        "address": target.get("address", ""),
        "drive_folder_id": target.get("drive_folder_id"),
        "photo_count": target.get("photo_count", 0),
    }
    if updates:
        for field in ("first_name", "last_name", "email", "phone", "address", "drive_folder_id"):
            if updates.get(field) is not None:
                merged_values[field] = updates[field]

    normalized_sources: List[int] = []
    seen: set[int] = set()
    total_photo_count = merged_values.get("photo_count", 0) or 0
    for patient_id in source_patient_ids:
        if patient_id == target_patient_id or patient_id in seen:
            continue
        patient = fetch_patient(patient_id)
        if not patient:
            raise ValueError(f"Patient #{patient_id} was not found or is deleted.")
        normalized_sources.append(patient_id)
        seen.add(patient_id)
        total_photo_count += patient.get("photo_count", 0) or 0

    merged_values["photo_count"] = total_photo_count
    if updates and updates.get("photo_count") is not None:
        merged_values["photo_count"] = max(0, int(updates["photo_count"]))

    if not normalized_sources:
        raise ValueError("Add at least one other existing patient to merge.")

    payload = _serialize_patient_payload(merged_values)
    moved_procedures = 0
    moved_payments = 0

    with closing(get_connection()) as conn:
        conn.execute(
            """
            UPDATE patients
            SET
                first_name = ?,
                last_name = ?,
                email = ?,
                phone = ?,
                address = ?,
                drive_folder_id = ?,
                deleted = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["address"],
                payload["drive_folder_id"],
                target_patient_id,
            ),
        )

        for source_id in normalized_sources:
            proc_cursor = conn.execute(
                """
                UPDATE procedures
                SET patient_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE patient_id = ?
                """,
                (target_patient_id, source_id),
            )
            moved_procedures += proc_cursor.rowcount

            payment_cursor = conn.execute(
                "UPDATE payments SET patient_id = ? WHERE patient_id = ?",
                (target_patient_id, source_id),
            )
            moved_payments += payment_cursor.rowcount

            conn.execute(
                """
                UPDATE patients
                SET deleted = 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (source_id,),
            )

        conn.commit()

    updated_patient = fetch_patient(target_patient_id)
    return {
        "patient": updated_patient,
        "archived_patient_ids": normalized_sources,
        "moved_procedures": moved_procedures,
        "moved_payments": moved_payments,
    }


def list_procedures_for_patient(
    patient_id: int,
    *,
    include_deleted: bool = False,
    only_deleted: bool = False,
) -> List[Dict[str, Any]]:
    """List all procedures for a specific patient."""
    return list_procedures(
        patient_id=patient_id,
        include_deleted=include_deleted,
        only_deleted=only_deleted,
    )


def find_procedure_by_patient_and_date(
    patient_id: int,
    procedure_date: Optional[str],
    *,
    include_deleted: bool = False,
) -> Optional[Dict[str, Any]]:
    """Return the first procedure for a patient on the supplied date."""
    normalized_date = _date_only(procedure_date)
    if not normalized_date:
        raise ValueError("procedure_date is missing or invalid")
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            SELECT procedures.*, patients.photo_count AS patient_photo_count
            FROM procedures
            LEFT JOIN patients ON patients.id = procedures.patient_id
            WHERE procedures.patient_id = ?
              AND procedure_date = ?
              AND procedures.deleted = ?
            ORDER BY procedures.id ASC
            LIMIT 1
            """,
            (patient_id, normalized_date, 1 if include_deleted else 0),
        )
        row = cursor.fetchone()
        return _row_to_procedure(row) if row else None


def fetch_procedure(procedure_id: int, *, include_deleted: bool = False) -> Optional[Dict[str, Any]]:
    """Fetch a single procedure by ID."""
    with closing(get_connection()) as conn:
        query = """
            SELECT procedures.*, patients.photo_count AS patient_photo_count
            FROM procedures
            LEFT JOIN patients ON patients.id = procedures.patient_id
            WHERE procedures.id = ?
        """
        params: Tuple[int, ...] = (procedure_id,)
        if not include_deleted:
            query += " AND procedures.deleted = 0"
        cursor = conn.execute(query, params)
        row = cursor.fetchone()
        return _row_to_procedure(row) if row else None


def create_procedure(patient_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new procedure record for a patient."""
    payload = _serialize_procedure_payload(data)
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO procedures (
                patient_id, procedure_date, procedure_time, status, procedure_type, package_type, agency, grafts, outstanding_balance, payment,
                consultation, forms, consents, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                patient_id,
                payload["procedure_date"],
                payload["procedure_time"],
                payload["status"],
                payload["procedure_type"],
                payload["package_type"],
                payload["agency"],
                payload["grafts"],
                payload["outstanding_balance"],
                payload["payment"],
                payload["consultation"],
                payload["forms"],
                payload["consents"],
                payload["notes"],
            ),
        )
        conn.commit()
        new_id = cursor.lastrowid
    created = fetch_procedure(new_id)
    if not created:
        raise RuntimeError("Failed to fetch procedure after creation")
    return created


def update_procedure(procedure_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update an existing procedure record."""
    payload = _serialize_procedure_payload(data)
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            UPDATE procedures
            SET
                procedure_date = ?,
                procedure_time = ?,
                status = ?,
                procedure_type = ?,
                package_type = ?,
                agency = ?,
                grafts = ?,
                outstanding_balance = ?,
                payment = ?,
                consultation = ?,
                forms = ?,
                consents = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                payload["procedure_date"],
                payload["procedure_time"],
                payload["status"],
                payload["procedure_type"],
                payload["package_type"],
                payload["agency"],
                payload["grafts"],
                payload["outstanding_balance"],
                payload["payment"],
                payload["consultation"],
                payload["forms"],
                payload["consents"],
                payload["notes"],
                procedure_id,
            ),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return fetch_procedure(procedure_id)


def delete_procedure(procedure_id: int) -> bool:
    """Soft delete a procedure record."""
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            UPDATE procedures
            SET deleted = 1
            WHERE id = ? AND deleted = 0
            """,
            (procedure_id,),
        )
        conn.commit()
        return cursor.rowcount > 0


def restore_procedure(procedure_id: int) -> Optional[Dict[str, Any]]:
    """Restore a soft-deleted procedure."""
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            UPDATE procedures
            SET deleted = 0
            WHERE id = ? AND deleted = 1
            """,
            (procedure_id,),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return fetch_procedure(procedure_id)


def purge_procedure(procedure_id: int) -> bool:
    """Hard delete a procedure record."""
    with closing(get_connection()) as conn:
        cursor = conn.execute("DELETE FROM procedures WHERE id = ?", (procedure_id,))
        conn.commit()
        _reset_id_sequences_if_empty(conn)
        return cursor.rowcount > 0


def fetch_deleted_procedures() -> List[Dict[str, Any]]:
    """Return every soft-deleted procedure."""
    return list_procedures(include_deleted=True, only_deleted=True)


# Payment management functions
def create_payment(patient_id: int, amount: float, currency: str = "GBP") -> Dict[str, Any]:
    """Create a new payment record for a patient."""
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO payments (patient_id, amount, currency)
            VALUES (?, ?, ?)
            """,
            (patient_id, amount, currency),
        )
        conn.commit()
        payment_id = cursor.lastrowid
        cursor = conn.execute("SELECT * FROM payments WHERE id = ?", (payment_id,))
        row = cursor.fetchone()
        return _row_to_payment(row) if row else {}


def list_payments_for_patient(patient_id: int) -> List[Dict[str, Any]]:
    """List all payments for a specific patient."""
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            "SELECT * FROM payments WHERE patient_id = ? ORDER BY created_at DESC",
            (patient_id,),
        )
        return [_row_to_payment(row) for row in cursor.fetchall()]


def delete_payment(payment_id: int) -> bool:
    """Delete a payment record."""
    with closing(get_connection()) as conn:
        cursor = conn.execute("DELETE FROM payments WHERE id = ?", (payment_id,))
        conn.commit()
        return cursor.rowcount > 0


def restore_patient(patient_id: int) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute("UPDATE patients SET deleted = 0 WHERE id = ? AND deleted = 1", (patient_id,))
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return fetch_patient(patient_id)


def fetch_deleted_patients() -> List[Dict[str, Any]]:
    return _fetch_patient_rows(include_deleted=True, only_deleted=True)


def _reset_id_sequences_if_empty(conn: sqlite3.Connection) -> None:
    """Reset autoincrement counters when tables are empty after purging data."""
    reset_any = False
    patient_count = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
    procedure_count = conn.execute("SELECT COUNT(*) FROM procedures").fetchone()[0]
    if patient_count == 0:
        conn.execute("DELETE FROM sqlite_sequence WHERE name = 'patients'")
        reset_any = True
    if procedure_count == 0:
        conn.execute("DELETE FROM sqlite_sequence WHERE name = 'procedures'")
        reset_any = True
    if reset_any:
        conn.commit()


def purge_patient(patient_id: int) -> bool:
    """Hard delete a patient record."""
    with closing(get_connection()) as conn:
        cursor = conn.execute("DELETE FROM patients WHERE id = ?", (patient_id,))
        conn.commit()
        _reset_id_sequences_if_empty(conn)
        return cursor.rowcount > 0


def _generate_token_value(length: int = 48) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def create_api_token(name: str, user_id: int) -> Dict[str, Any]:
    token_value = _generate_token_value()
    created_at = london_now_iso()
    with closing(get_connection()) as conn:
        conn.execute(
            "INSERT INTO api_tokens (name, token, created_at, user_id) VALUES (?, ?, ?, ?)",
            (name, token_value, created_at, user_id),
        )
        conn.commit()
        cursor = conn.execute(
            "SELECT id, name, token, created_at, user_id FROM api_tokens WHERE token = ?",
            (token_value,),
        )
        row = cursor.fetchone()
        return dict(row)


def list_api_tokens(user_id: Optional[int] = None) -> List[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        if user_id is None:
            cursor = conn.execute(
                "SELECT id, name, token, created_at, user_id FROM api_tokens ORDER BY created_at DESC"
            )
        else:
            cursor = conn.execute(
                """
                SELECT id, name, token, created_at, user_id
                FROM api_tokens
                WHERE user_id = ?
                ORDER BY created_at DESC
                """,
                (user_id,),
            )
        return [dict(row) for row in cursor.fetchall()]


def delete_api_token(token_id: int, user_id: Optional[int] = None) -> bool:
    with closing(get_connection()) as conn:
        if user_id is None:
            cursor = conn.execute("DELETE FROM api_tokens WHERE id = ?", (token_id,))
        else:
            cursor = conn.execute("DELETE FROM api_tokens WHERE id = ? AND user_id = ?", (token_id, user_id))
        conn.commit()
        return cursor.rowcount > 0


def get_api_token_by_value(token_value: str) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            "SELECT id, name, token, created_at, user_id FROM api_tokens WHERE token = ?",
            (token_value,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def _has_any_patients() -> bool:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT COUNT(*) FROM patients")
        return cursor.fetchone()[0] > 0


def seed_patients_if_empty() -> bool:
    """Seed demo patients when the table has no entries."""
    with closing(sqlite3.connect(DB_PATH)) as conn:
        return _seed_patients_if_empty(conn)


def _seed_patients_if_empty(conn: sqlite3.Connection) -> bool:
    """Seed demo patients if the table is empty."""
    cursor = conn.execute("SELECT COUNT(*) FROM patients")
    existing = cursor.fetchone()[0]
    if existing:
        return False
    rng = random.Random(2025)
    patient_ids: list[int] = []
    for record in DEMO_PATIENTS:
        cursor = conn.execute(
            """
            INSERT INTO patients (first_name, last_name, email, phone, address)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                record["first_name"],
                record["last_name"],
                record["email"],
                record["phone"],
                record["address"],
            ),
        )
        patient_ids.append(cursor.lastrowid)
    conn.commit()
    _seed_demo_procedures(conn, patient_ids, rng)
    return True


def _seed_procedures_from_patients_if_empty(conn: sqlite3.Connection) -> bool:
    """Legacy function - no longer needed with new schema."""
    return False


def _seed_demo_procedures(conn: sqlite3.Connection, patient_ids: List[int], rng: random.Random) -> None:
    """Create demo procedures in November 2025 for seeded patients."""
    if not patient_ids:
        return
    patient_id = patient_ids[0]
    scheduled_for = date(2025, 10, 15).isoformat()
    conn.execute(
        """
        INSERT INTO procedures (
            patient_id, procedure_date, procedure_time, status, procedure_type, package_type, agency, grafts, payment,
            consultation, forms, consents, notes
        ) VALUES (?, ?, ?, 'reserved', 'sfue', 'small', 'want_hair', '2500', 'waiting', '[]', '[]', '[]', '[]')
        """,
        (
            patient_id,
            scheduled_for,
            DEFAULT_PROCEDURE_TIME,
        ),
    )
    conn.commit()


DEMO_PATIENTS: List[Dict[str, Any]] = [
    {
        "first_name": "Ava",
        "last_name": "Wallace",
        "email": "ava.wallace@example.com",
        "phone": "+44 7700 900001",
        "address": "London",
    }
]
