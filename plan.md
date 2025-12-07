
- [x] add new page as dashboard and make it entry page
- [x] a card which holds current week bookings
- [x] a card which holds live activity
- [x] a card which holds next 10 booking listing which forms or consultations or constents is not completed
- [x] a button to go index page to see full list
- [x] since live activity will move this page remove it from index page

### Realtime utilities refactor
- [x] Extract shared websocket/audio/toast helpers into a reusable module (`frontend/js/realtime.js`).
- [x] Update `frontend/js/script.js` to consume the shared helpers for schedule page updates.
- [x] Update `frontend/js/dashboard.js` to consume the same helpers for dashboard updates.
- [x] Ensure both pages initialize the module with their page-specific callbacks and verify duplication is removed.

### Build metadata & version display
- [x] Add a git-driven `get_app_version()` helper and wire it into FastAPI/config responses.
- [x] Provide the version via `window.APP_CONFIG` and hydrate `[data-app-version]` slots with a shared session helper.
- [x] Refresh every top navigation bar (HTML + CSS) so the muted version label appears beneath the Liv Planner logo.

### Procedure time support
- [x] Add a `procedure_time` column (default `08:30`) to the `procedures` table plus migrations/seed data.
- [x] Extend backend models & serializers so API payloads can read/write `procedure_time` while defaulting missing values.
- [x] Expose the value via patient/procedure endpoints and update automated tests to cover the default behavior.

### London timezone standardization
- [x] Introduce a shared backend timezone helper pinned to Europe/London and replace all UTC `now()` usages.
- [x] Ensure frontend formatting utilities (Intl/locale strings) explicitly use the London timezone constant.
- [x] Provide a shared frontend timezone module so every page renders timestamps consistently.
