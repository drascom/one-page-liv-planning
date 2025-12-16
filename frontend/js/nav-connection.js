import { createRealtimeClient } from "./realtime.js";

const API_BASE_URL =
  window.APP_CONFIG?.backendUrl ?? `${window.location.protocol}//${window.location.host}`;

const connectionIndicator = document.getElementById("connection-indicator");

function buildWebSocketUrl(path) {
  try {
    const apiUrl = new URL(API_BASE_URL);
    const protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${apiUrl.host}${path}`;
  } catch (_error) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${path}`;
  }
}

function setIndicatorState(state) {
  if (!connectionIndicator) {
    return;
  }
  connectionIndicator.classList.toggle("connection-indicator--live", state === "live");
}

if (connectionIndicator) {
  setIndicatorState("offline");

  createRealtimeClient({
    getWebSocketUrl: () => buildWebSocketUrl("/ws/updates"),
    onConnectionChange(state) {
      setIndicatorState(state === "live" ? "live" : "offline");
    },
  });
}
