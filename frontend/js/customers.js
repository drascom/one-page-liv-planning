import {
  fetchCurrentUser,
  handleUnauthorized,
  initAppVersionDisplay,
  initSessionControls,
} from "./session.js";
import { buildPatientRecordUrlSync, setPatientRouteBase } from "./patient-route.js";
import { APP_TIMEZONE } from "./timezone.js";

const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;

const listEl = document.getElementById("customer-list");
const statusEl = document.getElementById("customer-status");
const refreshBtn = document.getElementById("customer-refresh-btn");
const totalCountEl = document.getElementById("customer-total-count");
const totalInlineEl = document.getElementById("customer-total-inline");
const visibleCountEl = document.getElementById("customer-visible-count");
const adminLink = document.querySelector("[data-admin-link]");
const searchForm = document.getElementById("patient-search-form");
const searchInput = document.getElementById("patient-search");
const searchClearBtn = document.getElementById("patient-search-clear");
const searchResultsEl = document.getElementById("patient-search-results");
const mergeControlsEl = document.getElementById("customer-merge-controls");
const mergeCountEl = document.getElementById("customer-merge-count");
const mergeSelectedBtn = document.getElementById("customer-merge-selected-btn");
const mergeClearBtn = document.getElementById("customer-merge-clear-btn");
const mergeOpenBtn = document.getElementById("customer-open-merge-btn");

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: APP_TIMEZONE,
});

let allCustomers = [];
let filteredCustomers = [];
let isAdminUser = false;
let hasCustomerData = false;
const selectedPatientIds = new Set();

initSessionControls();
initAppVersionDisplay();

if (searchResultsEl) {
  searchResultsEl.hidden = true;
  searchResultsEl.innerHTML = "";
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

async function ensureAdminLinkVisibility() {
  try {
    const user = await fetchCurrentUser();
    isAdminUser = Boolean(user?.is_admin);
    setPatientRouteBase(isAdminUser);
    if (isAdminUser) {
      adminLink?.removeAttribute("hidden");
    }
    if (isAdminUser && hasCustomerData) {
      renderCustomers(filteredCustomers);
    }
  } catch (_error) {
    // Ignore – non-admins simply won't see the link.
    isAdminUser = false;
    setPatientRouteBase(false);
  }
}

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

function normalizeName(value) {
  return (value || "").toString().trim().toLowerCase();
}

function getCustomerDisplayName(customer) {
  return `${customer?.first_name || ""} ${customer?.last_name || ""}`.trim() || `Patient #${customer?.id ?? ""}`;
}

function sortCustomersByName(customers) {
  return [...customers].sort((a, b) =>
    getCustomerDisplayName(a).localeCompare(getCustomerDisplayName(b), undefined, { sensitivity: "base" })
  );
}

function findDuplicateGroups(customers) {
  const groups = new Map();
  customers.forEach((customer) => {
    const first = normalizeName(customer.first_name);
    const last = normalizeName(customer.last_name);
    const key = `${first} ${last}`.trim();
    if (!key) {
      return;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(customer);
  });
  return Array.from(groups.values())
    .filter((items) => items.length > 1)
    .map((items) => ({
      displayName: getCustomerDisplayName(items[0]),
      items: sortCustomersByName(items),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

function buildDuplicateSection(groups) {
  if (!Array.isArray(groups) || !groups.length) {
    return "";
  }
  const itemsMarkup = groups
    .map((group) => {
      const links = group.items
        .map((customer) => {
          const url = buildPatientRecordUrlSync(customer.id, { patientName: getCustomerDisplayName(customer) });
          return `<a href="${url}" class="customer-duplicates__link">#${customer.id}</a>`;
        })
        .join("");
      return `
        <li class="customer-duplicates__item">
          <span class="customer-duplicates__name">${group.displayName}</span>
          <div class="customer-duplicates__links">${links}</div>
        </li>
      `;
    })
    .join("");
  return `
    <li class="customer-duplicates">
      <div class="customer-duplicates__header">
        <p class="customer-duplicates__title">Possible duplicate names</p>
        <p class="customer-duplicates__subtitle">${groups.length} name${groups.length === 1 ? "" : "s"} found</p>
      </div>
      <ul class="customer-duplicates__list">
        ${itemsMarkup}
      </ul>
    </li>
  `;
}

function pruneSelectedPatients() {
  const validIds = new Set(allCustomers.map((customer) => Number(customer.id)));
  let changed = false;
  selectedPatientIds.forEach((id) => {
    if (!validIds.has(id)) {
      selectedPatientIds.delete(id);
      changed = true;
    }
  });
  if (changed) {
    updateMergeControls();
  }
}

function summarizeProcedures(procedures = []) {
  if (!procedures.length) {
    return { count: 0, nextLabel: "No procedures scheduled" };
  }
  const sorted = [...procedures]
    .filter((entry) => Boolean(entry.procedure_date))
    .sort((a, b) => {
      const left = Date.parse(a.procedure_date ?? "");
      const right = Date.parse(b.procedure_date ?? "");
      return left - right;
    });
  if (!sorted.length) {
    return { count: procedures.length, nextLabel: "Procedures without dates" };
  }
  const nextDate = sorted[0].procedure_date;
  const dateLabel = (() => {
    const parsed = Date.parse(nextDate);
    if (Number.isNaN(parsed)) {
      return nextDate;
    }
    return DATE_FORMATTER.format(new Date(parsed));
  })();
  return { count: procedures.length, nextLabel: `Next: ${dateLabel}` };
}

function buildCustomerEntry(patient, proceduresByPatient) {
  const procedures = proceduresByPatient.get(Number(patient.id)) ?? [];
  const summary = summarizeProcedures(procedures);
  return {
    ...patient,
    procedureCount: summary.count,
    nextProcedureLabel: summary.nextLabel,
  };
}

function renderCustomers(customers) {
  if (!listEl) return;
  const duplicatesMarkup = buildDuplicateSection(findDuplicateGroups(customers));
  let cardsMarkup = "";
  if (!customers.length) {
    cardsMarkup =
      '<li class="customer-empty">No patients match your search. Try another name or address.</li>';
  } else {
    cardsMarkup = customers
      .map((customer) => {
        const isSelected = selectedPatientIds.has(Number(customer.id));
        const customerName = getCustomerDisplayName(customer);
        const patientUrl = buildPatientRecordUrlSync(customer.id, { patientName: customerName });
        return `
        <li class="customer-card ${isSelected ? "customer-card--selected" : ""}" data-patient-id="${customer.id}">
          <div class="customer-card__primary">
            <a class="customer-card__name" href="${patientUrl}">
              ${customerName}
            </a>
            <p class="customer-card__meta">
              ${customer.address || customer.city || "Address unknown"} • ${customer.email || "No email"}
            </p>
          </div>
          <div class="customer-card__stats">
            <div class="customer-card__stat">
              <span class="customer-card__stat-value">${customer.procedureCount}</span>
              <span class="customer-card__stat-label">Procedures</span>
            </div>
            <div class="customer-card__stat">
              <span class="customer-card__stat-value">${customer.photo_count ?? 0}</span>
              <span class="customer-card__stat-label">Photos</span>
            </div>
          </div>
          <div class="customer-card__actions">
            <label class="customer-card__select">
              <input
                type="checkbox"
                class="customer-card__select-input"
                data-select-patient="${customer.id}"
                ${isSelected ? "checked" : ""}
                aria-label="Select ${customerName} for merge"
              />
              <span>${isSelected ? "Selected" : "Select"}</span>
            </label>
            ${
              isAdminUser
                ? `<button type="button" class="danger-btn customer-card__delete-btn" data-delete-patient="${customer.id}">Delete</button>`
                : ""
            }
          </div>
        </li>
      `;
      })
      .join("");
  }
  listEl.innerHTML = `${duplicatesMarkup}${cardsMarkup}`;
  if (visibleCountEl) {
    visibleCountEl.textContent = String(customers.length);
  }
  updateMergeControls();
}

function updateMergeControls() {
  const selectedCount = selectedPatientIds.size;
  if (mergeControlsEl) {
    mergeControlsEl.hidden = selectedCount === 0;
  }
  if (mergeCountEl) {
    mergeCountEl.textContent = String(selectedCount);
  }
  if (mergeSelectedBtn) {
    mergeSelectedBtn.disabled = selectedCount < 2;
  }
}

function clearMergeSelection() {
  selectedPatientIds.clear();
  updateMergeControls();
  renderCustomers(filteredCustomers);
}

function openMergePage() {
  const ids = Array.from(selectedPatientIds);
  const params = new URLSearchParams();
  if (ids.length) {
    params.set("ids", ids.join(","));
  }
  const query = params.toString();
  const target = query ? `merge-patients.html?${query}` : "merge-patients.html";
  window.location.href = target;
}

function togglePatientSelection(patientId, isSelected) {
  if (!Number.isFinite(patientId)) {
    return;
  }
  if (isSelected) {
    selectedPatientIds.add(patientId);
  } else {
    selectedPatientIds.delete(patientId);
  }
  updateMergeControls();
  renderCustomers(filteredCustomers);
}

function applyCustomerFilter(query) {
  const normalized = normalizeName(query);
  if (!normalized) {
    filteredCustomers = sortCustomersByName(allCustomers);
  } else {
    filteredCustomers = sortCustomersByName(
      allCustomers.filter((customer) => {
        const name = `${normalizeName(customer.first_name)} ${normalizeName(customer.last_name)}`.trim();
        const address = normalizeName(customer.address || customer.city);
        const email = normalizeName(customer.email);
        return name.includes(normalized) || address.includes(normalized) || email.includes(normalized);
      })
    );
  }
  renderCustomers(filteredCustomers);
}

function setSearchClearState(active) {
  if (searchClearBtn) {
    searchClearBtn.hidden = !active;
  }
}

function handleSearchInput() {
  const value = searchInput?.value ?? "";
  applyCustomerFilter(value);
  setSearchClearState(Boolean(value.trim()));
  if (searchResultsEl) {
    searchResultsEl.innerHTML = "";
  }
}

function resetSearch() {
  if (searchInput) {
    searchInput.value = "";
  }
  setSearchClearState(false);
  applyCustomerFilter("");
}

function handleSearchSubmit(event) {
  event.preventDefault();
  handleSearchInput();
}

function updateCustomerTotals() {
  const total = allCustomers.length;
  if (totalCountEl) {
    totalCountEl.textContent = String(total);
  }
  if (totalInlineEl) {
    totalInlineEl.textContent = String(total);
  }
}

function getCustomerLabel(patientId) {
  const record = allCustomers.find((customer) => Number(customer.id) === patientId);
  if (!record) {
    return `patient #${patientId}`;
  }
  const nameParts = [record.first_name, record.last_name]
    .map((part) => (part || "").trim())
    .filter(Boolean);
  return nameParts.length ? nameParts.join(" ") : `patient #${patientId}`;
}

function removeCustomerFromState(patientId) {
  allCustomers = allCustomers.filter((customer) => Number(customer.id) !== patientId);
  filteredCustomers = filteredCustomers.filter((customer) => Number(customer.id) !== patientId);
  selectedPatientIds.delete(patientId);
  updateCustomerTotals();
  renderCustomers(filteredCustomers);
}

async function deletePatientRecord(patientId) {
  const response = await fetch(buildApiUrl(`/patients/${patientId}/purge`), { method: "DELETE" });
  handleUnauthorized(response);
  if (!response.ok) {
    let message = `Unable to delete patient #${patientId}`;
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail) {
        message = errorPayload.detail;
      }
    } catch (_jsonError) {
      // Ignore JSON parse issues for empty bodies
    }
    throw new Error(message);
  }
}

async function handleCustomerDelete(button, patientId) {
  if (!isAdminUser) return;
  const patientLabel = getCustomerLabel(patientId);
  const confirmed = window.confirm(
    `Delete ${patientLabel}? This also removes all associated procedures and files.`
  );
  if (!confirmed) {
    return;
  }
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Deleting...";
  try {
    await deletePatientRecord(patientId);
    removeCustomerFromState(patientId);
    setStatus(`${patientLabel} was deleted.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to delete patient.", { isError: true });
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

async function loadCustomers() {
  setStatus("Loading patients...");
  if (refreshBtn) {
    refreshBtn.disabled = true;
  }
  try {
    const [patients, procedures] = await Promise.all([fetchJson("/patients"), fetchJson("/procedures")]);
    const proceduresByPatient = new Map();
    procedures.forEach((procedure) => {
      const patientId = Number(procedure.patient_id);
      if (!Number.isFinite(patientId)) {
        return;
      }
      if (!proceduresByPatient.has(patientId)) {
        proceduresByPatient.set(patientId, []);
      }
      proceduresByPatient.get(patientId).push(procedure);
    });
    const normalizedPatients = patients.map((patient) => {
      const numericId = Number(patient.id);
      return {
        ...patient,
        id: Number.isFinite(numericId) ? numericId : patient.id,
      };
    });
    allCustomers = sortCustomersByName(
      normalizedPatients.map((patient) => buildCustomerEntry(patient, proceduresByPatient))
    );
    pruneSelectedPatients();
    filteredCustomers = [...allCustomers];
    hasCustomerData = true;
    updateCustomerTotals();
    setStatus("");
    renderCustomers(filteredCustomers);
  } catch (error) {
    console.error(error);
    hasCustomerData = false;
    setStatus(error.message || "Unable to load patients.", { isError: true });
    if (listEl) {
      listEl.innerHTML =
        '<li class="customer-empty customer-empty--error">Unable to load patients. Try refreshing.</li>';
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
    }
  }
}

if (searchInput) {
  searchInput.addEventListener("input", handleSearchInput);
  searchInput.addEventListener("search", () => {
    if (!searchInput.value.trim()) {
      resetSearch();
    } else {
      handleSearchInput();
    }
  });
  setSearchClearState(Boolean(searchInput.value.trim()));
}

searchForm?.addEventListener("submit", handleSearchSubmit);
searchClearBtn?.addEventListener("click", resetSearch);

refreshBtn?.addEventListener("click", () => {
  loadCustomers();
});

listEl?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const deleteButton = target.closest("[data-delete-patient]");
  if (!deleteButton || !(deleteButton instanceof HTMLButtonElement)) {
    return;
  }
  const patientId = Number(deleteButton.dataset.deletePatient);
  if (!Number.isFinite(patientId)) {
    return;
  }
  event.preventDefault();
  handleCustomerDelete(deleteButton, patientId);
});

listEl?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (!target.matches("[data-select-patient]")) {
    return;
  }
  const patientId = Number(target.dataset.selectPatient);
  togglePatientSelection(patientId, target.checked);
});

mergeSelectedBtn?.addEventListener("click", () => {
  if (selectedPatientIds.size < 2) {
    setStatus("Pick at least two patients to combine.", { isError: true });
    return;
  }
  openMergePage();
});

mergeClearBtn?.addEventListener("click", () => {
  clearMergeSelection();
});

mergeOpenBtn?.addEventListener("click", () => {
  openMergePage();
});

ensureAdminLinkVisibility();
loadCustomers();
