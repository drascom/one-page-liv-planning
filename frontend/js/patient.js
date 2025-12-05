import { fetchCurrentUser, handleUnauthorized, initSessionControls } from "./session.js";

const DEFAULT_FIELD_OPTIONS = {
  status: [
    { value: "reserved", label: "Reserved" },
    { value: "confirmed", label: "Confirmed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "insurgery", label: "In Surgery" },
    { value: "done", label: "Done" },
  ],
  procedure_type: [
    { value: "consultation", label: "Consultation" },
    { value: "sfue", label: "sFUE" },
    { value: "beard", label: "Beard" },
    { value: "woman", label: "Woman" },
    { value: "eyebrow", label: "Eyebrow" },
  ],
  package_type: [
    { value: "consultation", label: "Consultation" },
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
    { value: "form-1", label: "Form 1" },
    { value: "form-2", label: "Form 2" },
    { value: "form-3", label: "Form 3" },
    { value: "form-4", label: "Form 4" },
    { value: "form-5", label: "Form 5" },
  ],
  consents: [
    { value: "consent-1", label: "Consent 1" },
    { value: "consent-2", label: "Consent 2" },
    { value: "consent-3", label: "Consent 3" },
  ],
  consultation: [
    { value: "consultation1", label: "Consultation 1" },
    { value: "consultation2", label: "Consultation 2" },
  ],
};

const DEFAULT_CONTACT = {
  email: "test@example.com",
  phone: "+44 12345678",
  address: "London",
};

let fieldOptions = JSON.parse(JSON.stringify(DEFAULT_FIELD_OPTIONS));
const ACTIVE_PATIENT_KEY = "activePatient";
const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;
const BOOKING_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "short" });

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

function getFieldOptions(field) {
  return fieldOptions[field] ?? [];
}

function getFieldOptionValues(field) {
  return getFieldOptions(field).map((option) => option.value);
}

function getOptionLabel(field, value) {
  if (!value) return "";
  const match = getFieldOptions(field).find((option) => option.value === value);
  return match?.label ?? value;
}

initSessionControls();

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

function populateSelectOptions(selectEl, field, { multiple = false } = {}) {
  if (!selectEl) return;
  const options = getFieldOptions(field);
  selectEl.innerHTML = options
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  if (!options.length && !multiple) {
    selectEl.innerHTML = `<option value="">No options configured</option>`;
    selectEl.disabled = true;
  } else {
    selectEl.disabled = false;
  }
}

function renderOptionControls() {
  populateSelectOptions(statusSelect, "status");
  populateSelectOptions(procedureSelect, "procedure_type");
  populateSelectOptions(packageTypeSelect, "package_type");
  populateSelectOptions(paymentSelect, "payment");
  populateSelectOptions(agencySelect, "agency");
  populateSelectOptions(consultationSelect, "consultation", { multiple: true });
  buildConsultationsChecklist();
  populateSelectOptions(formsSelect, "forms", { multiple: true });
  buildFormsChecklist();
  populateSelectOptions(consentsSelect, "consents", { multiple: true });
  buildConsentsChecklist();
}

function refreshChecklistState(container, selectEl) {
  if (!container || !selectEl) return;
  const selected = new Set(collectMultiValue(selectEl));
  container.querySelectorAll(".form-checklist__item").forEach((item) => {
    const value = item.dataset.value;
    const isSelected = selected.has(value);
    item.classList.toggle("is-selected", isSelected);
    item.setAttribute("aria-pressed", isSelected ? "true" : "false");
    const icon = item.querySelector(".form-checklist__icon");
    if (icon) {
      icon.textContent = isSelected ? "✓" : "✕";
    }
  });
}

function buildChecklist(container, selectEl, field) {
  if (!container || !selectEl) return;
  container.innerHTML = "";
  const options = getFieldOptions(field);
  options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "form-checklist__item";
    button.dataset.value = option.value;
    button.innerHTML = `
      <span class="form-checklist__meta">
        <span class="form-checklist__number">${String(index + 1).padStart(2, "0")}</span>
        <span class="form-checklist__label">${option.label}</span>
      </span>
      <span class="form-checklist__icon" aria-hidden="true">✕</span>
    `;
    button.addEventListener("click", () => {
      const current = new Set(collectMultiValue(selectEl));
      if (current.has(option.value)) {
        current.delete(option.value);
      } else {
        current.add(option.value);
      }
      setMultiValue(selectEl, Array.from(current));
      refreshChecklistState(container, selectEl);
    });
    container.appendChild(button);
  });
  refreshChecklistState(container, selectEl);
}

function refreshFormsChecklist() {
  refreshChecklistState(formsChecklist, formsSelect);
}

function buildFormsChecklist() {
  buildChecklist(formsChecklist, formsSelect, "forms");
}

function refreshConsentsChecklist() {
  refreshChecklistState(consentsChecklist, consentsSelect);
}

function buildConsentsChecklist() {
  buildChecklist(consentsChecklist, consentsSelect, "consents");
}

function refreshConsultationsChecklist() {
  refreshChecklistState(consultationsChecklist, consultationSelect);
}

function buildConsultationsChecklist() {
  buildChecklist(consultationsChecklist, consultationSelect, "consultation");
}

const patientNameEl = document.getElementById("patient-name");
const patientWeekEl = document.getElementById("patient-week");
const patientAddressEl = document.getElementById("patient-address");
const bookingListEl = document.getElementById("patient-bookings-list");
const proceduresStatusEl = document.getElementById("procedures-status");
const formEl = document.getElementById("patient-form");
const formStatusEl = document.getElementById("form-status");
const patientStatusEl = document.getElementById("patient-status");
const procedureFormStatusEl = document.getElementById("procedure-form-status");
const settingsLink = document.querySelector("[data-admin-link]");
const adminCustomerLinks = document.querySelectorAll("[data-admin-customers]");
const deletePatientBtn = document.getElementById("delete-patient-btn");
const addProcedureBtn = document.getElementById("add-procedure-btn");
const cancelProcedureBtn = document.getElementById("cancel-procedure-btn");

const firstNameInput = document.getElementById("first-name");
const lastNameInput = document.getElementById("last-name");
const procedureDateInput = document.getElementById("procedure-date");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const addressInput = document.getElementById("address");
const statusSelect = document.getElementById("status");
const procedureSelect = document.getElementById("procedure-type");
const packageTypeSelect = document.getElementById("package-type");
const graftsInput = document.getElementById("grafts");
const paymentSelect = document.getElementById("payment");
const outstandingBalanceInput = document.getElementById("outstanding-balance");
const agencySelect = document.getElementById("agency");
const consultationSelect = document.getElementById("consultation");
const consultationsChecklist = document.getElementById("consultations-checklist");
const formsSelect = document.getElementById("forms");
const formsChecklist = document.getElementById("forms-checklist");
const consentsChecklist = document.getElementById("consents-checklist");
const consentsSelect = document.getElementById("consents");
const noteInput = document.getElementById("procedure-note-input");
const addNoteBtn = document.getElementById("add-procedure-note");
const notesListEl = document.getElementById("procedure-notes-list");
const driveFolderInput = document.getElementById("drive-folder-id");
const driveFolderGroup = document.getElementById("drive-folder-group");

const dropZone = document.getElementById("drop-zone");
const uploadList = document.getElementById("upload-list");
const uploadStatus = document.getElementById("upload-status");
const fileInput = document.getElementById("photo-input");
const browseButton = document.getElementById("browse-button");
const galleryContainer = document.getElementById("photo-gallery");
const galleryEmptyState = document.getElementById("photo-empty");
const viewerEl = document.getElementById("photo-viewer");
const viewerImage = document.getElementById("photo-viewer-image");
const viewerCaption = document.getElementById("photo-viewer-caption");
const viewerCloseBtn = document.getElementById("photo-viewer-close");
const viewerPrevBtn = document.getElementById("photo-viewer-prev");
const viewerNextBtn = document.getElementById("photo-viewer-next");
const viewerDeleteBtn = document.getElementById("photo-viewer-delete");
const documentsListEl = document.getElementById("documents-list");
const documentsEmptyStateEl = document.getElementById("documents-empty");

// Debug Elements
const adminDebugSection = document.getElementById("admin-debug");
const debugDriveFolderEl = document.getElementById("debug-drive-folder");
const debugDriveFilesEl = document.getElementById("debug-drive-files");
const debugDriveCountEl = document.getElementById("debug-drive-count");
const debugTestDriveBtn = document.getElementById("debug-test-drive");
const debugConsoleEl = document.getElementById("debug-console");

const params = new URLSearchParams(window.location.search);
const requestedId = params.get("id");
const requestedName = params.get("patient");
const requestedProcedureIdParam = params.get("procedure");
const requestedProcedureId = requestedProcedureIdParam ? Number(requestedProcedureIdParam) : null;

let currentPatient = null;
let isAdminUser = false;
let currentUser = null;
let patientProcedures = [];
let activeProcedure = null;
let procedureNotes = [];
let driveFolderFilesCache = [];
let activeDrivePhotoIndex = 0;

function loadActiveContext() {
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

function persistReturnToScheduleContext(patient, procedure) {
  if (!patient || typeof window === "undefined" || !window.localStorage) {
    return;
  }
  const scheduleMeta = buildScheduleContextFromProcedure(procedure);
  try {
    localStorage.setItem(
      ACTIVE_PATIENT_KEY,
      JSON.stringify({
        patientId: patient.id,
        patient: `${patient.first_name} ${patient.last_name}`.trim(),
        weekLabel: scheduleMeta.weekLabel,
        weekRange: scheduleMeta.weekRange,
        day: scheduleMeta.dayLabel,
        monthLabel: scheduleMeta.monthLabel,
        procedureDate: scheduleMeta.procedureDate,
        procedureId: procedure?.id,
        shouldReturnToSchedule: true,
        capturedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.warn("Unable to persist active patient context", error);
  }
}

function syncHeader(patient, procedure) {
  const displayName = `${patient?.first_name || ""} ${patient?.last_name || ""}`.trim() || requestedName || "Patient";
  patientNameEl.textContent = displayName;
  const scheduleMeta = buildScheduleContextFromProcedure(procedure);
  const weekBits = [scheduleMeta.weekLabel, scheduleMeta.dayLabel].filter(Boolean).join(" • ");
  patientWeekEl.textContent = weekBits;
  const address = patient?.address || patient?.city || "";
  patientAddressEl.textContent = address ? `Address: ${address}` : "";
}

function setMultiValue(selectEl, values) {
  const selected = new Set(values || []);
  Array.from(selectEl.options).forEach((option) => {
    option.selected = selected.has(option.value);
  });
}

function generateNoteId() {
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeNotes(rawNotes) {
  if (!Array.isArray(rawNotes)) return [];
  return rawNotes
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === "string") {
        const text = entry.trim();
        if (!text) return null;
        return {
          id: generateNoteId(),
          text,
          completed: false,
          user_id: null,
          author: null,
          created_at: new Date().toISOString(),
        };
      }
      const text = String(entry.text || entry.note || "").trim();
      if (!text) return null;
      return {
        id: entry.id || entry._id || generateNoteId(),
        text,
        completed: Boolean(entry.completed || entry.done),
        user_id: entry.user_id ?? null,
        author: entry.author ?? null,
        created_at: entry.created_at || new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function canDeleteNote(note) {
  if (!note) return false;
  if (note.user_id == null) {
    return true; // legacy/ownerless notes
  }
  if (!currentUser) {
    return false;
  }
  return Number(note.user_id) === Number(currentUser.id);
}

function updateActiveProcedureNotes(nextNotes) {
  procedureNotes = Array.isArray(nextNotes) ? nextNotes : [];
  if (activeProcedure) {
    activeProcedure.notes = procedureNotes;
    const idx = patientProcedures.findIndex((p) => p.id === activeProcedure.id);
    if (idx >= 0) {
      patientProcedures[idx] = { ...patientProcedures[idx], notes: procedureNotes };
    }
  }
  renderNotesList();
}

function renderNotesList() {
  if (!notesListEl) return;
  notesListEl.innerHTML = "";
  if (!procedureNotes.length) {
    const empty = document.createElement("li");
    empty.textContent = "No notes yet.";
    empty.className = "todo-meta";
    notesListEl.appendChild(empty);
    return;
  }
  procedureNotes.forEach((note) => {
    const item = document.createElement("li");
    item.className = "todo-item";

    const main = document.createElement("div");
    main.className = "todo-item__main";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(note.completed);
    checkbox.addEventListener("change", () => {
      note.completed = checkbox.checked;
      updateActiveProcedureNotes([...procedureNotes]);
    });

    const textWrapper = document.createElement("div");
    const textEl = document.createElement("p");
    textEl.className = "todo-text";
    if (note.completed) textEl.classList.add("is-completed");
    textEl.textContent = note.text;
    const meta = document.createElement("p");
    meta.className = "todo-meta";
    const authorLabel =
      note.user_id != null && currentUser && Number(note.user_id) === Number(currentUser.id)
        ? "You"
        : note.author || "Someone";
    meta.textContent = note.completed
      ? `Completed • ${authorLabel}`
      : `Added by ${authorLabel}`;
    textWrapper.appendChild(textEl);
    textWrapper.appendChild(meta);

    main.appendChild(checkbox);
    main.appendChild(textWrapper);

    const actions = document.createElement("div");
    actions.className = "todo-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "todo-delete-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.disabled = !canDeleteNote(note);
    deleteBtn.title = deleteBtn.disabled ? "You can only delete your own notes" : "Delete note";
    deleteBtn.addEventListener("click", () => {
      if (!canDeleteNote(note)) return;
      const remaining = procedureNotes.filter((entry) => entry.id !== note.id);
      updateActiveProcedureNotes(remaining);
    });
    actions.appendChild(deleteBtn);

    item.appendChild(main);
    item.appendChild(actions);
    notesListEl.appendChild(item);
  });
}

function addNoteFromInput() {
  if (!noteInput) return;
  const text = noteInput.value.trim();
  if (!text) return;
  const note = {
    id: generateNoteId(),
    text,
    completed: false,
    user_id: currentUser?.id ?? null,
    author: currentUser?.username ?? "You",
    created_at: new Date().toISOString(),
  };
  updateActiveProcedureNotes([...procedureNotes, note]);
  noteInput.value = "";
}

function populatePatientForm(record) {
  if (!record) {
    return;
  }
  firstNameInput.value = record.first_name || "";
  lastNameInput.value = record.last_name || "";
  emailInput.value = record.email || DEFAULT_CONTACT.email;
  phoneInput.value = record.phone || DEFAULT_CONTACT.phone;
  addressInput.value = record.address || record.city || DEFAULT_CONTACT.address;
  if (driveFolderInput) {
    driveFolderInput.value = record.drive_folder_id || "";
  }
  if (driveFolderGroup) {
    driveFolderGroup.hidden = !isAdminUser;
  }
  refreshDeleteButtonState();
  syncHeader(record, activeProcedure);
}

function clearProcedureForm() {
  procedureDateInput.value = "";
  statusSelect.value = getFieldOptions("status")[0]?.value || "";
  procedureSelect.value = getFieldOptions("procedure_type")[0]?.value || "";
  if (packageTypeSelect) {
    packageTypeSelect.value = getFieldOptions("package_type")[0]?.value || "";
  }
  graftsInput.value = "";
  paymentSelect.value = getFieldOptions("payment")[0]?.value || "";
  if (agencySelect) {
    agencySelect.value = getFieldOptions("agency")[0]?.value || "";
  }
  if (outstandingBalanceInput) {
    outstandingBalanceInput.value = "";
  }
  updateActiveProcedureNotes([]);
  setMultiValue(consultationSelect, []);
  refreshConsultationsChecklist();
  setMultiValue(formsSelect, []);
  refreshFormsChecklist();
  setMultiValue(consentsSelect, []);
  refreshConsentsChecklist();
  if (procedureFormStatusEl) {
    procedureFormStatusEl.textContent = "";
  }
}

function populateProcedureForm(procedure) {
  if (!procedure) {
    clearProcedureForm();
    syncHeader(currentPatient || {}, null);
    return;
  }
  procedureDateInput.value = procedure.procedure_date || "";
  statusSelect.value = procedure.status || getFieldOptions("status")[0]?.value || "";
  procedureSelect.value = procedure.procedure_type || getFieldOptions("procedure_type")[0]?.value || "";
  if (packageTypeSelect) {
    packageTypeSelect.value = procedure.package_type || getFieldOptions("package_type")[0]?.value || "";
  }
  const graftsNumber = Number(procedure.grafts);
  graftsInput.value = Number.isFinite(graftsNumber) && graftsNumber >= 0 ? String(graftsNumber) : "";
  paymentSelect.value = procedure.payment || getFieldOptions("payment")[0]?.value || "";
  if (agencySelect) {
    agencySelect.value = procedure.agency || getFieldOptions("agency")[0]?.value || "";
  }
  if (outstandingBalanceInput) {
    const balance = Number(procedure.outstanding_balance);
    outstandingBalanceInput.value = Number.isFinite(balance) ? String(balance) : "";
  }
  updateActiveProcedureNotes(normalizeNotes(procedure.notes || []));
  if (consultationSelect) {
    const selectedConsultations = Array.isArray(procedure.consultation)
      ? procedure.consultation
      : procedure.consultation
        ? [procedure.consultation]
        : [];
    setMultiValue(consultationSelect, selectedConsultations);
  }
  refreshConsultationsChecklist();
  setMultiValue(formsSelect, procedure.forms || []);
  refreshFormsChecklist();
  setMultiValue(consentsSelect, procedure.consents || []);
  refreshConsentsChecklist();
  syncHeader(currentPatient || {}, procedure);
  if (procedureFormStatusEl) {
    procedureFormStatusEl.textContent = "";
  }
}

function disableForm(disabled) {
  Array.from(formEl.elements).forEach((element) => {
    element.disabled = disabled;
  });
  if (addProcedureBtn) {
    addProcedureBtn.disabled = disabled;
  }
  if (cancelProcedureBtn) {
    cancelProcedureBtn.disabled = disabled || !activeProcedure;
  }
}

async function fetchPatient() {
  if (!requestedId) {
    const context = loadActiveContext();
    patientNameEl.textContent = context?.patient || requestedName || "Patient";
    patientWeekEl.textContent = context?.weekLabel || "";
    formStatusEl.textContent = "Select a patient from the schedule first.";
    patientStatusEl.textContent = "";
    procedureFormStatusEl.textContent = "";
    proceduresStatusEl.textContent = "";
    disableForm(true);
    currentPatient = null;
    patientProcedures = [];
    activeProcedure = null;
    updateActiveProcedureNotes([]);
    driveFolderFilesCache = [];
    renderDriveAssets();
    refreshDeleteButtonState();
    renderRelatedBookings(null);
    return;
  }
  try {
    patientStatusEl.textContent = "Loading patient...";
    const response = await fetch(buildApiUrl(`/patients/${requestedId}`));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const record = await response.json();
    currentPatient = record;
    driveFolderFilesCache = [];
    renderDriveAssets();
    if (record.drive_folder_id) {
        await fetchDriveFolderFiles(record.drive_folder_id);
    }
    populatePatientForm(currentPatient);
    patientStatusEl.textContent = "";
    await fetchProceduresForPatient(record.id);
    formStatusEl.textContent = "";
    disableForm(false);
    refreshDeleteButtonState();
    if (isAdminUser) {
      updateDebugInfo();
    }
  } catch (error) {
    console.error(error);
    formStatusEl.textContent = "Unable to load patient details.";
    patientStatusEl.textContent = "";
    disableForm(true);
    currentPatient = null;
    patientProcedures = [];
    activeProcedure = null;
    updateActiveProcedureNotes([]);
    driveFolderFilesCache = [];
    renderDriveAssets();
    refreshDeleteButtonState();
    renderRelatedBookings(null);
  }
}

function collectMultiValue(selectEl) {
  return Array.from(selectEl.selectedOptions).map((option) => option.value);
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

function getDriveFiles() {
  // Prefer the live folder fetch when available
  if (Array.isArray(driveFolderFilesCache) && driveFolderFilesCache.length > 0) {
    return driveFolderFilesCache;
  }

  return [];
}

function buildDriveFileUrl(fileObj) {
  if (!fileObj) return "";
  if (fileObj.id) {
    return `/drive-image/${fileObj.id}`;
  }
  return fileObj.driveLink || "";
}

function isPdfFile(file) {
  const mime = (file?.mimeType || "").toLowerCase();
  const name = (file?.name || "").toLowerCase();
  return mime === "application/pdf" || name.endsWith(".pdf");
}

function isZipFile(file) {
  const mime = (file?.mimeType || "").toLowerCase();
  const name = (file?.name || "").toLowerCase();
  return (
    mime === "application/zip" ||
    mime === "application/x-zip-compressed" ||
    name.endsWith(".zip")
  );
}

function isImageFile(file) {
  const mime = (file?.mimeType || "").toLowerCase();
  const name = (file?.name || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);
}

function classifyDriveFiles(files = []) {
  const buckets = { images: [], pdfs: [], archives: [], others: [] };
  files.forEach((file) => {
    if (isImageFile(file)) {
      buckets.images.push(file);
    } else if (isPdfFile(file)) {
      buckets.pdfs.push(file);
    } else if (isZipFile(file)) {
      buckets.archives.push(file);
    } else {
      buckets.others.push(file);
    }
  });
  return buckets;
}

function getDriveImageFiles() {
  const { images } = classifyDriveFiles(getDriveFiles());
  return images;
}

function getDriveDocumentFiles() {
  const { pdfs, archives, others } = classifyDriveFiles(getDriveFiles());
  return { pdfs, archives, others };
}

async function fetchDriveFolderFiles(folderId) {
  driveFolderFilesCache = [];
  renderDriveAssets();
  if (!folderId) return driveFolderFilesCache;
  try {
    const response = await fetch(`/drive-image/folder/${folderId}/files`);
    handleUnauthorized(response);
    if (!response.ok) {
      console.warn("Drive folder list failed", response.status);
      return driveFolderFilesCache;
    }
    const payload = await response.json();
    driveFolderFilesCache = Array.isArray(payload?.files)
      ? payload.files.map((f) => ({
          id: f.id,
          mimeType: f.mimeType,
          name: f.name,
          driveLink: f.webViewLink,
          thumbnailLink: f.thumbnailLink,
        }))
      : [];
  } catch (error) {
    console.warn("Unable to fetch drive folder files", error);
  }
  renderDriveAssets();
  return driveFolderFilesCache;
}

// Deprecated alias for compatibility if needed elsewhere
function getDrivePhotoIds() {
  return getDriveImageFiles().map(f => f.id);
}

async function fetchProceduresForPatient(patientId) {
  if (!patientId || !proceduresStatusEl) {
    return [];
  }
  proceduresStatusEl.textContent = "Loading procedures...";
  try {
    const response = await fetch(buildApiUrl(`/patients/${patientId}/procedures`));
    handleUnauthorized(response);
    let payload = [];
    let emptyMessage = "";
    if (response.ok) {
      const body = await response.json();
      if (Array.isArray(body)) {
        payload = body;
      } else if (body && Array.isArray(body.procedures)) {
        payload = body.procedures;
        emptyMessage = typeof body.message === "string" ? body.message : "";
      }
    } else {
      const fallback = await fetch(buildApiUrl("/procedures"));
      handleUnauthorized(fallback);
      if (!fallback.ok) {
        throw new Error(`Unable to load procedures (${response.status})`);
      }
      const allProcedures = await fallback.json();
      payload = Array.isArray(allProcedures)
        ? allProcedures.filter((procedure) => Number(procedure.patient_id) === Number(patientId))
        : [];
    }
    patientProcedures = Array.isArray(payload) ? payload : [];
    const preferredId = Number.isFinite(requestedProcedureId) ? requestedProcedureId : null;
    activeProcedure =
      (preferredId && patientProcedures.find((procedure) => procedure.id === preferredId)) ||
      patientProcedures[0] ||
      null;
    renderRelatedBookings(patientProcedures);
    populateProcedureForm(activeProcedure);
    refreshDeleteButtonState();
    if (proceduresStatusEl) {
      proceduresStatusEl.textContent = patientProcedures.length
        ? ""
        : emptyMessage || "No procedures found. Use Add to create one.";
    }
    return patientProcedures;
  } catch (error) {
    console.error(error);
    proceduresStatusEl.textContent = "Unable to load procedures.";
    patientProcedures = [];
    activeProcedure = null;
    updateActiveProcedureNotes([]);
    renderRelatedBookings(null);
    clearProcedureForm();
    refreshDeleteButtonState();
    return [];
  }
}

function normalizeName(value) {
  return (value || "").trim().toLowerCase();
}

function dateOnly(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  const datePart = text.includes("T") ? text.split("T")[0] : text.split(" ")[0] || text;
  return datePart;
}

function formatBookingDate(value) {
  if (!value) {
    return "No date";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return BOOKING_DATE_FORMATTER.format(parsed);
}

function formatMonthLabelFromDate(date) {
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }
  return MONTH_FORMATTER.format(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
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
  const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const mondayAlignedOffset = (firstDayOfMonth + 6) % 7;
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

function buildScheduleContextFromProcedure(procedure) {
  if (!procedure) {
    return {
      weekLabel: "",
      weekRange: "",
      monthLabel: "",
      dayLabel: "",
      procedureDate: "",
    };
  }
  const parsed = parseISODate(procedure.procedure_date);
  if (!parsed) {
    return {
      weekLabel: procedure.week_label || "",
      weekRange: procedure.week_range || "",
      monthLabel: procedure.month_label || "",
      dayLabel: procedure.day_label || "",
      procedureDate: procedure.procedure_date || "",
    };
  }
  const weekMeta = getWeekMetaForDate(parsed);
  return {
    weekLabel: weekMeta.label,
    weekRange: weekMeta.range,
    monthLabel: formatMonthLabelFromDate(parsed),
    dayLabel: DAY_FORMATTER.format(parsed),
    procedureDate: formatLocalISODate(parsed),
  };
}

function findDuplicateProcedureForPatient({ procedure_date, id: selfId }) {
  const normalizedDate = dateOnly(procedure_date);
  if (!normalizedDate) {
    return null;
  }
  return (
    patientProcedures.find(
      (procedure) =>
        (!selfId || procedure.id !== selfId) && dateOnly(procedure.procedure_date) === normalizedDate
    ) || null
  );
}

async function confirmDuplicateIfNeeded(payload) {
  const duplicate = findDuplicateProcedureForPatient(payload);
  if (!duplicate) {
    return true;
  }
  const date = duplicate.procedure_date || "this date";
  const proceed = window.confirm(
    `This patient already has a procedure on ${date}.\n\nPress OK to add another procedure on the same date, or Cancel to edit the existing entry instead.`
  );
  if (!proceed) {
    selectProcedure(duplicate.id);
    return false;
  }
  return true;
}

function buildBookingLabel(entry) {
  const dateText = formatBookingDate(entry.procedure_date);
  const statusLabel = getOptionLabel("status", entry.status) || entry.status || "Status not set";
  const typeLabel =
    getOptionLabel("procedure_type", entry.procedure_type) || entry.procedure_type || "Type not set";
  return `${dateText} • ${statusLabel} • ${typeLabel}`;
}

function getBookingSortValue(entry) {
  const parsed = Date.parse(entry.procedure_date ?? "");
  if (Number.isNaN(parsed)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parsed;
}

function renderRelatedBookings(entries) {
  if (!bookingListEl) {
    return;
  }
  bookingListEl.innerHTML = "";
  const procedures = Array.isArray(entries)
    ? [...entries].sort((a, b) => getBookingSortValue(a) - getBookingSortValue(b) || a.id - b.id)
    : [];
  procedures.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-tab";
    if (entry.id) {
      button.dataset.procedureId = String(entry.id);
    }
    if (entry.id === activeProcedure?.id) {
      button.classList.add("is-active");
    }

    const titleSpan = document.createElement("span");
    titleSpan.className = "settings-tab__title";
    titleSpan.textContent = formatBookingDate(entry.procedure_date);

    const subtitleSpan = document.createElement("span");
    subtitleSpan.className = "settings-tab__subtitle";
    const statusLabel = getOptionLabel("status", entry.status) || entry.status || "Status not set";
    const typeLabel =
      getOptionLabel("procedure_type", entry.procedure_type) || entry.procedure_type || "Type not set";
    subtitleSpan.textContent = `${statusLabel} • ${typeLabel}`;

    button.appendChild(titleSpan);
    button.appendChild(subtitleSpan);

    button.addEventListener("click", () => {
      if (entry.id === activeProcedure?.id) {
        return;
      }
      selectProcedure(entry.id);
    });
    bookingListEl.appendChild(button);
  });
}

function getActiveProcedureButton() {
  if (!bookingListEl) {
    return null;
  }
  if (activeProcedure?.id) {
    const button = bookingListEl.querySelector(`.settings-tab[data-procedure-id="${activeProcedure.id}"]`);
    if (button) {
      return button;
    }
  }
  return bookingListEl.querySelector(".settings-tab.is-active");
}

function updateActiveProcedureTitle(dateValue) {
  if (!bookingListEl) {
    return;
  }
  const activeButton = getActiveProcedureButton();
  if (!activeButton) {
    return;
  }
  const titleSpan = activeButton.querySelector(".settings-tab__title");
  if (titleSpan) {
    titleSpan.textContent = formatBookingDate(dateValue);
  }
}

function selectProcedure(procedureId) {
  const match = patientProcedures.find((procedure) => procedure.id === procedureId);
  if (!match) {
    return;
  }
  activeProcedure = match;
  populateProcedureForm(activeProcedure);
  renderRelatedBookings(patientProcedures);
  refreshDeleteButtonState();
  if (proceduresStatusEl) {
    proceduresStatusEl.textContent = "";
  }
}

function startNewProcedure() {
  activeProcedure = null;
  clearProcedureForm();
  renderRelatedBookings(patientProcedures);
  refreshDeleteButtonState();
  if (procedureFormStatusEl) {
    procedureFormStatusEl.textContent = "Creating a new procedure entry.";
  }
}

function renderDriveDocuments(pdfFiles = [], archiveFiles = [], otherFiles = []) {
  if (!documentsListEl || !documentsEmptyStateEl) return;

  documentsListEl.innerHTML = "";
  const files = [
    ...pdfFiles.map((file) => ({ file, kind: "pdf" })),
    ...archiveFiles.map((file) => ({ file, kind: "zip" })),
    ...otherFiles.map((file) => ({ file, kind: "file" })),
  ];

  if (!files.length) {
    documentsEmptyStateEl.hidden = false;
    return;
  }

  documentsEmptyStateEl.hidden = true;

  files.forEach(({ file, kind }) => {
    const createIconLink = (label, paths, opts = {}) => {
      const link = document.createElement("a");
      link.className = "document-card__link document-card__link--icon";
      link.setAttribute("aria-label", label);
      link.title = label;
      if (opts.href) link.href = opts.href;
      if (opts.target) link.target = opts.target;
      if (opts.rel) link.rel = opts.rel;
      if (opts.download) link.download = opts.download;

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.8");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");

      paths.forEach((d) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
      });

      link.appendChild(svg);
      return link;
    };

    const withInlineDisposition = (href) => {
      if (!href || !href.startsWith("/drive-image/")) return href;
      return href.includes("?") ? `${href}&disposition=inline` : `${href}?disposition=inline`;
    };

    const card = document.createElement("div");
    card.className = "document-card";

    const icon = document.createElement("div");
    icon.className = "document-card__icon";
    icon.textContent = kind === "pdf" ? "PDF" : kind === "zip" ? "ZIP" : "FILE";

    const meta = document.createElement("div");
    meta.className = "document-card__meta";

    const nameEl = document.createElement("p");
    nameEl.className = "document-card__name";
    const displayName =
      file.name || (kind === "pdf" ? "PDF document" : kind === "zip" ? "ZIP archive" : "Drive file");
    nameEl.textContent = displayName;
    nameEl.title = displayName;

    const actions = document.createElement("div");
    actions.className = "document-card__actions";
    const url = buildDriveFileUrl(file);
    if (url) {
      if (kind === "pdf") {
        const viewLink = createIconLink(
          "Open file",
          ["M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V11", "M14 5h5m0 0v5m0-5L10 14"],
          { href: withInlineDisposition(url), target: "_blank", rel: "noreferrer noopener" }
        );
        actions.appendChild(viewLink);
      }

      const downloadLink = createIconLink(
        "Download file",
        ["M12 4v12m0 0-4-4m4 4 4-4", "M5 19h14"],
        { href: url, download: displayName }
      );
      actions.appendChild(downloadLink);
    }

    meta.appendChild(nameEl);

    card.appendChild(icon);
    card.appendChild(meta);
    card.appendChild(actions);
    documentsListEl.appendChild(card);
  });
}

function renderDriveGallery(images = getDriveImageFiles()) {
  if (!galleryContainer || !galleryEmptyState) return;
  galleryContainer.innerHTML = "";
  if (!images.length) {
    galleryEmptyState.textContent = "No Google Drive photos yet.";
    return;
  }
  galleryEmptyState.textContent = `${images.length} photo${images.length === 1 ? "" : "s"} available`;
  images.forEach((fileObj, index) => {
    const card = document.createElement("div");
    card.className = "photo-thumb";
    const thumbUrl = fileObj.thumbnailLink || `/drive-image/${fileObj.id}`;
    card.style.backgroundImage = `url(${thumbUrl})`;
    const badge = document.createElement("span");
    badge.className = "drive-badge";
    badge.textContent = "Drive";
    card.appendChild(badge);
    card.addEventListener("click", () => openDrivePhotoViewer(index));
    galleryContainer.appendChild(card);
  });
}

function openDrivePhotoViewer(index) {
  if (!viewerEl || !viewerImage) return;
  const driveImages = getDriveImageFiles();
  if (!driveImages.length) return;
  activeDrivePhotoIndex = (index + driveImages.length) % driveImages.length;
  const file = driveImages[activeDrivePhotoIndex];
  viewerImage.src = `/drive-image/${file.id}`;
  if (viewerCaption) {
    viewerCaption.textContent = file.name || `Photo ${activeDrivePhotoIndex + 1}`;
  }
  viewerEl.hidden = false;
}

function closeDrivePhotoViewer() {
  if (viewerEl) {
    viewerEl.hidden = true;
  }
}

function showRelativeDrivePhoto(step) {
  const driveImages = getDriveImageFiles();
  if (!driveImages.length) return;
  openDrivePhotoViewer(activeDrivePhotoIndex + step);
}

function renderDriveAssets() {
  const { images, pdfs, archives, others } = classifyDriveFiles(getDriveFiles());
  renderDriveDocuments(pdfs, archives, others);
  renderDriveGallery(images);
}

function buildPatientPayloadFromForm() {
  if (!currentPatient) {
    return null;
  }
  const payload = {
    first_name: firstNameInput.value.trim() || currentPatient.first_name,
    last_name: lastNameInput.value.trim() || currentPatient.last_name,
    email: emailInput.value.trim(),
    phone: phoneInput.value.trim(),
    address: addressInput.value.trim(),
  };
  if (isAdminUser) {
    payload.drive_folder_id = driveFolderInput?.value?.trim() || null;
  } else {
    payload.drive_folder_id = currentPatient.drive_folder_id ?? null;
  }
  return payload;
}

function buildProcedurePayloadFromForm() {
  if (!currentPatient) {
    return null;
  }
  const base = activeProcedure || patientProcedures[0] || {};
  const balanceText = outstandingBalanceInput?.value?.trim() ?? "";
  let parsedBalance = null;
  if (balanceText) {
    const nextValue = Number(balanceText);
    if (Number.isNaN(nextValue)) {
      if (procedureFormStatusEl) {
        procedureFormStatusEl.textContent = "Outstanding balance must be a valid number.";
      }
      return null;
    }
    parsedBalance = nextValue;
  }
  const graftsValue = graftsInput.value.trim();
  let graftsNumber = 0;
  if (graftsValue) {
    graftsNumber = Number(graftsValue);
    if (Number.isNaN(graftsNumber) || graftsNumber < 0) {
      if (procedureFormStatusEl) {
        procedureFormStatusEl.textContent = "Grafts must be a valid number.";
      }
      return null;
    }
  }
  const notes = [...procedureNotes];
  const payload = {
    patient_id: currentPatient.id,
    procedure_date: procedureDateInput.value || base.procedure_date || "",
    status: statusSelect.value,
    procedure_type: procedureSelect.value,
    package_type: packageTypeSelect?.value || "",
    grafts: graftsNumber,
    payment: paymentSelect.value,
    agency: agencySelect?.value || "",
    consultation: collectMultiValue(consultationSelect),
    forms: collectMultiValue(formsSelect),
    consents: collectMultiValue(consentsSelect),
    outstanding_balance: parsedBalance,
    notes,
  };
  return payload;
}

async function savePatient(event) {
  event.preventDefault();
  if (!currentPatient) {
    return;
  }
  const patientPayload = buildPatientPayloadFromForm();
  const procedurePayload = buildProcedurePayloadFromForm();
  if (!patientPayload || !procedurePayload) {
    return;
  }
  const shouldProceed = await confirmDuplicateIfNeeded({
    ...procedurePayload,
    id: activeProcedure?.id,
  });
  if (!shouldProceed) {
    return;
  }
  formStatusEl.textContent = "Saving...";
  patientStatusEl.textContent = "Updating patient...";
  procedureFormStatusEl.textContent = activeProcedure ? "Saving procedure..." : "Creating procedure...";
  try {
    const response = await fetch(buildApiUrl(`/patients/${currentPatient.id}`), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patientPayload),
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to save patient (status ${response.status})`);
    }
    const updateResult = await response.json();
    if (!updateResult?.id) {
      throw new Error("Missing patient id in response");
    }
    const refreshedPatient = await fetchPatientById(updateResult.id);
    currentPatient = refreshedPatient;
    driveFolderFilesCache = [];
    if (currentPatient.drive_folder_id) {
      await fetchDriveFolderFiles(currentPatient.drive_folder_id);
    }
    populatePatientForm(refreshedPatient);
    if (isAdminUser) updateDebugInfo();
    patientStatusEl.textContent = "Patient details saved.";
  } catch (error) {
    console.error(error);
    formStatusEl.textContent = error.message;
    patientStatusEl.textContent = error.message;
    return;
  }

  try {
    const endpoint = activeProcedure
      ? buildApiUrl(`/procedures/${activeProcedure.id}`)
      : buildApiUrl(`/procedures`);
    const response = await fetch(endpoint, {
      method: activeProcedure ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(procedurePayload),
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to save procedure (status ${response.status})`);
    }
    const procedureResult = await response.json();
    if (!procedureResult?.id) {
      throw new Error("Missing procedure id in response");
    }
    const savedProcedure = await fetchProcedureById(procedureResult.id);
    const existingIndex = patientProcedures.findIndex((procedure) => procedure.id === savedProcedure.id);
    if (existingIndex >= 0) {
      patientProcedures[existingIndex] = savedProcedure;
    } else {
      patientProcedures.push(savedProcedure);
    }
    activeProcedure = savedProcedure;
    populateProcedureForm(savedProcedure);
    renderRelatedBookings(patientProcedures);
    refreshDeleteButtonState();
    procedureFormStatusEl.textContent = "Procedure saved.";
    persistReturnToScheduleContext(currentPatient, savedProcedure);
    formStatusEl.textContent = "Record saved. Returning to schedule...";
    window.location.href = "/";
  } catch (error) {
    console.error(error);
    procedureFormStatusEl.textContent = error.message;
    formStatusEl.textContent = error.message;
  }
}

formEl.addEventListener("submit", savePatient);

function appendUploadedFileItem(file) {
  if (!uploadList) return;
  const item = document.createElement("li");
  const sizeInKb = Math.round(file.size / 1024);
  item.textContent = `${file.name} (${sizeInKb} KB)`;
  uploadList.appendChild(item);
}

async function uploadFiles(fileList) {
  if (!currentPatient || !uploadStatus) {
    return;
  }
  if (!currentPatient.drive_folder_id) {
    uploadStatus.textContent = "Set a Drive folder ID before uploading.";
    return;
  }
  const files = Array.from(fileList).slice(0, 10);
  if (!files.length) return;
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  uploadStatus.textContent = "Uploading to Drive...";
  try {
    const uploadUrl = new URL(
      `/drive-image/folder/${encodeURIComponent(currentPatient.drive_folder_id)}/upload`,
      API_BASE_URL
    );
    const response = await fetch(uploadUrl, { method: "POST", body: formData });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Upload failed (${response.status})`);
    }
    files.forEach(appendUploadedFileItem);
    await fetchDriveFolderFiles(currentPatient.drive_folder_id);
    uploadStatus.textContent = `Uploaded ${files.length} file${files.length === 1 ? "" : "s"}.`;
  } catch (error) {
    console.error(error);
    uploadStatus.textContent = `Unable to upload: ${error.message}`;
  }
}

function setDropState(active) {
  if (!dropZone) return;
  dropZone.classList.toggle("drop-zone--active", active);
}

if (procedureDateInput) {
  procedureDateInput.addEventListener("input", handleProcedureDateInputChange);
  procedureDateInput.addEventListener("change", handleProcedureDateInputChange);
}

function refreshDeletePatientButtonState() {
  if (!deletePatientBtn) {
    return;
  }
  const shouldHide = !isAdminUser;
  deletePatientBtn.hidden = shouldHide;
  deletePatientBtn.disabled = shouldHide || !currentPatient;
}

function refreshDeleteProcedureButtonState() {
  if (!cancelProcedureBtn) {
    return;
  }
  const shouldHide = !isAdminUser || !activeProcedure;
  cancelProcedureBtn.hidden = shouldHide;
  cancelProcedureBtn.disabled = shouldHide;
}

function refreshAddProcedureButtonState() {
  if (!addProcedureBtn) {
    return;
  }
  const shouldHide = !isAdminUser;
  addProcedureBtn.hidden = shouldHide;
  addProcedureBtn.disabled = shouldHide;
}

function refreshDeleteButtonState() {
  refreshDeletePatientButtonState();
  refreshDeleteProcedureButtonState();
  refreshAddProcedureButtonState();
}

function handleProcedureDateInputChange() {
  if (!procedureDateInput) {
    return;
  }
  const nextValue = procedureDateInput.value || "";
  if (!activeProcedure) {
    const activeButton = getActiveProcedureButton();
    const fallbackId = activeButton ? Number(activeButton.dataset.procedureId) : null;
    if (Number.isFinite(fallbackId)) {
      const fallback = patientProcedures.find((procedure) => procedure.id === fallbackId);
      if (fallback) {
        activeProcedure = fallback;
      }
    }
  }
  if (activeProcedure) {
    activeProcedure.procedure_date = nextValue;
  }
  updateActiveProcedureTitle(nextValue);
  if (activeProcedure) {
    renderRelatedBookings(patientProcedures);
  }
}

async function handleDeleteProcedure() {
  if (!activeProcedure || !isAdminUser) {
    return;
  }
  const confirmed = window.confirm(
    "Delete this procedure? It will move to Deleted Records where admins can restore it."
  );
  if (!confirmed) {
    return;
  }
  const originalLabel = cancelProcedureBtn.textContent;
  cancelProcedureBtn.disabled = true;
  cancelProcedureBtn.textContent = "Deleting...";
  try {
    const response = await fetch(buildApiUrl(`/procedures/${activeProcedure.id}`), { method: "DELETE" });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to delete (status ${response.status})`);
    }
    patientProcedures = patientProcedures.filter((procedure) => procedure.id !== activeProcedure.id);
    activeProcedure = patientProcedures[0] ?? null;
    populateProcedureForm(activeProcedure);
    renderRelatedBookings(patientProcedures);
    refreshDeleteButtonState();
    proceduresStatusEl.textContent = patientProcedures.length
      ? ""
      : "No procedures found. Use Add to create one.";
  } catch (error) {
    console.error(error);
    alert(`Unable to delete this procedure: ${error.message}`);
  } finally {
    cancelProcedureBtn.textContent = originalLabel;
    cancelProcedureBtn.disabled = false;
  }
}

async function handleDeletePatient() {
  if (!currentPatient || !isAdminUser) {
    return;
  }
  const confirmed = window.confirm(
    "Move this patient to Deleted Records? You can restore it later from Settings → Deleted Records."
  );
  if (!confirmed) {
    return;
  }
  const originalLabel = deletePatientBtn.textContent;
  deletePatientBtn.disabled = true;
  deletePatientBtn.textContent = "Removing...";
  try {
    const response = await fetch(buildApiUrl(`/patients/${currentPatient.id}`), {
      method: "DELETE",
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to remove (status ${response.status})`);
    }
    persistReturnToScheduleContext(currentPatient, activeProcedure);
    window.location.href = "/";
  } catch (error) {
    console.error(error);
    alert(`Unable to remove this patient: ${error.message}`);
  } finally {
    deletePatientBtn.textContent = originalLabel;
    deletePatientBtn.disabled = false;
  }
}

if (deletePatientBtn) {
  deletePatientBtn.addEventListener("click", handleDeletePatient);
}
if (cancelProcedureBtn) {
  cancelProcedureBtn.addEventListener("click", handleDeleteProcedure);
}
if (addProcedureBtn) {
  addProcedureBtn.addEventListener("click", () => {
    if (!isAdminUser) {
      return;
    }
    startNewProcedure();
  });
}
if (addNoteBtn) {
  addNoteBtn.addEventListener("click", addNoteFromInput);
}
if (noteInput) {
  noteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addNoteFromInput();
    }
  });
}

async function initializePatientPage() {
  await fetchFieldOptions();
  renderOptionControls();
  const user = await fetchCurrentUser().catch(() => null);
  currentUser = user;
  isAdminUser = Boolean(user?.is_admin);
  if (isAdminUser) {
    settingsLink?.removeAttribute("hidden");
    adminCustomerLinks.forEach((link) => link.removeAttribute("hidden"));
  } else {
    adminCustomerLinks.forEach((link) => link.remove());
  }
  refreshDeleteButtonState();
  await fetchPatient();
  if (isAdminUser && adminDebugSection) {
    adminDebugSection.hidden = false;
    updateDebugInfo();
  } else if (adminDebugSection) {
    adminDebugSection.hidden = true;
  }
}

function updateDebugInfo() {
  if (!currentPatient || !debugDriveFolderEl || !debugDriveFilesEl || !debugDriveCountEl) return;
  const files = getDriveFiles();
  debugDriveFolderEl.textContent = currentPatient.drive_folder_id || "None";
  debugDriveFilesEl.textContent = files.length
    ? files.map((f) => f.name || f.id).join(", ")
    : "None";
  debugDriveCountEl.textContent = `${files.length} files found`;
}

if (debugTestDriveBtn) {
  debugTestDriveBtn.addEventListener("click", async () => {
    const ids = getDrivePhotoIds();
    if (!ids.length) {
      logDebug("No Drive IDs to test.");
      return;
    }
    const testId = ids[0];
    const url = `/drive-image/${testId}`;
    logDebug(`Testing fetch: ${url}`);
    
    try {
      const response = await fetch(url);
      logDebug(`Response Status: ${response.status} ${response.statusText}`);
      if (response.ok) {
        const blob = await response.blob();
        logDebug(`Success! Blob Type: ${blob.type}, Size: ${blob.size}`);
      } else {
        const text = await response.text();
        logDebug(`Error Body: ${text.substring(0, 200)}`);
      }
    } catch (e) {
      logDebug(`Fetch Exception: ${e.message}`);
    }
  });
}

function logDebug(msg) {
  if (!debugConsoleEl) return;
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  debugConsoleEl.appendChild(line);
  debugConsoleEl.scrollTop = debugConsoleEl.scrollHeight;
}

initializePatientPage();
if (viewerCloseBtn) {
  viewerCloseBtn.addEventListener("click", closeDrivePhotoViewer);
}
if (viewerPrevBtn) {
  viewerPrevBtn.addEventListener("click", () => showRelativeDrivePhoto(-1));
}
if (viewerNextBtn) {
  viewerNextBtn.addEventListener("click", () => showRelativeDrivePhoto(1));
}
if (viewerDeleteBtn) {
  viewerDeleteBtn.hidden = true;
}
if (viewerEl) {
  viewerEl.addEventListener("click", (event) => {
    if (event.target === viewerEl) {
      closeDrivePhotoViewer();
    }
  });
}
window.addEventListener("keydown", (event) => {
  if (!viewerEl || viewerEl.hidden) return;
  if (event.key === "Escape") {
    closeDrivePhotoViewer();
  } else if (event.key === "ArrowRight") {
    showRelativeDrivePhoto(1);
  } else if (event.key === "ArrowLeft") {
    showRelativeDrivePhoto(-1);
  }
});
if (dropZone && fileInput) {
  dropZone.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    fileInput.click();
  });
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    setDropState(true);
  });
  dropZone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    setDropState(false);
  });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    setDropState(false);
    if (event.dataTransfer?.files) {
      uploadFiles(event.dataTransfer.files);
    }
  });
}

if (browseButton && fileInput) {
  browseButton.addEventListener("click", (event) => {
    event.preventDefault();
    fileInput.click();
  });
}

if (fileInput) {
  fileInput.addEventListener("change", () => {
    if (fileInput.files) {
      uploadFiles(fileInput.files);
      fileInput.value = "";
    }
  });
}
