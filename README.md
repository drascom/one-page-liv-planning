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

8. Build or serve the static frontend: the repository ships with prebuilt `index.html`, `patient.html`, `settings.html`, and `login.html` files under `static/` (served automatically by FastAPI).

## API reference

| Method | Path | Description |
| --- | --- | --- |
| GET | `/plans/` | List every weekly plan |
| POST | `/plans/` | Create plan |
| PUT | `/plans/{id}` | Update plan |
| DELETE | `/plans/{id}` | Delete plan |
| GET | `/patients/` | List the patient schedule |
| POST | `/patients/` | Create a placeholder patient |
| GET/PUT | `/patients/{id}` | Fetch or update a patient record |
| POST | `/uploads/{last_name}` | Upload photos for a patient |
| DELETE | `/uploads/{patient_id}?file=path` | Remove a photo |
| GET | `/field-options` | Fetch the dropdown metadata (status, forms, etc.) |
| PUT | `/field-options/{field}` | Replace a dropdown list (admin only) |
| POST | `/auth/login` | Authenticate and receive a session cookie |
| POST | `/auth/logout` | Clear the current session |
| GET | `/auth/me` | Return the current user |
| GET/POST/PUT/DELETE | `/auth/users` | Admin user management APIs |
| GET/POST/DELETE | `/api-tokens` | Manage integration tokens scoped to the current admin user |
| GET | `/api/v1/search?token=abc123xyz&full_name=Randhir%20Sandhu` | External-only endpoint that finds a patient by full name and returns `{ "success": true, "patient": { ... } }` (with `id`/`surgery_date` for backwards compatibility) or `{ "success": false, "message": "Patient record not found" }`. You can also continue sending `name`+`surname` pairs for backwards compatibility. |

### Sample patient requests

Create a patient (internal session cookie example):

```bash
curl -X POST "http://127.0.0.1:8000/patients" \
  -H "Content-Type: application/json" \
  -d '{
    "month_label": "June 2024",
    "week_label": "Week 2",
    "week_range": "Jun 10 – Jun 16",
    "week_order": 2,
    "day_label": "Tue",
    "day_order": 2,
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane.doe@example.com",
    "phone": "+1-555-123-4567",
    "city": "Los Angeles",
    "procedure_date": "2024-06-12",
    "status": "consult",
    "surgery_type": "Facelift",
    "payment": "Deposit received",
    "consultation": [],
    "forms": [],
    "consents": [],
    "photos": 0,
    "photo_files": []
  }'
```

Update an existing patient (replace `123` with the record id):

```bash
curl -X PUT "http://127.0.0.1:8000/patients/123" \
  -H "Content-Type: application/json" \
  -d '{
    "month_label": "June 2024",
    "week_label": "Week 2",
    "week_range": "Jun 10 – Jun 16",
    "week_order": 2,
    "day_label": "Tue",
    "day_order": 2,
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane.doe@example.com",
    "phone": "+1-555-987-6543",
    "city": "Los Angeles",
    "procedure_date": "2024-06-18",
    "status": "pre-op",
    "surgery_type": "Facelift",
    "payment": "Paid in full",
    "consultation": ["consultation1"],
    "forms": ["health_history"],
    "consents": ["photo_release"],
    "photos": 0,
    "photo_files": []
  }'
```

### Frontend capabilities

- **Weekly schedule** – `index.html` renders the one-page calendar. Authenticated users can page through months, create placeholder patients, and drill into patient details. All data flows through the FastAPI APIs.
- **Patient editor** – `patient.html` lets you edit contact info, forms/consents, consultation status, and upload photos.
- **Settings dashboard** – `settings.html` combines multiple admin tools:
  - API token generator (with delete controls)
  - Option manager for every dropdown (status, surgery type, payment, forms, consents, consultation). The UI mirrors the provided todo-style design.
  - User management (create users, toggle admin, reset passwords, delete accounts)
- **Login/logout** – `login.html` provides the session entry point while logout buttons are available on every authenticated page.

All HTTP APIs include interactive docs at `http://127.0.0.1:8000/docs` once the server is running.

**External integrations:** Every route above is mirrored under `/api/v1/*` and requires an API token created in the Settings → API Tokens UI. Send it in the `Authorization: Bearer <token>` header (recommended) or fall back to the legacy `token` query string parameter if your client cannot set headers. The `/api/v1/search` helper is specifically designed for lightweight patient lookups from outside systems—you can now pass `full_name=Randhir%20Sandhu` (preferred) or continue using the legacy `name` and optional `surname` parameters. The response includes the full patient payload when found (along with `id` and `surgery_date` for backwards compatibility) or sets `success: false` with `message: "Patient record not found"` when no match exists so you can gracefully handle misses.
<!--  -->
