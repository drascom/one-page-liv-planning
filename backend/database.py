"""SQLite helpers for the Liv planning backend."""
from __future__ import annotations

import json
import random
import secrets
import sqlite3
import string
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DB_PATH = Path(__file__).resolve().parent / "liv_planning.db"


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
        "city",
        "deleted",
        "created_at",
        "updated_at",
    }
    if columns and columns == desired:
        return
    # Drop legacy table if present; caller already decided data can be discarded
    conn.execute("DROP TABLE IF EXISTS patients")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            city TEXT NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _reset_procedures_table(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(procedures)")
    columns = {row[1] for row in cursor.fetchall()}
    desired = {
        "id",
        "patient_id",
        "procedure_date",
        "status",
        "procedure_type",
        "package_type",
        "agency",
        "grafts",
        "payment",
        "consultation",
        "forms",
        "consents",
        "photo_files",
        "deleted",
        "created_at",
        "updated_at",
    }
    if columns:
        missing = desired - columns
        alterable = {"package_type", "agency"}
        if not missing:
            return
        if missing.issubset(alterable):
            if "package_type" in missing:
                conn.execute("ALTER TABLE procedures ADD COLUMN package_type TEXT NOT NULL DEFAULT ''")
            if "agency" in missing:
                conn.execute("ALTER TABLE procedures ADD COLUMN agency TEXT NOT NULL DEFAULT ''")
            conn.commit()
            return
    conn.execute("DROP TABLE IF EXISTS procedures")
    conn.execute("DROP TABLE IF EXISTS surgeries")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS procedures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            procedure_date TEXT,
            status TEXT NOT NULL,
            procedure_type TEXT NOT NULL,
            package_type TEXT NOT NULL DEFAULT '',
            agency TEXT NOT NULL DEFAULT '',
            grafts TEXT NOT NULL DEFAULT '',
            payment TEXT NOT NULL,
            consultation TEXT NOT NULL DEFAULT '[]',
            forms TEXT NOT NULL DEFAULT '[]',
            consents TEXT NOT NULL DEFAULT '[]',
            photo_files TEXT NOT NULL DEFAULT '[]',
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_procedures_patient_id ON procedures(patient_id)")


def _create_photos_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            taken_at TEXT,
            file_path TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
        """
    )


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


def seed_default_admin_user(password_hash: str, username: str = "admin") -> None:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0]:
            return
        conn.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
            (username, password_hash),
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
        {"value": "reserved", "label": "Reserved"},
        {"value": "confirmed", "label": "Confirmed"},
        {"value": "insurgery", "label": "In Surgery"},
        {"value": "done", "label": "Done"},
    ],
    "procedure_type": [
        {"value": "sfue", "label": "sFUE"},
        {"value": "beard", "label": "Beard"},
        {"value": "woman", "label": "Woman"},
        {"value": "eyebrow", "label": "Eyebrow"},
    ],
    "package_type": [
        {"value": "small", "label": "Small"},
        {"value": "big", "label": "Big"},
    ],
    "agency": [
        {"value": "want_hair", "label": "Want Hair"},
        {"value": "liv_hair", "label": "Liv Hair"},
    ],
    "forms": [
        {"value": "form1", "label": "Form 1"},
        {"value": "form2", "label": "Form 2"},
        {"value": "form3", "label": "Form 3"},
        {"value": "form4", "label": "Form 4"},
        {"value": "form5", "label": "Form 5"},
    ],
    "consents": [
        {"value": "form1", "label": "Consent 1"},
        {"value": "form2", "label": "Consent 2"},
        {"value": "form3", "label": "Consent 3"},
    ],
    "consultation": [
        {"value": "consultation1", "label": "Consultation 1"},
        {"value": "consultation2", "label": "Consultation 2"},
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
        _create_photos_table(conn)
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
    normalized: List[Dict[str, str]] = []
    seen: set[str] = set()
    for option in options:
        value = str(option.get("value", "")).strip()
        label = str(option.get("label", "")).strip() or value
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


def _row_to_patient(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a patient row to a dictionary (personal info only)."""
    return {
        "id": row["id"],
        "first_name": (row["first_name"] or "").strip(),
        "last_name": (row["last_name"] or "").strip(),
        "email": row["email"],
        "phone": row["phone"],
        "city": row["city"],
        "deleted": bool(row["deleted"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "photo_count": row["photo_count"] if "photo_count" in row.keys() else 0,
    }


def _row_to_procedure(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a procedure row to a dictionary."""
    return {
        "id": row["id"],
        "patient_id": row["patient_id"],
        "procedure_date": _date_only(row["procedure_date"]),
        "status": row["status"],
        "procedure_type": row["procedure_type"],
        "package_type": (row["package_type"] if "package_type" in row.keys() else "") or "",
        "agency": (row["agency"] if "agency" in row.keys() else "") or "",
        "grafts": row["grafts"],
        "payment": row["payment"],
        "consultation": _deserialize_consultation(row["consultation"]),
        "forms": json.loads(row["forms"]) if row["forms"] else [],
        "consents": json.loads(row["consents"]) if row["consents"] else [],
        "photo_files": json.loads(row["photo_files"]) if row["photo_files"] else [],
        "photos": row["photo_count"]
        if "photo_count" in row.keys() and row["photo_count"] is not None
        else len(json.loads(row["photo_files"])) if row["photo_files"] else 0,
        "deleted": bool(row["deleted"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_photo(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a photo row to a dictionary."""
    return {
        "id": row["id"],
        "patient_id": row["patient_id"],
        "name": row["name"],
        "taken_at": row["taken_at"],
        "file_path": row["file_path"],
        "created_at": row["created_at"],
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
            SELECT
                patients.*,
                (
                    SELECT COUNT(*) FROM photos WHERE photos.patient_id = patients.id
                ) AS photo_count
            FROM patients
            {where_clause}
            {order_clause}
            """
        )
        return [_row_to_patient(row) for row in cursor.fetchall()]


def fetch_patient(patient_id: int, *, include_deleted: bool = False) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        query = """
            SELECT
                patients.*,
                (
                    SELECT COUNT(*) FROM photos WHERE photos.patient_id = patients.id
                ) AS photo_count
            FROM patients
            WHERE id = ?
        """
        params: Tuple[int, ...] = (patient_id,)
        if not include_deleted:
            query += " AND deleted = 0"
        cursor = conn.execute(query, params)
        row = cursor.fetchone()
        return _row_to_patient(row) if row else None


def _split_full_name(full_name: str) -> Tuple[str, str]:
    normalized = " ".join(full_name.split())
    if not normalized:
        raise ValueError("Full name is required")
    parts = normalized.split(" ", 1)
    if len(parts) < 2:
        raise ValueError("Full name must include both first and last name")
    first_name = parts[0].strip()
    last_name = parts[1].strip()
    if not first_name or not last_name:
        raise ValueError("Full name must include both first and last name")
    return first_name, last_name


def find_patient_by_full_name(full_name: str) -> Optional[Dict[str, Any]]:
    first_name, last_name = _split_full_name(full_name)
    normalized_first = first_name.lower().strip()
    normalized_last = last_name.lower().strip()
    with closing(get_connection()) as conn:
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
    grafts_number: Optional[str] = None,
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
        clauses.append("grafts = ?")
        params.append(str(grafts_number).strip())
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
            SELECT
                procedures.*,
                (
                    SELECT COUNT(*) FROM photos WHERE photos.patient_id = procedures.patient_id
                ) AS photo_count
            FROM procedures
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
    timestamp = datetime.utcnow().isoformat() + "Z"
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
    return {
        "first_name": normalized_first,
        "last_name": normalized_last,
        "email": data.get("email", ""),
        "phone": data.get("phone", ""),
        "city": data.get("city", ""),
    }


def _serialize_procedure_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """Serialize procedure data."""
    consultation_value = data.get("consultation") or []
    if isinstance(consultation_value, str):
        consultation_list: List[str] = [consultation_value]
    else:
        consultation_list = list(consultation_value)

    return {
        "procedure_date": _date_only(data.get("procedure_date")),
        "status": data.get("status", ""),
        "procedure_type": data.get("procedure_type", ""),
        "package_type": data.get("package_type") or "",
        "agency": data.get("agency") or "",
        "grafts": data.get("grafts", ""),
        "payment": (data.get("payment") or ""),
        "consultation": json.dumps(consultation_list),
        "forms": json.dumps(data.get("forms") or []),
        "consents": json.dumps(data.get("consents") or []),
        "photo_files": json.dumps(data.get("photo_files") or []),
    }


def create_patient(data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new patient record (personal info only)."""
    payload = _serialize_patient_payload(data)
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO patients (first_name, last_name, email, phone, city)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["city"],
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
        cursor = conn.execute(
            """
            UPDATE patients
            SET
                first_name = ?,
                last_name = ?,
                email = ?,
                phone = ?,
                city = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["city"],
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
            SELECT
                procedures.*,
                (
                    SELECT COUNT(*) FROM photos WHERE photos.patient_id = procedures.patient_id
                ) AS photo_count
            FROM procedures
            WHERE patient_id = ?
              AND procedure_date = ?
              AND deleted = ?
            ORDER BY id ASC
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
            SELECT
                procedures.*,
                (
                    SELECT COUNT(*) FROM photos WHERE photos.patient_id = procedures.patient_id
                ) AS photo_count
            FROM procedures
            WHERE id = ?
        """
        params: Tuple[int, ...] = (procedure_id,)
        if not include_deleted:
            query += " AND deleted = 0"
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
                patient_id, procedure_date, status, procedure_type, package_type, agency, grafts, payment,
                consultation, forms, consents, photo_files
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                patient_id,
                payload["procedure_date"],
                payload["status"],
                payload["procedure_type"],
                payload["package_type"],
                payload["agency"],
                payload["grafts"],
                payload["payment"],
                payload["consultation"],
                payload["forms"],
                payload["consents"],
                payload["photo_files"],
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
                status = ?,
                procedure_type = ?,
                package_type = ?,
                agency = ?,
                grafts = ?,
                payment = ?,
                consultation = ?,
                forms = ?,
                consents = ?,
                photo_files = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                payload["procedure_date"],
                payload["status"],
                payload["procedure_type"],
                payload["package_type"],
                payload["agency"],
                payload["grafts"],
                payload["payment"],
                payload["consultation"],
                payload["forms"],
                payload["consents"],
                payload["photo_files"],
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
        return cursor.rowcount > 0


def fetch_deleted_procedures() -> List[Dict[str, Any]]:
    """Return every soft-deleted procedure."""
    return list_procedures(include_deleted=True, only_deleted=True)


# Photo management functions
def create_photo(patient_id: int, name: str, file_path: str, taken_at: Optional[str] = None) -> Dict[str, Any]:
    """Create a new photo record for a patient."""
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO photos (patient_id, name, file_path, taken_at)
            VALUES (?, ?, ?, ?)
            """,
            (patient_id, name, file_path, taken_at),
        )
        conn.commit()
        photo_id = cursor.lastrowid
        cursor = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,))
        row = cursor.fetchone()
        return _row_to_photo(row) if row else {}


def list_photos_for_patient(patient_id: int) -> List[Dict[str, Any]]:
    """List all photos for a specific patient."""
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            "SELECT * FROM photos WHERE patient_id = ? ORDER BY created_at DESC",
            (patient_id,),
        )
        return [_row_to_photo(row) for row in cursor.fetchall()]


def delete_photo(photo_id: int) -> bool:
    """Delete a photo record."""
    with closing(get_connection()) as conn:
        cursor = conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
        conn.commit()
        return cursor.rowcount > 0


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


def purge_patient(patient_id: int) -> bool:
    """Hard delete a patient record."""
    with closing(get_connection()) as conn:
        cursor = conn.execute("DELETE FROM patients WHERE id = ?", (patient_id,))
        conn.commit()
        return cursor.rowcount > 0


# Legacy photo functions - kept for backward compatibility with routes
# These work with the photos table now
def append_patient_photos(patient_id: int, relative_paths: List[str]) -> Optional[List[str]]:
    """Add photos to a patient (creates photo records in photos table)."""
    if not relative_paths:
        return fetch_patient_photos(patient_id)

    # Verify patient exists
    patient = fetch_patient(patient_id)
    if not patient or patient.get("deleted"):
        return None

    # Create photo records
    for path in relative_paths:
        create_photo(patient_id, path, path)

    return fetch_patient_photos(patient_id)


def remove_patient_photo(patient_id: int, relative_path: str) -> Optional[List[str]]:
    """Remove a photo from a patient."""
    patient = fetch_patient(patient_id)
    if not patient or patient.get("deleted"):
        return None

    # Find and delete the photo record
    photos = list_photos_for_patient(patient_id)
    for photo in photos:
        if photo["file_path"] == relative_path:
            delete_photo(photo["id"])
            break

    return fetch_patient_photos(patient_id)


def fetch_patient_photos(patient_id: int) -> Optional[List[str]]:
    """Fetch all photo file paths for a patient."""
    patient = fetch_patient(patient_id)
    if not patient or patient.get("deleted"):
        return None

    photos = list_photos_for_patient(patient_id)
    return [photo["file_path"] for photo in photos]


def _generate_token_value(length: int = 48) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def create_api_token(name: str, user_id: int) -> Dict[str, Any]:
    token_value = _generate_token_value()
    created_at = datetime.utcnow().isoformat()
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
            INSERT INTO patients (first_name, last_name, email, phone, city)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                record["first_name"],
                record["last_name"],
                record["email"],
                record["phone"],
                record["city"],
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
            patient_id, procedure_date, status, procedure_type, package_type, agency, grafts, payment,
            consultation, forms, consents, photo_files
        ) VALUES (?, ?, 'reserved', 'sfue', 'small', 'want_hair', '2500', 'waiting', '[]', '[]', '[]', '[]')
        """,
        (
            patient_id,
            scheduled_for,
        ),
    )
    conn.commit()


DEMO_PATIENTS: List[Dict[str, Any]] = [
    {
        "first_name": "Ava",
        "last_name": "Wallace",
        "email": "ava.wallace@example.com",
        "phone": "+44 7700 900001",
        "city": "London",
    }
]
