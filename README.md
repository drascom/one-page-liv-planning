# Liv CRM (one-page-liv-crm)

Liv CRM is the refreshed one-page scheduling and patient tracking workspace for the Liv team. A FastAPI backend manages patients, procedures, photos, payments, field options, API tokens, and activity events while the static frontend (HTML/CSS/JS under `frontend/`) delivers a single-page workflow for scheduling, editing patient records, and administrating the workspace.

## Workflow overview

1. **Authenticate.** Visit `/login`, submit the admin username/password, and the server issues a secure session cookie. Non-admins can browse read-only lists but only admins see the "Add patient", "Customers", or "Settings" controls.
2. **Schedule.** The home screen (`index.html`) renders a monthly calendar of procedures, lets you search for patients by name or city, mark multiple procedures for bulk deletes, and displays a real-time activity feed plus a conflict banner whenever another user pushes an update. The schedule pulls field options for statuses, procedure types, packages, agencies, and payments so the UI stays in sync with the backend.
3. **Patient workspace.** Clicking a card opens `/patient` for admins (or `/patient-view` for view-only users), where you can:
   - Edit contact info and navigate weeks via the dynamic heading (procedure dates mirror the selected record).
   - Manage every procedure field now including `package_type` (Small/Big) and `agency` (default "Want Hair" with "Liv Hair" as an option), pick a status and procedure type (Hair/sFUE, Beard, Woman, Eyebrow with sFUE selected by default), update graft counts, payment state, and checklist-driven forms/consents/consultations that show numbered tiles plus check/empty icons.
   - Upload unlimited photos via the drop zone and preview them in the full-screen viewer; files land under `uploads/<last-name>` and are served from `/uploaded-files`.
   - Track payments, assign multiple procedures, and delete/purge records; the UI automatically hides actions that require admin privileges and surfaces a reload button when concurrent edits clash.
4. **Admin & directory.** Admins can browse `customers.html` for a directory of every patient (including soft-deleted ones), refresh counts, filter by name/city/email, and delete individual entries. `settings.html` exposes tabs for dropdown options, API tokens, request logs, soft-deleted records, team access, and destructive resets. Dropdowns (forms, consents, consultations, payment, statuses, procedure types, package types, agency) can be edited via new cards, resetting options falls back to the built-in defaults, and user management lets you invite, toggle, or remove teammates. API tokens never expire and are shown with a shortcut to the `/api/v1/search` tester.
5. **Integrations.** Every internal endpoint (`/patients`, `/procedures`, `/uploads`, `/field-options`, `/api-tokens`, `/status`, `/drive-image`, etc.) is also available with the `/api/v1/*` prefix when you present a valid API token. Use `POST /api/v1/patients` or `POST /api/v1/patients/multiple` to import simplified payloads, `GET /api/v1/search?full_name=...` to fetch a flat patient sheet, and `GET /api/v1/procedures/search-by-meta` to look up procedures via metadata and receive the full procedure payload. The audit tab logs recent API calls so you can trace integrations.

## Feature highlights

### Frontend experience

- **Schedule view** – Monthly navigation, patient counts (current month/total), unscheduled plates, select-all checkbox, bulk delete, nav search/autocomplete, realtime connection indicator, and an activity feed that syncs over the websocket hub at `/ws/updates`.
- **Patient form** – Multi-procedure support, dynamic week labels, checklist representations for forms/consents/consultations (icon + numbering), photo uploads with viewer/via Google Drive proxy, package/agency dropdowns seeded with "Small/Big" and "Want Hair/Liv Hair", and payment/status tracking.
- **Admin surfaces** – Settings tabs arrange dropdown option management, data reset, deleted record recovery/purge, user management, API token creation/deletion, and audit log review. Customers view exposes the patient directory, visibility counts, and admin-only delete buttons.

### Backend services

- FastAPI app with routers for patients, procedures, uploads, API tokens, field options, audit activity, configuration (`/app-config` and `/app-config.js`), Google Drive proxies, status checks (`GET /api/v1/status/connection-check`), and the realtime websocket hub.
- SQLite persistence in `backend/liv_planning.db` for tables covering patients, procedures, photos, payments, field options, API tokens, activity events, and users. Database initialization/alterations keep `package_type`/`agency` columns and default option counts in sync.
- Pydantic models enforce structured payloads for patients, procedures, metadata searches, payments, photos, and activity events while `backend/realtime.py` records and broadcasts every change so clients can display the activity timeline and flag conflicts.
- Google Drive integration proxies `/drive-image/{file_id}` (and `/meta`) through `google-auth` credentials stored in the environment (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PROJECT_ID`, `GOOGLE_TOKEN_JSON`, etc.) so credentials never reach the browser.

### Integrations & automation

- `/api/v1/*` versions of every internal route require Bearer tokens created in the settings UI; tokens are immutable but your code can delete them when no longer needed.
- Procedures support metadata searches (`/procedures/search`, `GET /procedures/search-by-meta`) and paginated deleted/recoverable records (`/procedures/deleted`, `/procedures/{id}/recover`, `/procedures/{id}/purge`). Patients support soft delete/recover/purge flows along with `GET /patients/{id}/procedures`.
- `LIV REST API.paw` provides a ready-made Paw collection, and the FastAPI docs at `${BACKEND_URL}/docs` list every route/shape in one place.
- Smoke-test automation lives in `tests/patient_workflow_test.py` (log in, create patient/procedure, update, and optionally purge). The `tests/test_procedures.py` suite exercises CRUD, filtering, search fallback, deleted record workflows, metadata search, validations, and `api/v1/search` responses.

## Getting started

### Debian/Ubuntu quick install

```bash
chmod +x install.sh
./install.sh
```

The script installs system packages (`python3`, `python3-venv`, `curl`, `build-essential`, `libsqlite3-dev`), the `uv` tool, syncs dependencies via `uv sync`, boots a systemd service named `one-page-crm.service`, and seeds `.env` from `.env.example` if missing. After installation, manage the service with `sudo systemctl restart one-page-crm.service` or `sudo systemctl status one-page-crm.service`.

### Manual development

1. Install [uv](https://github.com/astral-sh/uv) if missing: `curl -LsSf https://astral.sh/uv/install.sh | sh`.
2. Sync dependencies: `uv sync`.
3. Copy the environment file: `cp .env.example .env` and adjust `APP_SECRET_KEY`, `DEFAULT_ADMIN_PASSWORD`, `BACKEND_URL`, `FRONTEND_URL`, and optional Google OAuth / token variables.
4. Run the app locally: `uv run uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000`. Behind a proxy or load balancer use `uv run uvicorn backend.app:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*"`.
5. Visit `/login`, auth as `admin`/password-from-`.env`, then explore the schedule, patient, settings, and customers pages. Static assets live under `frontend/css`, `frontend/js`, and `frontend/html`; FastAPI automatically serves them.

### Docker

```
docker build -t liv-crm .
docker run -p 8000:8000 --env-file .env liv-crm
```

The `Dockerfile` installs uv, syncs dependencies with `uv sync --no-dev`, copies static assets, exposes port 8000, and launches `uvicorn backend.app:app`.

## Configuration

### `.env` file content

- `APP_SECRET_KEY`: A secret key for signing session cookies. Change this to a random, secure string in production.
- `DEFAULT_ADMIN_PASSWORD`: The initial password for the `admin` user. This should be changed after the first login.
- `BACKEND_URL`: The public URL of the backend server (e.g., `https://liv.drascom.uk`).
- `FRONTEND_URL`: The public URL of the frontend application (e.g., `https://liv.drascom.uk`).
- `GOOGLE_CLIENT_ID`: Google OAuth 2.0 Client ID.
- `GOOGLE_CLIENT_SECRET`: Google OAuth 2.0 Client Secret.
- `GOOGLE_PROJECT_ID`: Your Google Cloud project ID.
- `GOOGLE_REDIRECT_URIS`: The callback URL for Google OAuth. For local development, this is typically `http://localhost:8000/auth/google/callback`.
- `GOOGLE_AUTH_URI`: The Google OAuth 2.0 authorization endpoint. Default is `https://accounts.google.com/o/oauth2/auth`.
- `GOOGLE_TOKEN_URI`: The Google OAuth 2.0 token endpoint. Default is `https://oauth2.googleapis.com/token`.
- `GOOGLE_TOKEN_JSON`: (Optional) A JSON string containing a pre-authorized token. This allows the application to access Google Drive without requiring a user to go through the OAuth flow in the browser.

### Setting up Google Drive connection

To enable the Google Drive integration for fetching photos, you need to configure Google OAuth 2.0 credentials.

1.  **Create a Google Cloud Project:**
    - Go to the [Google Cloud Console](https://console.cloud.google.com/).
    - Create a new project or select an existing one.

2.  **Enable the Google Drive API:**
    - In your project, navigate to "APIs & Services" > "Library".
    - Search for "Google Drive API" and enable it.

3.  **Create OAuth 2.0 Credentials:**
    - Go to "APIs & Services" > "Credentials".
    - Click "Create Credentials" and select "OAuth client ID".
    - Choose "Web application" as the application type.
    - Add an authorized redirect URI. For local development, use `http://localhost:8000/auth/google/callback`. For production, use `https://<your-domain>/auth/google/callback`.
    - Click "Create" and take note of the **Client ID** and **Client Secret**.

4.  **Update your `.env` file:**
    - Copy the Client ID, Client Secret, and Project ID into the corresponding variables in your `.env` file.

5.  **Authorize the application:**
    - Run the application and navigate to the settings page.
    - Click the "Connect to Google Drive" button.
    - You will be redirected to a Google consent screen. Log in and grant the requested permissions.
    - After authorization, you will be redirected back to the application, and a `GOOGLE_TOKEN_JSON` will be generated and stored. You can copy this value into your `.env` file to avoid re-authorizing in the future.

- `backend/settings.py` exposes `static_root` (serving `frontend/`), `uploads_root` (`uploads/`), and the paths used by `app-config`. The `uploads/` directory stores patient photo files and must be writable.
- The `private/` directory currently holds a sample Google client secret; copy yours into the environment variables instead of checking in secrets.

## Testing & automation

- Run the unit/integration suite with `uv run pytest tests`.
- Use the workflow smoke-test helper: `uv run python tests/patient_workflow_test.py --base-url http://127.0.0.1:8000 --username admin --password changeme [--keep-records]`.
- `uv run python -m pytest tests/test_procedures.py` exercises procedures search, metadata, deletion, recovery, and API-token-protected responses.

## API docs & tooling

- Interactive docs live at `${BACKEND_URL}/docs` (Swagger UI) and `${BACKEND_URL}/redoc` when the server is running.
- `LIV REST API.paw` is a Paw collection with sample requests for the most common flows.
- `config_router` exposes `/app-config` and `/app-config.js` so the frontend can discover the correct backend/frontend URLs at runtime.


## Operations & observability

- Real-time updates flow through the websocket hub at `/ws/updates`, populating the activity feed and letting clients detect conflicts, show `Offline/Connected` status, and offer manual refresh controls.
- Activity events are recorded via `database.record_activity_event` (procedures, patients, uploads), retained in `activity_events`, and surfaced in the frontend feed.
- Google Drive files are proxied through `/drive-image/{file_id}` and `/drive-image/{file_id}/meta` using the server's credentials so browsers never see the OAuth token.
- Uploaded photos and other static artifacts are served from `/uploaded-files`; refer to `patient.js` for the drop zone + gallery flow.
- Use `GET /api/v1/status/connection-check` with a token to verify connectivity before attempting uploads or imports.
