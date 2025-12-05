import sys
from pathlib import Path
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

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
        "first_name": "Test",
        "last_name": "Patient",
        "email": "test@example.com",
        "phone": "+10000000000",
        "city": "Exampleville",
    }
    response = client.post("/patients", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    return data["id"]


def _create_procedure(client: TestClient, patient_id: int, *, date: str = "2025-01-02") -> int:
    payload = {
        "patient_id": patient_id,
        "procedure_date": date,
        "status": "reserved",
        "procedure_type": "sfue",
        "package_type": "small",
        "grafts": 0,
        "payment": "waiting",
        "consultation": [],
        "forms": [],
        "consents": [],
    }
    created = client.post("/procedures", json=payload)
    assert created.status_code == 201
    return created.json()["id"]


def test_procedure_crud_and_filtering(client: TestClient):
    patient_id = _create_patient(client)

    create_payload = {
        "patient_id": patient_id,
        "procedure_date": "2025-01-02",
        "status": "reserved",
        "procedure_type": "sfue",
        "package_type": "small",
        "grafts": 0,
        "payment": "waiting",
        "consultation": [],
        "forms": [],
        "consents": [],
    }

    created = client.post("/procedures", json=create_payload)
    assert created.status_code == 201
    create_result = created.json()
    assert create_result["success"] is True
    procedure_id = create_result["id"]
    fetched_after_create = client.get(f"/procedures/{procedure_id}")
    assert fetched_after_create.status_code == 200
    assert fetched_after_create.json()["patient_id"] == patient_id

    listed = client.get(f"/procedures?patient_id={patient_id}")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    update_payload = {
        **create_payload,
        "status": "complete",
        "payment": "paid",
    }
    updated = client.put(f"/procedures/{procedure_id}", json=update_payload)
    assert updated.status_code == 200
    body = updated.json()
    assert body["success"] is True

    fetched = client.get(f"/procedures/{procedure_id}")
    assert fetched.status_code == 200
    details = fetched.json()
    assert details["status"] == "complete"
    assert details["payment"] == "paid"

    deleted = client.delete(f"/procedures/{procedure_id}")
    assert deleted.status_code == 200
    delete_body = deleted.json()
    assert delete_body["success"] is True
    assert delete_body["id"] == procedure_id

    missing = client.get(f"/procedures/{procedure_id}")
    assert missing.status_code == 404


def test_procedures_removed_with_patient(client: TestClient):
    patient_id = _create_patient(client)

    response = client.post(
        "/procedures",
        json={
            "patient_id": patient_id,
            "grafts": 0,
            "procedure_type": "sfue",
            "package_type": "small",
            "status": "scheduled",
            "procedure_date": "2025-01-03",
            "payment": "waiting",
            "consultation": [],
            "forms": [],
            "consents": [],
        },
    )
    assert response.status_code == 201
    assert response.json()["success"] is True

    purge = client.delete(f"/patients/{patient_id}/purge")
    assert purge.status_code == 204

    remaining = client.get(f"/procedures?patient_id={patient_id}")
    assert remaining.status_code == 200
    assert remaining.json() == []


def test_admin_manages_deleted_procedures(client: TestClient):
    patient_id = _create_patient(client)
    payload = {
        "patient_id": patient_id,
        "procedure_date": "2025-02-01",
        "status": "reserved",
        "procedure_type": "sfue",
        "grafts": 0,
        "payment": "waiting",
        "consultation": [],
        "forms": [],
        "consents": [],
    }
    created = client.post("/procedures", json=payload)
    assert created.status_code == 201
    procedure_id = created.json()["id"]

    deleted = client.delete(f"/procedures/{procedure_id}")
    assert deleted.status_code == 200
    delete_body = deleted.json()
    assert delete_body["success"] is True
    assert delete_body["id"] == procedure_id

    deleted_list = client.get("/procedures/deleted")
    assert deleted_list.status_code == 200
    records = deleted_list.json()
    assert any(entry["procedure"]["id"] == procedure_id for entry in records)

    recovered = client.post(f"/procedures/{procedure_id}/recover")
    assert recovered.status_code == 200
    recovered_body = recovered.json()
    assert recovered_body["id"] == procedure_id
    assert recovered_body["deleted"] is False

    fetched = client.get(f"/procedures/{procedure_id}")
    assert fetched.status_code == 200

    removal = client.delete(f"/procedures/{procedure_id}")
    assert removal.status_code == 200
    purged = client.delete(f"/procedures/{procedure_id}/purge")
    assert purged.status_code == 204

    deleted_list_after = client.get("/procedures/deleted")
    assert deleted_list_after.status_code == 200
    assert all(entry["procedure"]["id"] != procedure_id for entry in deleted_list_after.json())


def test_procedure_recovery_requires_patient(client: TestClient):
    patient_id = _create_patient(client)
    payload = {
        "patient_id": patient_id,
        "procedure_date": "2025-03-04",
        "status": "reserved",
        "procedure_type": "sfue",
        "grafts": 0,
        "payment": "waiting",
        "consultation": [],
        "forms": [],
        "consents": [],
    }
    created = client.post("/procedures", json=payload)
    assert created.status_code == 201
    procedure_id = created.json()["id"]

    soft_deleted_patient = client.delete(f"/patients/{patient_id}")
    assert soft_deleted_patient.status_code == 200

    blocked_recover = client.post(f"/procedures/{procedure_id}/recover")
    assert blocked_recover.status_code == 400
    detail = blocked_recover.json()["detail"]
    assert "Restore the patient" in detail

    restored_patient = client.post(f"/patients/{patient_id}/recover")
    assert restored_patient.status_code == 200

    recovered_procedure = client.post(f"/procedures/{procedure_id}/recover")
    assert recovered_procedure.status_code == 200
    assert recovered_procedure.json()["deleted"] is False


def test_procedure_search_returns_success_and_message(client: TestClient):
    patient_id = _create_patient(client)
    payload = {
        "patient_id": patient_id,
        "procedure_date": "2025-04-05",
        "status": "reserved",
        "procedure_type": "sfue",
        "grafts": 0,
        "payment": "waiting",
        "consultation": [],
        "forms": [],
        "consents": [],
    }
    created = client.post("/procedures", json=payload)
    assert created.status_code == 201
    procedure_id = created.json()["id"]

    missing_params = client.get("/procedures/search")
    assert missing_params.status_code == 400

    match = client.get(f"/procedures/search?patient_id={patient_id}&procedure_date=2025-04-05")
    assert match.status_code == 200
    body = match.json()
    assert body["success"] is True
    assert body["procedure"]["id"] == procedure_id

    fallback = client.get(f"/procedures/search?patient_id={patient_id}")
    assert fallback.status_code == 200
    fallback_body = fallback.json()
    assert fallback_body["success"] is True
    assert fallback_body["procedure"]["id"] == procedure_id

    direct = client.get(f"/procedures/search?procedure_id={procedure_id}")
    assert direct.status_code == 200
    direct_body = direct.json()
    assert direct_body["success"] is True
    assert direct_body["procedure"]["id"] == procedure_id

    mismatch = client.get(f"/procedures/search?patient_id=999999&procedure_id={procedure_id}")
    assert mismatch.status_code == 200
    mismatch_body = mismatch.json()
    assert mismatch_body["success"] is False
    assert mismatch_body["message"] == "Procedure does not belong to this patient"

    missing = client.get(
        f"/procedures/search?patient_id={patient_id}&procedure_date=2025-04-06"
    )
    assert missing.status_code == 200
    missing_body = missing.json()
    assert missing_body["success"] is False
    assert missing_body["message"] == "Procedure not found"

    missing_patient = client.get(
        "/procedures/search?patient_id=999999&procedure_date=2025-04-05"
    )
    assert missing_patient.status_code == 200
    missing_patient_body = missing_patient.json()
    assert missing_patient_body["success"] is False
    assert missing_patient_body["message"] == "Patient record not found"


def test_patient_procedure_list_returns_message_when_empty(client: TestClient):
    patient_id = _create_patient(client)

    empty = client.get(f"/patients/{patient_id}/procedures")
    assert empty.status_code == 200
    empty_body = empty.json()
    assert empty_body["success"] is False
    assert empty_body["procedures"] == []
    assert empty_body["message"] == "No procedures found for this patient."

    procedure_id = _create_procedure(client, patient_id, date="2025-05-06")

    populated = client.get(f"/patients/{patient_id}/procedures")
    assert populated.status_code == 200
    populated_body = populated.json()
    assert populated_body["success"] is True
    assert populated_body["message"] in (None, "")
    assert len(populated_body["procedures"]) == 1
    assert populated_body["procedures"][0]["id"] == procedure_id


def test_search_procedure_by_metadata_and_delete(client: TestClient):
    patient_id = _create_patient(client)
    payload = {
        "patient_id": patient_id,
        "procedure_date": "2025-05-10",
        "status": "reserved",
        "procedure_type": "sfue",
        "package_type": "small",
        "grafts": 3000,
        "outstanding_balance": 123.45,
        "payment": "waiting",
        "consultation": [],
        "forms": [],
        "consents": [],
    }
    created = client.post("/procedures", json=payload)
    assert created.status_code == 201
    procedure_id = created.json()["id"]

    search_request = {
        "full_name": "Test Patient",
    }
    search = client.post("/procedures/search-by-meta", json=search_request)
    assert search.status_code == 200
    body = search.json()
    assert body["success"] is True
    assert body["procedure_id"] == procedure_id
    assert body["procedure_date"] == "2025-05-10"
    assert body["status"] == "reserved"
    assert body["procedure_type"] == "sfue"
    assert body["package_type"] == "small"
    assert body["agency"] == ""
    assert body["grafts"] == 3000
    assert body["outstanding_balance"] == 123.45
    assert isinstance(body["procedure"], dict)
    assert body["procedure"]["id"] == procedure_id
    assert body["procedure"]["patient_id"] == patient_id
    assert body["procedure"]["procedure_type"] == "sfue"
    assert body["procedure"]["package_type"] == "small"

    status_only_request = {
        "status": "reserved",
        "date": "2025-05-10",
        "package_type": "small",
    }
    status_search = client.post("/procedures/search-by-meta", json=status_only_request)
    assert status_search.status_code == 200
    status_body = status_search.json()
    assert status_body["success"] is True
    assert status_body["procedure_id"] == procedure_id
    assert status_body["procedure_date"] == "2025-05-10"
    assert status_body["status"] == "reserved"
    assert status_body["procedure_type"] == "sfue"
    assert status_body["package_type"] == "small"
    assert status_body["agency"] == ""
    assert status_body["grafts"] == 3000
    assert status_body["outstanding_balance"] == 123.45
    assert status_body["procedure"]["id"] == procedure_id
    assert status_body["procedure"]["patient_id"] == patient_id
    assert status_body["procedure"]["status"] == "reserved"

    deleted = client.delete(f"/procedures/{procedure_id}")
    assert deleted.status_code == 200
    delete_body = deleted.json()
    assert delete_body["success"] is True
    assert delete_body["id"] == procedure_id


def test_search_procedure_by_metadata_missing_record(client: TestClient):
    patient_id = _create_patient(client)
    _create_procedure(client, patient_id, date="2025-08-01")
    search_request = {
        "date": "2025-08-02",
    }
    result = client.post("/procedures/search-by-meta", json=search_request)
    assert result.status_code == 200
    assert result.json()["success"] is False


def test_search_procedure_by_metadata_requires_filters(client: TestClient):
    response = client.post("/procedures/search-by-meta", json={})
    assert response.status_code == 400
    assert "Provide at least one search field" in response.json()["detail"]


def test_partial_update_preserves_existing_lists(client: TestClient):
    patient_id = _create_patient(client)
    payload = {
        "patient_id": patient_id,
        "procedure_date": "2025-12-04",
        "status": "reserved",
        "procedure_type": "hair transplant",
        "package_type": "big",
        "grafts": 3000,
        "payment": "waiting",
        "consultation": ["consultation1"],
        "forms": ["form1"],
        "consents": ["consent1"],
        "notes": [{"text": "initial note"}],
    }
    created = client.post("/procedures", json=payload)
    assert created.status_code == 201
    procedure_id = created.json()["id"]

    update_payload = {
        "patient_id": patient_id,
        "procedure_date": "2025-12-04",
        "status": "confirmed",
        "procedure_type": "hair transplant",
        "package_type": "big",
        "grafts": 3000,
        "outstanding_balance": 1111,
        "agency": "want_hair",
        "notes": [{"text": "updated note", "completed": True}],
    }
    updated = client.put(f"/procedures/{procedure_id}", json=update_payload)
    assert updated.status_code == 200

    fetched = client.get(f"/procedures/{procedure_id}")
    assert fetched.status_code == 200
    body = fetched.json()
    assert body["status"] == "confirmed"
    assert body["payment"] == "waiting"
    assert body["outstanding_balance"] == 1111
    assert body["consultation"] == ["consultation1"]
    assert body["forms"] == ["form1"]
    assert body["consents"] == ["consent1"]
    assert any(note["text"] == "updated note" for note in body["notes"])


def test_procedure_creation_ignores_empty_notes(client: TestClient):
    patient_id = _create_patient(client)
    payload = {
        "patient_id": patient_id,
        "procedure_date": "2025-06-15",
        "status": "reserved",
        "procedure_type": "sfue",
        "package_type": "small",
        "grafts": 0,
        "payment": "waiting",
        "notes": [{"text": "", "completed": True}],
    }
    created = client.post("/procedures", json=payload)
    assert created.status_code == 201
    procedure_id = created.json()["id"]

    fetched = client.get(f"/procedures/{procedure_id}")
    assert fetched.status_code == 200
    assert fetched.json()["notes"] == []


def test_procedure_creation_rejects_blank_date(client: TestClient):
    patient_id = _create_patient(client)
    payload = {
        "patient_id": patient_id,
        "procedure_date": "   ",
        "status": "reserved",
        "procedure_type": "sfue",
        "package_type": "small",
        "grafts": 0,
        "payment": "waiting",
        "consultation": [],
        "forms": [],
        "consents": [],
    }
    response = client.post("/procedures", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"] == "procedure_date is required"


def test_procedure_listing_survives_null_dates(client: TestClient):
    patient_id = _create_patient(client)
    procedure_id = _create_procedure(client, patient_id)
    with closing(database.get_connection()) as conn:
        conn.execute("UPDATE procedures SET procedure_date = NULL WHERE id = ?", (procedure_id,))
        conn.commit()
    response = client.get("/procedures")
    assert response.status_code == 200
    procedures = response.json()
    assert any(
        entry["id"] == procedure_id and entry["procedure_date"] == ""
        for entry in procedures
    )


def test_search_endpoint_omits_empty_fields_when_missing_patient(client: TestClient):
    token_response = client.post("/api-tokens", json={"name": "search-test"})
    assert token_response.status_code == 201
    api_token = token_response.json()["token"]
    response = client.get(
        "/api/v1/search",
        params={"full_name": "Missing Patient"},
        headers={"Authorization": f"Bearer {api_token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["message"] == "Patient record not found"
    assert "id" not in body
    assert "patient" not in body
    assert body["procedures"] == []


def test_search_endpoint_returns_flat_patient_fields(client: TestClient):
    patient_id = _create_patient(client)
    procedure_id = _create_procedure(client, patient_id)
    token_response = client.post("/api-tokens", json={"name": "search-success"})
    assert token_response.status_code == 201
    api_token = token_response.json()["token"]
    response = client.get(
        "/api/v1/search",
        params={"FULL_NAME": "TEST PATIENT"},
        headers={"Authorization": f"Bearer {api_token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["id"] == patient_id
    assert body["first_name"] == "Test"
    assert body["last_name"] == "Patient"
    assert body["email"] == "test@example.com"
    assert body["phone"] == "+10000000000"
    assert body["city"] == "Exampleville"
    assert body["deleted"] is False
    assert "patient" not in body
    assert isinstance(body["procedures"], list)
    assert any(entry["id"] == procedure_id for entry in body["procedures"])
