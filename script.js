import { fetchCurrentUser, handleUnauthorized, initSessionControls } from "./session.js";

const scheduleEl = document.getElementById("schedule");
const weekTemplate = document.getElementById("week-template");

const DEFAULT_FIELD_OPTIONS = {
  status: [
    { value: "reserved", label: "Reserved" },
    { value: "confirmed", label: "Confirmed" },
    { value: "insurgery", label: "In Surgery" },
    { value: "done", label: "Done" },
  ],
  surgery_type: [
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
  true: "☑",
  false: "☐",
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
const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "short" });

const monthLabel = document.getElementById("selected-month");
const weekCount = document.getElementById("week-count");
const monthPrevBtn = document.getElementById("month-prev");
const monthNextBtn = document.getElementById("month-next");
const yearSelect = document.getElementById("year-select");
const todayButton = document.getElementById("month-today");
const addPatientBtn = document.getElementById("add-patient-btn");
const settingsLink = document.querySelector("[data-admin-link]");

initSessionControls();
initializeAdminControls();

async function initializeAdminControls() {
  if (!settingsLink) {
    return;
  }
  try {
    const user = await fetchCurrentUser();
    if (user?.is_admin) {
      settingsLink.hidden = false;
      return;
    }
  } catch (_error) {
    // ignore fetch errors and hide the control
  }
  settingsLink.remove();
}

let monthlySchedules = [];
let selectedDate = new Date();
selectedDate.setDate(1);
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

async function fetchPatients() {
  const response = await fetch(buildApiUrl("/patients"));
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error(`Unable to load patients (${response.status})`);
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

function normalizePatientForSchedule(patient) {
  const date = parseISODate(patient.patient_date);
  const scheduleMonthLabel = date ? formatMonthLabelFromDate(date) : patient.month_label;
  const weekMeta = date ? getWeekMetaForDate(date) : null;
  const scheduleWeekLabel = weekMeta?.label ?? patient.week_label ?? "Week 1";
  const scheduleWeekRange = weekMeta?.range ?? patient.week_range ?? scheduleMonthLabel;
  const scheduleWeekOrder = weekMeta?.order ?? patient.week_order ?? 1;
  const scheduleDayLabel = date ? DAY_FORMATTER.format(date) : patient.day_label;
  const scheduleProcedureDate = date ? date.toISOString().slice(0, 10) : patient.patient_date;

  return {
    ...patient,
    scheduleMonthLabel,
    scheduleWeekLabel,
    scheduleWeekRange,
    scheduleWeekOrder,
    scheduleDayLabel: scheduleDayLabel || patient.day_label,
    scheduleProcedureDate,
    scheduleSortKey: date ? date.getTime() : patient.day_order ?? 0,
    consultation: Array.isArray(patient.consultation)
      ? patient.consultation
      : patient.consultation
        ? [patient.consultation]
        : [],
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
        days: [],
      });
    }
    const entry = weekMap.get(key);
    entry.days.push({
      id: patient.id,
      day: patient.scheduleDayLabel,
      sortKey: patient.scheduleSortKey,
      procedureDate: patient.scheduleProcedureDate,
      patientName: `${patient.first_name} ${patient.last_name}`.trim(),
      firstName: patient.first_name,
      lastName: patient.last_name,
      status: patient.status,
      surgeryType: patient.surgery_type,
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

function buildMonthlySchedules(patients) {
  const normalized = patients.map(normalizePatientForSchedule);
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

function createCheckCell(value, label) {
  const cell = document.createElement("td");
  cell.classList.add("col-check");
  cell.dataset.label = label;

  const icon = document.createElement("span");
  icon.className = `check-icon ${value ? "check-icon--checked" : ""}`;
  icon.textContent = CHECKED_ICON[value];
  icon.setAttribute("aria-label", `${label} ${value ? "complete" : "missing"}`);

  cell.appendChild(icon);
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

function formatProcedureDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return DATE_FORMATTER.format(date);
}

function parseISODate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWeekMetaForDate(date) {
  const day = date.getDate();
  const weekIndex = Math.floor((day - 1) / 7) + 1;
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const startDay = (weekIndex - 1) * 7 + 1;
  const endDay = Math.min(weekIndex * 7, lastDay);
  const monthShort = date.toLocaleString("en-US", { month: "short" });
  return {
    label: `Week ${weekIndex}`,
    range: `${monthShort} ${startDay} – ${monthShort} ${endDay}`,
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

function renderSelectedMonth() {
  const selectedLabel = formatMonthLabelFromDate(selectedDate);
  monthLabel.textContent = selectedLabel;
  const currentMonth = monthlySchedules.find((month) => month.label === selectedLabel);

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
    setScheduleStatus(`No patient records found for ${selectedLabel}.`);
    weekCount.textContent = "0 weeks scheduled";
  } else {
    currentMonth.weeks.forEach(renderWeek);
    weekCount.textContent = `${currentMonth.weeks.length} weeks scheduled`;
  }
  updateControlState();
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

function buildDefaultPatientPayload() {
  const monthLabel = formatMonthLabelFromDate(selectedDate);
  const currentMonth = monthlySchedules.find((month) => month.label === monthLabel);
  const existingWeeks = currentMonth?.weeks ?? [];
  const newWeekOrder =
    existingWeeks.length && existingWeeks[existingWeeks.length - 1]?.order
      ? existingWeeks[existingWeeks.length - 1].order + 1
      : 1;
  const weekLabel = `Week ${existingWeeks.length + 1 || 1}`;
  const defaultStatus = getDefaultFieldValue("status", "reserved");
  const defaultSurgery = getDefaultFieldValue("surgery_type", "small");
  const defaultPayment = getDefaultFieldValue("payment", "waiting");

  return {
    month_label: monthLabel,
    week_label: weekLabel,
    week_range: monthLabel,
    week_order: newWeekOrder,
    day_label: "TBD",
    day_order: 1,
    patient_date: selectedDate.toISOString().slice(0, 10),
    first_name: "New",
    last_name: "Patient",
    email: "",
    phone: "",
    city: "",
    status: defaultStatus,
    surgery_type: defaultSurgery,
    payment: defaultPayment,
    consultation: [],
    forms: [],
    consents: [],
    photos: 0,
    photo_files: [],
  };
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
    const payload = buildDefaultPatientPayload();
    const response = await fetch(buildApiUrl("/patients"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to create patient (${response.status})`);
    }
    const patient = await response.json();
    localStorage.setItem(
      ACTIVE_PATIENT_KEY,
      JSON.stringify({
        patientId: patient.id,
        patient: `${patient.first_name} ${patient.last_name}`.trim(),
        weekLabel: patient.week_label,
        weekRange: patient.week_range,
        day: patient.day_label,
        capturedAt: new Date().toISOString(),
      })
    );
    const params = new URLSearchParams({
      id: String(patient.id),
      patient: `${patient.first_name} ${patient.last_name}`.trim(),
    });
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
    patientId: day.id,
    patient: day.patientName,
    weekLabel: week.label,
    weekRange: week.range,
    day: day.day,
    capturedAt: new Date().toISOString(),
  };
  localStorage.setItem(ACTIVE_PATIENT_KEY, JSON.stringify(payload));
  const params = new URLSearchParams({ patient: day.patientName, id: String(day.id) });
  window.location.href = `patient.html?${params.toString()}`;
}

function renderWeek(week, index) {
  const clone = weekTemplate.content.cloneNode(true);
  clone.querySelector(".week__title").textContent = week.label;
  clone.querySelector(".week__range").textContent = week.range;
  const tbody = clone.querySelector("tbody");

  week.days.forEach((day, dayIndex) => {
    const row = document.createElement("tr");
    row.classList.add("patient-row");
    row.tabIndex = 0;
    row.dataset.patient = day.patientName;
    row.setAttribute("aria-label", `Open patient record for ${day.patientName}`);

    const indexCell = document.createElement("td");
    indexCell.textContent = `${index + 1}.${dayIndex + 1}`;
    indexCell.classList.add("col-index");
    indexCell.dataset.label = "#";

    const dayCell = document.createElement("td");
    dayCell.textContent = day.day;
    dayCell.classList.add("col-day");
    dayCell.dataset.label = "Day";

    const dateCell = document.createElement("td");
    dateCell.textContent = formatProcedureDate(day.procedureDate);
    dateCell.classList.add("col-date");
    dateCell.dataset.label = "Procedure Date";

    const patientCell = document.createElement("td");
    patientCell.textContent = day.patientName;
    patientCell.classList.add("col-patient");
    patientCell.dataset.label = "Patient";

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.textContent = getOptionLabel("status", day.status) || day.status || "—";
    badge.className = `status-badge ${getStatusClass(day.status)}`;
    statusCell.appendChild(badge);
    statusCell.classList.add("col-status");
    statusCell.dataset.label = "Status";

    const surgeryCell = document.createElement("td");
    surgeryCell.textContent = getOptionLabel("surgery_type", day.surgeryType) || day.surgeryType || "—";
    surgeryCell.classList.add("col-surgery");
    surgeryCell.dataset.label = "Surgery Type";

    const formsComplete = hasCompletedChecklist("forms", day.forms);
    const consentsComplete = hasCompletedChecklist("consents", day.consents);
    const formsCell = createCheckCell(formsComplete, "Forms");
    const consentsCell = createCheckCell(consentsComplete, "Consents");
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

    row.append(
      indexCell,
      dayCell,
      dateCell,
      patientCell,
      statusCell,
      surgeryCell,
      formsCell,
      consentsCell,
      consultationCell,
      paymentCell,
      photosCell
    );
    tbody.appendChild(row);
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

async function initializeSchedule() {
  setScheduleStatus("Loading schedule...");
  try {
    await fetchFieldOptions();
    const patients = await fetchPatients();
    monthlySchedules = buildMonthlySchedules(patients);
    updateYearOptions(selectedDate.getFullYear());
    renderSelectedMonth();
  } catch (error) {
    console.error(error);
    setScheduleStatus("Unable to load the schedule. Please try again later.");
    monthLabel.textContent = "Consultation Planner";
    weekCount.textContent = "";
    updateControlState();
  }
}

initializeSchedule();
