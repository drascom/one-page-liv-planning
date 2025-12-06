import {
  fetchCurrentUser,
  handleUnauthorized,
  initAppVersionDisplay,
  initSessionControls,
} from "./session.js";
import { navigateToPatientRecord, setPatientRouteBase } from "./patient-route.js";

const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;

const selectedListEl = document.getElementById("merge-selected-list");
const availableListEl = document.getElementById("merge-available-list");
const addSearchInput = document.getElementById("merge-add-search");
const clearSelectionBtn = document.getElementById("merge-clear-btn");
const openDirectoryBtn = document.getElementById("merge-open-directory");
const openCustomersBtn = document.getElementById("merge-open-customers");
const statusEl = document.getElementById("merge-status");
const mergeForm = document.getElementById("merge-form");
const submitBtn = document.getElementById("merge-submit-btn");
const viewPatientBtn = document.getElementById("merge-view-patient");

const firstNameInput = document.getElementById("merge-first-name");
const lastNameInput = document.getElementById("merge-last-name");
const emailInput = document.getElementById("merge-email");
const phoneInput = document.getElementById("merge-phone");
const addressInput = document.getElementById("merge-address");
const driveInput = document.getElementById("merge-drive");

const selectedCountEl = document.getElementById("merge-selected-count");
const procedureCountEl = document.getElementById("merge-procedure-count");
const summaryCountEl = document.getElementById("merge-summary-count");
const summaryProceduresEl = document.getElementById("merge-summary-procedures");
const summaryPhotosEl = document.getElementById("merge-summary-photos");

let patients = [];
let proceduresByPatient = new Map();
let selectedPatientIds = new Set();
let primaryPatientId = null;
let duplicatePatientIds = new Set();

initSessionControls();
initAppVersionDisplay();

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

async function fetchJson(path) {
  const response = await fetch(buildApiUrl(path));
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error(`Unable to load ${path} (${response.status})`);
  }
  return response.json();
}

function normalize(value) {
  return (value || "").toString().trim().toLowerCase();
}

function normalizePhone(value) {
  return normalize(value).replace(/\D+/g, "");
}

function setStatus(message, { isError = false } = {}) {
  if (!statusEl) return;
  statusEl.textContent = message ?? "";
  if (isError) {
    statusEl.classList.add("form-status--danger");
  } else {
    statusEl.classList.remove("form-status--danger");
  }
}

function formatPatientName(patient) {
  return `${patient?.first_name || ""} ${patient?.last_name || ""}`.trim() || "Unnamed patient";
}

function collectDuplicatePatientIds(records) {
  const emailMap = new Map();
  const phoneMap = new Map();
  const nameMap = new Map();

  const addToMap = (map, key, id) => {
    if (!key) return;
    const current = map.get(key) ?? new Set();
    current.add(id);
    map.set(key, current);
  };

  records.forEach((patient) => {
    const id = Number(patient.id);
    addToMap(emailMap, normalize(patient.email), id);
    addToMap(phoneMap, normalizePhone(patient.phone), id);
    const first = normalize(patient.first_name);
    const last = normalize(patient.last_name);
    if (first && last) {
      addToMap(nameMap, `${first}|${last}`, id);
    }
  });

  const duplicates = new Set();
  [emailMap, phoneMap, nameMap].forEach((map) => {
    map.forEach((ids) => {
      if (ids.size > 1) {
        ids.forEach((id) => duplicates.add(id));
      }
    });
  });
  return duplicates;
}

function getPatientRecord(patientId) {
  return patients.find((patient) => Number(patient.id) === Number(patientId));
}

function getProcedureCount(patientId) {
  return proceduresByPatient.get(Number(patientId))?.length ?? 0;
}

function getTotalProceduresForSelection() {
  let total = 0;
  selectedPatientIds.forEach((patientId) => {
    total += getProcedureCount(patientId);
  });
  return total;
}

function getTotalPhotosForSelection() {
  let total = 0;
  selectedPatientIds.forEach((patientId) => {
    const record = getPatientRecord(patientId);
    total += record?.photo_count ?? 0;
  });
  return total;
}

function parseSelectedFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const idsParam = params.get("ids");
  if (!idsParam) return [];
  return idsParam
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function fillFormFromPatient(patient) {
  if (!patient) return;
  if (firstNameInput) firstNameInput.value = patient.first_name || "";
  if (lastNameInput) lastNameInput.value = patient.last_name || "";
  if (emailInput) emailInput.value = patient.email || "";
  if (phoneInput) phoneInput.value = patient.phone || "";
  if (addressInput) addressInput.value = patient.address || patient.city || "";
  if (driveInput) driveInput.value = patient.drive_folder_id || "";
}

function ensurePrimarySelection() {
  if (primaryPatientId && selectedPatientIds.has(primaryPatientId)) {
    return;
  }
  const [firstSelected] = selectedPatientIds;
  primaryPatientId = firstSelected ?? null;
  const primaryRecord = getPatientRecord(primaryPatientId);
  if (primaryRecord) {
    fillFormFromPatient(primaryRecord);
  }
}

function updateSummary() {
  const selectedCount = selectedPatientIds.size;
  const procedureCount = getTotalProceduresForSelection();
  const photoCount = getTotalPhotosForSelection();
  if (selectedCountEl) selectedCountEl.textContent = String(selectedCount);
  if (procedureCountEl) procedureCountEl.textContent = String(procedureCount);
  if (summaryCountEl) summaryCountEl.textContent = String(selectedCount);
  if (summaryProceduresEl) summaryProceduresEl.textContent = String(procedureCount);
  if (summaryPhotosEl) summaryPhotosEl.textContent = String(photoCount);
  if (submitBtn) {
    submitBtn.disabled = selectedCount < 2 || !primaryPatientId;
    submitBtn.textContent = selectedCount < 2 ? "Select 2+ patients" : "Merge patients";
  }
  if (viewPatientBtn) {
    viewPatientBtn.hidden = !primaryPatientId;
  }
}

function renderSelectedList() {
  if (!selectedListEl) return;
  if (!selectedPatientIds.size) {
    selectedListEl.innerHTML =
      '<li class="merge-selected-card merge-selected-card--empty">Select at least two patients to get started.</li>';
    updateSummary();
    return;
  }
  const items = [...selectedPatientIds]
    .map((patientId) => {
      const patient = getPatientRecord(patientId) || { id: patientId };
      const isPrimary = patientId === primaryPatientId;
      const procedureCount = getProcedureCount(patientId);
      const photoCount = patient.photo_count ?? 0;
      return `
        <li class="merge-selected-card ${isPrimary ? "merge-selected-card--primary" : ""}" data-patient-id="${patientId}">
          <div class="merge-selected-card__row">
            <label class="merge-selected-card__primary">
              <input type="radio" name="primaryPatient" value="${patientId}" data-primary-select ${isPrimary ? "checked" : ""} />
              <span>Keep this record</span>
            </label>
            <button type="button" class="ghost-btn ghost-btn--small" data-remove-patient="${patientId}">Remove</button>
          </div>
          <div class="merge-selected-card__body">
            <div>
              <p class="merge-selected-card__name">${formatPatientName(patient)}</p>
              <p class="merge-selected-card__meta">${patient.address || patient.city || "Address unknown"} • ${
                patient.email || "No email"
              }</p>
            </div>
            <div class="merge-selected-card__stats">
              <span>${procedureCount} procedure${procedureCount === 1 ? "" : "s"}</span>
              <span>${photoCount} photo${photoCount === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div class="merge-selected-card__actions">
            <button type="button" class="link-btn" data-fill-patient="${patientId}">Use these details</button>
            <button type="button" class="link-btn" data-open-patient="${patientId}">Open record</button>
          </div>
        </li>
      `;
    })
    .join("");
  selectedListEl.innerHTML = items;
  updateSummary();
}

function matchesPatient(patient, term) {
  if (!term) return true;
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return true;
  const name = normalize(`${patient.first_name} ${patient.last_name}`);
  const email = normalize(patient.email);
  const phone = normalize(patient.phone);
  const address = normalize(patient.address || patient.city);
  return (
    name.includes(normalizedTerm) ||
    email.includes(normalizedTerm) ||
    phone.includes(normalizedTerm) ||
    address.includes(normalizedTerm)
  );
}

function renderAvailableList() {
  if (!availableListEl) return;
  const searchTerm = addSearchInput?.value ?? "";
  const available = patients.filter(
    (patient) => !selectedPatientIds.has(Number(patient.id)) && matchesPatient(patient, searchTerm)
  );
  const sortedAvailable = [...available].sort((a, b) => {
    const aDuplicate = duplicatePatientIds.has(a.id);
    const bDuplicate = duplicatePatientIds.has(b.id);
    if (aDuplicate !== bDuplicate) {
      return aDuplicate ? -1 : 1;
    }
    return formatPatientName(a).localeCompare(formatPatientName(b));
  });
  if (!available.length) {
    availableListEl.innerHTML =
      '<li class="merge-available-card merge-available-card--empty">No other patients match that search.</li>';
    return;
  }
  availableListEl.innerHTML = sortedAvailable
    .slice(0, 12)
    .map((patient) => {
      const procedureCount = getProcedureCount(patient.id);
      const isDuplicate = duplicatePatientIds.has(patient.id);
      return `
        <li class="merge-available-card">
          <div>
            <p class="merge-available-card__name">${formatPatientName(patient)}</p>
            <p class="merge-available-card__meta">${patient.address || patient.city || "Address unknown"} • ${
              patient.email || "No email"
            }</p>
            ${isDuplicate ? '<span class="merge-available-card__badge">Possible duplicate</span>' : ""}
          </div>
          <div class="merge-available-card__actions">
            <span class="merge-available-card__stat">${procedureCount} procedure${procedureCount === 1 ? "" : "s"}</span>
            <button type="button" class="secondary-btn" data-add-patient="${patient.id}">Add</button>
          </div>
        </li>
      `;
    })
    .join("");
}

function addPatientToSelection(patientId) {
  const record = getPatientRecord(patientId);
  if (!record) {
    setStatus(`Patient #${patientId} is not available to merge.`, { isError: true });
    return;
  }
  selectedPatientIds.add(Number(patientId));
  ensurePrimarySelection();
  renderSelectedList();
  renderAvailableList();
}

function removePatientFromSelection(patientId) {
  selectedPatientIds.delete(Number(patientId));
  if (primaryPatientId === Number(patientId)) {
    primaryPatientId = null;
  }
  ensurePrimarySelection();
  renderSelectedList();
  renderAvailableList();
}

function openPatientRecord(patientId) {
  if (!patientId) return;
  navigateToPatientRecord(patientId);
}

function hydrateSelectionFromQuery() {
  const idsFromQuery = parseSelectedFromQuery();
  if (!idsFromQuery.length) {
    return;
  }
  idsFromQuery.forEach((patientId) => {
    if (patients.some((patient) => Number(patient.id) === patientId)) {
      selectedPatientIds.add(patientId);
    }
  });
  ensurePrimarySelection();
}

async function loadPatientsAndProcedures() {
  setStatus("Loading patients and procedures...");
  try {
    const [patientPayload, procedurePayload] = await Promise.all([fetchJson("/patients"), fetchJson("/procedures")]);
    const normalizedPatients = patientPayload.map((patient) => ({
      ...patient,
      id: Number(patient.id),
    }));
    patients = normalizedPatients;
    duplicatePatientIds = collectDuplicatePatientIds(normalizedPatients);
    proceduresByPatient = new Map();
    procedurePayload.forEach((procedure) => {
      const patientId = Number(procedure.patient_id);
      if (!Number.isFinite(patientId)) return;
      if (!proceduresByPatient.has(patientId)) {
        proceduresByPatient.set(patientId, []);
      }
      proceduresByPatient.get(patientId).push(procedure);
    });
    hydrateSelectionFromQuery();
    ensurePrimarySelection();
    renderSelectedList();
    renderAvailableList();
    setStatus("");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to load patients.", { isError: true });
  }
}

function collectFormUpdates() {
  return {
    first_name: firstNameInput?.value?.trim() ?? "",
    last_name: lastNameInput?.value?.trim() ?? "",
    email: emailInput?.value?.trim() ?? "",
    phone: phoneInput?.value?.trim() ?? "",
    address: addressInput?.value?.trim() ?? "",
    drive_folder_id: driveInput?.value?.trim() || null,
  };
}

async function submitMerge(event) {
  event.preventDefault();
  if (selectedPatientIds.size < 2) {
    setStatus("Select at least two patients to merge.", { isError: true });
    return;
  }
  if (!primaryPatientId) {
    setStatus("Choose which patient to keep.", { isError: true });
    return;
  }
  const sourceIds = [...selectedPatientIds].filter((id) => id !== primaryPatientId);
  const payload = {
    target_patient_id: primaryPatientId,
    source_patient_ids: sourceIds,
    updates: collectFormUpdates(),
  };
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Merging…";
  }
  setStatus("Combining records...");
  try {
    const response = await fetch(buildApiUrl("/patients/merge"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    handleUnauthorized(response);
    const result = await response.json();
    if (!response.ok) {
      const detail = result?.detail || "Unable to merge patients.";
      throw new Error(detail);
    }
    const sourcePhotoTotal = sourceIds.reduce((total, id) => total + (getPatientRecord(id)?.photo_count ?? 0), 0);
    const primaryRecord = getPatientRecord(primaryPatientId);
    if (primaryRecord) {
      primaryRecord.photo_count = (primaryRecord.photo_count ?? 0) + sourcePhotoTotal;
    }
    sourceIds.forEach((id) => {
      const movedProcedures = proceduresByPatient.get(id);
      if (movedProcedures?.length) {
        if (!proceduresByPatient.has(primaryPatientId)) {
          proceduresByPatient.set(primaryPatientId, []);
        }
        proceduresByPatient.get(primaryPatientId).push(...movedProcedures);
      }
      proceduresByPatient.delete(id);
    });
    patients = patients.filter((patient) => patient.id === primaryPatientId || !sourceIds.includes(patient.id));
    setStatus(
      `Merged ${selectedPatientIds.size} patients into ${formatPatientName(primaryRecord) || "the surviving record"}.`
    );
    selectedPatientIds = new Set([primaryPatientId]);
    ensurePrimarySelection();
    renderSelectedList();
    renderAvailableList();
    if (viewPatientBtn) {
      viewPatientBtn.hidden = false;
    }
    if (result?.moved_procedures) {
      if (summaryProceduresEl) summaryProceduresEl.textContent = String(result.moved_procedures || 0);
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to merge patients.", { isError: true });
  } finally {
    if (submitBtn) {
      submitBtn.disabled = selectedPatientIds.size < 2;
      submitBtn.textContent = selectedPatientIds.size < 2 ? "Select 2+ patients" : "Merge patients";
    }
  }
}

function setupAdminLink() {
  const adminLink = document.querySelector("[data-admin-link]");
  fetchCurrentUser()
    .then((user) => {
      setPatientRouteBase(Boolean(user?.is_admin));
      if (user?.is_admin) {
        adminLink?.removeAttribute("hidden");
      }
    })
    .catch(() => {
      setPatientRouteBase(false);
      // Ignore failures; admins will see the link when available
    });
}

selectedListEl?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const removeButton = target.closest("[data-remove-patient]");
  if (removeButton) {
    const patientId = Number(removeButton.getAttribute("data-remove-patient"));
    removePatientFromSelection(patientId);
    return;
  }
  const fillButton = target.closest("[data-fill-patient]");
  if (fillButton) {
    const patientId = Number(fillButton.getAttribute("data-fill-patient"));
    const record = getPatientRecord(patientId);
    if (record) {
      primaryPatientId = patientId;
      fillFormFromPatient(record);
      renderSelectedList();
    }
    return;
  }
  const openButton = target.closest("[data-open-patient]");
  if (openButton) {
    const patientId = Number(openButton.getAttribute("data-open-patient"));
    openPatientRecord(patientId);
    return;
  }
});

selectedListEl?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.matches("[data-primary-select]")) {
    primaryPatientId = Number(target.value);
    const record = getPatientRecord(primaryPatientId);
    if (record) {
      fillFormFromPatient(record);
    }
    renderSelectedList();
  }
});

availableListEl?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const addButton = target.closest("[data-add-patient]");
  if (addButton) {
    const patientId = Number(addButton.getAttribute("data-add-patient"));
    addPatientToSelection(patientId);
  }
});

addSearchInput?.addEventListener("input", () => {
  renderAvailableList();
});

clearSelectionBtn?.addEventListener("click", () => {
  selectedPatientIds = new Set();
  primaryPatientId = null;
  renderSelectedList();
  renderAvailableList();
  setStatus("");
});

openDirectoryBtn?.addEventListener("click", () => {
  window.location.href = "customers.html";
});

openCustomersBtn?.addEventListener("click", () => {
  window.location.href = "/schedule";
});

viewPatientBtn?.addEventListener("click", () => {
  if (!primaryPatientId) return;
  openPatientRecord(primaryPatientId);
});

mergeForm?.addEventListener("submit", submitMerge);

setupAdminLink();
loadPatientsAndProcedures();
