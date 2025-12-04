import sys
from pathlib import Path

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


def test_partial_patient_update_preserves_existing_fields(client: TestClient):
    create_payload = {
        "first_name": "Alice",
        "last_name": "Example",
        "email": "alice@example.com",
        "phone": "+4400000000",
        "city": "London",
    }
    created = client.post("/patients", json=create_payload)
    assert created.status_code == 201
    patient_id = created.json()["id"]

    update_payload = {
        "phone": "+4411111111",
        "city": "Bristol",
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
    assert body["city"] == "Bristol"
