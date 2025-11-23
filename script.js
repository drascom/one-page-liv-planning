import { fetchCurrentUser, handleUnauthorized, initSessionControls } from "./session.js";

const scheduleEl = document.getElementById("schedule");
const weekTemplate = document.getElementById("week-template");
const searchForm = document.getElementById("patient-search-form");
const searchInput = document.getElementById("patient-search");
const searchClearBtn = document.getElementById("patient-search-clear");
const searchResultsEl = document.getElementById("patient-search-results");

const DEFAULT_FIELD_OPTIONS = {
  status: [
    { value: "reserved", label: "Reserved" },
    { value: "confirmed", label: "Confirmed" },
    { value: "insurgery", label: "In Surgery" },
    { value: "done", label: "Done" },
  ],
  procedure_type: [
    { value: "small", label: "Small" },
    { value: "big", label: "Big" },
    { value: "beard", label: "Beard" },
    { value: "woman", label: "Woman" },
  ],
  payment: [
    { value: "waiting", label: "Waiting" },
    { value: "paid", label: "Paid" },
    { value: "partially_paid", label: "Partially Paid" },
  ],
  forms: [
    { value: "form1", label: "Form 1" },
    { value: "form2", label: "Form 2" },
    { value: "form3", label: "Form 3" },
    { value: "form4", label: "Form 4" },
    { value: "form5", label: "Form 5" },
  ],
  consents: [
    { value: "form1", label: "Consent 1" },
    { value: "form2", label: "Consent 2" },
    { value: "form3", label: "Consent 3" },
  ],
  consultation: [
    { value: "consultation1", label: "Consultation 1" },
    { value: "consultation2", label: "Consultation 2" },
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
  if (!value) {
    return "status-generic";
  }
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const defaults = {
    reserved: "status-reserved",
    confirmed: "status-confirmed",
    insurgery: "status-insurgery",
    done: "status-done",
  };
  if (defaults[value]) {
    return defaults[value];
  }
  if (!normalized) {
    return "status-generic";
  }
  return `status-generic status-${normalized}`;
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
const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const DAY_NAME_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "long" });

const monthLabel = document.getElementById("selected-month");
const weekCount = document.getElementById("week-count");
const monthPatientCount = document.getElementById("month-patient-count");
const totalPatientCount = document.getElementById("total-patient-count");
const monthPrevBtn = document.getElementById("month-prev");
const monthNextBtn = document.getElementById("month-next");
const yearSelect = document.getElementById("year-select");
const todayButton = document.getElementById("month-today");
const addPatientBtn = document.getElementById("add-patient-btn");
const settingsLink = document.querySelector("[data-admin-link]");
const adminTools = document.querySelector("[data-admin-tools]");
const selectAllCheckbox = document.getElementById("select-all-patients");
const deleteSelectedBtn = document.getElementById("delete-selected-btn");

initSessionControls();
let activePatientContext = loadActivePatientContext();
let isAdminUser = false;
const selectedProcedureIds = new Set();
let fieldOptionsLoaded = false;
let normalizedProcedures = [];
let filteredMonthlySchedules = [];
let searchQuery = "";

if (searchClearBtn) {
  searchClearBtn.hidden = true;
}

(async function bootstrap() {
  await initializeAdminControls();
  await initializeSchedule();
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

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

async function initializeAdminControls() {
  try {
    const user = await fetchCurrentUser();
    isAdminUser = Boolean(user?.is_admin);
  } catch (_error) {
    isAdminUser = false;
  }
  if (isAdminUser) {
    settingsLink?.removeAttribute("hidden");
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

function normalizeProcedureForSchedule(procedure, patientLookup = new Map()) {
  const lookupId = Number.isFinite(Number(procedure.patient_id)) ? Number(procedure.patient_id) : procedure.patient_id;
  const patient = patientLookup.get(lookupId) || procedure.patient || {};
  const firstName = patient.first_name || procedure.first_name || "";
  const lastName = patient.last_name || procedure.last_name || "";
  const patientId = patient.id ?? lookupId ?? null;
  const procedureId = procedure.id;
  const date = parseISODate(procedure.procedure_date);
  const scheduleMonthLabel = date ? formatMonthLabelFromDate(date) : procedure.month_label;
  const weekMeta = date ? getWeekMetaForDate(date) : null;
  const scheduleWeekLabel = weekMeta?.label ?? procedure.week_label ?? "Week 1";
  const scheduleWeekRange = weekMeta?.range ?? procedure.week_range ?? scheduleMonthLabel;
  const scheduleWeekOrder = weekMeta?.order ?? procedure.week_order ?? 1;
  const scheduleDayLabel = date ? DAY_FORMATTER.format(date) : procedure.day_label;
  const scheduleProcedureDate = date ? formatLocalISODate(date) : procedure.procedure_date;
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
    scheduleSortKey: date ? date.getTime() : procedure.day_order ?? 0,
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

function renderSearchResults(matches) {
  if (!searchResultsEl) {
    return;
  }
  searchResultsEl.innerHTML = "";
  matches.slice(0, 8).forEach((patient) => {
    const item = document.createElement("li");
    item.dataset.patientId = String(patient.id);
    item.setAttribute("role", "option");
    item.tabIndex = 0;
    const name = document.createElement("span");
    name.className = "patient-search__result-name";
    name.textContent = formatPatientName(patient);
    const meta = document.createElement("span");
    meta.className = "patient-search__result-meta";
    meta.textContent = patient.scheduleMonthLabel;
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
  }
  setSearchClearState(true);
  renderSelectedMonth();
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
  const matches = filterPatientsByName(normalizedProcedures, value);
  renderSearchResults(matches);
}

function handleSearchSubmit(event) {
  event.preventDefault();
  const query = searchInput?.value ?? "";
  if (!query.trim()) {
    resetSearch();
    return;
  }
  applySearchFilter(query);
  clearSearchResults();
}

function handleSearchSelection(patientId) {
  if (!Number.isFinite(patientId)) {
    return;
  }
  const match = normalizedProcedures.find((patient) => patient.id === patientId);
  if (!match) {
    return;
  }
  const displayName = formatPatientName(match);
  if (searchInput) {
    searchInput.value = displayName;
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

  const icon = document.createElement("span");
  icon.className = `check-icon ${value ? "check-icon--checked" : "check-icon--error"}`;
  icon.textContent = CHECKED_ICON[value];
  icon.setAttribute(
    "aria-label",
    `${label} ${value ? "complete" : "missing"}${countText ? ` (${countText})` : ""}`
  );

  cell.appendChild(icon);
  if (countText) {
    const count = document.createElement("span");
    count.className = "check-count";
    count.textContent = countText;
    cell.appendChild(count);
  }
  return cell;
}

function formatPhotos(value) {
  return value > 0 ? String(value) : "None";
}

function formatConsultation(value) {
  const list = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];
  if (!list.length) {
    return "—";
  }
  return list.map((entry) => getOptionLabel("consultation", entry)).join(", ");
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
    const monthName = date.toLocaleString("en-US", { month: "short" });
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
  const monthStartShort = weekStart.toLocaleString("en-US", { month: "short" });
  const monthEndShort = weekEnd.toLocaleString("en-US", { month: "short" });
  return {
    label: `Week ${weekIndex}`,
    range: `${monthStartShort} ${weekStart.getDate()} – ${monthEndShort} ${weekEnd.getDate()}`,
    order: weekIndex,
  };
}

function updateYearOptions(centerYear = selectedDate.getFullYear()) {
  if (!yearSelect) {
    return;
  }
  const span = 5;
  const years = [];
  for (let year = centerYear - span; year <= centerYear + span; year += 1) {
    years.push(year);
  }
  yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
}

function updateControlState() {
  if (todayButton) {
    todayButton.disabled = false;
  }
  if (yearSelect) {
    yearSelect.disabled = false;
  }
}

function updateTotalPatients(total) {
  if (totalPatientCount) {
    totalPatientCount.textContent = `${total} total patient${total === 1 ? "" : "s"}`;
  }
}

function updateMonthPatientCount(total) {
  if (monthPatientCount) {
    monthPatientCount.textContent = `${total} patient${total === 1 ? "" : "s"} this month`;
  }
  const calendarMonthPatients = document.getElementById("calendar-month-patients");
  if (calendarMonthPatients) {
    calendarMonthPatients.textContent = `${total} patient${total === 1 ? "" : "s"}`;
  }
}

function renderSelectedMonth() {
  if (isAdminUser) {
    selectedProcedureIds.clear();
  }
  const sourceSchedules = searchQuery ? filteredMonthlySchedules : monthlySchedules;
  const selectedLabel = formatMonthLabelFromDate(selectedDate);
  monthLabel.textContent = selectedLabel;
  const currentMonth = sourceSchedules.find((month) => month.label === selectedLabel);

  if (yearSelect) {
    const selectedYear = selectedDate.getFullYear();
    const optionExists = Array.from(yearSelect.options).some(
      (option) => Number(option.value) === selectedYear
    );
    if (!optionExists) {
      updateYearOptions(selectedYear);
    }
    yearSelect.value = String(selectedYear);
  }

  scheduleEl.innerHTML = "";
  if (!currentMonth?.weeks?.length) {
    if (searchQuery) {
      const hasAnyMatches = filteredMonthlySchedules.some((month) => month.weeks?.length);
      const message = hasAnyMatches
        ? `No patients matching "${searchQuery}" in ${selectedLabel}.`
        : `No patients found matching "${searchQuery}".`;
      setScheduleStatus(message);
      const matchingWeeks = filteredMonthlySchedules.reduce(
        (total, month) => total + (month.weeks?.length ?? 0),
        0
      );
      weekCount.textContent = matchingWeeks
        ? `${matchingWeeks} matching week${matchingWeeks === 1 ? "" : "s"}`
        : "0 matches";
    } else {
      setScheduleStatus(`No patient records found for ${selectedLabel}.`);
      weekCount.textContent = "0 weeks scheduled";
    }
    updateMonthPatientCount(0);
  } else {
    currentMonth.weeks.forEach(renderWeek);
    weekCount.textContent = `${currentMonth.weeks.length} ${searchQuery ? "matching week" : "week"}${
      currentMonth.weeks.length === 1 ? "" : "s"
    }`;
    const monthPatientTotal = currentMonth.weeks.reduce(
      (total, week) => total + (week.days?.length ?? 0),
      0
    );
    updateMonthPatientCount(monthPatientTotal);
  }
  updateMonthQueryParam(selectedDate);
  updateControlState();
  updateSelectionControlsState();
}

function highlightActivePatientRow() {
  if (!activePatientContext?.patientId || !activePatientContext.shouldReturnToSchedule) {
    return;
  }
  const selector = activePatientContext.procedureId
    ? `.patient-row[data-patient-id="${activePatientContext.patientId}"][data-procedure-id="${activePatientContext.procedureId}"]`
    : `.patient-row[data-patient-id="${activePatientContext.patientId}"]`;
  const row = document.querySelector(selector);
  if (!row) {
    return;
  }
  row.classList.add("patient-row--active");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
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

function handleYearChange(event) {
  const selectedYear = Number(event.target.value);
  if (!Number.isFinite(selectedYear)) {
    return;
  }
  selectedDate = new Date(selectedYear, selectedDate.getMonth(), 1);
  renderSelectedMonth();
}

function handleTodayClick() {
  const today = new Date();
  selectedDate = new Date(today.getFullYear(), today.getMonth(), 1);
  renderSelectedMonth();
}

function buildDefaultPatientPayloads() {
  const monthLabel = formatMonthLabelFromDate(selectedDate);
  const currentMonth = monthlySchedules.find((month) => month.label === monthLabel);
  const existingWeeks = currentMonth?.weeks ?? [];
  const newWeekOrder =
    existingWeeks.length && existingWeeks[existingWeeks.length - 1]?.order
      ? existingWeeks[existingWeeks.length - 1].order + 1
      : 1;
  const weekLabel = `Week ${existingWeeks.length + 1 || 1}`;
  const defaultStatus = getDefaultFieldValue("status", "reserved");
  const defaultProcedure = getDefaultFieldValue("procedure_type", "small");
  const defaultPayment = getDefaultFieldValue("payment", "waiting");

  const patientPayload = {
    first_name: "New",
    last_name: "Patient",
    email: "test@example.com",
    phone: "+44 12345678",
    city: "London",
  };

  const procedurePayload = {
    month_label: monthLabel,
    week_label: weekLabel,
    week_range: monthLabel,
    week_order: newWeekOrder,
    day_label: "TBD",
    day_order: 1,
    procedure_date: formatLocalISODate(selectedDate),
    status: defaultStatus,
    procedure_type: defaultProcedure,
    grafts: "",
    payment: defaultPayment,
    consultation: [],
    forms: [],
    consents: [],
    photos: 0,
    photo_files: [],
  };

  return { patientPayload, procedurePayload };
}

async function handleAddPatientClick() {
  if (isCreatingPatient) {
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
    const patient = await patientResponse.json();
    const newPatientId = patient.id;
    if (!newPatientId) {
      throw new Error("Missing patient id in response");
    }
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
    const procedure = await procedureResponse.json();
    persistActivePatientContext({
      patientId: patient.id,
      patient: `${patient.first_name} ${patient.last_name}`.trim(),
      weekLabel: procedure?.week_label ?? procedurePayload.week_label,
      weekRange: procedure?.week_range ?? procedurePayload.week_range,
      day: procedure?.day_label ?? procedurePayload.day_label,
      monthLabel: procedure?.month_label ?? procedurePayload.month_label,
      procedureDate: procedure?.procedure_date ?? procedurePayload.procedure_date,
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
    window.location.href = `patient.html?${params.toString()}`;
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
  const params = new URLSearchParams({
    patient: day.patientName,
    id: String(payload.patientId),
  });
  if (payload.procedureId) {
    params.set("procedure", String(payload.procedureId));
  }
  window.location.href = `patient.html?${params.toString()}`;
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
  clone.querySelector(".week__title").textContent = week.label;
  clone.querySelector(".week__range").textContent = week.range;
  const table = clone.querySelector(".week__table");
  const existingTbody = table.querySelector("tbody");
  if (existingTbody) {
    existingTbody.remove();
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
      patientCell.dataset.label = "Patient";
      if (isGroupedDay) {
        patientCell.colSpan = 1;
      }
      const patientName = document.createElement("span");
      patientName.textContent = day.patientName;
      patientName.className = "patient-name";
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
      patientCell.append(patientName, expandBtn);

      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.textContent = getOptionLabel("status", day.status) || day.status || "—";
      badge.className = `status-badge ${getStatusClass(day.status)}`;
      statusCell.appendChild(badge);
      statusCell.classList.add("col-status");
      statusCell.dataset.label = "Status";

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
      const formsCell = createCheckCell(formsComplete, "Forms", formatChecklistCount("forms", day.forms));
      const consentsCell = createCheckCell(consentsComplete, "Consents", formatChecklistCount("consents", day.consents));
      const consultationCell = document.createElement("td");
      consultationCell.textContent = formatConsultation(day.consultation);
      consultationCell.classList.add("col-consult");
      consultationCell.dataset.label = "Consulted";

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
  });

  scheduleEl.appendChild(clone);
}

if (monthPrevBtn) {
  monthPrevBtn.addEventListener("click", handlePrevMonth);
}
if (monthNextBtn) {
  monthNextBtn.addEventListener("click", handleNextMonth);
}
if (yearSelect) {
  yearSelect.addEventListener("change", handleYearChange);
}
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
    const patientLookup = new Map();
    patients.forEach((patient) => patientLookup.set(Number(patient.id), patient));
    normalizedProcedures = procedures.map((procedure) =>
      normalizeProcedureForSchedule(procedure, patientLookup)
    );
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
    if (activePatientContext?.shouldReturnToSchedule) {
      const matchingMonth = monthlySchedules.find(
        (month) => month.label === activePatient?.scheduleMonthLabel
      );
      if (matchingMonth?.date) {
        setSelectedDateFromTarget(matchingMonth.date);
      }
    }
    filteredMonthlySchedules = monthlySchedules;
    searchQuery = "";
    if (searchInput) {
      searchInput.value = "";
    }
    setSearchClearState(false);
    clearSearchResults();
    updateYearOptions(selectedDate.getFullYear());
    updateTotalPatients(normalizedProcedures.length);
    renderSelectedMonth();
    highlightActivePatientRow();
  } catch (error) {
    console.error(error);
    setScheduleStatus("Unable to load the schedule. Please try again later.");
    monthLabel.textContent = "Consultation Planner";
    weekCount.textContent = "";
    updateControlState();
  }
}
