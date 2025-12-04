# API Endpoints

The frontend uses the base endpoints below directly and no token is required for those internal requests.

## `/patients`
- `GET /patients` – Fetch every patient ordered by procedure date/month.
- `POST /patients` – Create a patient by sending either the full `PatientCreate` payload or the simplified JSON `{ "status": "...", "surgery_type": "...", "name": "...", "number": "...", "date": "..." }`.
- `POST /patients/multiple` – Send an array of simplified payloads (same shape as above) and let the backend derive calendar fields + insert patients.
- `GET /patients/{id}` – Fetch a single patient.
- `PUT /patients/{id}` – Update an existing patient.
- `DELETE /patients/{id}` – (Admin only) Soft delete a patient record (moves it to Deleted Records) and return 204.
- `GET /patients/deleted` – (Admin only) List soft-deleted patients.
- `POST /patients/{id}/recover` – (Admin only) Restore a soft-deleted patient.
- `DELETE /patients/{id}/purge` – (Admin only) Permanently delete a patient (removes all stored details/files).
- Patient payloads include a `consultation` array (values `consultation1`, `consultation2`) to track completed consultations.

## `/procedures`
- `GET /procedures` – List every procedure; filter by `patient_id` to only view items attached to a specific patient.
- `POST /procedures` – Create a procedure with `{ "patient_id": 123, "name": "Consultation", "procedure_type": "sfue", "status": "scheduled", "procedure_date": "2025-01-02", "grafts": 2500, "payment": "deposit", "outstaning_balance": 500.0, "notes": [{"text": "Pre-op call scheduled"}] }`. Notes are to-do style items tied to the user who created them.
- `GET /procedures/{id}` – Fetch a single procedure.
- `PUT /procedures/{id}` – Update procedure details (requires a valid `patient_id`).
- `DELETE /procedures/{id}` – Remove a procedure; purging a patient also cascades and removes related procedures.
- `POST /api/v1/procedures/search-by-meta` – Provide `{ "full_name": "", "date": "", "status": "", "grafts_number": "", "package_type": "" }` to locate a procedure by metadata and receive its id and full procedure payload (delete it via `DELETE /procedures/{id}`).

## `/uploads`
- `POST /uploads/{last_name}?patient_id=ID` – Upload one or more images for the patient. Returns updated `photoFiles`.
- `DELETE /uploads/{patient_id}?file=relative/path.jpg` – Delete a single photo from both disk and the DB.

## `/api-tokens`
- `GET /api-tokens` – List the integration tokens created by the current admin (tokens never expire).
- `POST /api-tokens` – Create a new token by providing a `name`. Response contains the raw token string; store it securely.
- `DELETE /api-tokens/{id}` – Delete one of your tokens. Other admins cannot delete your tokens.

## `/auth`
- `POST /auth/login` – Authenticate with `{ "username": "", "password": "" }` and receive a session cookie.
- `POST /auth/logout` – Clear the current session.
- `GET /auth/me` – Return the logged-in user (`{ id, username, is_admin }`).
- `GET /auth/users` – (Admin) List every user.
- `POST /auth/users` – (Admin) Create a user (`{ username, password, is_admin }`).
- `PUT /auth/users/{id}/password` – (Admin) Reset a user's password.
- `PUT /auth/users/{id}/role` – (Admin) Toggle the admin flag.
- `DELETE /auth/users/{id}` – (Admin) Remove a user.

## `/plans`
- `GET /plans` – List weekly plans.
- `POST /plans` – Create plan.
- `PUT /plans/{id}` – Update plan.
- `DELETE /plans/{id}` – Delete plan.

## `/config`
- `GET /app-config` – JSON containing frontend/backend URLs.
- `GET /app-config.js` – Injects `window.APP_CONFIG`.

## `/field-options`
- `GET /field-options` – Fetch every configurable dropdown list (status, procedure type, forms, consents, consultations, payment).
- `GET /field-options/{field}` – Fetch a single field's options.
- `PUT /field-options/{field}` – Replace the option list for a field by sending `{ "options": [{"value": "id", "label": "Label"}, ...] }`.

## External API (`/api/v1/*`)
- connection check url is `GET api/v1/status/connection-check` with `Authorization: Bearer <token>` header
- Every endpoint listed above is also exposed under the `/api/v1/` prefix (e.g. `GET /api/v1/patients`).
- Importer endpoint: `POST /api/v1/patients/multiple` accepts the same simplified payload array for integrations, and `POST /api/v1/patients` accepts a single simplified payload as well.
- `DELETE /api/v1/patients/{id}` – Listed for completeness; it still requires an authenticated admin session (intended for the internal UI) and performs a soft delete.
- `GET /api/v1/patients/deleted` and `POST /api/v1/patients/{id}/recover` follow the same behavior as the base routes for managing soft-deleted records.
- `DELETE /api/v1/patients/{id}/purge` – Permanently delete a patient (admin + token required).
- All `/api/v1/...` requests require an `Authorization: Bearer <token>` header. Requests without this header are rejected.
- `GET /api/v1/search` – Provide the full name via `full_name=Randhir%20Sandhu` (preferred) or continue using the legacy `name`/`surname` parameters to look up a single patient. Returns `{ "success": true, "id": 123, "first_name": "Randhir", ..., "procedures": [ { ... } ] }` when found, `{ "success": false, "message": "Patient record not found", "procedures": [] }` when no record matches, or `{ "success": false, "message": "Name is missing" }` when no name parameter is supplied.
- `POST /api/v1/procedures/search-by-meta` – Provide any combination of `full_name`, `date`, `status`, `grafts_number`, or `package_type` to look up a procedure. Successful responses include `{ "success": true, "procedure_id": 42, "procedure": { ...full procedure... }, ... }`; failures return `{ "success": false, "message": "Procedure not found" }`.
