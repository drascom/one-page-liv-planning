# API Endpoints

The frontend uses the base endpoints below directly and no token is required for those internal requests.

## `/patients`
- `GET /patients` – Fetch every patient ordered by procedure date/month.
- `POST /patients` – Create a new patient (body: `PatientCreate`).
- `GET /patients/{id}` – Fetch a single patient.
- `PUT /patients/{id}` – Update an existing patient.
- Patient payloads include a `consultation` array (values `consultation1`, `consultation2`) to track completed consultations.

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
- `GET /field-options` – Fetch every configurable dropdown list (status, surgery type, forms, consents, consultations, payment).
- `GET /field-options/{field}` – Fetch a single field's options.
- `PUT /field-options/{field}` – Replace the option list for a field by sending `{ "options": [{"value": "id", "label": "Label"}, ...] }`.

## External API (`/api/v1/*`)
- connection check url is `GET api/v1/status/connection-check` with `Authorization: Bearer <token>` header
- Every endpoint listed above is also exposed under the `/api/v1/` prefix (e.g. `GET /api/v1/patients`).
- All `/api/v1/...` requests require either an `Authorization: Bearer <token>` header (preferred) or the `token` query parameter (e.g. `/api/v1/patients?token=abc123xyz`) for backwards compatibility.
- `GET /api/v1/search` – Provide the full name via `full_name=Randhir%20Sandhu` (preferred) or continue using the legacy `name`/`surname` parameters to look up a single patient. Returns `{ "success": true, "patient": { ... }, "id": 123, "surgery_date": "2024-03-11" }` when found and `{ "success": false, "message": "Patient record not found" }` otherwise.
