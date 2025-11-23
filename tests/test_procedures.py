import pytest
from fastapi.testclient import TestClient

from backend import database
from backend.app import create_app


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


def _create_patient(client: TestClient) -> int:
    payload = {
        "month_label": "January 2025",
        "week_label": "Week 1",
        "week_range": "Jan 1 – Jan 7",
        "week_order": 1,
        "day_label": "Mon",
        "day_order": 1,
        "first_name": "Test",
        "last_name": "Patient",
        "email": "test@example.com",
        "phone": "+10000000000",
        "city": "Exampleville",
        "procedure_date": "2025-01-01",
        "status": "reserved",
        "procedure_type": "small",
        "grafts": "",
        "payment": "waiting",
        "consultation": [],
        "forms": [],
        "consents": [],
        "photos": 0,
        "photo_files": [],
    }
    response = client.post("/patients", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    return data["id"]


def test_procedure_crud_and_filtering(client: TestClient):
    patient_id = _create_patient(client)

    create_payload = {
        "patient_id": patient_id,
        "name": "Initial surgery",
        "procedure_type": "small",
        "status": "scheduled",
        "procedure_date": "2025-01-02",
        "payment": "deposit",
        "notes": "Scheduled via integration",
    }

    created = client.post("/procedures", json=create_payload)
    assert created.status_code == 201
    procedure = created.json()
    assert procedure["patient_id"] == patient_id
    assert procedure["name"] == create_payload["name"]

    listed = client.get(f"/procedures?patient_id={patient_id}")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    update_payload = {
        **create_payload,
        "status": "complete",
        "payment": "paid",
        "notes": "Finalized and invoiced",
    }
    updated = client.put(f"/procedures/{procedure['id']}", json=update_payload)
    assert updated.status_code == 200
    body = updated.json()
    assert body["status"] == "complete"
    assert body["payment"] == "paid"
    assert body["notes"] == "Finalized and invoiced"

    fetched = client.get(f"/procedures/{procedure['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["status"] == "complete"

    deleted = client.delete(f"/procedures/{procedure['id']}")
    assert deleted.status_code == 204

    missing = client.get(f"/procedures/{procedure['id']}")
    assert missing.status_code == 404


def test_procedures_removed_with_patient(client: TestClient):
    patient_id = _create_patient(client)

    response = client.post(
        "/procedures",
        json={
            "patient_id": patient_id,
            "name": "Follow-up",
            "procedure_type": "small",
            "status": "scheduled",
            "procedure_date": "2025-01-03",
            "payment": "waiting",
            "notes": "Check healing",
        },
    )
    assert response.status_code == 201

    purge = client.delete(f"/patients/{patient_id}/purge")
    assert purge.status_code == 204

    remaining = client.get(f"/procedures?patient_id={patient_id}")
    assert remaining.status_code == 200
    assert remaining.json() == []
