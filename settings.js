import { handleUnauthorized, initSessionControls, requireAdminUser } from "./session.js";

const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;

const tokenForm = document.getElementById("token-form");
const tokenNameInput = document.getElementById("token-name");
const tokenStatus = document.getElementById("token-status");
const tokenList = document.getElementById("token-list");
const tokenTestLink = document.getElementById("token-test-link");
const createButton = document.getElementById("create-token-btn");
const settingsTabs = Array.from(document.querySelectorAll("[data-settings-tab]"));
const settingsSections = Array.from(document.querySelectorAll("[data-settings-section]"));
const purgePatientsBtn = document.getElementById("purge-patients-btn");
const purgePatientsStatus = document.getElementById("purge-patients-status");
const purgePatientsDefaultText = purgePatientsBtn?.textContent?.trim() ?? "Delete selected";
const deletedList = document.getElementById("deleted-patient-list");
const deletedStatus = document.getElementById("deleted-patients-status");
const recoverAllBtn = document.getElementById("recover-all-btn");
const refreshDeletedBtn = document.getElementById("refresh-deleted-btn");
let deletedPatientsCache = [];

initSessionControls();

const sectionNames = new Set(settingsSections.map((section) => section.dataset.settingsSection));
const defaultSection = settingsTabs[0]?.dataset.settingsTab ?? null;

function getHashSection() {
  return window.location.hash.replace(/^#/, "");
}

function activateSettingsSection(targetSection, { updateHash = true } = {}) {
  if (!defaultSection) return;
  const nextSection = sectionNames.has(targetSection) ? targetSection : defaultSection;
  settingsTabs.forEach((tab) => {
    const isActive = tab.dataset.settingsTab === nextSection;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.tabIndex = isActive ? 0 : -1;
  });
  settingsSections.forEach((section) => {
    const isActive = section.dataset.settingsSection === nextSection;
    section.hidden = !isActive;
  });
  if (updateHash && window.location.hash !== `#${nextSection}`) {
    window.history.replaceState(null, "", `#${nextSection}`);
  }
}

function initializeSettingsTabs() {
  if (!defaultSection) return;
  const initialSection = getHashSection();
  activateSettingsSection(initialSection || defaultSection, { updateHash: false });
  settingsTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activateSettingsSection(tab.dataset.settingsTab);
    });
  });
  window.addEventListener("hashchange", () => {
    activateSettingsSection(getHashSection(), { updateHash: false });
  });
}

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

const SEARCH_DOC_PATH = "/docs#/default/search_patients_route_api_v1_search_get";
if (tokenTestLink) {
  tokenTestLink.href = buildApiUrl(SEARCH_DOC_PATH);
}

function renderTokens(tokens) {
  if (!tokenList) return;
  if (!tokens.length) {
    tokenList.innerHTML = `<p class="photo-empty">No tokens generated yet.</p>`;
    return;
  }
  tokenList.innerHTML = tokens
    .map(
      (token) => `
        <div class="token-card" data-token-id="${token.id}">
          <div>
            <p class="token-name">${token.name}</p>
            <p class="token-created">Created ${new Date(token.created_at).toLocaleString()}</p>
          </div>
          <div class="token-value-group">
            <code class="token-value">${token.token}</code>
            <button
              type="button"
              class="token-copy-btn"
              data-token-value="${token.token}"
              aria-label="Copy token ${token.name}"
            >
              Copy
            </button>
          </div>
          <button
            type="button"
            class="token-delete-btn"
            aria-label="Delete token ${token.name}"
            data-token-id="${token.id}"
            data-token-name="${token.name}"
          >
            Delete
          </button>
        </div>
      `
    )
    .join("");
}

async function fetchTokens() {
  try {
    const response = await fetch(buildApiUrl("/api-tokens"));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error("Unable to load tokens");
    }
    const tokens = await response.json();
    renderTokens(tokens);
  } catch (error) {
    console.error(error);
    if (tokenStatus) {
      tokenStatus.textContent = error.message;
    }
  }
}

async function createToken(event) {
  event.preventDefault();
  if (!tokenNameInput.value.trim()) {
    tokenStatus.textContent = "Name is required.";
    return;
  }
  tokenStatus.textContent = "Creating token...";
  createButton.disabled = true;
  try {
    const response = await fetch(buildApiUrl("/api-tokens"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tokenNameInput.value.trim() }),
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to create token (${response.status})`);
    }
    const token = await response.json();
    tokenStatus.textContent = "Token created. Copy and store it safely.";
    tokenNameInput.value = "";
    await fetchTokens();
    navigator.clipboard?.writeText(token.token).catch(() => undefined);
  } catch (error) {
    console.error(error);
    tokenStatus.textContent = error.message;
  } finally {
    createButton.disabled = false;
    setTimeout(() => {
      tokenStatus.textContent = "";
    }, 4000);
  }
}

tokenForm.addEventListener("submit", createToken);
tokenList?.addEventListener("click", async (event) => {
  const copyButton = event.target.closest(".token-copy-btn");
  if (copyButton) {
    const value = copyButton.dataset.tokenValue ?? "";
    await copyTokenValue(value);
    return;
  }
  const deleteButton = event.target.closest(".token-delete-btn");
  if (!deleteButton) return;
  const tokenId = Number(deleteButton.dataset.tokenId);
  if (!tokenId) return;
  const tokenName = deleteButton.dataset.tokenName ?? "this token";
  const confirmed = window.confirm(`Delete token "${tokenName}"? This cannot be undone.`);
  if (!confirmed) {
    return;
  }
  deleteButton.disabled = true;
  deleteButton.textContent = "Deleting...";
  tokenStatus.textContent = "Deleting token...";
  try {
    const response = await fetch(buildApiUrl(`/api-tokens/${tokenId}`), {
      method: "DELETE",
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error("Failed to delete token");
    }
    await fetchTokens();
    tokenStatus.textContent = "Token deleted.";
  } catch (error) {
    console.error(error);
    tokenStatus.textContent = error.message;
  } finally {
    deleteButton.disabled = false;
    deleteButton.textContent = "Delete";
    setTimeout(() => {
      tokenStatus.textContent = "";
    }, 4000);
  }
});

async function copyTokenValue(value) {
  if (!value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      fallbackCopy(value);
    }
    tokenStatus.textContent = "Token copied to clipboard.";
  } catch (error) {
    console.error(error);
    try {
      fallbackCopy(value);
      tokenStatus.textContent = "Token copied to clipboard.";
    } catch (fallbackError) {
      console.error(fallbackError);
      tokenStatus.textContent = "Unable to copy token automatically.";
    }
  } finally {
    setTimeout(() => {
      if (tokenStatus.textContent.includes("copied") || tokenStatus.textContent.includes("Unable to copy")) {
        tokenStatus.textContent = "";
      }
    }, 2500);
  }
}

function fallbackCopy(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

const FIELD_METADATA = {
  status: {
    title: "Statuses",
    description: "Controls the badges shown on the schedule.",
    min: 1,
    placeholder: "e.g. Confirmed",
  },
  procedure_type: {
    title: "Procedure Types",
    description: "Used to categorize procedures on the schedule.",
    min: 1,
    placeholder: "e.g. Minor Procedure",
  },
  forms: {
    title: "Forms",
    description: "Checklist requirements for each patient.",
    min: 0,
    placeholder: "e.g. Intake Packet",
  },
  consents: {
    title: "Consents",
    description: "Consent documents patients must complete.",
    min: 0,
    placeholder: "e.g. Surgical Consent",
  },
  consultation: {
    title: "Consultations",
    description: "Consultation touchpoints tracked per patient.",
    min: 0,
    placeholder: "e.g. Pre-op Call",
  },
  payment: {
    title: "Payment Status",
    description: "Displayed as the payment dropdown on the patient form.",
    min: 1,
    placeholder: "e.g. Deposit Paid",
  },
};

const FIELD_DEFAULTS = {
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

const fieldOptionsContainer = document.getElementById("field-options-container");
let currentFieldOptions = JSON.parse(JSON.stringify(FIELD_DEFAULTS));
const optionEditorRefs = new Map();

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchFieldOptionsData() {
  try {
    const response = await fetch(buildApiUrl("/field-options"));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error("Unable to load option lists");
    }
    const payload = await response.json();
    currentFieldOptions = Object.fromEntries(
      Object.keys(FIELD_METADATA).map((field) => {
        const incoming = Array.isArray(payload?.[field]) ? payload[field] : null;
        return [field, incoming && incoming.length ? incoming : FIELD_DEFAULTS[field]];
      })
    );
  } catch (error) {
    console.error(error);
    currentFieldOptions = JSON.parse(JSON.stringify(FIELD_DEFAULTS));
  }
}

function generateUniqueValue(field, label) {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "option";
  const existingValues = new Set(currentFieldOptions[field]?.map((opt) => opt.value));
  if (!existingValues.has(base)) {
    return base;
  }
  let suffix = 2;
  while (existingValues.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function renderOptionList(field) {
  const refs = optionEditorRefs.get(field);
  if (!refs) return;
  const { list } = refs;
  const options = currentFieldOptions[field] ?? [];
  if (!options.length) {
    list.innerHTML = `<li class="option-card__empty">No options yet.</li>`;
    return;
  }
  list.innerHTML = options
    .map(
      (option) => `
        <li class="option-card__item" data-value="${option.value}">
          <span class="option-card__bullet">•</span>
          <div class="option-card__text">
            <span class="option-card__label">${escapeHtml(option.label)}</span>
            <span class="option-card__value">${escapeHtml(option.value)}</span>
          </div>
          <button type="button" class="option-card__remove" aria-label="Remove option">×</button>
        </li>
      `
    )
    .join("");
}

function setStatus(field, message) {
  const refs = optionEditorRefs.get(field);
  if (!refs) return;
  refs.status.textContent = message;
  if (message) {
    setTimeout(() => {
      if (refs.status.textContent === message) {
        refs.status.textContent = "";
      }
    }, 4000);
  }
}

function addOptionFromInput(field) {
  const refs = optionEditorRefs.get(field);
  if (!refs) return;
  const label = refs.input.value.trim();
  if (!label) {
    setStatus(field, "Enter a label before adding.");
    return;
  }
  const value = generateUniqueValue(field, label);
  currentFieldOptions[field] = [...(currentFieldOptions[field] ?? []), { label, value }];
  refs.input.value = "";
  renderOptionList(field);
  setStatus(field, "Added locally. Click Save to persist.");
}

function removeOption(field, value) {
  currentFieldOptions[field] = (currentFieldOptions[field] ?? []).filter((option) => option.value !== value);
  renderOptionList(field);
  setStatus(field, "Removed locally. Click Save to persist.");
}

async function saveFieldOptions(field) {
  const refs = optionEditorRefs.get(field);
  if (!refs) return;
  const meta = FIELD_METADATA[field];
  const options = currentFieldOptions[field] ?? [];
  if (options.length < (meta.min ?? 0)) {
    setStatus(field, `Add at least ${meta.min} option${meta.min === 1 ? "" : "s"}.`);
    return;
  }
  refs.saveButton.disabled = true;
  setStatus(field, "Saving...");
  try {
    const response = await fetch(buildApiUrl(`/field-options/${field}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options }),
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error("Failed to save options");
    }
    const updated = await response.json();
    currentFieldOptions[field] = updated;
    renderOptionList(field);
    setStatus(field, "Saved.");
  } catch (error) {
    console.error(error);
    setStatus(field, error.message);
  } finally {
    refs.saveButton.disabled = false;
  }
}

function renderFieldOptionForms() {
  if (!fieldOptionsContainer) return;
  fieldOptionsContainer.innerHTML = "";
  optionEditorRefs.clear();
  Object.entries(FIELD_METADATA).forEach(([field, meta]) => {
    const card = document.createElement("section");
    card.className = "option-card";
    card.dataset.field = field;
    card.innerHTML = `
      <div class="option-card__title">
        <h3>${meta.title}</h3>
        <p>${meta.description}</p>
      </div>
      <div class="option-card__input-row">
        <input type="text" class="option-card__input" placeholder="${meta.placeholder ?? "Add option"}" />
        <button type="button" class="option-card__add">Add</button>
      </div>
      <ul class="option-card__list"></ul>
      <div class="option-card__footer">
        <button type="button" style="display:none;" class="primary-btn option-card__save">Save</button>
        <span class="option-card__status" aria-live="polite"></span>
      </div>
    `;
    const input = card.querySelector(".option-card__input");
    const addButton = card.querySelector(".option-card__add");
    const list = card.querySelector(".option-card__list");
    const saveButton = card.querySelector(".option-card__save");
    const status = card.querySelector(".option-card__status");
    optionEditorRefs.set(field, { card, input, addButton, list, saveButton, status });

    addButton.addEventListener("click", () => { 
      addOptionFromInput(field);
      saveFieldOptions(field);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addOptionFromInput(field);
      }
    });
    list.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".option-card__remove");
      if (!removeBtn) return;
      const item = removeBtn.closest(".option-card__item");
      const value = item?.dataset.value;
      if (!value) return;
      removeOption(field, value);
      saveFieldOptions(field)
    });
    saveButton.addEventListener("click", () => saveFieldOptions(field));
    renderOptionList(field);
    fieldOptionsContainer.appendChild(card);
  });
}

async function initializeFieldOptions() {
  if (!fieldOptionsContainer) return;
  fieldOptionsContainer.innerHTML = `<p class="option-card__loading">Loading options...</p>`;
  await fetchFieldOptionsData();
  renderFieldOptionForms();
}

purgePatientsBtn?.addEventListener("click", purgeAllPatients);

function setPurgeStatus(message) {
  if (!purgePatientsStatus) return;
  purgePatientsStatus.textContent = message;
  if (message) {
    setTimeout(() => {
      if (purgePatientsStatus.textContent === message) {
        purgePatientsStatus.textContent = "";
      }
    }, 5000);
  }
}

async function purgeAllPatients() {
  if (!purgePatientsBtn) {
    return;
  }
  const confirmed = window.confirm(
    "Delete every patient record permanently (including previously deleted ones)? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  purgePatientsBtn.disabled = true;
  purgePatientsBtn.textContent = "Deleting patients...";
  setPurgeStatus("Deleting all patient records...");
  try {
    const [patientsResponse, deletedResponse] = await Promise.all([
      fetch(buildApiUrl("/patients")),
      fetch(buildApiUrl("/patients/deleted")),
    ]);
    handleUnauthorized(patientsResponse);
    handleUnauthorized(deletedResponse);
    if (!patientsResponse.ok || !deletedResponse.ok) {
      throw new Error("Unable to load patient records.");
    }
    const patients = await patientsResponse.json();
    const deletedPatients = await deletedResponse.json();
    const allPatients = [...patients, ...deletedPatients];
    if (!allPatients.length) {
      setPurgeStatus("No patient records found.");
      return;
    }
    for (const patient of allPatients) {
      const deleteResponse = await fetch(buildApiUrl(`/patients/${patient.id}/purge`), {
        method: "DELETE",
      });
      handleUnauthorized(deleteResponse);
      if (!deleteResponse.ok) {
        throw new Error("Unable to delete all patient records. Please try again.");
      }
    }
    setPurgeStatus(`Deleted ${allPatients.length} patient record${allPatients.length === 1 ? "" : "s"}.`);
    await fetchDeletedPatients();
  } catch (error) {
    console.error(error);
    setPurgeStatus(error.message || "Unable to delete patient records.");
  } finally {
    purgePatientsBtn.disabled = false;
    purgePatientsBtn.textContent = purgePatientsDefaultText;
  }
}

function setDeletedStatus(message) {
  if (!deletedStatus) return;
  deletedStatus.textContent = message;
  if (message) {
    setTimeout(() => {
      if (deletedStatus.textContent === message) {
        deletedStatus.textContent = "";
      }
    }, 5000);
  }
}

function renderDeletedPatients(patients) {
  if (!deletedList) return;
  deletedPatientsCache = Array.isArray(patients) ? patients : [];
  if (!deletedPatientsCache.length) {
    deletedList.innerHTML = `<p class="photo-empty">No deleted patients.</p>`;
    if (recoverAllBtn) {
      recoverAllBtn.disabled = true;
    }
    return;
  }
  if (recoverAllBtn) {
    recoverAllBtn.disabled = false;
  }
  deletedList.innerHTML = deletedPatientsCache
    .map(
      (patient) => `
        <div class="token-card" data-patient-id="${patient.id}">
          <div>
            <p class="token-name">${escapeHtml(`${patient.first_name} ${patient.last_name}`.trim() || "Patient")}</p>
            <p class="token-created">${escapeHtml(patient.week_label || "")} • ${escapeHtml(
        patient.day_label || ""
      )} • ${escapeHtml(patient.procedure_date || "No date")}</p>
            <p class="token-created">Status: ${escapeHtml(patient.status || "Unknown")} • ${
        patient.city ? escapeHtml(patient.city) : "City N/A"
      }</p>
          </div>
          <div class="token-actions">
            <button
              type="button"
              class="secondary-btn"
              data-action="recover"
              data-patient-id="${patient.id}"
            >
              Recover
            </button>
            <button
              type="button"
              class="danger-btn"
              data-action="purge"
              data-patient-id="${patient.id}"
            >
              Delete permanently
            </button>
          </div>
        </div>
      `
    )
    .join("");
}

async function fetchDeletedPatients() {
  if (!deletedList) return;
  setDeletedStatus("Loading deleted patients...");
  try {
    const response = await fetch(buildApiUrl("/patients/deleted"));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error("Unable to load deleted patients.");
    }
    const patients = await response.json();
    renderDeletedPatients(patients);
    setDeletedStatus("");
  } catch (error) {
    console.error(error);
    setDeletedStatus(error.message || "Unable to load deleted patients.");
  }
}

async function recoverPatient(patientId, trigger, { refresh = true } = {}) {
  if (!patientId) return;
  if (trigger) {
    trigger.disabled = true;
    trigger.textContent = "Recovering...";
  }
  try {
    const response = await fetch(buildApiUrl(`/patients/${patientId}/recover`), {
      method: "POST",
    });
    handleUnauthorized(response);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "Unable to recover this patient.");
    }
    setDeletedStatus("Patient restored.");
    if (refresh) {
      await fetchDeletedPatients();
    }
  } catch (error) {
    console.error(error);
    setDeletedStatus(error.message || "Unable to recover patient.");
  } finally {
    if (trigger) {
      trigger.disabled = false;
      trigger.textContent = "Recover";
    }
  }
}

async function recoverAllPatients() {
  if (!deletedPatientsCache.length) {
    setDeletedStatus("No deleted patients to recover.");
    return;
  }
  if (!window.confirm(`Recover ${deletedPatientsCache.length} patient${deletedPatientsCache.length === 1 ? "" : "s"}?`)) {
    return;
  }
  if (recoverAllBtn) {
    recoverAllBtn.disabled = true;
    recoverAllBtn.textContent = "Recovering...";
  }
  try {
    for (const patient of deletedPatientsCache) {
      // eslint-disable-next-line no-await-in-loop
      await recoverPatient(patient.id, null, { refresh: false });
    }
    await fetchDeletedPatients();
    setDeletedStatus("Recovered all deleted patients.");
  } catch (error) {
    console.error(error);
    setDeletedStatus(error.message || "Unable to recover all patients.");
  } finally {
    if (recoverAllBtn) {
      recoverAllBtn.textContent = "Recover all";
      recoverAllBtn.disabled = false;
    }
  }
}

deletedList?.addEventListener("click", (event) => {
  const recoverBtn = event.target.closest("[data-action='recover']");
  if (!recoverBtn) return;
  const patientId = Number(recoverBtn.dataset.patientId);
  if (!Number.isFinite(patientId)) return;
  recoverPatient(patientId, recoverBtn);
});

async function purgePatientPermanently(patientId, trigger) {
  if (!patientId) return;
  if (!window.confirm("Permanently delete this patient and surgery details? This cannot be undone.")) {
    return;
  }
  if (trigger) {
    trigger.disabled = true;
    trigger.textContent = "Deleting...";
  }
  try {
    const response = await fetch(buildApiUrl(`/patients/${patientId}/purge`), {
      method: "DELETE",
    });
    handleUnauthorized(response);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "Unable to delete this patient.");
    }
    setDeletedStatus("Patient permanently deleted.");
    await fetchDeletedPatients();
  } catch (error) {
    console.error(error);
    setDeletedStatus(error.message || "Unable to delete patient.");
  } finally {
    if (trigger) {
      trigger.disabled = false;
      trigger.textContent = "Delete permanently";
    }
  }
}

deletedList?.addEventListener("click", (event) => {
  const recoverBtn = event.target.closest("[data-action='recover']");
  if (recoverBtn) {
    const patientId = Number(recoverBtn.dataset.patientId);
    if (!Number.isFinite(patientId)) return;
    recoverPatient(patientId, recoverBtn);
    return;
  }
  const purgeBtn = event.target.closest("[data-action='purge']");
  if (!purgeBtn) return;
  const patientId = Number(purgeBtn.dataset.patientId);
  if (!Number.isFinite(patientId)) return;
  purgePatientPermanently(patientId, purgeBtn);
});

recoverAllBtn?.addEventListener("click", recoverAllPatients);
refreshDeletedBtn?.addEventListener("click", fetchDeletedPatients);

const userAdminContainer = document.getElementById("user-admin");
const userWarning = document.getElementById("user-admin-warning");
const userList = document.getElementById("user-list");
const userForm = document.getElementById("user-form");
const newUsernameInput = document.getElementById("new-username");
const newPasswordInput = document.getElementById("new-password");
const newIsAdminInput = document.getElementById("new-is-admin");
const userFormStatus = document.getElementById("user-form-status");
let currentUser = null;

function renderUserList(users) {
  if (!userList) {
    return;
  }
  if (!users.length) {
    userList.innerHTML = `<li class="option-card__empty">No users yet.</li>`;
    return;
  }
  userList.innerHTML = users
    .map(
      (user) => `
        <li class="user-list__item" data-user-id="${user.id}" data-is-admin="${user.is_admin}">
          <div class="user-list__info">
            <span class="user-list__name">${escapeHtml(user.username)}</span>
            <span class="user-list__role">${user.is_admin ? "Admin" : "User"}</span>
          </div>
          <div class="user-list__actions">
            <button type="button" data-action="toggle-admin" class="secondary-btn">
              ${user.is_admin ? "Remove admin" : "Make admin"}
            </button>
            <button type="button" data-action="reset-password" class="secondary-btn">Reset password</button>
            ${currentUser && currentUser.id === user.id ? "" : '<button type="button" data-action="delete" class="danger-btn">Delete</button>'}
          </div>
        </li>
      `
    )
    .join("");
}

async function fetchUsers() {
  try {
    const response = await fetch(buildApiUrl("/auth/users"));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error("Unable to load users");
    }
    const payload = await response.json();
    renderUserList(payload);
  } catch (error) {
    userWarning.textContent = error.message;
  }
}

async function createUser(event) {
  event.preventDefault();
  if (!userFormStatus) return;
  userFormStatus.textContent = "Creating user...";
  try {
    const response = await fetch(buildApiUrl("/auth/users"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: newUsernameInput.value.trim(),
        password: newPasswordInput.value,
        is_admin: newIsAdminInput.checked,
      }),
    });
    handleUnauthorized(response);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "Unable to create user");
    }
    newUsernameInput.value = "";
    newPasswordInput.value = "";
    newIsAdminInput.checked = false;
    await fetchUsers();
    userFormStatus.textContent = "User created.";
  } catch (error) {
    userFormStatus.textContent = error.message;
  } finally {
    setTimeout(() => {
      if (userFormStatus) {
        userFormStatus.textContent = "";
      }
    }, 4000);
  }
}

async function toggleUserAdmin(userId, isAdmin) {
  const response = await fetch(buildApiUrl(`/auth/users/${userId}/role`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_admin: !isAdmin }),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error("Unable to update role");
  }
  await fetchUsers();
}

async function resetUserPassword(userId) {
  const nextPassword = window.prompt("Enter a new password.", "");
  if (!nextPassword) return;
  const response = await fetch(buildApiUrl(`/auth/users/${userId}/password`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: nextPassword }),
  });
  handleUnauthorized(response);
  if (!response.ok) {
    throw new Error("Unable to reset password");
  }
  userWarning.textContent = "Password updated.";
  setTimeout(() => {
    userWarning.textContent = "";
  }, 3000);
}

async function deleteUser(userId) {
  if (!window.confirm("Delete this user?")) {
    return;
  }
  const response = await fetch(buildApiUrl(`/auth/users/${userId}`), {
    method: "DELETE",
  });
  handleUnauthorized(response);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Unable to delete user");
  }
  await fetchUsers();
}

async function handleUserAction(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const row = actionButton.closest(".user-list__item");
  if (!row) return;
  const userId = Number(row.dataset.userId);
  const isAdmin = row.dataset.isAdmin === "true";
  try {
    if (actionButton.dataset.action === "toggle-admin") {
      await toggleUserAdmin(userId, isAdmin);
    } else if (actionButton.dataset.action === "reset-password") {
      await resetUserPassword(userId);
    } else if (actionButton.dataset.action === "delete") {
      await deleteUser(userId);
    }
  } catch (error) {
    userWarning.textContent = error.message;
  }
}

async function initializeUserManagement() {
  if (!userAdminContainer) return;
  if (!currentUser) {
    userWarning.textContent = "Sign in again to manage users.";
    return;
  }
  if (!currentUser.is_admin) {
    userWarning.textContent = "Only admins can manage users.";
    return;
  }
  userAdminContainer.hidden = false;
  userForm?.addEventListener("submit", createUser);
  userList?.addEventListener("click", handleUserAction);
  await fetchUsers();
}

async function initializeSettingsPage() {
  currentUser = await requireAdminUser({ redirectTo: "/" });
  if (!currentUser) {
    return;
  }
  initializeSettingsTabs();
  initializeFieldOptions();
  if (recoverAllBtn) {
    recoverAllBtn.disabled = true;
  }
  await fetchDeletedPatients();
  await initializeUserManagement();
  fetchTokens();
}

initializeSettingsPage();
