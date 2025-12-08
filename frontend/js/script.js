import {
  fetchCurrentUser,
  handleUnauthorized,
  initAppVersionDisplay,
  initSessionControls,
} from "./session.js";
import { navigateToPatientRecord, setPatientRouteBase } from "./patient-route.js";
import { createRealtimeClient, showActivityToast } from "./realtime.js";
import { APP_TIMEZONE } from "./timezone.js";

const scheduleEl = document.getElementById("schedule");
const weekTemplate = document.getElementById("week-template");
const searchForm = document.getElementById("patient-search-form");
const searchInput = document.getElementById("patient-search");
const searchClearBtn = document.getElementById("patient-search-clear");
const searchResultsEl = document.getElementById("patient-search-results");

const DEFAULT_FIELD_OPTIONS = {
  status: [
    { value: "confirmed", label: "Confirmed" },
    { value: "reserved", label: "Reserved" },
    { value: "cancelled", label: "Cancelled" },
    { value: "done", label: "Done" },
  ],
  procedure_type: [
    { value: "sfue", label: "sFUE" },
    { value: "hair_transplant", label: "Hair Transplant" },
    { value: "beard", label: "Beard" },
    { value: "woman", label: "Woman" },
    { value: "eyebrow", label: "Eyebrow" },
    { value: "face_to_face", label: "Face to Face Consultation" },
    { value: "video_consultation", label: "Video Consultation" },
  ],
  package_type: [
    { value: "small", label: "Small" },
    { value: "big", label: "Big" },
  ],
  agency: [
    { value: "want_hair", label: "Want Hair" },
    { value: "liv_hair", label: "Liv Hair" },
  ],
  payment: [
    { value: "waiting", label: "Waiting" },
    { value: "paid", label: "Paid" },
    { value: "partially_paid", label: "Partially Paid" },
  ],
  forms: [
    { value: "form_1", label: "Registration" },
    { value: "form_2", label: "PPAQ" },
    { value: "form_3", label: "PPAQ Output (Dr)" },
    { value: "form_4", label: "Booking (Dr)" },
    { value: "form_5", label: "HT Forms (Pre Surgery)" },
    { value: "form_6", label: "HT Forms (After Surgery)" },
  ],
  consents: [
    { value: "consent_1", label: "HT-1 Admission" },
    { value: "consent_2", label: "HT-2 Consent (Surgery)" },
  ],
  consultation: [
    { value: "consultation_1", label: "Consultation 1" },
    { value: "consultation_2", label: "Consultation 2" },
  ],
};

let fieldOptions = JSON.parse(JSON.stringify(DEFAULT_FIELD_OPTIONS));

const CHECKED_ICON = {
  true: "✓",
  false: "✕",
};

function getFieldOptions(field) {
  return fieldOptions[field] ?? [];
}

function getFieldOptionValues(field) {
  return getFieldOptions(field).map((option) => option.value);
}

function getOptionLabel(field, value) {
  if (!value) {
    return "";
  }
  const match = getFieldOptions(field).find((option) => option.value === value);
  return match?.label ?? value;
}

function getDefaultFieldValue(field, fallback = "") {
  const options = getFieldOptions(field);
  return options[0]?.value ?? fallback;
}

function getStatusClass(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  if (!normalized) {
    return "status-generic";
  }
  const defaults = {
    reserved: "status-reserved",
    confirmed: "status-confirmed",
    insurgery: "status-insurgery",
    done: "status-done",
    small: "status-small",
    big: "status-big",
  };
  const mappedClass = defaults[normalized];
  return mappedClass ?? `status-generic status-${normalized}`;
}

function hasCompletedChecklist(field, values) {
  const required = getFieldOptionValues(field);
  if (!required.length) {
    return false;
  }
  const provided = new Set(Array.isArray(values) ? values : []);
  return required.every((value) => provided.has(value));
}

async function fetchFieldOptions() {
  try {
    const response = await fetch(buildApiUrl("/field-options"));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error("Unable to load field options");
    }
    const payload = await response.json();
    fieldOptions = Object.fromEntries(
      Object.keys(DEFAULT_FIELD_OPTIONS).map((field) => {
        const incoming = Array.isArray(payload?.[field]) ? payload[field] : null;
        return [field, incoming && incoming.length ? incoming : DEFAULT_FIELD_OPTIONS[field]];
      })
    );
  } catch (error) {
    console.error(error);
    fieldOptions = JSON.parse(JSON.stringify(DEFAULT_FIELD_OPTIONS));
  }
}

const ACTIVE_PATIENT_KEY = "activePatient";
const MONTH_QUERY_PARAM = "month";
const GLOBAL_SEARCH_KEY = "globalSearchQuery";
const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: APP_TIMEZONE,
});
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: APP_TIMEZONE });
const DAY_NAME_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: APP_TIMEZONE });
const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});

const monthDisplay = document.getElementById("current-month-button");
const monthPicker = document.getElementById("month-picker");
const monthPickerGrid = document.getElementById("month-picker-grid");
const monthPickerClose = document.getElementById("month-picker-close");
const weekCount = document.getElementById("week-count");
const monthPatientCount = document.getElementById("month-patient-count");
const totalPatientCount = document.getElementById("total-patient-count");
const monthPrevBtn = document.getElementById("month-prev");
const monthNextBtn = document.getElementById("month-next");
const todayButton = document.getElementById("month-today");
const addPatientBtn = document.getElementById("add-patient-btn");
const settingsLink = document.querySelector("[data-admin-link]");
const adminCustomerLinks = document.querySelectorAll("[data-admin-customers]");
const adminTools = document.querySelector("[data-admin-tools]");
const selectAllCheckbox = document.getElementById("select-all-patients");
const deleteSelectedBtn = document.getElementById("delete-selected-btn");
const connectionIndicator = document.getElementById("connection-indicator");
const activityFeedEl = document.getElementById("activity-feed");
const activityStatusEl = document.getElementById("activity-connection-status");
const conflictBanner = document.getElementById("conflict-banner");
const conflictMessageEl = document.getElementById("conflict-message");
const conflictRefreshBtn = document.getElementById("conflict-refresh-btn");
const conflictDismissBtn = document.getElementById("conflict-dismiss-btn");

initSessionControls();
initAppVersionDisplay();
let activePatientContext = loadActivePatientContext();
let isAdminUser = false;
const selectedProcedureIds = new Set();
let fieldOptionsLoaded = false;
let normalizedProcedures = [];
let unscheduledPatients = [];
let searchablePatients = [];
let filteredMonthlySchedules = [];
let searchQuery = "";
let patientRecords = [];
let procedureRecords = [];
let activityEvents = [];
let realtimeClient = null;
let conflictActionCallback = null;
let shouldPreserveSelections = false;

if (searchClearBtn) {
  searchClearBtn.hidden = true;
}

renderActivityFeed();
setActivityStatus("Offline", "offline");

(async function bootstrap() {
  await initializeAdminControls();
  await initializeActivityFeed();
  await initializeSchedule();
  initializeRealtimeChannel();
  hideChatbotForNonAdmins();
})();

function parseMonthParam(param) {
  if (!param || typeof param !== "string") {
    return null;
  }
  const [yearStr, monthStr] = param.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime()) ? null : date;
}

function loadSelectedDateFromUrl() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const monthParam = params.get(MONTH_QUERY_PARAM);
    return parseMonthParam(monthParam);
  } catch (error) {
    console.warn("Unable to read month from URL", error);
    return null;
  }
}

let monthlySchedules = [];
const initialSelectedDate = loadSelectedDateFromUrl() ?? new Date();
let selectedDate = new Date(initialSelectedDate.getFullYear(), initialSelectedDate.getMonth(), 1);
let isCreatingPatient = false;

function setScheduleStatus(message) {
  scheduleEl.innerHTML = "";
  const paragraph = document.createElement("p");
  paragraph.className = "schedule__status";
  paragraph.textContent = message;
  scheduleEl.appendChild(paragraph);
}

function formatActivityTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }
  return TIME_FORMATTER.format(date);
}


function formatHumanReadableDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "short", timeZone: APP_TIMEZONE });
  const year = date.getFullYear();
  return `${day}, ${month} ${year}`;
}

function handleActivityNavigation(payload = {}) {
  const normalizedPatientId = Number(payload.patientId);
  if (!Number.isFinite(normalizedPatientId)) {
    return;
  }
  const patientName = payload.patientName || "";
  const procedureId = Number(payload.procedureId);
  const procedureDate = payload.procedureDate || "";
  const metadata = buildScheduleMetadataFromDate(procedureDate);
  const context = {
    patientId: normalizedPatientId,
    patient: patientName,
    weekLabel: metadata.weekLabel,
    weekRange: metadata.weekRange || metadata.monthLabel || "",
    day: metadata.dayLabel,
    monthLabel: metadata.monthLabel,
    procedureDate,
    procedureId: Number.isFinite(procedureId) ? procedureId : null,
    capturedAt: new Date().toISOString(),
  };
  persistActivePatientContext(context);
  navigateToPatientRecord(context.patientId, {
    patientName: context.patient,
    procedureId: context.procedureId,
  });
}

function createActivityLink(text, onClick) {
  const link = document.createElement("a");
  link.href = "#";
  link.className = "activity-entry__link";
  link.textContent = text;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return link;
}

function appendDescriptorWithProcedureLink(container, descriptor, navigationPayload) {
  if (!descriptor) {
    return;
  }
  const keyword = "procedure";
  const keywordIndex = navigationPayload.procedureId
    ? descriptor.toLowerCase().indexOf(keyword)
    : -1;
  if (keywordIndex >= 0) {
    const before = descriptor.slice(0, keywordIndex);
    const keywordText = descriptor.slice(keywordIndex, keywordIndex + keyword.length);
    const after = descriptor.slice(keywordIndex + keyword.length);
    if (before) {
      container.appendChild(document.createTextNode(before));
    }
    const procedureLink = createActivityLink(keywordText, () =>
      handleActivityNavigation(navigationPayload)
    );
    container.appendChild(procedureLink);
    if (after) {
      container.appendChild(document.createTextNode(after));
    }
    return;
  }
  container.appendChild(document.createTextNode(descriptor));
}

function renderActivityFeed() {
  if (!activityFeedEl) {
    return;
  }
  activityFeedEl.innerHTML = "";
  if (!activityEvents.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "activity-feed__placeholder";
    placeholder.textContent = "Waiting for activity…";
    activityFeedEl.appendChild(placeholder);
    return;
  }
  const table = document.createElement("table");
  table.className = "activity-table";
  const tbody = document.createElement("tbody");
  activityEvents.slice(0, 10).forEach((event) => {
    const row = document.createElement("tr");
    row.className = "activity-row";
    const summaryCell = document.createElement("td");
    summaryCell.className = "activity-cell activity-cell--summary";
    const summaryWrapper = document.createElement("div");
    summaryWrapper.className = "activity-entry__meta";
    const summaryText = event.summary || "Schedule updated";
    const patientIdValue = Number(event.data?.patient_id);
    const procedureIdValue = Number(event.data?.procedure_id);
    const navigationPayload = {
      patientId: Number.isFinite(patientIdValue) ? patientIdValue : null,
      patientName: event.data?.patient_name || "",
      procedureId: Number.isFinite(procedureIdValue) ? procedureIdValue : null,
      procedureDate: event.data?.procedure_date || "",
    };
    const summary = document.createElement("div");
    summary.className = "activity-entry__summary";
    const hasPatientContext =
      Number.isFinite(navigationPayload.patientId) && navigationPayload.patientName;
    if (hasPatientContext) {
      const patientLink = createActivityLink(navigationPayload.patientName, () =>
        handleActivityNavigation(navigationPayload)
      );
      summary.appendChild(patientLink);
      const descriptor = summaryText.slice(navigationPayload.patientName.length);
      appendDescriptorWithProcedureLink(summary, descriptor, navigationPayload);
    } else {
      summary.textContent = summaryText;
    }
    const actor = document.createElement("div");
    actor.className = "activity-entry__actor";
    actor.textContent = `by ${event.actor || "Another user"}`;
    summaryWrapper.append(summary, actor);
    summaryCell.appendChild(summaryWrapper);

    const timeCell = document.createElement("td");
    timeCell.className = "activity-cell activity-cell--time";
    const time = document.createElement("span");
    time.className = "activity-entry__time";
    time.textContent = formatActivityTime(event.timestamp);
    timeCell.appendChild(time);

    row.append(summaryCell, timeCell);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  activityFeedEl.appendChild(table);
}

async function initializeActivityFeed() {
  try {
    const response = await fetch(buildApiUrl("/status/activity-feed"));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Unable to load activity feed (${response.status})`);
    }
    const payload = await response.json();
    if (Array.isArray(payload)) {
      activityEvents = payload.slice(0, 10);
      renderActivityFeed();
    }
  } catch (error) {
    console.error(error);
  }
}

function updateConnectionIndicator(state) {
  if (!connectionIndicator) {
    return;
  }
  connectionIndicator.classList.toggle("connection-indicator--live", state === "live");
}

function setActivityStatus(text, connectionState) {
  if (activityStatusEl) {
    activityStatusEl.textContent = text;
  }
  if (typeof connectionState === "string") {
    updateConnectionIndicator(connectionState);
  }
}

function addActivityEvent(event) {
  if (!event) {
    return;
  }
  activityEvents.unshift(event);
  if (activityEvents.length > 10) {
    activityEvents.length = 10;
  }
  renderActivityFeed();
}


function showConflictNotice(message, actionCallback = null) {
  if (!conflictBanner || !conflictMessageEl) {
    return;
  }
  conflictActionCallback = actionCallback;
  conflictMessageEl.textContent = message;
  conflictBanner.hidden = false;
}

function hideConflictNotice() {
  if (conflictBanner) {
    conflictBanner.hidden = true;
  }
  conflictActionCallback = null;
}

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

async function initializeAdminControls() {
  try {
    const user = await fetchCurrentUser();
    isAdminUser = Boolean(user?.is_admin);
  } catch (_error) {
    isAdminUser = false;
  }
  setPatientRouteBase(isAdminUser);
  if (isAdminUser) {
    settingsLink?.removeAttribute("hidden");
    adminCustomerLinks.forEach((link) => link.removeAttribute("hidden"));
    if (addPatientBtn) {
      addPatientBtn.hidden = false;
      addPatientBtn.disabled = false;
    }
    if (adminTools) {
      adminTools.hidden = false;
    }
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.disabled = true;
    }
  } else {
    settingsLink?.remove();
    adminCustomerLinks.forEach((link) => link.remove());
    if (addPatientBtn) {
      addPatientBtn.hidden = true;
      addPatientBtn.disabled = true;
    }
    adminTools?.remove();
  }
  updateSelectionControlsState();
}

async function fetchPatients() {
  const response = await fetch(buildApiUrl("/patients"));
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error(`Unable to load patients (${response.status})`);
  }
  return response.json();
}

async function fetchPatientById(patientId) {
  const response = await fetch(buildApiUrl(`/patients/${patientId}`));
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error(`Unable to load patient (${response.status})`);
  }
  return response.json();
}

async function fetchProcedureById(procedureId) {
  const response = await fetch(buildApiUrl(`/procedures/${procedureId}`));
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error(`Unable to load procedure (${response.status})`);
  }
  return response.json();
}

async function fetchProcedures() {
  const response = await fetch(buildApiUrl("/procedures"));
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error(`Unable to load procedures (${response.status})`);
  }
  return response.json();
}

function parseMonthMetadata(label) {
  const match = label.match(/^([\p{L}]+)\s+(\d{4})$/u);
  if (!match) {
    return { year: null, monthNumber: null, date: null, timestamp: Number.MAX_SAFE_INTEGER };
  }
  const [, monthName, yearStr] = match;
  const date = new Date(`${monthName} 1, ${yearStr}`);
  if (Number.isNaN(date.getTime())) {
    return { year: null, monthNumber: null, date: null, timestamp: Number.MAX_SAFE_INTEGER };
  }
  return {
    year: Number(yearStr),
    monthNumber: date.getMonth(),
    date,
    timestamp: date.getTime(),
  };
}

function getDateFromContext(context) {
  const fromProcedureDate = parseISODate(context?.procedureDate);
  if (fromProcedureDate) {
    return fromProcedureDate;
  }
  if (!context?.monthLabel) {
    return null;
  }
  const meta = parseMonthMetadata(context.monthLabel);
  return meta?.date ?? null;
}

function setSelectedDateFromTarget(targetDate) {
  if (!targetDate) {
    return;
  }
  selectedDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
}

function loadActivePatientContext() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = localStorage.getItem(ACTIVE_PATIENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Unable to parse active patient context", error);
    return null;
  }
}

function persistActivePatientContext(context) {
  activePatientContext = context;
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    localStorage.setItem(ACTIVE_PATIENT_KEY, JSON.stringify(context));
  } catch (error) {
    console.warn("Unable to persist active patient context", error);
  }
}

function consumeGlobalSearchQuery() {
  if (typeof window === "undefined" || !window.localStorage) {
    return "";
  }
  try {
    const query = window.localStorage.getItem(GLOBAL_SEARCH_KEY) || "";
    if (query) {
      window.localStorage.removeItem(GLOBAL_SEARCH_KEY);
    }
    return query.trim();
  } catch (error) {
    console.warn("Unable to read global search query", error);
    return "";
  }
}

function buildScheduleMetadataFromDate(dateValue, fallback = {}) {
  const parsed = parseISODate(dateValue);
  if (!parsed) {
    return {
      monthLabel: fallback.monthLabel ?? "",
      weekLabel: fallback.weekLabel ?? "Week 1",
      weekRange: fallback.weekRange ?? fallback.monthLabel ?? "",
      weekOrder: Number.isFinite(fallback.weekOrder) ? fallback.weekOrder : 1,
      dayLabel: fallback.dayLabel ?? "",
      normalizedDate: fallback.procedureDate ?? "",
      sortKey: Number.isFinite(fallback.sortKey) ? fallback.sortKey : Number.MAX_SAFE_INTEGER,
    };
  }
  const weekMeta = getWeekMetaForDate(parsed);
  return {
    monthLabel: formatMonthLabelFromDate(parsed),
    weekLabel: weekMeta.label,
    weekRange: weekMeta.range,
    weekOrder: weekMeta.order,
    dayLabel: DAY_FORMATTER.format(parsed),
    normalizedDate: formatLocalISODate(parsed),
    sortKey: parsed.getTime(),
  };
}

function normalizeProcedureForSchedule(procedure, patientLookup = new Map()) {
  const lookupId = Number.isFinite(Number(procedure.patient_id)) ? Number(procedure.patient_id) : procedure.patient_id;
  const patient = patientLookup.get(lookupId) || procedure.patient || {};
  const firstName = patient.first_name || procedure.first_name || "";
  const lastName = patient.last_name || procedure.last_name || "";
  const patientId = patient.id ?? lookupId ?? null;
  const procedureId = procedure.id;
  const fallbackMeta = {
    monthLabel: procedure.month_label,
    weekLabel: procedure.week_label,
    weekRange: procedure.week_range,
    weekOrder: Number.isFinite(Number(procedure.week_order)) ? Number(procedure.week_order) : undefined,
    dayLabel: procedure.day_label,
    sortKey: Number.isFinite(Number(procedure.day_order)) ? Number(procedure.day_order) : undefined,
    procedureDate: procedure.procedure_date,
  };
  const scheduleMeta = buildScheduleMetadataFromDate(procedure.procedure_date, fallbackMeta);
  const scheduleMonthLabel = scheduleMeta.monthLabel || fallbackMeta.monthLabel || "Date not set";
  const scheduleWeekLabel = scheduleMeta.weekLabel || fallbackMeta.weekLabel || "Week 1";
  const scheduleWeekRange = scheduleMeta.weekRange || fallbackMeta.weekRange || scheduleMonthLabel;
  const scheduleWeekOrder = scheduleMeta.weekOrder || fallbackMeta.weekOrder || 1;
  const scheduleDayLabel = scheduleMeta.dayLabel || fallbackMeta.dayLabel || "";
  const scheduleProcedureDate = scheduleMeta.normalizedDate || fallbackMeta.procedureDate || "";
  const searchFirst = normalizeSearchText(firstName);
  const searchLast = normalizeSearchText(lastName);
  const searchFull = `${searchFirst} ${searchLast}`.trim();

  return {
    ...patient,
    ...procedure,
    id: patientId ?? procedureId,
    patientId,
    procedureId,
    first_name: firstName,
    last_name: lastName,
    patientName: `${firstName} ${lastName}`.trim() || "Patient",
    scheduleMonthLabel,
    scheduleWeekLabel,
    scheduleWeekRange,
    scheduleWeekOrder,
    scheduleDayLabel: scheduleDayLabel || procedure.day_label,
    scheduleProcedureDate,
    scheduleSortKey: scheduleMeta.sortKey,
    consultation: Array.isArray(procedure.consultation)
      ? procedure.consultation
      : procedure.consultation
        ? [procedure.consultation]
        : [],
    searchFirst,
    searchLast,
    searchFull,
  };
}

function buildUnscheduledSearchEntry(patient) {
  const firstName = patient.first_name || "";
  const lastName = patient.last_name || "";
  const searchFirst = normalizeSearchText(firstName);
  const searchLast = normalizeSearchText(lastName);
  return {
    ...patient,
    id: patient.id,
    patientId: patient.id,
    first_name: firstName,
    last_name: lastName,
    patientName: `${firstName} ${lastName}`.trim() || "Patient",
    scheduleMonthLabel: "No procedure scheduled",
    scheduleWeekLabel: "Awaiting date",
    scheduleWeekRange: "Procedure not scheduled",
    scheduleWeekOrder: Number.MAX_SAFE_INTEGER,
    scheduleDayLabel: "",
    scheduleProcedureDate: "",
    scheduleSortKey: Number.MAX_SAFE_INTEGER,
    searchFirst,
    searchLast,
    searchFull: `${searchFirst} ${searchLast}`.trim(),
    unscheduled: true,
  };
}

function buildWeeksForPatients(patients) {
  const weekMap = new Map();
  patients.forEach((patient) => {
    const key = `${patient.scheduleMonthLabel}-${patient.scheduleWeekLabel}`;
    if (!weekMap.has(key)) {
      weekMap.set(key, {
        label: patient.scheduleWeekLabel,
        range: patient.scheduleWeekRange,
        order: patient.scheduleWeekOrder,
        monthLabel: patient.scheduleMonthLabel,
        days: [],
      });
    }
    const entry = weekMap.get(key);
    entry.days.push({
      id: patient.id,
      patientId: patient.patientId ?? patient.id,
      procedureId: patient.procedureId ?? patient.id,
      day: patient.scheduleDayLabel,
      sortKey: patient.scheduleSortKey,
      procedureDate: patient.scheduleProcedureDate,
      patientName: `${patient.first_name} ${patient.last_name}`.trim(),
      firstName: patient.first_name,
      lastName: patient.last_name,
      status: patient.status,
      procedureType: patient.procedure_type,
      packageType: patient.package_type,
      grafts: patient.grafts,
      forms: patient.forms,
      consents: patient.consents,
      payment: patient.payment,
      photos: patient.photos,
      consultation: patient.consultation,
      weekLabel: patient.scheduleWeekLabel,
      weekRange: patient.scheduleWeekRange,
      monthLabel: patient.scheduleMonthLabel,
    });
  });

  return Array.from(weekMap.values())
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map((week) => {
      week.days.sort((a, b) => a.sortKey - b.sortKey);
      return week;
    });
}

function groupWeekDays(days) {
  if (!Array.isArray(days)) {
    return [];
  }
  const dayMap = new Map();
  days.forEach((day) => {
    const key = day.procedureDate || `no-date-${day.day}-${day.sortKey}`;
    if (!dayMap.has(key)) {
      dayMap.set(key, {
        dayLabel: day.day,
        procedureDate: day.procedureDate,
        sortKey: day.sortKey,
        entries: [],
      });
    }
    dayMap.get(key).entries.push(day);
  });
  return Array.from(dayMap.values()).sort((a, b) => a.sortKey - b.sortKey);
}

function formatPatientName(patient) {
  return `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim() || "Unnamed patient";
}

function stripDiacritics(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeSearchText(value) {
  const stringValue = (value ?? "").toString().trim().toLowerCase();
  return stripDiacritics(stringValue);
}

function filterPatientsByName(patients, query) {
  if (!Array.isArray(patients)) {
    return [];
  }
  const term = normalizeSearchText(query);
  if (!term) {
    return patients;
  }
  return patients.filter((patient) => {
    const first = patient.searchFirst ?? normalizeSearchText(patient.first_name);
    const last = patient.searchLast ?? normalizeSearchText(patient.last_name);
    const combined = patient.searchFull ?? `${first} ${last}`.trim();
    return first.includes(term) || last.includes(term) || combined.includes(term);
  });
}

function findActivePatientByContext() {
  if (!activePatientContext?.patientId || !Array.isArray(normalizedProcedures)) {
    return null;
  }
  return (
    normalizedProcedures.find((entry) => {
      const matchesPatient = entry.patientId === activePatientContext.patientId;
      const matchesProcedure = activePatientContext.procedureId
        ? entry.procedureId === activePatientContext.procedureId
        : true;
      return matchesPatient && matchesProcedure;
    }) ?? null
  );
}

function clearSearchResults() {
  if (searchResultsEl) {
    searchResultsEl.innerHTML = "";
  }
}

function focusSelectedMonthForPatients(patients) {
  if (!patients?.length) {
    return;
  }
  const [firstMatch] = patients;
  const monthMeta = parseMonthMetadata(firstMatch.scheduleMonthLabel);
  if (monthMeta?.date) {
    selectedDate = new Date(monthMeta.date.getFullYear(), monthMeta.date.getMonth(), 1);
    return;
  }
  const procedureDate = parseISODate(firstMatch.scheduleProcedureDate);
  if (procedureDate) {
    selectedDate = new Date(procedureDate.getFullYear(), procedureDate.getMonth(), 1);
  }
}

function setSearchClearState(isActive) {
  if (searchClearBtn) {
    searchClearBtn.hidden = !isActive;
  }
}

function getPatientSearchNames(patient) {
  const first = patient.searchFirst ?? normalizeSearchText(patient.first_name);
  const last = patient.searchLast ?? normalizeSearchText(patient.last_name);
  return {
    first,
    last,
    full: `${first} ${last}`.trim(),
  };
}

function computeSearchScore(patient, normalizedTerm, parts) {
  if (!normalizedTerm) {
    return patient.unscheduled ? 1 : 0;
  }
  const { first, last, full } = getPatientSearchNames(patient);
  if (full === normalizedTerm) return -5;
  if (parts.length >= 2 && first === parts[0] && last === parts[parts.length - 1]) return -4;
  if (first === normalizedTerm || last === normalizedTerm) return -3;
  if (full.startsWith(normalizedTerm)) return -2;
  if (first.startsWith(parts[0] ?? normalizedTerm) || last.startsWith(parts[0] ?? normalizedTerm)) return -1;
  if (full.includes(normalizedTerm)) return 0;
  return patient.unscheduled ? 1 : 0.5;
}

function sortSearchMatches(matches, query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return matches;
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  return [...matches]
    .map((patient) => ({
      patient,
      score: computeSearchScore(patient, normalized, parts),
    }))
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.patient);
}

function getSearchResultIdentifier(patient) {
  const candidate = Number(patient.patientId ?? patient.id);
  if (Number.isFinite(candidate)) {
    return `patient-${candidate}`;
  }
  if (patient.patientId || patient.id) {
    return `patient-${patient.patientId || patient.id}`;
  }
  return null;
}

function renderSearchResults(matches, query = "") {
  if (!searchResultsEl) {
    return;
  }
  searchResultsEl.innerHTML = "";
  const sortedMatches = sortSearchMatches(matches, query);
  const seenPatients = new Set();
  const uniqueMatches = [];
  sortedMatches.forEach((patient) => {
    const identifier = getSearchResultIdentifier(patient);
    if (identifier && seenPatients.has(identifier)) {
      return;
    }
    if (identifier) {
      seenPatients.add(identifier);
    }
    uniqueMatches.push(patient);
  });
  uniqueMatches.slice(0, 8).forEach((patient) => {
    const item = document.createElement("li");
    item.className = "patient-search__result";
    if (patient.unscheduled) {
      item.classList.add("patient-search__result--unscheduled");
    }
    item.dataset.patientId = String(patient.id);
    item.dataset.unscheduled = patient.unscheduled ? "true" : "false";
    item.setAttribute("role", "option");
    item.tabIndex = 0;
    const name = document.createElement("span");
    name.className = "patient-search__result-name";
    name.textContent = formatPatientName(patient);
    const meta = document.createElement("span");
    meta.className = "patient-search__result-meta";
    meta.textContent = patient.unscheduled
      ? "No procedure scheduled"
      : patient.scheduleMonthLabel;
    item.append(name, meta);
    item.addEventListener("click", () => handleSearchSelection(Number(patient.id)));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleSearchSelection(Number(patient.id));
      }
    });
    searchResultsEl.appendChild(item);
  });
}

function applySearchFilter(query) {
  searchQuery = query.trim();
  if (!searchQuery) {
    filteredMonthlySchedules = monthlySchedules;
    setSearchClearState(false);
    renderSelectedMonth();
    clearSearchResults();
    return;
  }
  const filteredPatients = filterPatientsByName(normalizedProcedures, searchQuery);
  filteredMonthlySchedules = buildMonthlySchedules(filteredPatients, { skipNormalize: true });
  if (filteredPatients.length) {
    focusSelectedMonthForPatients(filteredPatients);
    setSearchClearState(true);
    clearSearchResults();
    renderSelectedMonth();
    return;
  }
  setSearchClearState(true);
  renderSelectedMonth();
  const unscheduledMatches = filterPatientsByName(unscheduledPatients, searchQuery);
  if (unscheduledMatches.length) {
    renderSearchResults(unscheduledMatches, searchQuery);
    return;
  }
  clearSearchResults();
}

function resetSearch() {
  searchQuery = "";
  filteredMonthlySchedules = monthlySchedules;
  if (searchInput) {
    searchInput.value = "";
  }
  setSearchClearState(false);
  clearSearchResults();
  renderSelectedMonth();
}

function handleSearchInput(event) {
  const value = event.target.value || "";
  if (!value.trim()) {
    resetSearch();
    return;
  }
  setSearchClearState(true);
  const matches = filterPatientsByName(searchablePatients, value);
  renderSearchResults(matches, value);
}

function handleSearchSubmit(event) {
  event.preventDefault();
  const query = searchInput?.value ?? "";
  if (!query.trim()) {
    resetSearch();
    return;
  }
  applySearchFilter(query);
}

function openPatientRecord(patient) {
  if (!patient) {
    return;
  }
  const identifier = patient.patientId ?? patient.id;
  const options = {
    patientName: formatPatientName(patient),
  };
  if (patient.procedureId && !patient.unscheduled) {
    options.procedureId = patient.procedureId;
  }
  navigateToPatientRecord(identifier, options);
}

function handleSearchSelection(patientId) {
  if (!Number.isFinite(patientId)) {
    return;
  }
  const match = searchablePatients.find((patient) => patient.id === patientId);
  if (!match) {
    return;
  }
  const displayName = formatPatientName(match);
  if (searchInput) {
    searchInput.value = displayName;
  }
  if (match.unscheduled) {
    clearSearchResults();
    openPatientRecord(match);
    return;
  }
  applySearchFilter(displayName);
  clearSearchResults();
}

function buildMonthlySchedules(patients, { skipNormalize = false } = {}) {
  const normalized = skipNormalize ? patients : patients.map(normalizeProcedureForSchedule);
  const monthGroups = new Map();
  normalized.forEach((patient) => {
    if (!monthGroups.has(patient.scheduleMonthLabel)) {
      monthGroups.set(patient.scheduleMonthLabel, []);
    }
    monthGroups.get(patient.scheduleMonthLabel).push(patient);
  });

  return Array.from(monthGroups.entries())
    .map(([label, entries]) => {
      const metadata = parseMonthMetadata(label);
      return {
        label,
        weeks: buildWeeksForPatients(entries),
        ...metadata,
      };
    })
    .sort((a, b) => (a.timestamp ?? Number.MAX_SAFE_INTEGER) - (b.timestamp ?? Number.MAX_SAFE_INTEGER));
}

function rebuildScheduleCollections() {
  const patientLookup = new Map();
  patientRecords.forEach((patient) => {
    patientLookup.set(Number(patient.id), patient);
  });
  normalizedProcedures = procedureRecords.map((procedure) =>
    normalizeProcedureForSchedule(procedure, patientLookup)
  );
  monthlySchedules = buildMonthlySchedules(normalizedProcedures, { skipNormalize: true });
  const scheduledIds = new Set(
    normalizedProcedures
      .map((entry) => (Number.isFinite(Number(entry.patientId)) ? Number(entry.patientId) : null))
      .filter((value) => value !== null)
  );
  unscheduledPatients = patientRecords
    .filter((patient) => !scheduledIds.has(Number(patient.id)))
    .map((patient) => buildUnscheduledSearchEntry(patient));
  searchablePatients = [...normalizedProcedures, ...unscheduledPatients];
  updateTotalPatients(normalizedProcedures.length);
}

function ensureSelectedMonthHasEntries(sourceSchedules = monthlySchedules) {
  if (!Array.isArray(sourceSchedules) || !sourceSchedules.length) {
    return null;
  }
  const selectedLabel = formatMonthLabelFromDate(selectedDate);
  const existing = sourceSchedules.find((month) => month.label === selectedLabel);
  if (existing) {
    return existing;
  }
  const fallback = sourceSchedules[0];
  if (fallback?.date instanceof Date && !Number.isNaN(fallback.date.getTime())) {
    selectedDate = new Date(fallback.date.getFullYear(), fallback.date.getMonth(), 1);
    return fallback;
  }
  const meta = parseMonthMetadata(fallback.label);
  if (meta?.date) {
    selectedDate = new Date(meta.date.getFullYear(), meta.date.getMonth(), 1);
  }
  return fallback;
}

function refreshScheduleView({ preserveSearch = false, preserveSelections = false } = {}) {
  rebuildScheduleCollections();
  ensureSelectedMonthHasEntries();
  shouldPreserveSelections = preserveSelections;
  if (preserveSearch && searchQuery) {
    applySearchFilter(searchQuery);
  } else {
    filteredMonthlySchedules = monthlySchedules;
    renderSelectedMonth();
  }
}

function upsertPatientRecord(record) {
  if (!record || typeof record !== "object") {
    return;
  }
  const id = Number(record.id);
  if (!Number.isFinite(id)) {
    return;
  }
  const index = patientRecords.findIndex((patient) => Number(patient.id) === id);
  if (index >= 0) {
    patientRecords[index] = { ...patientRecords[index], ...record };
  } else {
    patientRecords.push(record);
  }
}

function removePatientRecordById(patientId) {
  const normalizedId = Number(patientId);
  patientRecords = patientRecords.filter((patient) => Number(patient.id) !== normalizedId);
}

function upsertProcedureRecord(record) {
  if (!record || typeof record !== "object") {
    return;
  }
  const id = Number(record.id);
  if (!Number.isFinite(id)) {
    return;
  }
  const index = procedureRecords.findIndex((procedure) => Number(procedure.id) === id);
  if (index >= 0) {
    procedureRecords[index] = { ...procedureRecords[index], ...record };
  } else {
    procedureRecords.push(record);
  }
}

function removeProcedureRecordById(procedureId) {
  const normalizedId = Number(procedureId);
  procedureRecords = procedureRecords.filter((procedure) => Number(procedure.id) !== normalizedId);
}

function summarizeChecklist(field, values) {
  const optionValues = new Set(getFieldOptionValues(field));
  const selectedValues = new Set(Array.isArray(values) ? values : []);
  const selectedCount = Array.from(selectedValues).filter((value) => optionValues.has(value)).length;
  return { selected: selectedCount, total: optionValues.size };
}

function formatChecklistCount(field, values) {
  const { selected, total } = summarizeChecklist(field, values);
  return `${selected}/${total || 0}`;
}

function createCheckCell(value, label, countText = "") {
  const cell = document.createElement("td");
  cell.classList.add("col-check");
  cell.dataset.label = label;

  const content = document.createElement("span");
  content.className = "check-cell";

  const icon = document.createElement("span");
  icon.className = `check-icon ${value ? "check-icon--checked" : "check-icon--error"}`;
  icon.textContent = CHECKED_ICON[value];
  icon.setAttribute(
    "aria-label",
    `${label} ${value ? "complete" : "missing"}${countText ? ` (${countText})` : ""}`
  );

  content.appendChild(icon);
  if (countText) {
    const count = document.createElement("span");
    count.className = "check-count";
    count.textContent = countText;
    content.appendChild(count);
  }
  cell.appendChild(content);
  return cell;
}

function formatPhotos(value) {
  return value > 0 ? String(value) : "None";
}

function resolvePackageLabel(packageValue, procedureType) {
  return (
    getOptionLabel("package_type", packageValue) ||
    packageValue ||
    getOptionLabel("procedure_type", procedureType) ||
    procedureType ||
    ""
  );
}

function createPackagePill(label) {
  if (!label) {
    return null;
  }
  const pill = document.createElement("span");
  pill.className = "package-pill";
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("small")) {
    pill.classList.add("package-pill--small");
  } else if (normalized.includes("big")) {
    pill.classList.add("package-pill--big");
  }
  pill.textContent = label;
  return pill;
}

function buildMobilePatientCard(day, week, { expandInitially = false } = {}) {
  const card = document.createElement("article");
  card.className = "patient-card-mobile";
  card.tabIndex = 0;
  card.dataset.patient = day.patientName;
  card.dataset.patientId = String(day.patientId ?? day.id);
  if (day.procedureId) {
    card.dataset.procedureId = String(day.procedureId);
  }
  card.setAttribute("aria-label", `Open patient record for ${day.patientName}`);

  const header = document.createElement("button");
  header.type = "button";
  header.className = "patient-card-mobile__header";
  header.setAttribute("aria-expanded", expandInitially ? "true" : "false");

  const info = document.createElement("div");
  info.className = "patient-card-mobile__info";
  const name = document.createElement("span");
  name.className = "patient-card-mobile__name";
  name.textContent = day.patientName || "Patient";
  const badges = document.createElement("div");
  badges.className = "patient-card-mobile__badges";
  const procedureLabel = getOptionLabel("procedure_type", day.procedureType) || day.procedureType || "—";
  const procedurePill = createPackagePill(procedureLabel);
  if (procedurePill) {
    procedurePill.classList.add("pill--neutral");
    badges.appendChild(procedurePill);
  }
  const statusText = getOptionLabel("status", day.status) || day.status || "—";
  const statusBadge = document.createElement("span");
  statusBadge.className = `status-badge ${getStatusClass(day.status)}`;
  statusBadge.textContent = statusText;
  badges.appendChild(statusBadge);
  info.append(name, badges);

  const chevronIcon = document.createElement("span");
  chevronIcon.className = "patient-card-mobile__chevron-icon";
  header.append(info, chevronIcon);

  const details = document.createElement("div");
  details.className = "patient-card-mobile__details";
  details.hidden = !expandInitially;

  const addDetail = (label, value) => {
    const row = document.createElement("div");
    row.className = "patient-card-mobile__detail-row";
    const labelEl = document.createElement("span");
    labelEl.className = "patient-card-mobile__detail-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "patient-card-mobile__detail-value";
    valueEl.textContent = value || "—";
    row.append(labelEl, valueEl);
    details.appendChild(row);
  };

  addDetail("Date", formatDayDateHeading(day.procedureDate, day.day || "Day"));
  addDetail("Package", resolvePackageLabel(day.packageType, day.procedureType) || "—");
  addDetail("Grafts", day.grafts || "—");
  addDetail("Forms", formatChecklistCount("forms", day.forms));
  addDetail("Consents", formatChecklistCount("consents", day.consents));
  addDetail("Consulted", formatChecklistCount("consultation", day.consultation));
  addDetail("Payment", getOptionLabel("payment", day.payment) || day.payment || "—");
  addDetail("Photos", formatPhotos(day.photos));

  const footer = document.createElement("div");
  footer.className = "patient-card-mobile__footer";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "patient-card-mobile__open";
  openBtn.textContent = "Open record";
  footer.appendChild(openBtn);

  card.append(header, details, footer);

  const setExpanded = (expanded) => {
    header.setAttribute("aria-expanded", expanded ? "true" : "false");
    details.hidden = !expanded;
    card.classList.toggle("patient-card-mobile--collapsed", !expanded);
  };
  setExpanded(Boolean(expandInitially));

  const toggle = () => {
    const expanded = header.getAttribute("aria-expanded") === "true";
    setExpanded(!expanded);
  };

  header.addEventListener("click", (event) => {
    event.stopPropagation();
    toggle();
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });

  const navigate = () => handleRowNavigation(day, week);
  openBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    navigate();
  });

  return card;
}

function formatMonthLabelFromDate(date) {
  return MONTH_FORMATTER.format(new Date(date.getFullYear(), date.getMonth(), 1));
}

function formatMonthQueryParam(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDayDateHeading(procedureDate, fallbackDayLabel) {
  const date = procedureDate ? new Date(procedureDate) : null;
  if (date && !Number.isNaN(date.getTime())) {
    const dayName = DAY_NAME_FORMATTER.format(date);
    const monthName = date.toLocaleString("en-US", { month: "short", timeZone: APP_TIMEZONE });
    const dayNumber = date.getDate();
    return `${dayNumber} ${monthName}, ${dayName}`;
  }
  return fallbackDayLabel || "Day";
}

function parseISODate(value) {
  if (!value) return null;
  const text = String(value);
  const datePart = text.includes("T") ? text.split("T")[0] : text.split(" ")[0] || text;
  const date = new Date(`${datePart}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekMetaForDate(date) {
  const day = date.getDate();
  const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1).getDay(); // 0=Sun
  const mondayAlignedOffset = (firstDayOfMonth + 6) % 7; // shift so Monday is week start
  const weekIndex = Math.floor((mondayAlignedOffset + day - 1) / 7) + 1;

  const weekdayMondayFirst = (date.getDay() + 6) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - weekdayMondayFirst);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const monthStartShort = weekStart.toLocaleString("en-US", { month: "short", timeZone: APP_TIMEZONE });
  const monthEndShort = weekEnd.toLocaleString("en-US", { month: "short", timeZone: APP_TIMEZONE });
  return {
    label: `Week ${weekIndex}`,
    range: `${monthStartShort} ${weekStart.getDate()} – ${monthEndShort} ${weekEnd.getDate()}`,
    order: weekIndex,
  };
}

function updateControlState() {
  if (todayButton) {
    todayButton.disabled = false;
  }
}

function updateTotalPatients(total) {
  if (totalPatientCount) {
    totalPatientCount.textContent = String(total);
  }
}

function updateMonthPatientCount(total) {
  if (monthPatientCount) {
    monthPatientCount.textContent = `${total} procedure${total === 1 ? "" : "s"}`;
  }
  const calendarMonthPatients = document.getElementById("calendar-month-patients");
  if (calendarMonthPatients) {
    calendarMonthPatients.textContent = `${total} procedure${total === 1 ? "" : "s"}`;
  }
}

function updateMonthPickerSelection(monthIndex) {
  if (!monthPickerGrid) return;
  monthPickerGrid.querySelectorAll("[data-month-index]").forEach((button) => {
    const isActive = Number(button.dataset.monthIndex) === monthIndex;
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

function openMonthPicker() {
  if (!monthPicker) return;
  monthPicker.hidden = false;
  if (monthDisplay) {
    monthDisplay.setAttribute("aria-expanded", "true");
  }
  updateMonthPickerSelection(selectedDate.getMonth());
  const activeButton = monthPickerGrid?.querySelector(".is-active");
  activeButton?.focus();
}

function closeMonthPicker() {
  if (!monthPicker) return;
  monthPicker.hidden = true;
  if (monthDisplay) {
    monthDisplay.setAttribute("aria-expanded", "false");
    monthDisplay.focus();
  }
}

function toggleMonthPicker() {
  if (!monthPicker) return;
  const isHidden = monthPicker.hidden;
  if (isHidden) {
    openMonthPicker();
  } else {
    closeMonthPicker();
  }
}

function renderSelectedMonth() {
  if (isAdminUser && !shouldPreserveSelections) {
    selectedProcedureIds.clear();
  }
  const sourceSchedules = searchQuery ? filteredMonthlySchedules : monthlySchedules;
  const selectedLabel = formatMonthLabelFromDate(selectedDate);
  if (monthDisplay) {
    monthDisplay.textContent = selectedLabel;
  }
  updateMonthPickerSelection(selectedDate.getMonth());
  const currentMonth = sourceSchedules.find((month) => month.label === selectedLabel);

  scheduleEl.innerHTML = "";
  if (!currentMonth?.weeks?.length) {
    if (searchQuery) {
      const hasAnyMatches = filteredMonthlySchedules.some((month) => month.weeks?.length);
      let message = hasAnyMatches
        ? `No procedures matching "${searchQuery}" in ${selectedLabel}.`
        : `No procedures found matching "${searchQuery}".`;
      if (!hasAnyMatches) {
        const unscheduledMatches = filterPatientsByName(unscheduledPatients, searchQuery);
        if (unscheduledMatches.length) {
          const noun = unscheduledMatches.length === 1 ? "patient" : "patients";
          message = `No scheduled procedures matching "${searchQuery}". Select the ${noun} shown above to open the record.`;
        }
      }
      setScheduleStatus(message);
      const matchingWeeks = filteredMonthlySchedules.reduce(
        (total, month) => total + (month.weeks?.length ?? 0),
        0
      );
      if (weekCount) {
        weekCount.textContent = matchingWeeks
          ? `${matchingWeeks} matching week${matchingWeeks === 1 ? "" : "s"}`
          : "0 matches";
      }
    } else {
      setScheduleStatus(`No procedures scheduled for ${selectedLabel}.`);
      if (weekCount) {
        weekCount.textContent = "0 weeks scheduled";
      }
    }
    updateMonthPatientCount(0);
  } else {
    currentMonth.weeks.forEach(renderWeek);
    if (weekCount) {
      weekCount.textContent = `${currentMonth.weeks.length} ${searchQuery ? "matching week" : "week"}${
        currentMonth.weeks.length === 1 ? "" : "s"
      }`;
    }
    const monthPatientTotal = currentMonth.weeks.reduce(
      (total, week) => total + (week.days?.length ?? 0),
      0
    );
    updateMonthPatientCount(monthPatientTotal);
  }
  updateMonthQueryParam(selectedDate);
  updateControlState();
  updateSelectionControlsState();
  shouldPreserveSelections = false;
}

function queryPatientElementsByProcedure(procedureId) {
  if (!Number.isFinite(procedureId)) {
    return [];
  }
  const selector = `.patient-row[data-procedure-id="${procedureId}"], .patient-card-mobile[data-procedure-id="${procedureId}"]`;
  return Array.from(document.querySelectorAll(selector));
}

function queryPatientElementsByContext(patientId, procedureId) {
  if (!Number.isFinite(patientId)) {
    return [];
  }
  const selectors = [];
  if (Number.isFinite(procedureId)) {
    selectors.push(
      `.patient-row[data-patient-id="${patientId}"][data-procedure-id="${procedureId}"]`,
      `.patient-card-mobile[data-patient-id="${patientId}"][data-procedure-id="${procedureId}"]`
    );
  } else {
    selectors.push(
      `.patient-row[data-patient-id="${patientId}"]`,
      `.patient-card-mobile[data-patient-id="${patientId}"]`
    );
  }
  return selectors.length ? Array.from(document.querySelectorAll(selectors.join(", "))) : [];
}

function highlightProcedureRow(procedureId) {
  if (!Number.isFinite(procedureId)) {
    return;
  }
  requestAnimationFrame(() => {
    const elements = queryPatientElementsByProcedure(procedureId);
    if (!elements.length) {
      return;
    }
    elements.forEach((element) => {
      element.classList.add("patient-row--pulse");
      setTimeout(() => {
        element.classList.remove("patient-row--pulse");
      }, 1800);
    });
  });
}

function highlightActivePatientRow() {
  if (!activePatientContext?.patientId || !activePatientContext.shouldReturnToSchedule) {
    return;
  }
  const elements = queryPatientElementsByContext(
    activePatientContext.patientId,
    activePatientContext.procedureId
  );
  if (!elements.length) {
    return;
  }
  elements.forEach((element) => element.classList.add("patient-row--active"));
  const [first] = elements;
  first.scrollIntoView({ behavior: "smooth", block: "center" });
  persistActivePatientContext({ ...activePatientContext, shouldReturnToSchedule: false });
}

function handlePrevMonth() {
  selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1);
  renderSelectedMonth();
}

function handleNextMonth() {
  selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);
  renderSelectedMonth();
}

function handleTodayClick() {
  const today = new Date();
  selectedDate = new Date(today.getFullYear(), today.getMonth(), 1);
  renderSelectedMonth();
}

function handleMonthSelect(event) {
  const button = event.target.closest("[data-month-index]");
  if (!button) return;
  const monthIndex = Number(button.dataset.monthIndex);
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return;
  }
  selectedDate = new Date(selectedDate.getFullYear(), monthIndex, 1);
  renderSelectedMonth();
  closeMonthPicker();
}

function handleMonthPickerKeydown(event) {
  if (event.key === "Escape" && monthPicker && monthPicker.hidden === false) {
    closeMonthPicker();
    monthDisplay?.focus();
  }
}

function buildDefaultPatientPayloads() {
  const defaultStatus = getDefaultFieldValue("status", "reserved");
  const defaultProcedure = getDefaultFieldValue("procedure_type", "sfue");
  const defaultPackageType = getDefaultFieldValue("package_type", "small");
  const defaultPayment = getDefaultFieldValue("payment", "waiting");
  const defaultAgency = getDefaultFieldValue("agency", "liv_hair");

  const patientPayload = {
    first_name: "New",
    last_name: "Patient",
    email: "test@example.com",
    phone: "+44 12345678",
    address: "London",
  };

  const procedurePayload = {
    procedure_date: formatLocalISODate(selectedDate),
    status: defaultStatus,
    procedure_type: defaultProcedure,
    package_type: defaultPackageType,
    grafts: 0,
    payment: defaultPayment,
    agency: defaultAgency,
    consultation: [],
    forms: [],
    consents: [],
    photos: 0,
    outstanding_balance: null,
    notes: [],
    preop_answers: {},
  };

  return { patientPayload, procedurePayload };
}

async function handleAddPatientClick() {
  if (!isAdminUser || isCreatingPatient) {
    return;
  }
  isCreatingPatient = true;
  if (addPatientBtn) {
    addPatientBtn.disabled = true;
    addPatientBtn.textContent = "Creating...";
  }
  try {
    const { patientPayload, procedurePayload } = buildDefaultPatientPayloads();
    const patientResponse = await fetch(buildApiUrl("/patients"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patientPayload),
    });
    handleUnauthorized(patientResponse);
    if (!patientResponse.ok) {
      throw new Error(`Failed to create patient (${patientResponse.status})`);
    }
    const patientResult = await patientResponse.json();
    const newPatientId = patientResult?.id;
    if (!newPatientId) {
      throw new Error("Missing patient id in response");
    }
    const patient = await fetchPatientById(newPatientId);
    const procedureResponse = await fetch(buildApiUrl("/procedures"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...procedurePayload, patient_id: newPatientId }),
    });
    handleUnauthorized(procedureResponse);
    if (!procedureResponse.ok) {
      throw new Error(`Failed to create procedure (${procedureResponse.status})`);
    }
    const procedureResult = await procedureResponse.json();
    const procedureId = procedureResult?.id;
    if (!procedureId) {
      throw new Error("Missing procedure id in response");
    }
    const procedure = await fetchProcedureById(procedureId);
    const contextMeta = buildScheduleMetadataFromDate(
      procedure?.procedure_date ?? procedurePayload.procedure_date,
      { procedureDate: procedure?.procedure_date ?? procedurePayload.procedure_date }
    );
    const normalizedProcedureDate =
      contextMeta.normalizedDate || procedure?.procedure_date || procedurePayload.procedure_date;
    persistActivePatientContext({
      patientId: patient.id,
      patient: `${patient.first_name} ${patient.last_name}`.trim(),
      weekLabel: contextMeta.weekLabel,
      weekRange: contextMeta.weekRange || contextMeta.monthLabel,
      day: contextMeta.dayLabel,
      monthLabel: contextMeta.monthLabel,
      procedureDate: normalizedProcedureDate,
      procedureId: procedure?.id,
      capturedAt: new Date().toISOString(),
    });
    const params = new URLSearchParams({
      id: String(patient.id),
      patient: `${patient.first_name} ${patient.last_name}`.trim(),
    });
    if (procedure?.id) {
      params.set("procedure", String(procedure.id));
    }
    navigateToPatientRecord(patient.id, {
      patientName: `${patient.first_name} ${patient.last_name}`.trim(),
      procedureId: procedure?.id,
    });
  } catch (error) {
    console.error(error);
    if (addPatientBtn) {
      addPatientBtn.disabled = false;
      addPatientBtn.textContent = "Add Patient";
    }
    isCreatingPatient = false;
    alert(error.message);
  }
}

function handleRowNavigation(day, week) {
  const payload = {
    patientId: day.patientId ?? day.id,
    procedureId: day.procedureId ?? null,
    patient: day.patientName,
    weekLabel: week.label,
    weekRange: week.range,
    day: day.day,
    monthLabel: day.monthLabel ?? week.monthLabel,
    procedureDate: day.procedureDate,
    capturedAt: new Date().toISOString(),
  };
  persistActivePatientContext(payload);
  navigateToPatientRecord(payload.patientId, {
    patientName: day.patientName,
    procedureId: payload.procedureId,
  });
}

function handleRowSelectionChange(procedureId, checked) {
  if (!isAdminUser || !Number.isFinite(procedureId) || !selectAllCheckbox) {
    return;
  }
  if (checked) {
    selectedProcedureIds.add(procedureId);
  } else {
    selectedProcedureIds.delete(procedureId);
  }
  updateSelectionControlsState();
}

function updateSelectionControlsState() {
  if (!isAdminUser || (!selectAllCheckbox && !deleteSelectedBtn)) {
    return;
  }
  const hasSelection = selectedProcedureIds.size > 0;
  if (deleteSelectedBtn) {
    deleteSelectedBtn.hidden = !hasSelection;
    deleteSelectedBtn.disabled = !hasSelection;
  }
  if (!selectAllCheckbox) {
    return;
  }
  const checkboxes = document.querySelectorAll(".patient-select");
  const totalCheckboxes = checkboxes.length;
  if (!totalCheckboxes) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    selectAllCheckbox.disabled = true;
    return;
  }
  selectAllCheckbox.disabled = false;
  let checkedCount = 0;
  checkboxes.forEach((checkbox) => {
    if (checkbox.checked) {
      checkedCount += 1;
    }
  });
  selectAllCheckbox.checked = checkedCount === totalCheckboxes;
  selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < totalCheckboxes;
}

function handleSelectAllToggle(event) {
  if (!isAdminUser) {
    event.target.checked = false;
    event.target.indeterminate = false;
    return;
  }
  const shouldSelect = event.target.checked;
  const checkboxes = document.querySelectorAll(".patient-select");
  checkboxes.forEach((checkbox) => {
    checkbox.checked = shouldSelect;
    const procedureId = Number(checkbox.dataset.procedureId);
    if (!Number.isFinite(procedureId)) {
      return;
    }
    if (shouldSelect) {
      selectedProcedureIds.add(procedureId);
    } else {
      selectedProcedureIds.delete(procedureId);
    }
  });
  updateSelectionControlsState();
}

async function handleDeleteSelected() {
  if (!isAdminUser || !selectedProcedureIds.size) {
    return;
  }
  const count = selectedProcedureIds.size;
  const confirmation = window.confirm(`Cancel ${count} selected procedure${count === 1 ? "" : "s"}?`);
  if (!confirmation) {
    return;
  }
  if (deleteSelectedBtn) {
    deleteSelectedBtn.disabled = true;
    deleteSelectedBtn.textContent = "Removing...";
  }
  try {
    for (const procedureId of selectedProcedureIds) {
      const response = await fetch(buildApiUrl(`/procedures/${procedureId}`), {
        method: "DELETE",
      });
      handleUnauthorized(response);
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Failed to cancel selected procedures.");
      }
    }
    selectedProcedureIds.clear();
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }
    await initializeSchedule();
  } catch (error) {
    console.error(error);
    alert(error.message || "Unable to cancel selected procedures.");
  } finally {
    if (deleteSelectedBtn) {
      deleteSelectedBtn.textContent = "Cancel selected";
      deleteSelectedBtn.disabled = false;
    }
    updateSelectionControlsState();
  }
}

function renderWeek(week) {
  const clone = weekTemplate.content.cloneNode(true);
  const badgeEls = clone.querySelectorAll("[data-week-badge]");
  badgeEls.forEach((badgeEl) => {
    badgeEl.textContent = week.label;
  });
  const countEls = clone.querySelectorAll("[data-week-count]");
  countEls.forEach((countEl) => {
    const totalProcedures = week.days?.length ?? 0;
    countEl.textContent = `${totalProcedures} ${
      totalProcedures === 1 ? "Procedure" : "Procedures"
    }`;
  });
  const table = clone.querySelector(".week__table");
  const existingTbody = table.querySelector("tbody");
  if (existingTbody) {
    existingTbody.remove();
  }
  const accordionBody = clone.querySelector("[data-week-mobile-body]");
  const mobileContainer = accordionBody?.querySelector("[data-week-mobile]") ?? null;
  if (mobileContainer) {
    mobileContainer.innerHTML = "";
  }
  const accordionHeader = clone.querySelector("[data-week-accordion-header]");
  if (accordionHeader && accordionBody) {
    accordionBody.hidden = false;
  }
  const selectHeaderCell = clone.querySelector("[data-select-header]");
  const canSelectRows = isAdminUser && Boolean(selectAllCheckbox);
  if (selectHeaderCell) {
    selectHeaderCell.hidden = !canSelectRows;
  }

  const dayGroups = groupWeekDays(week.days);

  dayGroups.forEach((group) => {
    const groupBody = document.createElement("tbody");
    groupBody.className = "day-group";
    const isGroupedDay = group.entries.length > 1;
    const headerRow = document.createElement("tr");
    headerRow.className = "day-group__header";
    const headerCell = document.createElement("td");
    headerCell.colSpan = canSelectRows ? 12 : 11;
    headerCell.textContent = formatDayDateHeading(group.procedureDate, group.dayLabel);
    headerRow.appendChild(headerCell);
    groupBody.appendChild(headerRow);
    let mobileGroup = null;
    let mobileCardsWrapper = null;
    if (mobileContainer) {
      mobileGroup = document.createElement("section");
      mobileGroup.className = "week-mobile-group";
      const mobileHeader = document.createElement("header");
      mobileHeader.className = "week-mobile-group__header";
      mobileHeader.textContent = formatDayDateHeading(group.procedureDate, group.dayLabel);
      mobileCardsWrapper = document.createElement("div");
      mobileCardsWrapper.className = "week-mobile-group__cards";
      mobileGroup.append(mobileHeader, mobileCardsWrapper);
    }

    group.entries.forEach((day, index) => {
      const row = document.createElement("tr");
      row.classList.add("patient-row");
      row.tabIndex = 0;
      row.dataset.patient = day.patientName;
      row.dataset.patientId = String(day.patientId ?? day.id);
      if (day.procedureId) {
        row.dataset.procedureId = String(day.procedureId);
      }
      row.setAttribute("aria-label", `Open patient record for ${day.patientName}`);

      const cells = [];
      const procedureIdValue = Number(day.procedureId ?? day.id);
      if (isGroupedDay && index === 0) {
        const spacerDayCell = document.createElement("td");
        spacerDayCell.classList.add("col-day", "col-day--spacer");
        spacerDayCell.dataset.label = "";
        spacerDayCell.setAttribute("aria-hidden", "true");
        spacerDayCell.rowSpan = group.entries.length;

        const spacerDateCell = document.createElement("td");
        spacerDateCell.classList.add("col-date", "col-date--spacer");
        spacerDateCell.dataset.label = "";
        spacerDateCell.setAttribute("aria-hidden", "true");
        spacerDateCell.rowSpan = group.entries.length;

        cells.push(spacerDayCell, spacerDateCell);
      }
      if (canSelectRows) {
        const selectCell = document.createElement("td");
        selectCell.classList.add("col-select");
        selectCell.dataset.label = "Select";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "patient-select";
        checkbox.dataset.procedureId = String(day.procedureId ?? day.id);
        checkbox.checked = selectedProcedureIds.has(procedureIdValue);
        checkbox.setAttribute("aria-label", `Select ${day.patientName}`);
        checkbox.addEventListener("click", (event) => event.stopPropagation());
        checkbox.addEventListener("change", (event) => {
          handleRowSelectionChange(procedureIdValue, event.target.checked);
        });
        selectCell.appendChild(checkbox);
        cells.push(selectCell);
      }

      if (!isGroupedDay && index === 0) {
        const dayCell = document.createElement("td");
        dayCell.textContent = "";
        dayCell.classList.add("col-day", "col-day--hidden");
        dayCell.dataset.label = "";
        dayCell.setAttribute("aria-hidden", "true");
        dayCell.rowSpan = group.entries.length;
        dayCell.colSpan = 2;

        cells.push(dayCell);
      }

      const patientCell = document.createElement("td");
      patientCell.classList.add("col-patient");
      if (isGroupedDay) {
        patientCell.colSpan = 1;
      }
      const patientName = document.createElement("span");
      patientName.textContent = day.patientName;
      patientName.className = "patient-name";
      const patientMeta = document.createElement("div");
      patientMeta.className = "patient-meta";
      const statusText = getOptionLabel("status", day.status) || day.status || "—";
      const statusBadge = document.createElement("span");
      statusBadge.textContent = statusText;
      statusBadge.className = `status-badge ${getStatusClass(day.status)}`;
      const inlineStatusBadge = statusBadge.cloneNode(true);
      inlineStatusBadge.classList.add("patient-meta__pill");
      patientMeta.appendChild(inlineStatusBadge);
      const packageLabel = resolvePackageLabel(day.packageType, day.procedureType);
      const desktopPackageBadge = packageLabel ? createPackagePill(packageLabel) : null;
      if (packageLabel) {
        const inlinePackageBadge = createPackagePill(packageLabel);
        inlinePackageBadge.classList.add("patient-meta__pill");
        patientMeta.appendChild(inlinePackageBadge);
      }
      const expandBtn = document.createElement("button");
      expandBtn.type = "button";
      expandBtn.className = "mobile-expand";
      expandBtn.setAttribute("aria-label", `Show details for ${day.patientName}`);
      expandBtn.setAttribute("aria-expanded", "false");
      const expandIcon = document.createElement("span");
      expandIcon.className = "mobile-expand__icon";
      expandBtn.appendChild(expandIcon);
      expandBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const isExpanded = row.classList.toggle("is-expanded");
        expandBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      });
      patientCell.append(patientName, patientMeta, expandBtn);

      const statusCell = document.createElement("td");
      statusCell.classList.add("col-status");
      statusCell.dataset.label = "Status";
      const statusContent = document.createElement("div");
      statusContent.className = "status-cell";
      statusContent.appendChild(statusBadge);
      if (desktopPackageBadge) {
        statusContent.appendChild(desktopPackageBadge);
      }
      statusCell.appendChild(statusContent);

      const procedureCell = document.createElement("td");
      procedureCell.textContent =
        getOptionLabel("procedure_type", day.procedureType) || day.procedureType || "—";
      procedureCell.classList.add("col-procedure");
      procedureCell.dataset.label = "Type";

      const graftsCell = document.createElement("td");
      graftsCell.textContent = day.grafts || "—";
      graftsCell.classList.add("col-grafts");
      graftsCell.dataset.label = "Grafts";

      const formsComplete = hasCompletedChecklist("forms", day.forms);
      const consentsComplete = hasCompletedChecklist("consents", day.consents);
      const consultationComplete = hasCompletedChecklist("consultation", day.consultation);
      const formsCell = createCheckCell(formsComplete, "Forms", formatChecklistCount("forms", day.forms));
      const consentsCell = createCheckCell(
        consentsComplete,
        "Consents",
        formatChecklistCount("consents", day.consents)
      );
      const consultationCell = createCheckCell(
        consultationComplete,
        "Consulted",
        formatChecklistCount("consultation", day.consultation)
      );
      consultationCell.classList.add("col-consult");

      const paymentCell = document.createElement("td");
      paymentCell.textContent = getOptionLabel("payment", day.payment) || day.payment;
      paymentCell.classList.add("col-payment");
      paymentCell.dataset.label = "Payment";

      const photosCell = document.createElement("td");
      photosCell.textContent = formatPhotos(day.photos);
      photosCell.classList.add("col-photos");
      photosCell.dataset.label = "Photos";

      const navigate = () => handleRowNavigation(day, week);
      row.addEventListener("click", navigate);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate();
        }
      });
      if (mobileCardsWrapper) {
        const isToday =
          typeof day.procedureDate === "string" &&
          formatLocalISODate(new Date()) === day.procedureDate.split("T")[0];
        const mobileCard = buildMobilePatientCard(day, week, { expandInitially: Boolean(isToday) });
        mobileCardsWrapper.appendChild(mobileCard);
      }

      cells.push(
        patientCell,
        statusCell,
        procedureCell,
        graftsCell,
        formsCell,
        consentsCell,
        consultationCell,
        paymentCell,
        photosCell
      );
      row.append(...cells);
      groupBody.appendChild(row);
    });

    table.appendChild(groupBody);
    if (mobileContainer && mobileGroup && mobileCardsWrapper && mobileCardsWrapper.children.length) {
      mobileContainer.appendChild(mobileGroup);
    }
  });

  const accordion = clone.querySelector("[data-week-accordion]");
  if (accordion && mobileContainer && !mobileContainer.children.length) {
    accordion.hidden = true;
  }

  scheduleEl.appendChild(clone);
}

if (monthPrevBtn) {
  monthPrevBtn.addEventListener("click", handlePrevMonth);
}
if (monthNextBtn) {
  monthNextBtn.addEventListener("click", handleNextMonth);
}
if (monthDisplay) {
  monthDisplay.addEventListener("click", toggleMonthPicker);
}
if (monthPickerGrid) {
  monthPickerGrid.addEventListener("click", handleMonthSelect);
}
if (monthPickerClose) {
  monthPickerClose.addEventListener("click", closeMonthPicker);
}
if (monthPicker) {
  monthPicker.addEventListener("click", (event) => {
    if (event.target === monthPicker) {
      closeMonthPicker();
    }
  });
}
window.addEventListener("keydown", handleMonthPickerKeydown);
if (todayButton) {
  todayButton.addEventListener("click", handleTodayClick);
}
if (addPatientBtn) {
  addPatientBtn.addEventListener("click", handleAddPatientClick);
}
if (selectAllCheckbox) {
  selectAllCheckbox.addEventListener("change", handleSelectAllToggle);
}
if (deleteSelectedBtn) {
  deleteSelectedBtn.addEventListener("click", handleDeleteSelected);
}
if (searchForm) {
  searchForm.addEventListener("submit", handleSearchSubmit);
}
if (searchInput) {
  searchInput.addEventListener("input", handleSearchInput);
  // Capture native search clear ("x") events to reset the list
  searchInput.addEventListener("search", handleSearchInput);
}
if (searchClearBtn) {
  searchClearBtn.addEventListener("click", resetSearch);
}
if (conflictRefreshBtn) {
  conflictRefreshBtn.addEventListener("click", () => {
    if (typeof conflictActionCallback === "function") {
      conflictActionCallback();
    }
  });
}
if (conflictDismissBtn) {
  conflictDismissBtn.addEventListener("click", hideConflictNotice);
}

function updateMonthQueryParam(date) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    params.set(MONTH_QUERY_PARAM, formatMonthQueryParam(date));
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState({}, "", newUrl);
  } catch (error) {
    console.warn("Unable to persist month in URL", error);
  }
}

async function initializeSchedule() {
  setScheduleStatus("Loading schedule...");
  const pendingGlobalSearch = consumeGlobalSearchQuery();
  activePatientContext = loadActivePatientContext();
  if (activePatientContext?.shouldReturnToSchedule) {
    const targetDate = getDateFromContext(activePatientContext);
    setSelectedDateFromTarget(targetDate);
  }
  try {
    if (!fieldOptionsLoaded) {
      await fetchFieldOptions();
      fieldOptionsLoaded = true;
    }
    const [patients, procedures] = await Promise.all([fetchPatients(), fetchProcedures()]);
    patientRecords = patients;
    procedureRecords = procedures;
    rebuildScheduleCollections();
    const activePatient = findActivePatientByContext();
    if (activePatientContext?.shouldReturnToSchedule) {
      if (activePatient) {
        const scheduleTargetDate =
          getDateFromContext(activePatientContext) ||
          getDateFromContext({
            monthLabel: activePatient.scheduleMonthLabel,
            procedureDate: activePatient.scheduleProcedureDate,
          });
        setSelectedDateFromTarget(scheduleTargetDate);
        focusSelectedMonthForPatients([activePatient]);
      } else {
        persistActivePatientContext({ ...activePatientContext, shouldReturnToSchedule: false });
      }
    }
    monthlySchedules = buildMonthlySchedules(normalizedProcedures, { skipNormalize: true });
    ensureSelectedMonthHasEntries();
    if (activePatientContext?.shouldReturnToSchedule) {
      const matchingMonth = monthlySchedules.find(
        (month) => month.label === activePatient?.scheduleMonthLabel
      );
      if (matchingMonth?.date) {
        setSelectedDateFromTarget(matchingMonth.date);
      }
    }
    if (pendingGlobalSearch) {
      if (searchInput) {
        searchInput.value = pendingGlobalSearch;
      }
      applySearchFilter(pendingGlobalSearch);
    } else {
      filteredMonthlySchedules = monthlySchedules;
      searchQuery = "";
      if (searchInput) {
        searchInput.value = "";
      }
      setSearchClearState(false);
      clearSearchResults();
      renderSelectedMonth();
    }
    highlightActivePatientRow();
  } catch (error) {
    console.error(error);
    setScheduleStatus("Unable to load the schedule. Please try again later.");
    if (weekCount) {
      weekCount.textContent = "";
    }
    if (monthDisplay) {
      monthDisplay.textContent = "Consultation Planner";
    }
    updateControlState();
  }
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
      renderActivityFeed();
    },
    onEvent: handleRealtimeEvent,
    onConnectionChange(state) {
      if (state === "live") {
        setActivityStatus("Live", "live");
      } else if (state === "connecting") {
        setActivityStatus("Connecting…", "offline");
      } else {
        setActivityStatus("Reconnecting…", "offline");
      }
    },
  });
}

function handleRealtimeEvent(payload) {
  if (!payload) {
    return;
  }
  addActivityEvent(payload);
  showActivityToast(payload.summary || "New activity received");
  if (payload.entity === "procedure") {
    handleProcedureRealtimeEvent(payload);
  } else if (payload.entity === "patient") {
    handlePatientRealtimeEvent(payload);
  }
}

async function handleProcedureRealtimeEvent(payload) {
  const dataId = payload?.data?.procedure_id ?? payload.entityId;
  const procedureId = Number(dataId);
  if (!Number.isFinite(procedureId)) {
    return;
  }
  const preserveSelections = isAdminUser && selectedProcedureIds.size > 0;
  const wasSelected = selectedProcedureIds.has(procedureId);
  if (payload.action === "deleted") {
    removeProcedureRecordById(procedureId);
    refreshScheduleView({ preserveSearch: true, preserveSelections });
    handleProcedureConflict(procedureId, payload.summary, { deleted: true, wasSelected });
    return;
  }
  try {
    await fetchAndStoreProcedure(procedureId);
    refreshScheduleView({ preserveSearch: true, preserveSelections });
    highlightProcedureRow(procedureId);
    handleProcedureConflict(procedureId, payload.summary, { wasSelected });
  } catch (error) {
    console.error("Unable to sync procedure", error);
  }
}

async function handlePatientRealtimeEvent(payload) {
  const dataId = payload?.data?.patient_id ?? payload.entityId;
  const patientId = Number(dataId);
  if (!Number.isFinite(patientId)) {
    return;
  }
  const preserveSelections = isAdminUser && selectedProcedureIds.size > 0;
  if (payload.action === "deleted") {
    removePatientRecordById(patientId);
    procedureRecords = procedureRecords.filter(
      (procedure) => Number(procedure.patient_id) !== patientId
    );
    refreshScheduleView({ preserveSearch: true, preserveSelections });
    return;
  }
  try {
    const patient = await fetchPatientById(patientId);
    upsertPatientRecord(patient);
    refreshScheduleView({ preserveSearch: true, preserveSelections });
  } catch (error) {
    console.error("Unable to sync patient", error);
  }
}

async function fetchAndStoreProcedure(procedureId) {
  const procedure = await fetchProcedureById(procedureId);
  upsertProcedureRecord(procedure);
  const patientId = Number(procedure.patient_id);
  if (Number.isFinite(patientId)) {
    const existing = patientRecords.find((patient) => Number(patient.id) === patientId);
    if (!existing) {
      const patient = await fetchPatientById(patientId);
      upsertPatientRecord(patient);
    }
  }
}

function handleProcedureConflict(procedureId, summary, { deleted = false, wasSelected = false } = {}) {
  const isSelected = wasSelected || selectedProcedureIds.has(procedureId);
  if (!isSelected) {
    return;
  }
  const message = deleted
    ? `${summary}. A selected procedure was removed elsewhere.`
    : `${summary}. A procedure you selected was updated elsewhere.`;
  const action = deleted
    ? () => {
        selectedProcedureIds.delete(procedureId);
        hideConflictNotice();
        refreshScheduleView({ preserveSearch: true, preserveSelections: true });
      }
    : async () => {
        hideConflictNotice();
        try {
          await fetchAndStoreProcedure(procedureId);
          refreshScheduleView({ preserveSearch: true, preserveSelections: true });
          highlightProcedureRow(procedureId);
        } catch (error) {
          console.error("Unable to refresh conflicting procedure", error);
        }
      };
  showConflictNotice(message, action);
const openChatbotBtn = document.getElementById("open-chatbot-btn");
const closeChatbotBtn = document.getElementById("close-chatbot-btn");
const chatbotPopup = document.getElementById("chatbot-popup");

function hideChatbotForNonAdmins() {
  if (!openChatbotBtn) return;
  const userIsAdmin = Boolean(currentUser?.is_admin);
  if (!userIsAdmin) {
    openChatbotBtn.remove();
    if (chatbotPopup) chatbotPopup.remove();
  }
}

if (openChatbotBtn && closeChatbotBtn && chatbotPopup) {
    openChatbotBtn.addEventListener("click", () => {
        chatbotPopup.hidden = false;
    });

    closeChatbotBtn.addEventListener("click", () => {
        chatbotPopup.hidden = true;
    });
}
}
