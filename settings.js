const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ??
  `${window.location.protocol}//${window.location.host}`;

const tokenForm = document.getElementById("token-form");
const tokenNameInput = document.getElementById("token-name");
const tokenStatus = document.getElementById("token-status");
const tokenList = document.getElementById("token-list");
const createButton = document.getElementById("create-token-btn");

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
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
          <code class="token-value">${token.token}</code>
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
fetchTokens();
