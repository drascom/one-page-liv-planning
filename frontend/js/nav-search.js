const GLOBAL_SEARCH_KEY = "globalSearchQuery";
const searchForm = document.getElementById("patient-search-form");
const searchInput = document.getElementById("patient-search");
const searchClearBtn = document.getElementById("patient-search-clear");
const searchResultsEl = document.getElementById("patient-search-results");

function setSearchClearState(active) {
  if (searchClearBtn) {
    searchClearBtn.hidden = !active;
  }
}

function resetSearchField() {
  if (searchInput) {
    searchInput.value = "";
  }
  setSearchClearState(false);
  if (searchResultsEl) {
    searchResultsEl.innerHTML = "";
    searchResultsEl.hidden = true;
  }
}

function handleNavSearchSubmit(event) {
  event.preventDefault();
  if (!searchInput) {
    return;
  }
  const query = searchInput.value.trim();
  if (!query) {
    return;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(GLOBAL_SEARCH_KEY, query);
    } catch {
      // Ignore storage failures
    }
  }
  window.location.href = "/";
}

if (searchResultsEl) {
  searchResultsEl.innerHTML = "";
  searchResultsEl.hidden = true;
}

if (searchForm && searchInput) {
  searchForm.addEventListener("submit", handleNavSearchSubmit);
  searchInput.addEventListener("input", () => {
    const hasValue = Boolean(searchInput.value.trim());
    setSearchClearState(hasValue);
  });
  searchInput.addEventListener("search", () => {
    const hasValue = Boolean(searchInput.value.trim());
    if (!hasValue) {
      resetSearchField();
    }
  });
}

if (searchClearBtn) {
  searchClearBtn.addEventListener("click", () => {
    resetSearchField();
  });
  setSearchClearState(Boolean(searchInput?.value.trim()));
} else if (searchInput) {
  setSearchClearState(Boolean(searchInput.value.trim()));
}
