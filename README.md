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

1. Clone the repository and create a Python 3.11+ virtual environment.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Configure the `.env` file (optional but recommended):

   ```bash
   cp .env.example .env
   ```

   * `APP_SECRET_KEY` – random string used to sign session cookies.
   * `DEFAULT_ADMIN_PASSWORD` – temporary password for the auto-seeded admin user (`admin`).

4. Start the API server:

   ```bash
   uvicorn backend.app:app --reload
   ```

   The server listens on `http://127.0.0.1:8000` by default. Visit `http://127.0.0.1:8000/login` and sign in using `admin` plus the password from `.env`. From there you can invite teammates, issue API tokens, and manage dropdown options.

5. Build or serve the static frontend: the repository ships with prebuilt `index.html`, `patient.html`, `settings.html`, and `login.html` files under `static/` (served automatically by FastAPI).

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

### Frontend capabilities

- **Weekly schedule** – `index.html` renders the one-page calendar. Authenticated users can page through months, create placeholder patients, and drill into patient details. All data flows through the FastAPI APIs.
- **Patient editor** – `patient.html` lets you edit contact info, forms/consents, consultation status, and upload photos.
- **Settings dashboard** – `settings.html` combines multiple admin tools:
  - API token generator (with delete controls)
  - Option manager for every dropdown (status, surgery type, payment, forms, consents, consultation). The UI mirrors the provided todo-style design.
  - User management (create users, toggle admin, reset passwords, delete accounts)
- **Login/logout** – `login.html` provides the session entry point while logout buttons are available on every authenticated page.

All HTTP APIs include interactive docs at `http://127.0.0.1:8000/docs` once the server is running.
<!--  -->
