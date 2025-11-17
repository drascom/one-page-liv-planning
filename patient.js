const FORM_OPTIONS = ["form1", "form2", "form3", "form4", "form5"];
const CONSENT_OPTIONS = ["form1", "form2", "form3"];
const ACTIVE_PATIENT_KEY = "activePatient";
const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;
const UPLOADS_BASE_URL = new URL("/uploaded-files/", API_BASE_URL).toString();

const patientNameEl = document.getElementById("patient-name");
const patientWeekEl = document.getElementById("patient-week");
const patientCityEl = document.getElementById("patient-city");
const formEl = document.getElementById("patient-form");
const formStatusEl = document.getElementById("form-status");

const firstNameInput = document.getElementById("first-name");
const lastNameInput = document.getElementById("last-name");
const patientDateInput = document.getElementById("patient-date");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const cityInput = document.getElementById("city");
const statusSelect = document.getElementById("status");
const surgerySelect = document.getElementById("surgery-type");
const paymentSelect = document.getElementById("payment");
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
  patientDateInput.value = record.patient_date || "";
  emailInput.value = record.email || "";
  phoneInput.value = record.phone || "";
  cityInput.value = record.city || "";
  statusSelect.value = record.status || "reserved";
  surgerySelect.value = record.surgery_type || "small";
  paymentSelect.value = record.payment || "waiting";
  photosInput.value =
    (record.photo_files?.length ?? record.photos ?? 0) > 0
      ? String(record.photo_files.length ?? record.photos)
      : "None";
  setMultiValue(formsSelect, record.forms || []);
  setMultiValue(consentsSelect, record.consents || []);
  syncHeader(record);
  renderPhotoGallery();
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
    return;
  }
  try {
    const response = await fetch(new URL(`/patients/${requestedId}`, API_BASE_URL));
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
  } catch (error) {
    console.error(error);
    formStatusEl.textContent = "Unable to load patient details.";
    disableForm(true);
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
    const response = await fetch(
      new URL(
        `/uploads/${currentPatient.id}?file=${encodeURIComponent(relativePath)}`,
        API_BASE_URL
      ),
      { method: "DELETE" }
    );
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
    patient_date: patientDateInput.value || currentPatient.patient_date,
    first_name: firstNameInput.value.trim() || currentPatient.first_name,
    last_name: lastNameInput.value.trim() || currentPatient.last_name,
    email: emailInput.value.trim(),
    phone: phoneInput.value.trim(),
    city: cityInput.value.trim(),
    status: statusSelect.value,
    surgery_type: surgerySelect.value,
    payment: paymentSelect.value,
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
    const response = await fetch(new URL(`/patients/${currentPatient.id}`, API_BASE_URL), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
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

fetchPatient();
