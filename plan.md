
- [x] add new page as dashboard and make it entry page
- [x] a card which holds current week bookings
- [x] a card which holds live activity
- [x] a card which holds next 10 booking listing which forms or consultations or constents is not completed
- [x] a button to go index page to see full list
- [x] since live activity will move this page remove it from index page

### Realtime utilities refactor
- [ ] Extract shared websocket/audio/toast helpers into a reusable module (`frontend/js/realtime.js`).
- [ ] Update `frontend/js/script.js` to consume the shared helpers for schedule page updates.
- [ ] Update `frontend/js/dashboard.js` to consume the same helpers for dashboard updates.
- [ ] Ensure both pages initialize the module with their page-specific callbacks and verify duplication is removed.
