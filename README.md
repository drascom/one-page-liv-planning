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

1. Create a Python 3.11 virtual environment.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Start the API server:

   ```bash
   uvicorn backend.app:app --reload
   ```

   The server listens on `http://127.0.0.1:8000` by default.

## API reference

| Method | Path            | Description                      |
| ------ | --------------- | -------------------------------- |
| GET    | `/plans/`       | List every weekly plan.          |
| POST   | `/plans/`       | Create a new weekly plan.        |
| PUT    | `/plans/{id}`   | Update the plan with the given ID. |
| DELETE | `/plans/{id}`   | Remove the specified plan.       |

All POST/PUT payloads use the following JSON shape:

```json
{
  "week_start": "2024-03-18",
  "focus_area": "Partnership outreach",
  "objectives": "List bullet-style objectives",
  "metrics": "Number of new partner calls",
  "notes": "Anything else worth remembering"
}
```

The automatically generated FastAPI docs are also available at
`http://127.0.0.1:8000/docs` once the server is running.
<!--  -->