# API Endpoints

## `/patients`
- `GET /patients` – Fetch every patient ordered by procedure date/month.
- `POST /patients` – Create a new patient (body: `PatientCreate`).
- `GET /patients/{id}` – Fetch a single patient.
- `PUT /patients/{id}` – Update an existing patient.

## `/uploads`
- `POST /uploads/{last_name}?patient_id=ID` – Upload one or more images for the patient. Returns updated `photoFiles`.
- `DELETE /uploads/{patient_id}?file=relative/path.jpg` – Delete a single photo from both disk and the DB.

## `/api-tokens`
- `GET /api-tokens` – List every integration token (tokens never expire).
- `POST /api-tokens` – Create a new token by providing a `name`. Response contains the raw token string; store it securely.

## `/plans`
- `GET /plans` – List weekly plans.
- `POST /plans` – Create plan.
- `PUT /plans/{id}` – Update plan.
- `DELETE /plans/{id}` – Delete plan.

## `/config`
- `GET /app-config` – JSON containing frontend/backend URLs.
- `GET /app-config.js` – Injects `window.APP_CONFIG`.
