import {
  fetchCurrentUser,
  handleUnauthorized,
  initAppVersionDisplay,
  initSessionControls,
} from "./session.js";
import { navigateToPatientRecord, setPatientRouteBase } from "./patient-route.js";
import { createRealtimeClient, showActivityToast } from "./realtime.js";

const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ?? `${window.location.protocol}//${window.location.host}`;

const weekBookingsEl = document.getElementById("week-bookings");
const pendingBookingsEl = document.getElementById("pending-bookings");
const activityFeedEl = document.getElementById("activity-feed");
const weekCardHintEl = document.getElementById("week-card-hint");
const pendingCardHintEl = document.getElementById("pending-card-hint");
const activityCardHintEl = document.getElementById("activity-card-hint");
const weekCountEl = document.getElementById("stat-week-count");
const pendingCountEl = document.getElementById("stat-pending-count");
const weekRangeEl = document.getElementById("stat-week-range");
const connectionIndicator = document.getElementById("dashboard-connection-indicator");
const openChatbotBtn = document.getElementById("open-chatbot-btn");
const closeChatbotBtn = document.getElementById("close-chatbot-btn");
const chatbotPopup = document.getElementById("chatbot-popup");

let activityEvents = [];
let patientCache = [];
let procedureCache = [];
let normalizedProcedures = [];
let realtimeClient = null;
let proceduresRefreshPromise = null;

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

initSessionControls();
initAppVersionDisplay();
bootstrap();
wireChatbot();

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

function buildWebSocketUrl(path) {
  try {
    const apiUrl = new URL(API_BASE_URL);
    const protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${apiUrl.host}${path}`;
  } catch (_error) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${path}`;
  }
}

function parseDate(value) {
  if (!value) return null;
  const datePart = String(value).split("T")[0];
  const parsed = new Date(`${datePart}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

function endOfWeek(date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function isWithinWeek(date, anchor = new Date()) {
  const start = startOfWeek(anchor);
  const end = endOfWeek(anchor);
  return date >= start && date <= end;
}

function formatDate(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Date not set";
  return DATE_FORMATTER.format(parsed);
}

function formatTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "";
  return TIME_FORMATTER.format(parsed);
}

function normalizeProcedures(patients, procedures) {
  const lookup = new Map(patients.map((p) => [Number(p.id), p]));
  return procedures.map((proc) => {
    const patient = lookup.get(Number(proc.patient_id)) || {};
    const date = parseDate(proc.procedure_date);
    return {
      ...proc,
      patient,
      patientName: `${patient.first_name || ""} ${patient.last_name || ""}`.trim() || "Unknown patient",
      parsedDate: date,
    };
  });
}

async function fetchJson(path) {
  const response = await fetch(buildApiUrl(path));
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

async function bootstrap() {
  try {
    const user = await fetchCurrentUser().catch(() => null);
    const isAdmin = Boolean(user?.is_admin);
    setPatientRouteBase(isAdmin);
    if (isAdmin) {
      document.querySelectorAll("[data-admin-link]").forEach((el) => el.removeAttribute("hidden"));
      document.querySelectorAll("[data-admin-customers]").forEach((el) => el.removeAttribute("hidden"));
    } else {
      document.querySelectorAll("[data-admin-customers]").forEach((el) => el.remove());
      if (openChatbotBtn) openChatbotBtn.remove();
    }
  } catch (_err) {
    // ignore auth banner, backend will redirect if needed
  }

  await Promise.all([loadProcedures(), loadActivity()]);
  initializeRealtimeChannel();
}

function wireChatbot() {
  if (!openChatbotBtn || !closeChatbotBtn || !chatbotPopup) return;
  openChatbotBtn.addEventListener("click", () => {
    chatbotPopup.hidden = false;
  });
  closeChatbotBtn.addEventListener("click", () => {
    chatbotPopup.hidden = true;
  });
}

async function loadProcedures() {
  try {
    await refreshProceduresData();
  } catch (error) {
    console.error("Unable to load dashboard data", error);
    setHint(weekCardHintEl, "Unable to load bookings.");
    setHint(pendingCardHintEl, "Unable to load bookings.");
  }
}

async function loadActivity() {
  try {
    const response = await fetch(buildApiUrl("/status/activity-feed"));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Activity feed failed (${response.status})`);
    }
    const payload = await response.json();
    activityEvents = Array.isArray(payload) ? payload.slice(0, 10) : [];
    renderActivity(activityEvents);
  } catch (error) {
    console.error("Unable to load activity feed", error);
    setHint(activityCardHintEl, "Unable to load activity.");
  }
}

function setHint(el, text) {
  if (!el) return;
  el.textContent = text;
}

function renderWeekBookings(procedures) {
  if (!weekBookingsEl) return;
  weekBookingsEl.innerHTML = "";
  const weekProcedures = procedures.filter((proc) => proc.parsedDate && isWithinWeek(proc.parsedDate));
  weekProcedures.sort((a, b) => (a.parsedDate?.getTime() || 0) - (b.parsedDate?.getTime() || 0));
  if (weekProcedures.length === 0) {
    weekBookingsEl.innerHTML = `<p class="empty-state">No bookings scheduled this week.</p>`;
    setHint(weekCardHintEl, "No bookings scheduled this week.");
  } else {
    setHint(weekCardHintEl, `${weekProcedures.length} booking${weekProcedures.length === 1 ? "" : "s"} this week.`);
  }
  if (weekCountEl) {
    weekCountEl.textContent = weekProcedures.length.toString();
  }
  if (weekRangeEl) {
    const start = startOfWeek(new Date());
    const end = endOfWeek(new Date());
    weekRangeEl.textContent = `${DATE_FORMATTER.format(start)} – ${DATE_FORMATTER.format(end)}`;
  }
  weekProcedures.forEach((proc) => {
    const row = document.createElement("div");
    row.className = "booking-row";
    row.innerHTML = `
      <div class="booking-row__main">
        <p class="booking-row__title">${proc.patientName}</p>
        <p class="booking-row__meta">${proc.procedure_type || "Type not set"} • ${proc.status || "Status not set"}</p>
      </div>
      <div class="booking-row__time">
        <span class="booking-row__date">${formatDate(proc.procedure_date)}</span>
        <span class="booking-row__time-value">${formatTime(proc.procedure_date)}</span>
      </div>
    `;
    row.addEventListener("click", () => navigateToPatient(proc.patient?.id, proc.id, proc.procedure_date));
    weekBookingsEl.appendChild(row);
  });
}

function hasMissingPaperwork(proc) {
  const hasForms = Array.isArray(proc.forms) && proc.forms.length > 0;
  const hasConsents = Array.isArray(proc.consents) && proc.consents.length > 0;
  const hasConsultation =
    (Array.isArray(proc.consultation) && proc.consultation.length > 0) ||
    (proc.consultation && !Array.isArray(proc.consultation));
  return !(hasForms && hasConsents && hasConsultation);
}

function renderPendingBookings(procedures) {
  if (!pendingBookingsEl) return;
  pendingBookingsEl.innerHTML = "";
  const today = startOfWeek(new Date());
  const upcomingWithGaps = procedures
    .filter((proc) => proc.parsedDate && proc.parsedDate >= today && hasMissingPaperwork(proc))
    .sort((a, b) => (a.parsedDate?.getTime() || 0) - (b.parsedDate?.getTime() || 0))
    .slice(0, 10);

  if (pendingCountEl) {
    pendingCountEl.textContent = upcomingWithGaps.length.toString();
  }

  if (!upcomingWithGaps.length) {
    pendingBookingsEl.innerHTML = `<p class="empty-state">All upcoming bookings have paperwork in place.</p>`;
    setHint(pendingCardHintEl, "No missing forms or consents found.");
    return;
  }
  setHint(
    pendingCardHintEl,
    `${upcomingWithGaps.length} booking${upcomingWithGaps.length === 1 ? "" : "s"} need attention.`
  );

  upcomingWithGaps.forEach((proc) => {
    const missingParts = [];
    if (!(Array.isArray(proc.forms) && proc.forms.length)) missingParts.push("Forms");
    if (!(Array.isArray(proc.consents) && proc.consents.length)) missingParts.push("Consents");
    const hasConsult =
      (Array.isArray(proc.consultation) && proc.consultation.length > 0) ||
      (proc.consultation && !Array.isArray(proc.consultation));
    if (!hasConsult) missingParts.push("Consultation");

    const row = document.createElement("div");
    row.className = "booking-row booking-row--pending";
    row.innerHTML = `
      <div class="booking-row__main">
        <p class="booking-row__title">${proc.patientName}</p>
        <p class="booking-row__meta">${missingParts.join(" • ") || "Paperwork missing"}</p>
      </div>
      <div class="booking-row__time">
        <span class="booking-row__date">${formatDate(proc.procedure_date)}</span>
      </div>
    `;
    row.addEventListener("click", () => navigateToPatient(proc.patient?.id, proc.id, proc.procedure_date));
    pendingBookingsEl.appendChild(row);
  });
}

async function refreshProceduresData() {
  if (!proceduresRefreshPromise) {
    proceduresRefreshPromise = Promise.all([fetchJson("/patients"), fetchJson("/procedures")])
      .then(([patients, procedures]) => {
        patientCache = Array.isArray(patients) ? patients : [];
        procedureCache = Array.isArray(procedures) ? procedures : [];
        normalizedProcedures = normalizeProcedures(patientCache, procedureCache);
        renderWeekBookings(normalizedProcedures);
        renderPendingBookings(normalizedProcedures);
      })
      .catch((error) => {
        console.error("Unable to refresh bookings", error);
        throw error;
      })
      .finally(() => {
        proceduresRefreshPromise = null;
      });
  }
  return proceduresRefreshPromise;
}

function renderActivity(events) {
  if (!activityFeedEl) return;
  activityFeedEl.innerHTML = "";
  if (!Array.isArray(events) || events.length === 0) {
    activityFeedEl.innerHTML = `<p class="empty-state">No recent activity yet.</p>`;
    setHint(activityCardHintEl, "No recent activity.");
    updateConnectionIndicator("offline");
    return;
  }
  updateConnectionIndicator("live");
  setHint(activityCardHintEl, `${events.length} recent update${events.length === 1 ? "" : "s"}.`);

  const list = document.createElement("ul");
  list.className = "activity-list";

  events.forEach((event) => {
    const item = document.createElement("li");
    item.className = "activity-list__item";
    const summary = event.summary || "Schedule updated";
    const actor = event.actor || "Another user";
    const ts = event.timestamp ? new Date(event.timestamp) : null;
    const timeLabel = ts && !Number.isNaN(ts.getTime()) ? TIME_FORMATTER.format(ts) : "";

    item.innerHTML = `
      <div class="activity-list__main">
        <p class="activity-list__summary">${summary}</p>
        <p class="activity-list__meta">by ${actor}</p>
      </div>
      <span class="activity-list__time">${timeLabel}</span>
    `;

    const patientIdValue = Number(event.data?.patient_id);
    const procedureIdValue = Number(event.data?.procedure_id);
    item.addEventListener("click", () =>
      navigateToPatient(
        Number.isFinite(patientIdValue) ? patientIdValue : null,
        Number.isFinite(procedureIdValue) ? procedureIdValue : null,
        event.data?.procedure_date
      )
    );
    list.appendChild(item);
  });

  activityFeedEl.appendChild(list);
}


function addActivityEvent(event) {
  if (!event) {
    return;
  }
  activityEvents.unshift(event);
  if (activityEvents.length > 10) {
    activityEvents.length = 10;
  }
  renderActivity(activityEvents);
}

function initializeRealtimeChannel() {
  if (realtimeClient) {
    realtimeClient.close();
    realtimeClient = null;
  }
  realtimeClient = createRealtimeClient({
    getWebSocketUrl: () => buildWebSocketUrl("/ws/updates"),
    onActivitySync(items) {
      activityEvents = items.slice(0, 10);
      renderActivity(activityEvents);
    },
    onEvent: handleRealtimeEvent,
    onConnectionChange(state) {
      updateConnectionIndicator(state === "live" ? "live" : "offline");
    },
  });
}

function handleRealtimeEvent(payload) {
  if (!payload) {
    return;
  }
  if (payload.summary || payload.actor) {
    addActivityEvent(payload);
    showActivityToast(payload.summary || "New activity received");
  }
  refreshProceduresData().catch(() => {
    setHint(weekCardHintEl, "Unable to refresh bookings.");
    setHint(pendingCardHintEl, "Unable to refresh bookings.");
  });
}

function updateConnectionIndicator(state) {
  if (!connectionIndicator) return;
  connectionIndicator.classList.toggle("connection-indicator--live", state === "live");
}

function navigateToPatient(patientId, procedureId, procedureDate) {
  if (!patientId) return;
  const query = {};
  if (procedureId) {
    query.procedure = String(procedureId);
  }
  if (procedureDate) {
    query.date = procedureDate;
  }
  navigateToPatientRecord(patientId, { query });
}
