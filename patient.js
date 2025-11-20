import { fetchCurrentUser, handleUnauthorized, initSessionControls } from "./session.js";

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
const ACTIVE_PATIENT_KEY = "activePatient";
const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;
const UPLOADS_BASE_URL = new URL("/uploaded-files/", API_BASE_URL).toString();

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

function getFieldOptions(field) {
  return fieldOptions[field] ?? [];
}

function getFieldOptionValues(field) {
  return getFieldOptions(field).map((option) => option.value);
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
  populateSelectOptions(paymentSelect, "payment");
  populateSelectOptions(consultationSelect, "consultation", { multiple: true });
  populateSelectOptions(formsSelect, "forms", { multiple: true });
  populateSelectOptions(consentsSelect, "consents", { multiple: true });
}

const patientNameEl = document.getElementById("patient-name");
const patientWeekEl = document.getElementById("patient-week");
const patientCityEl = document.getElementById("patient-city");
const formEl = document.getElementById("patient-form");
const formStatusEl = document.getElementById("form-status");
const deletePatientBtn = document.getElementById("delete-patient-btn");

const firstNameInput = document.getElementById("first-name");
const lastNameInput = document.getElementById("last-name");
const procedureDateInput = document.getElementById("procedure-date");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const cityInput = document.getElementById("city");
const statusSelect = document.getElementById("status");
const procedureSelect = document.getElementById("procedure-type");
const graftsInput = document.getElementById("grafts");
const paymentSelect = document.getElementById("payment");
const consultationSelect = document.getElementById("consultation");
const photosInput = document.getElementById("photos");
const formsSelect = document.getElementById("forms");
const consentsSelect = document.getElementById("consents");

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

const params = new URLSearchParams(window.location.search);
const requestedId = params.get("id");
const requestedName = params.get("patient");

let currentPatient = null;
let activePhotoIndex = 0;
let isAdminUser = false;

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

function syncHeader(record) {
  const displayName = `${record.first_name} ${record.last_name}`.trim() || requestedName || "Patient";
  patientNameEl.textContent = displayName;
  const weekBits = [record.week_label, record.day_label].filter(Boolean).join(" • ");
  patientWeekEl.textContent = weekBits;
  patientCityEl.textContent = record.city ? `City: ${record.city}` : "";
}

function setMultiValue(selectEl, values) {
  const selected = new Set(values || []);
  Array.from(selectEl.options).forEach((option) => {
    option.selected = selected.has(option.value);
  });
}

function populateForm(record) {
  record.photo_files = record.photo_files ?? [];
  if (currentPatient) {
    currentPatient.photo_files = record.photo_files;
  }
  firstNameInput.value = record.first_name || "";
  lastNameInput.value = record.last_name || "";
  procedureDateInput.value = record.procedure_date || "";
  emailInput.value = record.email || "";
  phoneInput.value = record.phone || "";
  cityInput.value = record.city || "";
  statusSelect.value = record.status || "reserved";
  procedureSelect.value = record.procedure_type || "small";
  graftsInput.value = record.grafts || "";
  paymentSelect.value = record.payment || "waiting";
  if (consultationSelect) {
    const selectedConsultations = Array.isArray(record.consultation)
      ? record.consultation
      : record.consultation
        ? [record.consultation]
        : [];
    setMultiValue(consultationSelect, selectedConsultations);
  }
  photosInput.value =
    (record.photo_files?.length ?? record.photos ?? 0) > 0
      ? String(record.photo_files.length ?? record.photos)
      : "None";
  setMultiValue(formsSelect, record.forms || []);
  setMultiValue(consentsSelect, record.consents || []);
  syncHeader(record);
  renderPhotoGallery();
  refreshDeleteButtonState();
}

function disableForm(disabled) {
  Array.from(formEl.elements).forEach((element) => {
    element.disabled = disabled;
  });
  browseButton.disabled = disabled;
}

async function fetchPatient() {
  if (!requestedId) {
    const context = loadActiveContext();
    patientNameEl.textContent = context?.patient || requestedName || "Patient";
    patientWeekEl.textContent = context?.weekLabel || "";
    formStatusEl.textContent = "Select a patient from the schedule first.";
    disableForm(true);
    currentPatient = null;
    refreshDeleteButtonState();
    return;
  }
  try {
    const response = await fetch(buildApiUrl(`/patients/${requestedId}`));
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const record = await response.json();
    record.photo_files = record.photo_files ?? [];
    record.photos = record.photo_files.length ?? record.photos ?? 0;
    currentPatient = record;
    populateForm(record);
    updatePhotoCountInput();
    formStatusEl.textContent = "";
    disableForm(false);
    refreshDeleteButtonState();
  } catch (error) {
    console.error(error);
    formStatusEl.textContent = "Unable to load patient details.";
    disableForm(true);
    currentPatient = null;
    refreshDeleteButtonState();
  }
}

function collectMultiValue(selectEl) {
  return Array.from(selectEl.selectedOptions).map((option) => option.value);
}

function parsePhotos(value) {
  if (!value || value.toLowerCase() === "none") {
    return 0;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function getPhotoFiles() {
  return currentPatient?.photo_files ?? [];
}

function buildPhotoUrl(relativePath) {
  if (!relativePath) {
    return "";
  }
  return new URL(relativePath, UPLOADS_BASE_URL).toString();
}

function updatePhotoCountInput() {
  const count = getPhotoFiles().length;
  photosInput.value = count > 0 ? String(count) : "None";
}

function renderPhotoGallery() {
  if (!galleryContainer) return;
  const files = getPhotoFiles();
  galleryContainer.innerHTML = "";
  if (!files.length) {
    if (galleryEmptyState) {
      galleryEmptyState.textContent = "No photos uploaded yet.";
    }
    return;
  }
  if (galleryEmptyState) {
    galleryEmptyState.textContent = `${files.length} photo${files.length > 1 ? "s" : ""} uploaded`;
  }
  files.forEach((relativePath, index) => {
    const card = document.createElement("div");
    card.className = "photo-thumb";
    card.style.backgroundImage = `url(${buildPhotoUrl(relativePath)})`;
    card.addEventListener("click", () => openPhotoViewer(index));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "photo-thumb__delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deletePhoto(relativePath);
    });

    card.appendChild(deleteBtn);
    galleryContainer.appendChild(card);
  });
}

function openPhotoViewer(index) {
  const files = getPhotoFiles();
  if (!files.length || !viewerEl || !viewerImage) {
    return;
  }
  activePhotoIndex = (index + files.length) % files.length;
  const relativePath = files[activePhotoIndex];
  viewerImage.src = buildPhotoUrl(relativePath);
  if (viewerCaption) {
    viewerCaption.textContent = `Photo ${activePhotoIndex + 1} of ${files.length}`;
  }
  viewerEl.hidden = false;
}

function closePhotoViewer() {
  if (viewerEl) {
    viewerEl.hidden = true;
  }
}

function showRelativePhoto(step) {
  const files = getPhotoFiles();
  if (!files.length) return;
  activePhotoIndex = (activePhotoIndex + step + files.length) % files.length;
  const relativePath = files[activePhotoIndex];
  if (viewerImage) {
    viewerImage.src = buildPhotoUrl(relativePath);
  }
  if (viewerCaption) {
    viewerCaption.textContent = `Photo ${activePhotoIndex + 1} of ${files.length}`;
  }
}

async function deletePhoto(relativePath) {
  if (!currentPatient) return;
  try {
    const deleteUrl = new URL(`/uploads/${currentPatient.id}`, API_BASE_URL);
    deleteUrl.searchParams.set("file", relativePath);
    const response = await fetch(deleteUrl, { method: "DELETE" });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to delete photo (${response.status})`);
    }
    const payload = await response.json();
    currentPatient.photo_files = payload.photoFiles ?? [];
    currentPatient.photos = currentPatient.photo_files.length;
    updatePhotoCountInput();
    renderPhotoGallery();
    if (getPhotoFiles().length === 0) {
      closePhotoViewer();
    } else if (activePhotoIndex >= getPhotoFiles().length) {
      activePhotoIndex = getPhotoFiles().length - 1;
      showRelativePhoto(0);
    } else {
      showRelativePhoto(0);
    }
  } catch (error) {
    console.error(error);
    uploadStatus.textContent = `Unable to delete photo: ${error.message}`;
  }
}

function buildPayloadFromForm() {
  if (!currentPatient) {
    return null;
  }
  return {
    month_label: currentPatient.month_label,
    week_label: currentPatient.week_label,
    week_range: currentPatient.week_range,
    week_order: currentPatient.week_order,
    day_label: currentPatient.day_label,
    day_order: currentPatient.day_order,
    procedure_date: procedureDateInput.value || currentPatient.procedure_date,
    first_name: firstNameInput.value.trim() || currentPatient.first_name,
    last_name: lastNameInput.value.trim() || currentPatient.last_name,
    email: emailInput.value.trim(),
    phone: phoneInput.value.trim(),
    city: cityInput.value.trim(),
    status: statusSelect.value,
    procedure_type: procedureSelect.value,
    grafts: graftsInput.value.trim(),
    payment: paymentSelect.value,
    consultation: consultationSelect ? collectMultiValue(consultationSelect) : [],
    forms: collectMultiValue(formsSelect),
    consents: collectMultiValue(consentsSelect),
    photos: getPhotoFiles().length,
    photo_files: getPhotoFiles(),
  };
}

async function savePatient(event) {
  event.preventDefault();
  if (!currentPatient) {
    return;
  }
  const payload = buildPayloadFromForm();
  if (!payload) {
    return;
  }
  formStatusEl.textContent = "Saving...";
  try {
    const response = await fetch(buildApiUrl(`/patients/${currentPatient.id}`), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to save (status ${response.status})`);
    }
    const saved = await response.json();
    currentPatient = saved;
    populateForm(saved);
    updatePhotoCountInput();
    localStorage.setItem(
      ACTIVE_PATIENT_KEY,
      JSON.stringify({
        patientId: saved.id,
        patient: `${saved.first_name} ${saved.last_name}`.trim(),
        weekLabel: saved.week_label,
        weekRange: saved.week_range,
        day: saved.day_label,
        capturedAt: new Date().toISOString(),
      })
    );
    formStatusEl.textContent = "Patient record saved.";
    setTimeout(() => {
      formStatusEl.textContent = "";
    }, 3000);
  } catch (error) {
    console.error(error);
    formStatusEl.textContent = error.message;
  }
}

formEl.addEventListener("submit", savePatient);

function appendUploadedFileItem(file) {
  const item = document.createElement("li");
  const sizeInKb = Math.round(file.size / 1024);
  item.textContent = `${file.name} (${sizeInKb} KB)`;
  uploadList.appendChild(item);
}

function ensureLastName() {
  const lastName = lastNameInput.value.trim();
  if (!lastName) {
    uploadStatus.textContent = "Enter the patient's last name before uploading.";
    return null;
  }
  return lastName;
}

async function uploadFiles(fileList) {
  if (!currentPatient) {
    uploadStatus.textContent = "Load a patient before uploading.";
    return;
  }
  const files = Array.from(fileList).slice(0, 10);
  if (!files.length) return;
  const lastName = ensureLastName();
  if (!lastName) {
    return;
  }
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  uploadStatus.textContent = "Uploading photos...";
  try {
    const uploadUrl = new URL(`/uploads/${encodeURIComponent(lastName)}`, API_BASE_URL);
    if (currentPatient?.id) {
      uploadUrl.searchParams.set("patient_id", String(currentPatient.id));
    }
    const response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Upload failed (${response.status})`);
    }
    const payload = await response.json();
    files.forEach(appendUploadedFileItem);
    if (payload.photoFiles && currentPatient) {
      currentPatient.photo_files = payload.photoFiles;
      currentPatient.photos = currentPatient.photo_files.length;
      updatePhotoCountInput();
      renderPhotoGallery();
    }
    uploadStatus.textContent = `Uploaded ${files.length} file(s).`;
  } catch (error) {
    console.error(error);
    uploadStatus.textContent = `Unable to upload photos: ${error.message}`;
  }
}

function setDropState(active) {
  dropZone.classList.toggle("drop-zone--active", active);
}

dropZone.addEventListener("click", (event) => {
  if (event.target.closest("button")) {
    return;
  }
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
  uploadFiles(event.dataTransfer.files);
});

browseButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  uploadFiles(fileInput.files);
  fileInput.value = "";
});

if (viewerCloseBtn) {
  viewerCloseBtn.addEventListener("click", closePhotoViewer);
}
if (viewerPrevBtn) {
  viewerPrevBtn.addEventListener("click", () => showRelativePhoto(-1));
}
if (viewerNextBtn) {
  viewerNextBtn.addEventListener("click", () => showRelativePhoto(1));
}
if (viewerDeleteBtn) {
  viewerDeleteBtn.addEventListener("click", () => {
    const files = getPhotoFiles();
    if (files.length) {
      deletePhoto(files[activePhotoIndex]);
    }
  });
}
if (viewerEl) {
  viewerEl.addEventListener("click", (event) => {
    if (event.target === viewerEl) {
      closePhotoViewer();
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (!viewerEl || viewerEl.hidden) return;
  if (event.key === "Escape") {
    closePhotoViewer();
  } else if (event.key === "ArrowRight") {
    showRelativePhoto(1);
  } else if (event.key === "ArrowLeft") {
    showRelativePhoto(-1);
  }
});

function refreshDeleteButtonState() {
  if (!deletePatientBtn) {
    return;
  }
  deletePatientBtn.hidden = !isAdminUser;
  deletePatientBtn.disabled = !currentPatient;
}

async function handleDeletePatient() {
  if (!currentPatient || !isAdminUser) {
    return;
  }
  const confirmed = window.confirm("Delete this patient record? This action cannot be undone.");
  if (!confirmed) {
    return;
  }
  const originalLabel = deletePatientBtn.textContent;
  deletePatientBtn.disabled = true;
  deletePatientBtn.textContent = "Deleting...";
  try {
    const response = await fetch(buildApiUrl(`/patients/${currentPatient.id}`), {
      method: "DELETE",
    });
    handleUnauthorized(response);
    if (!response.ok) {
      throw new Error(`Failed to delete (status ${response.status})`);
    }
    window.location.href = "/";
  } catch (error) {
    console.error(error);
    alert(`Unable to delete this patient: ${error.message}`);
  } finally {
    deletePatientBtn.textContent = originalLabel;
    deletePatientBtn.disabled = false;
  }
}

if (deletePatientBtn) {
  deletePatientBtn.addEventListener("click", handleDeletePatient);
}

async function initializePatientPage() {
  await fetchFieldOptions();
  renderOptionControls();
  const user = await fetchCurrentUser().catch(() => null);
  isAdminUser = Boolean(user?.is_admin);
  refreshDeleteButtonState();
  await fetchPatient();
}

initializePatientPage();
