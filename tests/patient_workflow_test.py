#!/usr/bin/env python3
"""CLI utility that exercises the main patient/procedure workflow."""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from typing import Any, Dict
from uuid import uuid4

import httpx


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create a patient, attach a procedure, update both records, and purge the data again. "
            "Useful for quick end-to-end smoke tests."
        )
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8000",
        help="FastAPI server base URL (default: %(default)s)",
    )
    parser.add_argument(
        "--username",
        default="admin",
        help="Username for /auth/login (default: %(default)s)",
    )
    parser.add_argument(
        "--password",
        default="changeme",
        help="Password for /auth/login (default: %(default)s)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="HTTP timeout in seconds (default: %(default)s)",
    )
    parser.add_argument(
        "--keep-records",
        action="store_true",
        help="Skip the purge step so you can inspect the created data afterwards.",
    )
    return parser.parse_args()


def _request(client: httpx.Client, method: str, path: str, **kwargs) -> httpx.Response:
    response = client.request(method, path, **kwargs)
    response.raise_for_status()
    return response


def login(client: httpx.Client, username: str, password: str) -> Dict[str, Any]:
    response = _request(client, "POST", "/auth/login", json={"username": username, "password": password})
    user = response.json()
    print(f"✅ Logged in as {user['username']} (admin={user['is_admin']})")
    return user


def create_patient(client: httpx.Client) -> Dict[str, Any]:
    suffix = uuid4().hex[:6]
    payload = {
        "first_name": f"Test{suffix}",
        "last_name": "Workflow",
        "email": f"workflow+{suffix}@example.com",
        "phone": "+44 1234 567890",
        "city": "London",
    }
    response = _request(client, "POST", "/patients", json=payload)
    patient = response.json()
    print(f"✅ Created patient #{patient['id']} – {patient['first_name']} {patient['last_name']}")
    return patient


def update_patient(client: httpx.Client, patient_id: int, original: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        **original,
        "phone": "+44 9876 543210",
        "city": "Bristol",
    }
    response = _request(client, "PUT", f"/patients/{patient_id}", json=payload)
    patient = response.json()
    print(f"✅ Updated patient #{patient_id} with new phone/city info")
    return patient


def create_procedure(client: httpx.Client, patient_id: int) -> Dict[str, Any]:
    scheduled_date = (date.today() + timedelta(days=7)).isoformat()
    payload = {
        "patient_id": patient_id,
        "procedure_date": scheduled_date,
        "status": "reserved",
        "procedure_type": "sfue",
        "grafts": "",
        "payment": "waiting",
        "consultation": [],
        "forms": [],
        "consents": [],
        "photo_files": [],
    }
    response = _request(client, "POST", "/procedures", json=payload)
    procedure = response.json()
    print(f"✅ Created procedure #{procedure['id']} scheduled for {procedure['procedure_date']}")
    return procedure


def update_procedure(client: httpx.Client, procedure_id: int, patient_id: int, original: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        **original,
        "patient_id": patient_id,
        "status": "confirmed",
        "payment": "paid",
    }
    response = _request(client, "PUT", f"/procedures/{procedure_id}", json=payload)
    procedure = response.json()
    print(f"✅ Updated procedure #{procedure_id} with status={procedure['status']} payment={procedure['payment']}")
    return procedure


def purge_patient(client: httpx.Client, patient_id: int) -> None:
    _request(client, "DELETE", f"/patients/{patient_id}/purge")
    print(f"🧹 Purged patient #{patient_id} and all related procedures")


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    client = httpx.Client(base_url=base_url, timeout=args.timeout, follow_redirects=True)
    try:
        user = login(client, args.username, args.password)
        if not user.get("is_admin"):
            print("⚠️  The workflow requires an admin user (purge step).", file=sys.stderr)
            return 1
        patient = create_patient(client)
        procedure = create_procedure(client, patient["id"])
        updated_patient = update_patient(client, patient["id"], patient)
        update_procedure(client, procedure["id"], updated_patient["id"], procedure)
        if args.keep_records:
            print("ℹ️  Leaving records in place (--keep-records enabled)")
        else:
            purge_patient(client, patient["id"])
        print("🎉 Workflow completed successfully.")
        return 0
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:500]
        print(f"❌ Request failed: {exc.request.method} {exc.request.url} -> {exc.response.status_code}", file=sys.stderr)
        if body:
            print(body, file=sys.stderr)
        return 1
    except httpx.HTTPError as exc:
        print(f"❌ HTTP error: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
