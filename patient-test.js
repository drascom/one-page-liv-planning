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
    { value: "small", label: "Small" },
    { value: "big", label: "Big" },
    { value: "consultation", label: "Consultation" },
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

const DEFAULT_CONTACT = {
  email: "test@example.com",
  phone: "+44 12345678",
  city: "London",
};

let fieldOptions = JSON.parse(JSON.stringify(DEFAULT_FIELD_OPTIONS));
const ACTIVE_PATIENT_KEY = "activePatient";
const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;
const UPLOADS_BASE_URL = new URL("/uploaded-files/", API_BASE_URL).toString();
const BOOKING_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

// DOM Elements
const patientNameEl = document.querySelector(".patient-name");
const patientWeekEl = document.getElementById("patient-week");
const patientCityEl = document.getElementById("patient-city");
const tabMenuEl = document.querySelector(".tab-menu");
const formEl = document.getElementById("patient-form");
const patientStatusEl = document.getElementById("patient-status");
const deletePatientBtn = document.getElementById("delete-patient-btn");
const addProcedureBtn = document.getElementById("add-procedure-btn");
const cancelProcedureBtn = document.getElementById("cancel-procedure-btn");

// Form Inputs
const firstNameInput = document.getElementById("first-name");
const lastNameInput = document.getElementById("last-name");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const cityInput = document.getElementById("city");

// Procedure Inputs
const procedureDateInput = document.getElementById("procedure-date");
const statusSelect = document.getElementById("status");
const procedureSelect = document.getElementById("procedure-type");
const graftsInput = document.getElementById("grafts");
const paymentSelect = document.getElementById("payment");
const consultationSelect = document.getElementById("consultation"); // Hidden select if used
const formsSelect = document.getElementById("forms"); // Hidden select
const consentsSelect = document.getElementById("consents"); // Hidden select

// Checklists
const consultationsChecklist = document.getElementById("consultations-checklist");
const formsChecklist = document.getElementById("forms-checklist");
const consentsChecklist = document.getElementById("consents-checklist");

// Photo Elements
const dropZone = document.getElementById("drop-zone");
const photoInput = document.getElementById("photo-input");
const browseButton = document.getElementById("browse-button");
const uploadList = document.getElementById("upload-list");
const photoGallery = document.getElementById("photo-gallery");
const photoEmpty = document.getElementById("photo-empty");
const uploadStatus = document.getElementById("upload-status");

// Viewer Elements
const photoViewer = document.getElementById('photo-viewer');
const photoViewerImage = document.getElementById('photo-viewer-image');
const photoViewerClose = document.getElementById('photo-viewer-close');
const photoViewerPrev = document.getElementById('photo-viewer-prev');
const photoViewerNext = document.getElementById('photo-viewer-next');
const photoViewerDelete = document.getElementById('photo-viewer-delete');

// State
const params = new URLSearchParams(window.location.search);
const requestedId = params.get("id");
let currentPatient = null;
let patientProcedures = [];
let activeProcedure = null;
let patientPhotos = [];
let activePhotoIndex = 0;
let isAdminUser = false;

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

function getFieldOptions(field) {
  return fieldOptions[field] ?? [];
}

function getOptionLabel(field, value) {
  if (!value) return "";
  const match = getFieldOptions(field).find((option) => option.value === value);
  return match?.label ?? value;
}

function formatBookingDate(value) {
  if (!value) return "No date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : BOOKING_DATE_FORMATTER.format(parsed);
}

// --- Initialization ---

async function initializePage() {
    initSessionControls();
    await fetchFieldOptions();
    renderOptionControls();
    
    const user = await fetchCurrentUser().catch(() => null);
    isAdminUser = Boolean(user?.is_admin);
    refreshDeleteButtonState();

    await fetchPatient();
}

async function fetchFieldOptions() {
    try {
        const response = await fetch(buildApiUrl("/field-options"));
        if (response.ok) {
            const payload = await response.json();
            fieldOptions = { ...DEFAULT_FIELD_OPTIONS, ...payload };
        }
    } catch (e) {
        console.error("Failed to load options", e);
    }
}

function renderOptionControls() {
    populateSelectOptions(statusSelect, "status");
    populateSelectOptions(procedureSelect, "procedure_type");
    populateSelectOptions(paymentSelect, "payment");
    
    // If these selects exist (hidden ones for checklists)
    if (consultationSelect) populateSelectOptions(consultationSelect, "consultation", { multiple: true });
    if (formsSelect) populateSelectOptions(formsSelect, "forms", { multiple: true });
    if (consentsSelect) populateSelectOptions(consentsSelect, "consents", { multiple: true });

    buildChecklist(formsChecklist, formsSelect, "forms");
    buildChecklist(consentsChecklist, consentsSelect, "consents");
    buildChecklist(consultationsChecklist, consultationSelect, "consultation");
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
    }
}

// --- Checklists ---

function buildChecklist(container, selectEl, field) {
    if (!container || !selectEl) return;
    container.innerHTML = "";
    const options = getFieldOptions(field);
    options.forEach((option) => {
        const item = document.createElement("div");
        item.className = "checklist-item";
        item.dataset.value = option.value;
        item.innerHTML = `
            ${option.label} 
            <button type="button" class="checklist-remove">✕</button>
        `;
        
        // Toggle logic
        item.addEventListener("click", (e) => {
             // Toggle selection logic here if needed, or just visual
             // For now, let's implement simple toggle
             toggleMultiValue(selectEl, option.value);
             refreshChecklistUI(container, selectEl);
        });
        container.appendChild(item);
    });
    refreshChecklistUI(container, selectEl);
}

function toggleMultiValue(selectEl, value) {
    const current = new Set(Array.from(selectEl.selectedOptions).map(opt => opt.value));
    if (current.has(value)) {
        current.delete(value);
    } else {
        current.add(value);
    }
    
    Array.from(selectEl.options).forEach(opt => {
        opt.selected = current.has(opt.value);
    });
}

function refreshChecklistUI(container, selectEl) {
    const selectedValues = new Set(Array.from(selectEl.selectedOptions).map(opt => opt.value));
    container.querySelectorAll(".checklist-item").forEach(item => {
        const val = item.dataset.value;
        if (selectedValues.has(val)) {
            item.classList.add("is-selected");
            item.querySelector(".checklist-remove").textContent = "✓"; // Visual indicator
        } else {
            item.classList.remove("is-selected");
            item.querySelector(".checklist-remove").textContent = "✕";
        }
    });
}


// --- Patient & Procedure Loading ---

async function fetchPatient() {
    if (!requestedId) {
        patientStatusEl.textContent = "No patient ID provided.";
        return;
    }
    
    try {
        patientStatusEl.textContent = "Loading...";
        const response = await fetch(buildApiUrl(`/patients/${requestedId}`));
        if (!response.ok) throw new Error("Failed to load patient");
        
        currentPatient = await response.json();
        populatePatientForm(currentPatient);
        await fetchPhotosForPatient(currentPatient.id);
        await fetchProceduresForPatient(currentPatient.id);
        patientStatusEl.textContent = "";
    } catch (error) {
        console.error(error);
        patientStatusEl.textContent = "Error loading patient.";
    }
}

function populatePatientForm(patient) {
    firstNameInput.value = patient.first_name || "";
    lastNameInput.value = patient.last_name || "";
    emailInput.value = patient.email || "";
    phoneInput.value = patient.phone || "";
    cityInput.value = patient.city || "";
    
    patientNameEl.textContent = `${patient.first_name} ${patient.last_name}`;
    if (patientCityEl) patientCityEl.textContent = patient.city;
    
    refreshDeleteButtonState();
}

async function fetchProceduresForPatient(patientId) {
    try {
        const response = await fetch(buildApiUrl(`/patients/${patientId}/procedures`));
        if (response.ok) {
            patientProcedures = await response.json();
        } else {
            patientProcedures = [];
        }
        
        if (patientProcedures.length > 0) {
            activeProcedure = patientProcedures[0];
        } else {
            activeProcedure = null;
        }
        
        renderProceduresTabs();
        if (activeProcedure) {
            populateProcedureForm(activeProcedure);
        } else {
            clearProcedureForm();
        }
    } catch (e) {
        console.error("Error loading procedures", e);
    }
}

function renderProceduresTabs() {
    if (!tabMenuEl) return;
    tabMenuEl.innerHTML = "";
    
    patientProcedures.forEach((proc, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tab-button";
        if (activeProcedure && proc.id === activeProcedure.id) {
            btn.classList.add("is-active");
        }
        
        const dateSpan = document.createElement("span");
        dateSpan.textContent = formatBookingDate(proc.procedure_date);
        
        const statusSpan = document.createElement("span");
        statusSpan.textContent = getOptionLabel("status", proc.status);
        
        const typeSpan = document.createElement("span");
        typeSpan.textContent = getOptionLabel("procedure_type", proc.procedure_type);
        
        btn.appendChild(dateSpan);
        btn.appendChild(statusSpan);
        btn.appendChild(typeSpan);
        
        btn.addEventListener("click", () => {
            selectProcedure(proc);
        });
        
        tabMenuEl.appendChild(btn);
    });
}

function selectProcedure(proc) {
    activeProcedure = proc;
    
    // Update tab active state
    const buttons = tabMenuEl.querySelectorAll(".tab-button");
    buttons.forEach((btn, idx) => {
        if (patientProcedures[idx].id === proc.id) {
            btn.classList.add("is-active");
        } else {
            btn.classList.remove("is-active");
        }
    });
    
    populateProcedureForm(proc);
}

function populateProcedureForm(proc) {
    if (!proc) return;
    
    if (procedureDateInput) procedureDateInput.value = proc.procedure_date || "";
    if (statusSelect) statusSelect.value = proc.status || "";
    if (procedureSelect) procedureSelect.value = proc.procedure_type || "";
    if (graftsInput) graftsInput.value = proc.grafts || "";
    if (paymentSelect) paymentSelect.value = proc.payment || "";
    
    // Checklists
    updateChecklistSelection(formsSelect, proc.forms, formsChecklist);
    updateChecklistSelection(consentsSelect, proc.consents, consentsChecklist);
    updateChecklistSelection(consultationSelect, proc.consultation, consultationsChecklist);
}

function updateChecklistSelection(selectEl, values, container) {
    if (!selectEl || !container) return;
    
    const valArray = Array.isArray(values) ? values : (values ? [values] : []);
    
    Array.from(selectEl.options).forEach(opt => {
        opt.selected = valArray.includes(opt.value);
    });
    
    refreshChecklistUI(container, selectEl);
}

function clearProcedureForm() {
    if (procedureDateInput) procedureDateInput.value = "";
    if (graftsInput) graftsInput.value = "";
    // Reset selects to first option or empty
    if (statusSelect) statusSelect.selectedIndex = 0;
    if (procedureSelect) procedureSelect.selectedIndex = 0;
    if (paymentSelect) paymentSelect.selectedIndex = 0;
    
    updateChecklistSelection(formsSelect, [], formsChecklist);
    updateChecklistSelection(consentsSelect, [], consentsChecklist);
    updateChecklistSelection(consultationSelect, [], consultationsChecklist);
}

// --- CRUD Operations ---

if (addProcedureBtn) {
    addProcedureBtn.addEventListener("click", () => {
        activeProcedure = null;
        clearProcedureForm();
        // Remove active class from all tabs
        tabMenuEl.querySelectorAll(".tab-button").forEach(b => b.classList.remove("is-active"));
    });
}

formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentPatient) return;
    
    // 1. Save Patient Details
    const patientPayload = {
        first_name: firstNameInput.value,
        last_name: lastNameInput.value,
        email: emailInput.value,
        phone: phoneInput.value,
        city: cityInput.value
    };
    
    try {
        await fetch(buildApiUrl(`/patients/${currentPatient.id}`), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patientPayload)
        });
        
        // 2. Save Procedure (if we are editing one or creating one)
        // Note: Ideally we separate these, but the UI implies "Save Changes" does all.
        
        const procedurePayload = {
            patient_id: currentPatient.id,
            procedure_date: procedureDateInput.value,
            status: statusSelect.value,
            procedure_type: procedureSelect.value,
            grafts: graftsInput.value,
            payment: paymentSelect.value,
            forms: Array.from(formsSelect.selectedOptions).map(o => o.value),
            consents: Array.from(consentsSelect.selectedOptions).map(o => o.value),
            consultation: Array.from(consultationSelect.selectedOptions).map(o => o.value)
        };
        
        let procResponse;
        if (activeProcedure) {
            procResponse = await fetch(buildApiUrl(`/procedures/${activeProcedure.id}`), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(procedurePayload)
            });
        } else {
            // Create new
            procResponse = await fetch(buildApiUrl(`/procedures`), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(procedurePayload)
            });
        }
        
        if (procResponse.ok) {
            patientStatusEl.textContent = "Saved successfully.";
            // Refresh
            await fetchPatient();
        } else {
            throw new Error("Failed to save procedure");
        }
        
    } catch (e) {
        console.error(e);
        patientStatusEl.textContent = "Error saving.";
    }
});

// --- Photos ---

async function fetchPhotosForPatient(patientId) {
    const response = await fetch(buildApiUrl(`/patients/${patientId}/photos`));
    if (response.ok) {
        patientPhotos = await response.json();
        renderPhotoGallery();
    }
}

function renderPhotoGallery() {
    if (!photoGallery) return;
    photoGallery.innerHTML = "";
    
    if (patientPhotos.length === 0) {
        if (photoEmpty) photoEmpty.hidden = false;
        return;
    }
    
    if (photoEmpty) photoEmpty.hidden = true;
    
    patientPhotos.forEach((photo, index) => {
        const card = document.createElement("div");
        card.className = "photo-thumb";
        card.style.backgroundImage = `url(${buildPhotoUrl(photo.file_path)})`;
        
        const delBtn = document.createElement("button");
        delBtn.className = "photo-thumb__delete";
        delBtn.textContent = "✕";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deletePhoto(photo.file_path);
        };
        
        card.appendChild(delBtn);
        card.onclick = () => openPhotoViewer(index);
        
        photoGallery.appendChild(card);
    });
}

function buildPhotoUrl(path) {
    return new URL(path, UPLOADS_BASE_URL).toString();
}

async function uploadFiles(files) {
    if (!currentPatient) return;
    
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append("files", f));
    
    const lastName = currentPatient.last_name || "unknown";
    const uploadUrl = new URL(`/uploads/${encodeURIComponent(lastName)}`, API_BASE_URL);
    uploadUrl.searchParams.set("patient_id", currentPatient.id);
    
    try {
        uploadStatus.textContent = "Uploading...";
        const res = await fetch(uploadUrl, { method: "POST", body: formData });
        if (res.ok) {
            uploadStatus.textContent = "Upload complete.";
            await fetchPhotosForPatient(currentPatient.id);
        } else {
            uploadStatus.textContent = "Upload failed.";
        }
    } catch (e) {
        console.error(e);
        uploadStatus.textContent = "Error uploading.";
    }
}

async function deletePhoto(path) {
    if (!currentPatient) return;
    const url = new URL(`/uploads/${currentPatient.id}`, API_BASE_URL);
    url.searchParams.set("file", path);
    await fetch(url, { method: "DELETE" });
    await fetchPhotosForPatient(currentPatient.id);
}

// Photo Drag & Drop
if (dropZone) {
    dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("active"); });
    dropZone.addEventListener("dragleave", e => { e.preventDefault(); dropZone.classList.remove("active"); });
    dropZone.addEventListener("drop", e => {
        e.preventDefault();
        dropZone.classList.remove("active");
        uploadFiles(e.dataTransfer.files);
    });
    dropZone.addEventListener("click", () => photoInput.click());
}

if (photoInput) {
    photoInput.addEventListener("change", () => uploadFiles(photoInput.files));
}

// Photo Viewer Logic
function openPhotoViewer(index) {
    activePhotoIndex = index;
    updatePhotoViewer();
    photoViewer.hidden = false;
}

function updatePhotoViewer() {
    if (!patientPhotos[activePhotoIndex]) return;
    photoViewerImage.src = buildPhotoUrl(patientPhotos[activePhotoIndex].file_path);
}

if (photoViewerClose) photoViewerClose.onclick = () => photoViewer.hidden = true;
if (photoViewerPrev) photoViewerPrev.onclick = () => {
    activePhotoIndex = (activePhotoIndex - 1 + patientPhotos.length) % patientPhotos.length;
    updatePhotoViewer();
};
if (photoViewerNext) photoViewerNext.onclick = () => {
    activePhotoIndex = (activePhotoIndex + 1) % patientPhotos.length;
    updatePhotoViewer();
};

function refreshDeleteButtonState() {
    if (deletePatientBtn) {
        deletePatientBtn.hidden = !isAdminUser;
        deletePatientBtn.disabled = !currentPatient;
    }
}

// Boot
document.addEventListener("DOMContentLoaded", initializePage);
