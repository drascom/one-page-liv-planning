export function currentPathWithQuery() {
  return `${window.location.pathname}${window.location.search}`;
}

const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;

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

let cachedCurrentUser = null;
let currentUserRequest = null;

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
  const request = loadCurrentUser().catch(() => null);
  if (!force) {
    currentUserRequest = request;
  }
  const user = await request;
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
