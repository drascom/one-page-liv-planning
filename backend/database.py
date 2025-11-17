"""SQLite helpers for the Liv planning backend."""
from __future__ import annotations

import json
import secrets
import sqlite3
import string
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_PATH = Path(__file__).resolve().parent / "liv_planning.db"


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
                patient_date TEXT,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL,
                city TEXT NOT NULL,
                status TEXT NOT NULL,
                surgery_type TEXT NOT NULL,
                payment TEXT NOT NULL,
                forms TEXT NOT NULL DEFAULT '[]',
                consents TEXT NOT NULL DEFAULT '[]',
                photos INTEGER NOT NULL DEFAULT 0,
                photo_files TEXT NOT NULL DEFAULT '[]'
            )
            """
        )
        _ensure_patient_date_column(conn)
        _ensure_photo_files_column(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS api_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
        _seed_patients_if_empty(conn)


def _ensure_patient_date_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    if "patient_date" not in columns:
        conn.execute("ALTER TABLE patients ADD COLUMN patient_date TEXT")
        conn.commit()


def _ensure_photo_files_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("PRAGMA table_info(patients)")
    columns = {row[1] for row in cursor.fetchall()}
    if "photo_files" not in columns:
        conn.execute("ALTER TABLE patients ADD COLUMN photo_files TEXT NOT NULL DEFAULT '[]'")
        conn.execute("UPDATE patients SET photo_files = '[]' WHERE photo_files IS NULL")
        conn.commit()


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


def _row_to_patient(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "month_label": row["month_label"],
        "week_label": row["week_label"],
        "week_range": row["week_range"],
        "week_order": row["week_order"],
        "day_label": row["day_label"],
        "day_order": row["day_order"],
        "patient_date": row["patient_date"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "email": row["email"],
        "phone": row["phone"],
        "city": row["city"],
        "status": row["status"],
        "surgery_type": row["surgery_type"],
        "payment": row["payment"],
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


def fetch_patients() -> List[Dict[str, Any]]:
    records = _fetch_patient_rows()
    if records:
        return records
    # Auto-seed demo data when the table is empty so the UI always has content.
    seed_patients_if_empty()
    return _fetch_patient_rows()


def _fetch_patient_rows() -> List[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            SELECT * FROM patients
            ORDER BY week_order ASC, day_order ASC, last_name ASC
            """
        )
        return [_row_to_patient(row) for row in cursor.fetchall()]


def fetch_patient(patient_id: int) -> Optional[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,))
        row = cursor.fetchone()
        return _row_to_patient(row) if row else None


def _serialize_patient_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "month_label": data["month_label"],
        "week_label": data["week_label"],
        "week_range": data["week_range"],
        "week_order": data["week_order"],
        "day_label": data["day_label"],
        "day_order": data["day_order"],
        "patient_date": data.get("patient_date"),
        "first_name": data["first_name"],
        "last_name": data["last_name"],
        "email": data["email"],
        "phone": data["phone"],
        "city": data["city"],
        "status": data["status"],
        "surgery_type": data["surgery_type"],
        "payment": data["payment"],
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
                day_label, day_order, patient_date,
                first_name, last_name, email, phone, city,
                status, surgery_type, payment, forms, consents, photos, photo_files
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["month_label"],
                payload["week_label"],
                payload["week_range"],
                payload["week_order"],
                payload["day_label"],
                payload["day_order"],
                payload["patient_date"],
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["city"],
                payload["status"],
                payload["surgery_type"],
                payload["payment"],
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
                surgery_type = ?,
                patient_date = ?,
                payment = ?,
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
                payload["surgery_type"],
                payload["patient_date"],
                payload["payment"],
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


def append_patient_photos(patient_id: int, relative_paths: List[str]) -> Optional[List[str]]:
    if not relative_paths:
        return fetch_patient_photos(patient_id)
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT photo_files FROM patients WHERE id = ?", (patient_id,))
        row = cursor.fetchone()
        if not row:
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
        cursor = conn.execute("SELECT photo_files FROM patients WHERE id = ?", (patient_id,))
        row = cursor.fetchone()
        if not row:
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
        cursor = conn.execute("SELECT photo_files FROM patients WHERE id = ?", (patient_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return json.loads(row["photo_files"]) if row["photo_files"] else []


def _generate_token_value(length: int = 48) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def create_api_token(name: str) -> Dict[str, Any]:
    token_value = _generate_token_value()
    created_at = datetime.utcnow().isoformat()
    with closing(get_connection()) as conn:
        conn.execute(
            "INSERT INTO api_tokens (name, token, created_at) VALUES (?, ?, ?)",
            (name, token_value, created_at),
        )
        conn.commit()
        cursor = conn.execute(
            "SELECT id, name, token, created_at FROM api_tokens WHERE token = ?", (token_value,)
        )
        row = cursor.fetchone()
        return dict(row)


def list_api_tokens() -> List[Dict[str, Any]]:
    with closing(get_connection()) as conn:
        cursor = conn.execute("SELECT id, name, token, created_at FROM api_tokens ORDER BY created_at DESC")
        return [dict(row) for row in cursor.fetchall()]


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
        patient.setdefault("patient_date", None)
        payload = _serialize_patient_payload(patient)
        conn.execute(
            """
            INSERT INTO patients (
                month_label, week_label, week_range, week_order,
                day_label, day_order, patient_date,
                first_name, last_name, email, phone, city,
                status, surgery_type, payment, forms, consents, photos, photo_files
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["month_label"],
                payload["week_label"],
                payload["week_range"],
                payload["week_order"],
                payload["day_label"],
                payload["day_order"],
                payload["patient_date"],
                payload["first_name"],
                payload["last_name"],
                payload["email"],
                payload["phone"],
                payload["city"],
                payload["status"],
                payload["surgery_type"],
                payload["payment"],
                payload["forms"],
                payload["consents"],
                payload["photos"],
                payload["photo_files"],
            ),
        )
    conn.commit()
    return True


DEFAULT_PATIENTS: List[Dict[str, Any]] = [
    {
        "month_label": "June 2024",
        "week_label": "Week 1",
        "week_range": "Jun 3 – Jun 9",
        "week_order": 1,
        "day_label": "Mon",
        "day_order": 1,
        "first_name": "Emma",
        "last_name": "Torres",
        "email": "emma.torres@example.com",
        "phone": "+351 910 200 001",
        "city": "Lisbon",
        "status": "reserved",
        "surgery_type": "small",
        "payment": "waiting",
        "forms": ["form1", "form2"],
        "consents": ["form1"],
        "photos": 0,
    },
    {
        "month_label": "June 2024",
        "week_label": "Week 1",
        "week_range": "Jun 3 – Jun 9",
        "week_order": 1,
        "day_label": "Tue",
        "day_order": 2,
        "first_name": "Daniel",
        "last_name": "Costa",
        "email": "daniel.costa@example.com",
        "phone": "+351 910 200 002",
        "city": "Porto",
        "status": "confirmed",
        "surgery_type": "big",
        "payment": "paid",
        "forms": ["form1", "form2", "form3"],
        "consents": ["form1", "form2", "form3"],
        "photos": 3,
    },
    {
        "month_label": "June 2024",
        "week_label": "Week 1",
        "week_range": "Jun 3 – Jun 9",
        "week_order": 1,
        "day_label": "Wed",
        "day_order": 3,
        "first_name": "Sofia",
        "last_name": "Mendes",
        "email": "sofia.mendes@example.com",
        "phone": "+351 910 200 003",
        "city": "Coimbra",
        "status": "confirmed",
        "surgery_type": "woman",
        "payment": "waiting",
        "forms": ["form1", "form2", "form3", "form4", "form5"],
        "consents": ["form1", "form2"],
        "photos": 1,
    },
    {
        "month_label": "June 2024",
        "week_label": "Week 1",
        "week_range": "Jun 3 – Jun 9",
        "week_order": 1,
        "day_label": "Thu",
        "day_order": 4,
        "first_name": "Rafael",
        "last_name": "Lima",
        "email": "rafael.lima@example.com",
        "phone": "+351 910 200 004",
        "city": "Braga",
        "status": "insurgery",
        "surgery_type": "beard",
        "payment": "partially_paid",
        "forms": ["form1", "form2", "form3", "form4"],
        "consents": ["form1", "form2", "form3"],
        "photos": 2,
    },
    {
        "month_label": "June 2024",
        "week_label": "Week 1",
        "week_range": "Jun 3 – Jun 9",
        "week_order": 1,
        "day_label": "Fri",
        "day_order": 5,
        "first_name": "Helena",
        "last_name": "Rocha",
        "email": "helena.rocha@example.com",
        "phone": "+351 910 200 005",
        "city": "Faro",
        "status": "done",
        "surgery_type": "woman",
        "payment": "paid",
        "forms": ["form1", "form2", "form3", "form4", "form5"],
        "consents": ["form1", "form2", "form3"],
        "photos": 4,
    },
    {
        "month_label": "June 2024",
        "week_label": "Week 2",
        "week_range": "Jun 10 – Jun 16",
        "week_order": 2,
        "day_label": "Mon",
        "day_order": 1,
        "first_name": "Bruno",
        "last_name": "Almeida",
        "email": "bruno.almeida@example.com",
        "phone": "+351 910 200 006",
        "city": "Lisbon",
        "status": "confirmed",
        "surgery_type": "beard",
        "payment": "waiting",
        "forms": ["form1", "form2", "form3"],
        "consents": ["form1", "form2"],
        "photos": 1,
    },
    {
        "month_label": "June 2024",
        "week_label": "Week 2",
        "week_range": "Jun 10 – Jun 16",
        "week_order": 2,
        "day_label": "Tue",
        "day_order": 2,
        "first_name": "Ines",
        "last_name": "Martins",
        "email": "ines.martins@example.com",
        "phone": "+351 910 200 007",
        "city": "Porto",
        "status": "reserved",
        "surgery_type": "small",
        "payment": "waiting",
        "forms": ["form1", "form2"],
        "consents": ["form1"],
        "photos": 0,
    },
    {
        "month_label": "June 2024",
        "week_label": "Week 2",
        "week_range": "Jun 10 – Jun 16",
        "week_order": 2,
        "day_label": "Wed",
        "day_order": 3,
        "first_name": "Lucas",
        "last_name": "Pereira",
        "email": "lucas.pereira@example.com",
        "phone": "+351 910 200 008",
        "city": "Aveiro",
        "status": "confirmed",
        "surgery_type": "big",
        "payment": "partially_paid",
        "forms": ["form1", "form2", "form3", "form4", "form5"],
        "consents": ["form1", "form2", "form3"],
        "photos": 2,
    },
    {
        "month_label": "June 2024",
        "week_label": "Week 2",
        "week_range": "Jun 10 – Jun 16",
        "week_order": 2,
        "day_label": "Thu",
        "day_order": 4,
        "first_name": "Ana",
        "last_name": "Ribeiro",
        "email": "ana.ribeiro@example.com",
        "phone": "+351 910 200 009",
        "city": "Setubal",
        "status": "reserved",
        "surgery_type": "woman",
        "payment": "waiting",
        "forms": ["form1", "form2", "form3"],
        "consents": ["form1", "form2"],
        "photos": 0,
    },
    {
        "month_label": "June 2024",
        "week_label": "Week 2",
        "week_range": "Jun 10 – Jun 16",
        "week_order": 2,
        "day_label": "Fri",
        "day_order": 5,
        "first_name": "Tiago",
        "last_name": "Carvalho",
        "email": "tiago.carvalho@example.com",
        "phone": "+351 910 200 010",
        "city": "Braga",
        "status": "done",
        "surgery_type": "big",
        "payment": "paid",
        "forms": ["form1", "form2", "form3", "form4", "form5"],
        "consents": ["form1", "form2", "form3"],
        "photos": 3,
    },
]
