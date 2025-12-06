const NOTIFICATION_SOUND_SRC = "/static/audio/notification.wav";
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;

let notificationAudio = null;
let soundPermissionBannerEl = null;
let soundPermissionDismissed = false;
let activityToastStackEl = null;
const activityToastTimers = new Map();

function formatHumanReadableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "short" });
  const year = date.getFullYear();
  return `${day}, ${month} ${year}`;
}

function formatToastMessage(message) {
  const fallback = "New activity received";
  if (!message || typeof message !== "string") {
    return fallback;
  }
  return message.replace(ISO_DATE_PATTERN, (match) => formatHumanReadableDate(match) || match);
}

function getNotificationAudio() {
  if (notificationAudio !== null) {
    return notificationAudio;
  }
  try {
    const audio = new Audio(NOTIFICATION_SOUND_SRC);
    audio.preload = "auto";
    audio.volume = 0.4;
    notificationAudio = audio;
  } catch (error) {
    console.warn("Unable to initialize notification sound", error);
    notificationAudio = null;
  }
  return notificationAudio;
}

function hideSoundPermissionPrompt() {
  if (soundPermissionBannerEl) {
    soundPermissionBannerEl.remove();
    soundPermissionBannerEl = null;
  }
}

function requestNotificationSoundPermission() {
  const audio = getNotificationAudio();
  if (!audio) {
    showSoundPermissionPrompt("Audio could not be initialized.");
    return;
  }
  try {
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (!playPromise || typeof playPromise.then !== "function") {
      hideSoundPermissionPrompt();
      return;
    }
    playPromise
      .then(() => {
        hideSoundPermissionPrompt();
      })
      .catch(() => {
        showSoundPermissionPrompt("Tap enable to allow notification sounds.");
      });
  } catch (_error) {
    showSoundPermissionPrompt("Tap enable to allow notification sounds.");
  }
}

function showSoundPermissionPrompt(messageOverride = null) {
  if (soundPermissionDismissed) {
    return;
  }
  if (!soundPermissionBannerEl) {
    const banner = document.createElement("div");
    banner.className = "sound-permission-banner";

    const text = document.createElement("p");
    text.className = "sound-permission-banner__text";
    text.textContent = "Enable notification sounds to hear live updates.";

    const actions = document.createElement("div");
    actions.className = "sound-permission-banner__actions";

    const allowBtn = document.createElement("button");
    allowBtn.type = "button";
    allowBtn.className = "sound-permission-banner__btn";
    allowBtn.textContent = "Enable sound";
    allowBtn.addEventListener("click", () => requestNotificationSoundPermission());

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "sound-permission-banner__dismiss";
    dismissBtn.setAttribute("aria-label", "Dismiss sound prompt");
    dismissBtn.textContent = "×";
    dismissBtn.addEventListener("click", () => {
      soundPermissionDismissed = true;
      hideSoundPermissionPrompt();
    });

    actions.appendChild(allowBtn);
    banner.append(text, actions, dismissBtn);
    document.body.appendChild(banner);
    soundPermissionBannerEl = banner;
  }
  const textEl = soundPermissionBannerEl.querySelector(".sound-permission-banner__text");
  if (messageOverride && textEl) {
    textEl.textContent = messageOverride;
  }
  soundPermissionBannerEl.hidden = false;
}

function playNotificationSound() {
  const audio = getNotificationAudio();
  if (!audio) {
    return;
  }
  try {
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        console.warn("Notification sound blocked", error);
        showSoundPermissionPrompt("Notification sounds need your permission.");
      });
    }
  } catch (error) {
    console.warn("Unable to play notification sound", error);
    showSoundPermissionPrompt("Notification sounds need your permission.");
  }
}

function ensureActivityToastStack() {
  if (activityToastStackEl) {
    return;
  }
  activityToastStackEl = document.createElement("div");
  activityToastStackEl.className = "activity-toast-stack";
  document.body.appendChild(activityToastStackEl);
}

function removeToastImmediately(toastEl) {
  if (!toastEl) {
    return;
  }
  const timer = activityToastTimers.get(toastEl);
  if (timer) {
    clearTimeout(timer);
    activityToastTimers.delete(toastEl);
  }
  toastEl.remove();
}

function dismissActivityToast(toastEl) {
  if (!toastEl) {
    return;
  }
  const timer = activityToastTimers.get(toastEl);
  if (timer) {
    clearTimeout(timer);
    activityToastTimers.delete(toastEl);
  }
  toastEl.classList.remove("activity-toast--enter");
  toastEl.classList.add("activity-toast--exit");
  toastEl.addEventListener(
    "animationend",
    () => {
      toastEl.remove();
    },
    { once: true }
  );
}

export function showActivityToast(message) {
  ensureActivityToastStack();
  if (!activityToastStackEl) {
    return;
  }
  playNotificationSound();

  const toastEl = document.createElement("div");
  toastEl.className = "activity-toast activity-toast--enter";

  const messageEl = document.createElement("div");
  messageEl.className = "activity-toast__message";
  messageEl.textContent = formatToastMessage(message);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "activity-toast__close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => dismissActivityToast(toastEl));

  toastEl.append(messageEl, closeBtn);
  activityToastStackEl.appendChild(toastEl);

  const timer = setTimeout(() => dismissActivityToast(toastEl), 5000);
  activityToastTimers.set(toastEl, timer);

  while (activityToastStackEl.children.length > 3) {
    removeToastImmediately(activityToastStackEl.firstElementChild);
  }
}

export function createRealtimeClient({
  getWebSocketUrl,
  onActivitySync,
  onEvent,
  onConnectionChange,
}) {
  let socket = null;
  let retryDelay = 0;
  let retryTimer = null;

  function notify(state) {
    if (typeof onConnectionChange === "function") {
      onConnectionChange(state);
    }
  }

  function handlePayload(payload) {
    if (!payload) {
      return;
    }
    if (payload.type === "activity.sync" && Array.isArray(payload.items)) {
      if (typeof onActivitySync === "function") {
        onActivitySync(payload.items);
      }
      return;
    }
    if (typeof onEvent === "function") {
      onEvent(payload);
    }
  }

  function scheduleReconnect() {
    if (retryTimer) {
      return;
    }
    const baseDelay = retryDelay || 2000;
    retryDelay = Math.min(baseDelay * 1.5, 15000);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryDelay);
  }

  function connect() {
    if (socket) {
      try {
        socket.close();
      } catch (_error) {
        // ignore
      }
      socket = null;
    }
    const url = typeof getWebSocketUrl === "function" ? getWebSocketUrl() : getWebSocketUrl;
    if (!url) {
      console.warn("Realtime client missing WebSocket URL");
      return;
    }
    try {
      socket = new WebSocket(url);
    } catch (error) {
      console.error("Unable to open realtime channel", error);
      notify("offline");
      scheduleReconnect();
      return;
    }
    notify("connecting");
    socket.addEventListener("open", () => {
      retryDelay = 0;
      notify("live");
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        handlePayload(payload);
      } catch (error) {
        console.error("Unable to parse realtime payload", error);
      }
    });
    socket.addEventListener("close", () => {
      notify("offline");
      scheduleReconnect();
    });
    socket.addEventListener("error", (error) => {
      console.error("Realtime channel error", error);
      try {
        socket?.close();
      } catch (_error) {
        // already closed
      }
    });
  }

  connect();

  return {
    close() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (socket) {
        try {
          socket.close();
        } catch (_error) {
          // ignore
        }
        socket = null;
      }
    },
  };
}
