import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import database
from backend.app import create_app
from backend.database import DEFAULT_PROCEDURE_TIME


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Provide an authenticated TestClient backed by an isolated database."""
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(database, "DB_PATH", db_path)
    database.DB_PATH = db_path
    app = create_app()
    with TestClient(app) as test_client:
        login = test_client.post(
            "/auth/login", json={"username": "admin", "password": "changeme"}
        )
        assert login.status_code == 200
        yield test_client


def test_partial_patient_update_preserves_existing_fields(client: TestClient):
    create_payload = {
        "first_name": "Alice",
        "last_name": "Example",
        "email": "alice@example.com",
        "phone": "+4400000000",
        "address": "London",
    }
    created = client.post("/patients", json=create_payload)
    assert created.status_code == 201
    patient_id = created.json()["id"]

    update_payload = {
        "phone": "+4411111111",
        "address": "Bristol",
    }
    updated = client.put(f"/patients/{patient_id}", json=update_payload)
    assert updated.status_code == 200

    fetched = client.get(f"/patients/{patient_id}")
    assert fetched.status_code == 200
    body = fetched.json()
    assert body["first_name"] == "Alice"
    assert body["last_name"] == "Example"
    assert body["email"] == "alice@example.com"
    assert body["phone"] == "+4411111111"
    assert body["address"] == "Bristol"


def test_patient_creation_requires_names(client: TestClient):
    base_payload = {
        "email": "missing@example.com",
        "phone": "+4400000000",
        "address": "London",
    }

    missing_first = {**base_payload, "first_name": "", "last_name": "Example"}
    response_first = client.post("/patients", json=missing_first)
    assert response_first.status_code == 422
    assert response_first.json()["detail"] == "Name or surname required"

    missing_last = {**base_payload, "first_name": "Alice", "last_name": "  "}
    response_last = client.post("/patients", json=missing_last)
    assert response_last.status_code == 422
    assert response_last.json()["detail"] == "Name or surname required"


def test_search_handles_middle_name(client: TestClient):
    create_payload = {
        "first_name": "Steven",
        "last_name": "Kwok",
        "email": "steven@example.com",
        "phone": "+44123456789",
        "address": "London",
    }
    created = client.post("/patients", json=create_payload)
    assert created.status_code == 201
    patient_id = created.json()["id"]

    token_response = client.post("/api-tokens", json={"name": "test token"})
    assert token_response.status_code == 201
    token = token_response.json()["token"]

    response = client.get(
        "/api/v1/search",
        params={"full_name": "Steven Levan Kwok"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["id"] == patient_id
    assert body["first_name"] == "Steven"
    assert body["last_name"] == "Kwok"


def test_patients_search_returns_multiple_matches(client: TestClient):
    shared_name = {"first_name": "Jane", "last_name": "Doe"}
    base_payload = {
        "email": "jane@example.com",
        "phone": "+4400000000",
        "address": "London",
    }
    first = client.post("/patients", json={**shared_name, **base_payload})
    assert first.status_code == 201
    second = client.post(
        "/patients",
        json={
            **shared_name,
            "email": "jane2@example.com",
            "phone": "+4411111111",
            "address": "Bristol",
        },
    )
    assert second.status_code == 201
    ids = {first.json()["id"], second.json()["id"]}

    token_response = client.post("/api-tokens", json={"name": "test token"})
    assert token_response.status_code == 201
    token = token_response.json()["token"]

    response = client.get(
        "/api/v1/patients/search",
        params={"full_name": "Jane Doe"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    matches = body["matches"]
    assert len(matches) == 2
    assert {match["id"] for match in matches} == ids


def test_patients_search_by_date_filters_by_surgery_or_dob(client: TestClient):
    create_payload = {
        "first_name": "Alex",
        "last_name": "Smith",
        "email": "alex@example.com",
        "phone": "+4400000000",
        "address": "London",
        "dob": "1990-04-01",
    }
    created = client.post("/patients", json=create_payload)
    assert created.status_code == 201
    patient_id = created.json()["id"]

    procedure_payload = {
        "patient_id": patient_id,
        "procedure_date": "2024-08-01",
        "status": "confirmed",
        "procedure_type": "sfue",
        "package_type": "small",
        "grafts": 1000,
        "payment": "paid",
        "consultation": [],
        "forms": [],
        "consents": [],
    }
    created_proc = client.post("/procedures", json=procedure_payload)
    assert created_proc.status_code == 201
    procedure_id = created_proc.json()["id"]

    # Add a second procedure to test fallback when date does not match
    client.post(
        "/procedures",
        json={**procedure_payload, "procedure_date": "2024-08-15", "grafts": 1200},
    )

    token_response = client.post("/api-tokens", json={"name": "test token"})
    assert token_response.status_code == 201
    token = token_response.json()["token"]

    # Matching date returns only the matching procedure
    matching = client.get(
        "/api/v1/patients/search-by-date",
        params={"full_name": "Alex Smith", "surgery_date": "2024-08-01"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert matching.status_code == 200
    match_body = matching.json()
    assert match_body["success"] is True
    match = match_body["matches"][0]
    assert len(match["procedures"]) == 1
    assert match["procedures"][0]["id"] == procedure_id
    assert match["procedures"][0]["procedure_time"] == DEFAULT_PROCEDURE_TIME

    # Non-matching date falls back to all procedures for the patient
    fallback = client.get(
        "/api/v1/patients/search-by-date",
        params={"full_name": "Alex Smith", "surgery_date": "2024-09-01"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert fallback.status_code == 200
    fallback_body = fallback.json()
    assert fallback_body["success"] is True
    assert len(fallback_body["matches"][0]["procedures"]) == 2
    assert "surgery_date" in fallback_body["message"]

    dob_search = client.get(
        "/api/v1/patients/search-by-date",
        params={"full_name": "Alex Smith", "dob": "1990-04-01"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert dob_search.status_code == 200
    dob_body = dob_search.json()
    assert dob_body["success"] is True
    assert len(dob_body["matches"]) == 1
    assert len(dob_body["matches"][0]["procedures"]) == 2


def test_search_by_name_only_returns_patient_details(client: TestClient):
    create_payload = {
        "first_name": "Name",
        "last_name": "Only",
        "email": "only@example.com",
        "phone": "+4412345000",
        "address": "London",
    }
    created = client.post("/patients", json=create_payload)
    assert created.status_code == 201

    token_response = client.post("/api-tokens", json={"name": "search name"})
    assert token_response.status_code == 201
    token = token_response.json()["token"]

    response = client.get(
        "/api/v1/patients/search-by-name",
        params={"full_name": "Name Only"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["first_name"] == "Name"
    assert body["id"] == created.json()["id"]
    assert "procedures" not in body
    assert body["email"] == "only@example.com"
