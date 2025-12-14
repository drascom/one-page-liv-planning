export function currentPathWithQuery() {
  return `${window.location.pathname}${window.location.search}`;
}

const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;
const DEFAULT_VERSION_LABEL = "V- dev";

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

export function redirectToLogin() {
  if (window.location.pathname === "/login") {
    return;
  }
  const next = encodeURIComponent(currentPathWithQuery());
  window.location.href = `/login?next=${next}`;
}

export function handleUnauthorized(response) {
  if (response.status === 401) {
    redirectToLogin();
    throw new Error("Not authenticated");
  }
  return response;
}

export async function logout() {
  await fetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export function initSessionControls() {
  document.querySelectorAll("[data-logout-btn]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      await logout();
    });
  });
}

export function initAppVersionDisplay() {
  const version = window.APP_CONFIG?.version;
  const label = version ? `V- ${version}` : DEFAULT_VERSION_LABEL;
  document.querySelectorAll("[data-app-version]").forEach((el) => {
    el.textContent = label;
    el.removeAttribute("hidden");
  });
}

let cachedCurrentUser = null;
let currentUserRequest = null;

function normalizeAdminFlag(flag) {
  if (typeof flag === "boolean") {
    return flag;
  }
  if (typeof flag === "number") {
    return flag === 1;
  }
  if (typeof flag === "string") {
    const normalized = flag.trim().toLowerCase();
    if (!normalized) return false;
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function normalizeUserRecord(user) {
  if (!user || typeof user !== "object") {
    return null;
  }
  return { ...user, is_admin: normalizeAdminFlag(user.is_admin) };
}

function updateDocumentAdminFlag(isAdmin) {
  if (typeof document === "undefined" || !document.documentElement) {
    return;
  }
  if (isAdmin) {
    document.documentElement.setAttribute("data-admin-user", "true");
  } else {
    document.documentElement.removeAttribute("data-admin-user");
  }
}

async function loadCurrentUser() {
  const response = await fetch(buildApiUrl("/auth/me"));
  handleUnauthorized(response);
  if (!response.ok) {
    return null;
  }
  return response.json();
}

export async function fetchCurrentUser({ force = false } = {}) {
  if (!force && cachedCurrentUser) {
    return cachedCurrentUser;
  }
  if (!force && currentUserRequest) {
    return currentUserRequest;
  }
  const request = loadCurrentUser()
    .catch(() => null)
    .then((user) => normalizeUserRecord(user));
  if (!force) {
    currentUserRequest = request;
  }
  const user = await request;
  updateDocumentAdminFlag(Boolean(user?.is_admin));
  cachedCurrentUser = user;
  if (!force) {
    currentUserRequest = null;
  }
  return user;
}

export async function requireAdminUser({ redirectTo = "/" } = {}) {
  const user = await fetchCurrentUser();
  if (!user) {
    return null;
  }
  if (!user.is_admin) {
    window.location.replace(redirectTo);
    return null;
  }
  return user;
}
