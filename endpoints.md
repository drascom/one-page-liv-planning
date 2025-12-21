# API Endpoints

### Example API calls

All requests require `Authorization: Bearer <token>` headers unless you are using the browser session cookie. The snippets below assume `BASE_URL=https://example.com` and `TOKEN=<api-token>`.

```bash
# Search flat patient sheet
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/search?full_name=Alex%20Smith"

# Search a patient by name + surgery date
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/patients/search-by-date?full_name=Alex%20Smith&surgery_date=2024-08-01"

# Search a patient by name + date of birth
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/patients/search-by-date?full_name=Alex%20Smith&dob=1990-04-01"

# Search a patient by name only (returns just the patient metadata, no procedures)
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/patients/search-by-name?full_name=Alex%20Smith"

# Search procedures by patient/date/id
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/procedures/search?patient_id=123&procedure_date=2024-08-01"

# Metadata search for a single procedure
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/procedures/search-by-meta?full_name=Alex%20Smith&date=2024-08-01&status=confirmed"

# Create a patient
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "first_name": "Alex",
    "last_name": "Smith",
    "email": "alex@example.com",
    "phone": "+44123456789",
    "address": "London",
    "dob": "1990-04-01",
    "emergency_contact": {
      "name": "Becky Comben",
      "number": "07825631530"
    }
  }' \
  "$BASE_URL/api/v1/patients"

# Update a patient
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "phone": "+441111111111", "address": "Manchester" }' \
  "$BASE_URL/api/v1/patients/123"

# Partially update a patient
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "phone": "+449876543210", "emergency_contact": { "name": "Becky Comben", "number": "07825631530" } }' \
  "$BASE_URL/api/v1/patients/123"

# Create a procedure linked to a patient
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "procedure_date": "2024-08-01",
    "procedure_time": "09:00",
    "status": "confirmed",
    "procedure_type": "sfue",
    "package_type": "small",
    "payment": "deposit",
    "consultation": [],
    "forms": [],
    "consents": []
  }' \
  "$BASE_URL/api/v1/patients/123/procedures"

# Update a procedure
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "patient_id": 123,
    "procedure_date": "2024-08-01",
    "status": "completed",
    "procedure_type": "sfue",
    "package_type": "small",
    "payment": "paid"
  }' \
  "$BASE_URL/api/v1/procedures/456"
```
