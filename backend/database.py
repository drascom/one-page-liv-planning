"""SQLite helpers for the Liv planning backend."""
from __future__ import annotations

import json
import secrets
import sqlite3
import string
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DB_PATH = Path(__file__).resolve().parent / "liv_planning.db"

FIELD_OPTION_FIELDS: List[str] = [
    "status",
    "procedure_type",
    "forms",
    "consents",
    "consultation",
    "payment",
]


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
        {"value": "small", "label": "Small"},
        {"value": "big", "label": "Big"},
        {"value": "beard", "label": "Beard"},
        {"value": "woman", "label": "Woman"},
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
    """Create the database tables and seed demo patients if empty."""
    with closing(sqlite3.connect(DB_PATH)) as conn:
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                month_label TEXT NOT NULL,
                week_label TEXT NOT NULL,
                week_range TEXT NOT NULL,
                week_order INTEGER NOT NULL,
                day_label TEXT NOT NULL,
                day_order INTEGER NOT NULL,
                procedure_date TEXT,
                deleted INTEGER NOT NULL DEFAULT 0,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL,
                city TEXT NOT NULL,
                status TEXT NOT NULL,
                procedure_type TEXT NOT NULL,
                grafts TEXT NOT NULL DEFAULT '',
                payment TEXT NOT NULL,
                consultation TEXT,
                forms TEXT NOT NULL DEFAULT '[]',
                consents TEXT NOT NULL DEFAULT '[]',
                photos INTEGER NOT NULL DEFAULT 0,
                photo_files TEXT NOT NULL DEFAULT '[]'
            )
            """
        )
        _ensure_procedure_date_column(conn)
        _ensure_procedure_type_column(conn)
        _ensure_photo_files_column(conn)
        _ensure_consultation_column(conn)
        _ensure_grafts_column(conn)
        _ensure_deleted_column(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS api_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                user_id INTEGER,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS field_options (
                field TEXT PRIMARY KEY,
                options TEXT NOT NULL
            )
            """
        )
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
        _ensure_api_token_user_column(conn)
        _ensure_field_options(conn)
        conn.commit()
        _seed_patients_if_empty(conn)


def _ensure_procedure_date_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    if "procedure_date" in columns:
        return
    if "patient_date" in columns:
        conn.execute("ALTER TABLE patients RENAME COLUMN patient_date TO procedure_date")
        conn.commit()
        return
    conn.execute("ALTER TABLE patients ADD COLUMN procedure_date TEXT")
    conn.commit()


def _ensure_procedure_type_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    if "procedure_type" in columns:
        return
    if "surgery_type" in columns:
        conn.execute("ALTER TABLE patients RENAME COLUMN surgery_type TO procedure_type")
        conn.commit()
        return
    conn.execute("ALTER TABLE patients ADD COLUMN procedure_type TEXT")
    conn.execute("UPDATE patients SET procedure_type = 'small' WHERE procedure_type IS NULL OR procedure_type = ''")
    conn.commit()


def _ensure_deleted_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    if "deleted" in columns:
        return
    conn.execute("ALTER TABLE patients ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")
    conn.execute("UPDATE patients SET deleted = 0 WHERE deleted IS NULL")
    conn.commit()


def _ensure_photo_files_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    if "photo_files" not in columns:
        conn.execute("ALTER TABLE patients ADD COLUMN photo_files TEXT NOT NULL DEFAULT '[]'")
        conn.execute("UPDATE patients SET photo_files = '[]' WHERE photo_files IS NULL")
        conn.commit()


def _ensure_consultation_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    if "consultation" not in columns:
        conn.execute("ALTER TABLE patients ADD COLUMN consultation TEXT")
        conn.commit()
    _normalize_consultation_column(conn)


def _ensure_grafts_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    if "grafts" in columns:
        return
    conn.execute("ALTER TABLE patients ADD COLUMN grafts TEXT NOT NULL DEFAULT ''")
    conn.execute("UPDATE patients SET grafts = '' WHERE grafts IS NULL")
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
    return conn


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
    return {
        "id": row["id"],
        "month_label": row["month_label"],
        "week_label": row["week_label"],
        "week_range": row["week_range"],
        "week_order": row["week_order"],
        "day_label": row["day_label"],
        "day_order": row["day_order"],
        "procedure_date": row["procedure_date"],
        "deleted": bool(row["deleted"]),
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "email": row["email"],
        "phone": row["phone"],
        "city": row["city"],
        "status": row["status"],
        "procedure_type": row["procedure_type"],
        "grafts": row["grafts"],
        "payment": row["payment"],
        "consultation": _deserialize_consultation(row["consultation"]),
        "forms": json.loads(row["forms"]) if row["forms"] else [],
        "consents": json.loads(row["consents"]) if row["consents"] else [],
        "photos": row["photos"],
        "photo_files": json.loads(row["photo_files"]) if row["photo_files"] else [],
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
    order_clause = "ORDER BY id DESC" if only_deleted else "ORDER BY week_order ASC, day_order ASC, last_name ASC"
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            f"""
            SELECT * FROM patients
            {where_clause}
            {order_clause}
            """
        )
        return [_row_to_patient(row) for row in cursor.fetchall()]


def fetch_patient(patient_id: int, *, include_deleted: bool = False) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        query = "SELECT * FROM patients WHERE id = ?"
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
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            SELECT * FROM patients
            WHERE LOWER(first_name) = ? AND LOWER(last_name) = ? AND deleted = 0
            ORDER BY week_order ASC, day_order ASC, last_name ASC
            LIMIT 1
            """,
            (first_name.lower(), last_name.lower()),
        )
        row = cursor.fetchone()
        return _row_to_patient(row) if row else None


def _serialize_patient_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    consultation_value = data.get("consultation") or []
    if isinstance(consultation_value, str):
        consultation_list: List[str] = [consultation_value]
    else:
        consultation_list = list(consultation_value)
    return {
        "month_label": data["month_label"],
        "week_label": data["week_label"],
        "week_range": data["week_range"],
        "week_order": data["week_order"],
        "day_label": data["day_label"],
        "day_order": data["day_order"],
        "procedure_date": data.get("procedure_date"),
        "first_name": data["first_name"],
        "last_name": data["last_name"],
        "email": data["email"],
        "phone": data["phone"],
        "city": data["city"],
        "status": data["status"],
        "procedure_type": data["procedure_type"],
        "grafts": data.get("grafts", ""),
        "payment": data["payment"],
        "consultation": json.dumps(consultation_list),
        "forms": json.dumps(data.get("forms") or []),
        "consents": json.dumps(data.get("consents") or []),
        "photos": data.get("photos", 0),
        "photo_files": json.dumps(data.get("photo_files") or []),
    }


def create_patient(data: Dict[str, Any]) -> Dict[str, Any]:
    payload = _serialize_patient_payload(data)
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO patients (
                month_label, week_label, week_range, week_order,
                day_label, day_order, procedure_date,
                first_name, last_name, email, phone, city,
                status, procedure_type, grafts, payment, consultation, forms, consents, photos, photo_files
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["month_label"],
                payload["week_label"],
                payload["week_range"],
                payload["week_order"],
                payload["day_label"],
                payload["day_order"],
                payload["procedure_date"],
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["city"],
                payload["status"],
                payload["procedure_type"],
                payload["grafts"],
                payload["payment"],
                payload["consultation"],
                payload["forms"],
                payload["consents"],
                payload["photos"],
                payload["photo_files"],
            ),
        )
        conn.commit()
        new_id = cursor.lastrowid
    created = fetch_patient(new_id)
    if not created:
        raise RuntimeError("Failed to fetch patient after creation")
    return created


def update_patient(patient_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    payload = _serialize_patient_payload(data)
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            UPDATE patients
            SET
                month_label = ?,
                week_label = ?,
                week_range = ?,
                week_order = ?,
                day_label = ?,
                day_order = ?,
                first_name = ?,
                last_name = ?,
                email = ?,
                phone = ?,
                city = ?,
                status = ?,
                procedure_type = ?,
                procedure_date = ?,
                grafts = ?,
                payment = ?,
                consultation = ?,
                forms = ?,
                consents = ?,
                photos = ?,
                photo_files = ?
            WHERE id = ?
            """,
            (
                payload["month_label"],
                payload["week_label"],
                payload["week_range"],
                payload["week_order"],
                payload["day_label"],
                payload["day_order"],
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["city"],
                payload["status"],
                payload["procedure_type"],
                payload["procedure_date"],
                payload["grafts"],
                payload["payment"],
                payload["consultation"],
                payload["forms"],
                payload["consents"],
                payload["photos"],
                payload["photo_files"],
                patient_id,
            ),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return fetch_patient(patient_id)


def delete_patient(patient_id: int) -> bool:
    with closing(get_connection()) as conn:
        cursor = conn.execute("UPDATE patients SET deleted = 1 WHERE id = ? AND deleted = 0", (patient_id,))
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


def append_patient_photos(patient_id: int, relative_paths: List[str]) -> Optional[List[str]]:
    if not relative_paths:
        return fetch_patient_photos(patient_id)
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT photo_files, deleted FROM patients WHERE id = ?", (patient_id,))
        row = cursor.fetchone()
        if not row:
            return None
        if row["deleted"]:
            return None
        current_files = json.loads(row["photo_files"]) if row["photo_files"] else []
        updated_files = current_files + relative_paths
        conn.execute(
            "UPDATE patients SET photo_files = ?, photos = ? WHERE id = ?",
            (json.dumps(updated_files), len(updated_files), patient_id),
        )
        conn.commit()
    return updated_files


def remove_patient_photo(patient_id: int, relative_path: str) -> Optional[List[str]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT photo_files, deleted FROM patients WHERE id = ?", (patient_id,))
        row = cursor.fetchone()
        if not row:
            return None
        if row["deleted"]:
            return None
        current_files: List[str] = json.loads(row["photo_files"]) if row["photo_files"] else []
        if relative_path not in current_files:
            return current_files
        updated_files = [path for path in current_files if path != relative_path]
        conn.execute(
            "UPDATE patients SET photo_files = ?, photos = ? WHERE id = ?",
            (json.dumps(updated_files), len(updated_files), patient_id),
        )
        conn.commit()
    return updated_files


def fetch_patient_photos(patient_id: int) -> Optional[List[str]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT photo_files, deleted FROM patients WHERE id = ?", (patient_id,))
        row = cursor.fetchone()
        if not row:
            return None
        if row["deleted"]:
            return None
        return json.loads(row["photo_files"]) if row["photo_files"] else []


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
    cursor = conn.execute("SELECT COUNT(*) FROM patients")
    existing = cursor.fetchone()[0]
    if existing:
        return False
    for patient in DEFAULT_PATIENTS:
        patient.setdefault("photo_files", [])
        patient.setdefault("procedure_date", None)
        patient.setdefault("consultation", [])
        payload = _serialize_patient_payload(patient)
        conn.execute(
            """
            INSERT INTO patients (
                month_label, week_label, week_range, week_order,
                day_label, day_order, procedure_date,
                first_name, last_name, email, phone, city,
                status, procedure_type, grafts, payment, consultation, forms, consents, photos, photo_files
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["month_label"],
                payload["week_label"],
                payload["week_range"],
                payload["week_order"],
                payload["day_label"],
                payload["day_order"],
                payload["procedure_date"],
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["city"],
                payload["status"],
                payload["procedure_type"],
                payload["grafts"],
                payload["payment"],
                payload["consultation"],
                payload["forms"],
                payload["consents"],
                payload["photos"],
                payload["photo_files"],
            ),
        )
    conn.commit()
    return True


DEFAULT_PATIENTS: List[Dict[str, Any]] = []
