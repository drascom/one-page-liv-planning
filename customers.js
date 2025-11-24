import { fetchCurrentUser, handleUnauthorized, initSessionControls } from "./session.js";

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

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

let allCustomers = [];
let filteredCustomers = [];

initSessionControls();

if (searchResultsEl) {
  searchResultsEl.hidden = true;
  searchResultsEl.innerHTML = "";
}

async function ensureAdminLinkVisibility() {
  try {
    const user = await fetchCurrentUser();
    if (user?.is_admin) {
      adminLink?.removeAttribute("hidden");
    }
  } catch (_error) {
    // Ignore – non-admins simply won't see the link.
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
  if (!customers.length) {
    listEl.innerHTML =
      '<li class="customer-empty">No patients match your search. Try another name or city.</li>';
  } else {
    listEl.innerHTML = customers
      .map(
        (customer) => `
        <li class="customer-card">
          <div class="customer-card__primary">
            <a class="customer-card__name" href="patient.html?id=${customer.id}">
              ${customer.first_name || ""} ${customer.last_name || ""}
            </a>
            <p class="customer-card__meta">
              ${customer.city || "City unknown"} • ${customer.email || "No email"}
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
            <p class="customer-card__status">${customer.nextProcedureLabel}</p>
            <a class="secondary-btn customer-card__link" href="patient.html?id=${customer.id}">Open</a>
          </div>
        </li>
      `
      )
      .join("");
  }
  if (visibleCountEl) {
    visibleCountEl.textContent = String(customers.length);
  }
}

function applyCustomerFilter(query) {
  const normalized = normalizeName(query);
  if (!normalized) {
    filteredCustomers = [...allCustomers];
  } else {
    filteredCustomers = allCustomers.filter((customer) => {
      const name = `${normalizeName(customer.first_name)} ${normalizeName(customer.last_name)}`.trim();
      const city = normalizeName(customer.city);
      const email = normalizeName(customer.email);
      return name.includes(normalized) || city.includes(normalized) || email.includes(normalized);
    });
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

async function loadCustomers() {
  if (statusEl) {
    statusEl.textContent = "Loading patients...";
  }
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
    allCustomers = patients
      .map((patient) => buildCustomerEntry(patient, proceduresByPatient))
      .sort((a, b) => {
        const lastCompare = a.last_name.localeCompare(b.last_name);
        if (lastCompare !== 0) return lastCompare;
        return a.first_name.localeCompare(b.first_name);
      });
    filteredCustomers = [...allCustomers];
    if (totalCountEl) {
      totalCountEl.textContent = String(allCustomers.length);
    }
    if (totalInlineEl) {
      totalInlineEl.textContent = String(allCustomers.length);
    }
    if (statusEl) {
      statusEl.textContent = "";
    }
    renderCustomers(filteredCustomers);
  } catch (error) {
    console.error(error);
    if (statusEl) {
      statusEl.textContent = error.message || "Unable to load patients.";
    }
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

ensureAdminLinkVisibility();
loadCustomers();
