let cachedPatientRouteBase = "/patient";

function persistPatientRoute(base) {
  cachedPatientRouteBase = base;
  if (typeof window !== "undefined") {
    window.__PATIENT_ROUTE_BASE__ = base;
  }
}

export function setPatientRouteBase(options) {
  const base = options && options.useReadOnly ? "/patient-view" : "/patient";
  persistPatientRoute(base);
}

export function getPatientRouteBaseSync() {
  if (cachedPatientRouteBase) {
    return cachedPatientRouteBase;
  }
  if (typeof window !== "undefined" && typeof window.__PATIENT_ROUTE_BASE__ === "string") {
    cachedPatientRouteBase = window.__PATIENT_ROUTE_BASE__;
    return cachedPatientRouteBase;
  }
  return null;
}

export async function getPatientRouteBase() {
  const cached = getPatientRouteBaseSync();
  return cached;
}

function buildSearchParams(patientId, options = {}) {
  const params = new URLSearchParams();
  if (patientId != null) {
    params.set("id", String(patientId));
  }
  if (options.patientName) {
    params.set("patient", options.patientName);
  }
  if (options.procedureId) {
    params.set("procedure", String(options.procedureId));
  }
  if (options.query && typeof options.query === "object") {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value != null) {
        params.set(key, String(value));
      }
    });
  }
  return params;
}

export function buildPatientRecordUrlSync(patientId, options = {}) {
  const base = getPatientRouteBaseSync() ?? "/patient";
  const params = buildSearchParams(patientId, options);
  return `${base}?${params.toString()}`;
}

export async function buildPatientRecordUrl(patientId, options = {}) {
  const base = await getPatientRouteBase();
  const params = buildSearchParams(patientId, options);
  return `${base}?${params.toString()}`;
}

export async function navigateToPatientRecord(patientId, options = {}) {
  if (!patientId) return;
  const target = await buildPatientRecordUrl(patientId, options);
  window.location.href = target;
}
