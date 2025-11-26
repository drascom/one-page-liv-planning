# one-page-liv-planning

Planning weekly business priorities for Liv.

## Backend overview

The `backend/` folder contains a small FastAPI service backed by a local SQLite
(`backend/liv_planning.db`) database. The API lets us capture Liv's focus area,
objectives, metrics, and notes for every week so that a one-page plan can be
built from consistent data.

### Features

- SQLite persistence via lightweight helper functions in `backend/database.py`.
- Pydantic models (`backend/models.py`) that validate API payloads.
- REST-style routes (`backend/routes.py`) to list, create, update, and delete
  weekly plans.
- FastAPI application factory in `backend/app.py` with startup hooks that ensure
  the database schema exists.

## Getting started

1. Clone the repository (Python 3.11+).
2. **Ubuntu/Debian quick install:** run the bundled script to install apt deps, uv, Python packages, `.env` defaults, and a managed `systemd` service (`one-page-crm.service`) that runs uvicorn automatically:

   ```bash
   chmod +x install.sh
   ./install.sh
   ```

   The script reuses the current user for the service and enables it via `systemctl enable --now one-page-crm.service`. Manage it later with `sudo systemctl restart|status one-page-crm.service`. (For manual control or non-Debian systems, continue with the steps below.)

3. Install [uv](https://github.com/astral-sh/uv) if it's not already available:

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

   (Or `pip install uv` on Windows.)

4. Install the project dependencies into `.venv` with uv:

   ```bash
   uv sync
   ```

5. Configure the `.env` file (optional but recommended):

   ```bash
   cp .env.example .env
   ```

   * `APP_SECRET_KEY` – random string used to sign session cookies.
   * `DEFAULT_ADMIN_PASSWORD` – temporary password for the auto-seeded admin user (`admin`).
   * `BACKEND_URL`/`FRONTEND_URL` – optional; if omitted the app auto-detects the current origin so you only need to set these when a specific host/port must be enforced (e.g. behind a reverse proxy).
   * `PROCEDURES_TABLE` – the table name for procedure records (keeps database migrations and infra-as-code config in sync).

6. Start the API server with uv (which automatically uses the synced virtualenv) and bind it to `0.0.0.0` so other machines can reach it:

   ```bash
    uv run uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
   ```
If you are behind nginx proxy manager with ssl certificate than use 
```bash
   uv run uvicorn backend.app:app --host 0.0.0.0 --port 8000 \
  --proxy-headers --forwarded-allow-ips="*"
  ```
  
   The server now accepts traffic on all interfaces (e.g. `http://127.0.0.1:8000` locally or your machine's LAN IP). The frontend automatically talks to the same origin it was loaded from, so you can deploy to any IP without editing `.env`. Visit `/login` and sign in using `admin` plus the password from `.env`. From there you can invite teammates, issue API tokens, and manage dropdown options.

7. (Optional) Serve HTTPS locally with a self-signed certificate:

   ```bash
   chmod +x generate-self-signed-cert.sh
   ./generate-self-signed-cert.sh my-local-domain.test
   uv run uvicorn backend.app:app --host 0.0.0.0 --port 8443 \
     --ssl-keyfile certs/my-local-domain.test.key \
     --ssl-certfile certs/my-local-domain.test.crt
   ```

   Replace `my-local-domain.test` with the hostname you access in the browser (defaults to `localhost` if omitted). Browsers will warn about the untrusted cert—you can proceed after trusting it or import it into your system keychain.

8. Build or serve the static frontend: the repository ships with prebuilt HTML screens under `frontend/html/` plus bundled JS and CSS under `frontend/js/` and `frontend/css/` (served automatically by FastAPI).

## API reference

| Method | Path | Description |
| --- | --- | --- |
| GET | `/plans/` | List every weekly plan |
| POST | `/plans/` | Create plan |
| PUT | `/plans/{id}` | Update plan |
| DELETE | `/plans/{id}` | Delete plan |
| GET | `/patients/` | List patients (personal info only) |
| POST | `/patients/` | Create a patient |
| GET/PUT | `/patients/{id}` | Fetch or update a patient record |
| DELETE | `/patients/{id}` | Delete a patient (admin session only) |
| GET | `/procedures/` | List procedures (filter by `patient_id` when needed) |
| POST | `/procedures/` | Create a procedure linked to a patient |
| GET/PUT | `/procedures/{id}` | Fetch or update a procedure |
| DELETE | `/procedures/{id}` | Delete a procedure |
| POST | `/api/v1/procedures/search-by-meta` | Provide patient name/date metadata to retrieve a matching procedure id plus the procedure metadata (use `DELETE /procedures/{id}` afterward). |
| GET | `/procedures/search` | Provide `procedure_id` to fetch a procedure directly, or supply `patient_id` (optionally `procedure_date=YYYY-MM-DD`) to locate a patient's procedure. Returns `{ "success": true, "procedure": { ... } }` or `{ "success": false, "message": "Procedure not found" }`. |
| GET/POST/DELETE | `/patients/{id}/photos` | List/create/delete photo metadata (files land in `/uploads`) |
| GET/POST/DELETE | `/patients/{id}/payments` | Manage patient payments |
| POST | `/uploads/{last_name}` | Upload photos for a patient |
| DELETE | `/uploads/{patient_id}?file=path` | Remove a photo |
| GET | `/field-options` | Fetch the dropdown metadata (status, forms, etc.) |
| PUT | `/field-options/{field}` | Replace a dropdown list (admin only) |
| POST | `/auth/login` | Authenticate and receive a session cookie |
| POST | `/auth/logout` | Clear the current session |
| GET | `/auth/me` | Return the current user |
| GET/POST/PUT/DELETE | `/auth/users` | Admin user management APIs |
| GET/POST/DELETE | `/api-tokens` | Manage integration tokens scoped to the current admin user |
| GET | `/api/v1/search?full_name=name%20Surname` | External-only endpoint that finds a patient by full name and returns `{ "success": true, "id": 123, "first_name": "...", ..., "procedures": [ { ... } ] }` or `{ "success": false, "message": "Patient record not found", "procedures": [] }`. |

**Trailing slash:** The collection routes under `/api/v1` (for example `/patients/` and `/procedures/`) are registered with FastAPI's trailing-slash path. Requests that omit the slash (`/patients` without `/`) return a `307 Temporary Redirect`, so include the trailing slash in HTTP clients to reach the handler directly.

Use `GET /api/v1/procedures/{procedure_id}` when you already know the procedure id (`GET https://liv.drascom.uk/api/v1/procedures/1063`). The collection route still lists every procedure, optionally filtered by `patient_id`.

### Sample patient requests

Create a patient (internal session cookie example):

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/patients/" \
  -H "Authorization: Bearer SfTcDiRknE4NcRnlm50TEeH9zR6SkgQvjYA6kV0RRj32PnsF" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane.doe@example.com",
    "phone": "+1-555-123-4567",
    "city": "Los Angeles"
  }'
```

Successful requests return `201 Created` along with the inserted record id and a short message:

```json
{ "success": true, "id": 123, "message": "Patient created" }
```

Update an existing patient (replace `123` with the record id):

```bash
curl -X PUT "http://127.0.0.1:8000/api/v1/patients/123" \
  -H "Authorization: Bearer SfTcDiRknE4NcRnlm50TEeH9zR6SkgQvjYA6kV0RRj32PnsF" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane.doe@example.com",
    "phone": "+1-555-987-6543",
    "city": "Los Angeles"
  }'
```

Patient updates return `200 OK` with `{ "success": true, "id": 123, "message": "Patient updated" }`.

### Sample procedure requests

Create a procedure for an existing patient (only `patient_id`, `procedure_date`, `procedure_type`, `status`, and `grafts` are required; the other fields are optional and default to empty values):

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/procedures/" \
  -H "Authorization: Bearer SfTcDiRknE4NcRnlm50TEeH9zR6SkgQvjYA6kV0RRj32PnsF" \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": 4,
    "procedure_date": "2025-01-02",
    "procedure_type": "sfue",
    "status": "reserved",
    "grafts": "",
    "payment": "waiting",
    "consultation": [],
    "forms": [],
    "consents": [],
    "photo_files": []
  }'
```

On success the server responds `201 Created` with `{ "success": true, "id": 456, "message": "Procedure created" }`, which you can store and later pass to the GET endpoint when you need the full record.

Purging a patient via `DELETE /api/v1/patients/{id}/purge` cascades and removes all linked procedures and their metadata so downstream integrations do not have to manually clean them up.

### Sample curl commands with API token

The snippets below show how to call the `/api/v1` endpoints directly using the API token `f1iUbTg7yfh1cdncn2SWcq3t1eiQZZQUHmVZS3jPIrOiquyx`.

Create a patient via the token-protected API:

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/patients/" \
  -H "Authorization: Bearer f1iUbTg7yfh1cdncn2SWcq3t1eiQZZQUHmVZS3jPIrOiquyx" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Token",
    "last_name": "Patient",
    "email": "token.patient@example.com",
    "phone": "+1-555-111-2222",
    "city": "Cardiff"
  }'
```

## API request samples

Replace the example token (`YOUR_API_TOKEN`) with an API token generated from **Settings → API Tokens** and adjust the host if your backend is on a different origin.

1. **Search for a patient (external lookup)** — _Required query parameters: `full_name` (or legacy `name`+`surname`)._

   ```bash
   curl "http://127.0.0.1:8000/api/v1/search?full_name=Jane%20Doe" \
     -H "Authorization: Bearer YOUR_API_TOKEN"
   ```

2. **Create a patient** — _Required JSON fields: `first_name`, `last_name`, `email`, `phone`, `city`._

   ```bash
   curl -X POST "http://127.0.0.1:8000/api/v1/patients/" \
     -H "Authorization: Bearer YOUR_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "first_name": "Jane",
       "last_name": "Doe",
       "email": "jane.doe@example.com",
       "phone": "+1-555-123-4567",
       "city": "Los Angeles"
     }'
   ```

3. **Update a patient** — _Required path parameter: `patient_id`. Required JSON fields are the same as creation (`first_name`, `last_name`, `email`, `phone`, `city`)._

   ```bash
   curl -X PUT "http://127.0.0.1:8000/api/v1/patients/123" \
     -H "Authorization: Bearer YOUR_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "first_name": "Jane",
       "last_name": "Doe",
       "email": "jane.doe@example.com",
       "phone": "+1-555-765-4321",
       "city": "Los Angeles"
     }'
   ```

4. **Search for a procedure (id or patient/date)** — _Option A: provide `procedure_id` to fetch a specific procedure. Option B: provide `patient_id` and optionally `procedure_date` (YYYY-MM-DD). When the date is omitted, the earliest procedure for that patient is returned._

   ```bash
   curl "http://127.0.0.1:8000/api/v1/procedures/search?patient_id=123&procedure_date=2025-01-02" \
     -H "Authorization: Bearer YOUR_API_TOKEN"
   ```

   ```bash
   curl "http://127.0.0.1:8000/api/v1/procedures/search?procedure_id=456" \
     -H "Authorization: Bearer YOUR_API_TOKEN"
   ```

5. **Create a procedure** — _Required JSON fields: `patient_id`, `procedure_date`, `procedure_type`, `status`, `grafts`. Optional fields: `package_type`, `agency`, `payment`, `consultation`, `forms`, `consents`, `photo_files`. The API accepts json arrays for the list fields and plain strings for the others._

  ```bash
  curl -X POST "http://127.0.0.1:8000/api/v1/procedures/" \
    -H "Authorization: Bearer YOUR_API_TOKEN" \
    -H "Content-Type: application/json" \
     -d '{
       "patient_id": 123,
       "procedure_date": "2025-01-02",
       "status": "reserved",
       "procedure_type": "sfue",
       "package_type": "small",
       "grafts": "3000",
       "payment": "waiting",
       "consultation": [],
       "forms": [],
       "consents": [],
       "photo_files": []
     }'
   ```

6. **Update a procedure** — _Required path parameter: `procedure_id`. Required JSON body matches creation (`patient_id`, `procedure_date`, `procedure_type`, `status`, `grafts`). Include any subset of optional fields (`package_type`, `agency`, `payment`, `consultation`, `forms`, `consents`, `photo_files`) when you need to update them._

   ```bash
   curl -X PUT "http://127.0.0.1:8000/api/v1/procedures/456" \
     -H "Authorization: Bearer YOUR_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "patient_id": 123,
       "procedure_date": "2025-01-03",
       "status": "confirmed",
       "procedure_type": "sfue",
       "package_type": "small",
       "grafts": "3200",
       "payment": "paid",
       "consultation": ["consultation1"],
       "forms": [],
       "consents": [],
       "photo_files": []
     }'
   ```

Create a procedure linked to the new patient (replace `123` with the patient id returned above). Just like the admin example above, only `patient_id`, `procedure_date`, `procedure_type`, `status`, and `grafts` are required:

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/procedures/" \
  -H "Authorization: Bearer f1iUbTg7yfh1cdncn2SWcq3t1eiQZZQUHmVZS3jPIrOiquyx" \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": 123,
    "procedure_date": "2025-02-12",
    "procedure_type": "sfue",
    "status": "reserved",
    "grafts": "",
    "payment": "waiting",
    "consultation": [],
    "forms": [],
    "consents": [],
    "photo_files": []
  }'

### Find a procedure id by metadata _(All fields optional; provide any combination of `full_name`, `date`, `status`, `grafts_number`, `package_type` to narrow the search)._

Administrators can locate a procedure without knowing its id by POSTing to `/api/v1/procedures/search-by-meta`. The request body is flexible and you may send any subset of the supported keys (`full_name`, `date`, `status`, `grafts_number`, `package_type`). Supplying more fields reduces the chance of multiple matches:

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/procedures/search-by-meta" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Test Case",
    "date": "2025-10-15T00:00:00.000Z",
    "status": "reserved",
    "grafts_number": "3000",
    "package_type": "small"
  }'
```

The response includes the matching metadata when a record is found (e.g. `{ "success": true, "procedure_id": 42, "procedure_date": "2025-05-10", "status": "reserved", "procedure_type": "sfue", ... }`), or `{ "success": false, "message": "Procedure not found" }` when no match exists.
```

Check whether a patient already has a procedure scheduled on a specific date:

```bash
curl -X GET "http://127.0.0.1:8000/api/v1/procedures/search?patient_id=123&procedure_date=2025-02-12" \
  -H "Authorization: Bearer f1iUbTg7yfh1cdncn2SWcq3t1eiQZZQUHmVZS3jPIrOiquyx"
```

Responses include a `success` flag plus either the matching procedure or a friendly message:

```json
// When a matching procedure exists
{ "success": true, "procedure": { "id": 456, "procedure_date": "2025-02-12", ... } }

// When nothing matches
{ "success": false, "message": "Procedure not found" }
```

### Automated workflow smoke test

Use the helper script below to quickly exercise the full patient/procedure flow (login → create patient → create procedure → update both → purge everything). It logs in via the regular `/auth/login` endpoint, so the provided user must be an admin.

```bash
uv run python scripts/patient_workflow_test.py \
  --base-url http://127.0.0.1:8000 \
  --username admin \
  --password changeme
```

Pass `--keep-records` if you want to inspect the created rows instead of purging them automatically when the script finishes.

Update the patient’s contact info (the response again includes the `id` so you can confirm the change):

```bash
curl -X PUT "http://127.0.0.1:8000/api/v1/patients/123" \
  -H "Authorization: Bearer f1iUbTg7yfh1cdncn2SWcq3t1eiQZZQUHmVZS3jPIrOiquyx" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Token",
    "last_name": "Patient",
    "email": "token.patient+updated@example.com",
    "phone": "+1-555-999-0000",
    "city": "Cardiff"
  }'
```

Update the related procedure (replace `456` with the procedure id you created earlier); the response body now mirrors the operation result, e.g. `{ "success": true, "id": 456, "message": "Procedure updated" }`:

```bash
curl -X PUT "http://127.0.0.1:8000/api/v1/procedures/456" \
  -H "Authorization: Bearer f1iUbTg7yfh1cdncn2SWcq3t1eiQZZQUHmVZS3jPIrOiquyx" \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": 123,
    "procedure_date": "2025-02-12",
    "procedure_type": "sfue",
    "status": "confirmed",
    "grafts": "",
    "payment": "paid",
    "consultation": [],
    "forms": [],
    "consents": [],
    "photo_files": []
  }'
```

### Migration note

The SQLite schema now separates personal information (`patients`) from scheduling data (`procedures`) plus related `photos` and `payments` tables. The bootstrap step recreates those tables from scratch (legacy migrations were removed) so the API and UI can rely on the new shape immediately.

### Frontend capabilities

- **Weekly schedule** – `index.html` renders the one-page calendar. Authenticated users can page through months, create placeholder patients, and drill into patient details. All data flows through the FastAPI APIs.
- **Patient editor** – `patient.html` lets you edit contact info, forms/consents, consultation status, and upload photos.
- **Settings dashboard** – `settings.html` combines multiple admin tools:
  - API token generator (with delete controls)
  - Option manager for every dropdown (status, procedure type, payment, forms, consents, consultation). The UI mirrors the provided todo-style design.
  - User management (create users, toggle admin, reset passwords, delete accounts)
- **Login/logout** – `login.html` provides the session entry point while logout buttons are available on every authenticated page.

All HTTP APIs include interactive docs at `http://127.0.0.1:8000/docs` once the server is running.

**External integrations:** Every route above is mirrored under `/api/v1/*` and requires an API token created in the Settings → API Tokens UI. Send it in the `Authorization: Bearer <token>` header (requests without this header are rejected). The `/api/v1/search` helper is specifically designed for lightweight patient lookups from outside systems—you can pass `full_name=name%20Surname` (preferred) or continue using the legacy `name` and optional `surname` parameters. The response includes the patient's fields (flattened) plus a `procedures` array when found (e.g. `{ "success": true, "id": 123, "first_name": "Jane", ..., "procedures": [ { ... } ] }`), sets `success: false` with `message: "Patient record not found"` and `procedures: []` when no match exists, and returns `success: false` with `message: "Name is missing"` when no name parameters are supplied so you can spot empty requests.
<!--  -->
7. **Search by metadata (flexible match)** — _All fields are optional (`full_name`, `date`, `status`, `grafts_number`, `package_type`) and can be supplied in any combination to narrow the match. This endpoint is designed for integrations that only know partial patient details._

   ```bash
   curl -X POST "http://127.0.0.1:8000/api/v1/procedures/search-by-meta" \
     -H "Authorization: Bearer YOUR_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "full_name": "Jane Doe",
       "date": "2025-01-02",
       "status": "reserved",
       "grafts_number": "3000",
       "package_type": "small"
     }'
   ```
