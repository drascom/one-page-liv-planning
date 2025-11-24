const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;

const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("login-username");
const passwordInput = document.getElementById("login-password");
const passwordToggle = document.getElementById("password-toggle");
const loginStatus = document.getElementById("login-status");
const params = new URLSearchParams(window.location.search);
const nextPath = params.get("next") || "/";

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

async function handleLogin(event) {
  event.preventDefault();
  if (!usernameInput.value.trim() || !passwordInput.value.trim()) {
    loginStatus.textContent = "Enter username and password.";
    return;
  }
  loginStatus.textContent = "Signing in...";
  try {
    const response = await fetch(buildApiUrl("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      }),
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Invalid username or password.");
      }
      throw new Error("Unable to sign in.");
    }
    window.location.href = nextPath || "/";
  } catch (error) {
    loginStatus.textContent = error.message;
  } finally {
    passwordInput.value = "";
    passwordInput.type = "password";
    if (passwordToggle) {
      passwordToggle.setAttribute("aria-pressed", "false");
      passwordToggle.setAttribute("aria-label", "Show password");
      const label = passwordToggle.querySelector(".visually-hidden");
      if (label) {
        label.textContent = "Show password";
      }
    }
  }
}

async function checkExistingSession() {
  try {
    const response = await fetch(buildApiUrl("/auth/me"));
    if (response.ok) {
      window.location.href = nextPath || "/";
    }
  } catch (_error) {
    // ignore
  }
}

loginForm.addEventListener("submit", handleLogin);
if (passwordToggle) {
  passwordToggle.addEventListener("click", () => {
    const revealing = passwordInput.type === "password";
    passwordInput.type = revealing ? "text" : "password";
    passwordToggle.setAttribute("aria-pressed", String(revealing));
    const nextLabel = revealing ? "Hide password" : "Show password";
    passwordToggle.setAttribute("aria-label", nextLabel);
    const labelEl = passwordToggle.querySelector(".visually-hidden");
    if (labelEl) {
      labelEl.textContent = nextLabel;
    }
  });
}
checkExistingSession();
