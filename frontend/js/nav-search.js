import { handleUnauthorized } from "./session.js";

const GLOBAL_SEARCH_KEY = "globalSearchQuery";
const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ?? `${window.location.protocol}//${window.location.host}`;
const MAX_RESULTS = 8;

const searchForm = document.getElementById("patient-search-form");
const searchInput = document.getElementById("patient-search");
const searchClearBtn = document.getElementById("patient-search-clear");
const searchResultsEl = document.getElementById("patient-search-results");

let patientDirectory = [];
let patientsLoaded = false;
let loadingPatients = false;
let lastSearchToken = 0;

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

function setSearchClearState(active) {
  if (searchClearBtn) {
    searchClearBtn.hidden = !active;
  }
}

function clearSearchResults() {
  if (searchResultsEl) {
    searchResultsEl.innerHTML = "";
    searchResultsEl.hidden = true;
  }
}

function showSearchStatus(message) {
  if (!searchResultsEl) {
    return;
  }
  searchResultsEl.hidden = false;
  searchResultsEl.innerHTML = `<li class="patient-search__result patient-search__result--status">${message}</li>`;
}

function resetSearchField() {
  if (searchInput) {
    searchInput.value = "";
  }
  setSearchClearState(false);
  clearSearchResults();
}

function formatPatientName(patient) {
  return `${patient.first_name || ""} ${patient.last_name || ""}`.trim() || "Unnamed patient";
}

function normalizeValue(value) {
  return (value || "").toString().trim().toLowerCase();
}

function matchesPatient(patient, term) {
  const normalizedTerm = normalizeValue(term);
  if (!normalizedTerm) {
    return false;
  }
  const name = normalizeValue(`${patient.first_name} ${patient.last_name}`);
  const email = normalizeValue(patient.email);
  const phone = normalizeValue(patient.phone);
  const address = normalizeValue(patient.address || patient.city);
  return (
    name.includes(normalizedTerm) ||
    email.includes(normalizedTerm) ||
    phone.includes(normalizedTerm) ||
    address.includes(normalizedTerm)
  );
}

function renderSearchResults(matches) {
  if (!searchResultsEl) {
    return;
  }
  if (!matches.length) {
    showSearchStatus("No patients match that name.");
    return;
  }
  searchResultsEl.hidden = false;
  searchResultsEl.innerHTML = "";
  matches.slice(0, MAX_RESULTS).forEach((patient) => {
    const item = document.createElement("li");
    item.className = "patient-search__result";
    item.dataset.patientId = String(patient.id);
    item.setAttribute("role", "option");
    item.tabIndex = 0;
    const name = document.createElement("span");
    name.className = "patient-search__result-name";
    name.textContent = formatPatientName(patient);
    const meta = document.createElement("span");
    meta.className = "patient-search__result-meta";
    meta.textContent = patient.address || patient.city || patient.email || "Open record";
    item.append(name, meta);
    item.addEventListener("click", () => openPatientRecord(patient));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPatientRecord(patient);
      }
    });
    searchResultsEl.appendChild(item);
  });
}

function openPatientRecord(patient) {
  if (!patient?.id) {
    return;
  }
  clearSearchResults();
  const params = new URLSearchParams({
    id: String(patient.id),
    patient: formatPatientName(patient),
  });
  window.location.href = `patient.html?${params.toString()}`;
}

async function loadPatientDirectory() {
  if (patientsLoaded || loadingPatients) {
    return patientDirectory;
  }
  loadingPatients = true;
  try {
    const response = await fetch(buildApiUrl("/patients"));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to load patients (${response.status})`);
    }
    const payload = await response.json();
    patientDirectory = Array.isArray(payload) ? payload : [];
  } catch (error) {
    console.error("Unable to load patient directory for search", error);
    patientDirectory = [];
  } finally {
    patientsLoaded = true;
    loadingPatients = false;
  }
  return patientDirectory;
}

async function performSearch(query) {
  const token = ++lastSearchToken;
  const trimmed = query.trim();
  if (!trimmed) {
    resetSearchField();
    return;
  }
  setSearchClearState(true);
  showSearchStatus("Searching…");
  const patients = await loadPatientDirectory();
  if (token !== lastSearchToken) {
    return;
  }
  if (!patients.length) {
    showSearchStatus("Unable to load patients.");
    return;
  }
  const matches = patients.filter((patient) => matchesPatient(patient, trimmed));
  renderSearchResults(matches);
}

async function handleNavSearchSubmit(event) {
  event.preventDefault();
  if (!searchInput) {
    return;
  }
  const query = searchInput.value.trim();
  if (!query) {
    resetSearchField();
    return;
  }
  const patients = await loadPatientDirectory();
  const directMatch = patients.find((patient) => matchesPatient(patient, query));
  if (directMatch) {
    openPatientRecord(directMatch);
    return;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(GLOBAL_SEARCH_KEY, query);
    } catch {
      // Ignore storage failures
    }
  }
  window.location.href = "/schedule";
}

if (searchResultsEl) {
  clearSearchResults();
}

if (searchForm && searchInput) {
  searchForm.addEventListener("submit", handleNavSearchSubmit);
  searchInput.addEventListener("input", (event) => {
    const value = event.target.value || "";
    if (!value.trim()) {
      resetSearchField();
      return;
    }
    performSearch(value);
  });
  searchInput.addEventListener("search", () => {
    const hasValue = Boolean(searchInput.value.trim());
    if (!hasValue) {
      resetSearchField();
    }
  });
}

if (searchClearBtn) {
  searchClearBtn.addEventListener("click", () => {
    resetSearchField();
  });
  setSearchClearState(Boolean(searchInput?.value.trim()));
} else if (searchInput) {
  setSearchClearState(Boolean(searchInput.value.trim()));
}
