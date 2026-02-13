import { initDom, dom } from "./dom.js";
import { state } from "./state.js";
import { getAvatarUrl, getProfileColor } from "./user.js";
import { setStatus, setVisible } from "./ui.js";
import { getLocalKey, sanitizeServerSelection, setLocalKey } from "./storage.js";
import { deriveKey, deriveRoomId } from "./crypto.js";
import { authEnter, authMe, authLogout, authRelease, loadRoomSettings } from "./api.js";
import { bindChatHandlers, initSocket, refreshMessages, setAuthSectionVisibility, setChatSectionVisibility, startIdleWatcher, stopIdleWatcher, stopPolling, stopSocket } from "./chat.js";
import { initMentionAutocomplete } from "./mentions.js";
import { initProfileHandlers, openProfileModal } from "./profile.js";
import { stopTimeAgoUpdater } from "./time.js";

function updateCurrentUserUI() {
  if (!state.currentUser) return;
  if (dom.currentUserImg) dom.currentUserImg.src = getAvatarUrl(state.currentUser);
  if (dom.currentUserEl) {
    dom.currentUserEl.textContent = `${state.currentUser.username}`;
    dom.currentUserEl.style.color = getProfileColor(state.currentUser);
  }
  setVisible(dom.logoutBtn, true);
  setVisible(dom.releaseBtn, true);
}

function clearCurrentUserUI() {
  if (dom.currentUserEl) dom.currentUserEl.textContent = "";
  setVisible(dom.logoutBtn, false);
  setVisible(dom.releaseBtn, false);
}

async function bootstrap() {
  const { data } = await authMe();
  state.currentUser = data.user;
  state.masterUnlocked = Boolean(state.chatKey);

  setAuthSectionVisibility(dom.page === "login" || dom.page === "app");
  setChatSectionVisibility(dom.page === "app" && Boolean(state.currentUser));

  if (state.currentUser && dom.currentUserEl) {
    updateCurrentUserUI();
  }

  const savedPass = getLocalKey();
  if (savedPass) {
    try {
      state.roomId = await deriveRoomId(savedPass);
      state.chatSettings = await loadRoomSettings(state.roomId);
      state.chatKey = await deriveKey(savedPass, state.chatSettings.salt, state.chatSettings.opslimit, state.chatSettings.memlimit);
      state.masterUnlocked = true;
      if (dom.page === "login" && state.currentUser) {
        location.replace("/app.html");
        return;
      }
      if (dom.page === "app") {
        if (state.currentUser) {
          await refreshMessages({ forceBottom: true });
          initSocket();
          startIdleWatcher();
        } else {
          setChatSectionVisibility(false);
        }
      }
    } catch (err) {
    }
  }

  if ((!savedPass || !state.currentUser) && dom.page === "app") {
    location.replace("/login.html");
  }
}

function bindAuthHandlers() {
  if (dom.serverSelection) {
    const saved = getLocalKey();
    if (saved) dom.serverSelection.value = saved;
    dom.serverSelection.addEventListener("input", () => {
      const cleaned = sanitizeServerSelection(dom.serverSelection.value);
      if (dom.serverSelection.value !== cleaned) {
        dom.serverSelection.value = cleaned;
      }
      setLocalKey(cleaned);
    });
    dom.serverSelection.addEventListener("blur", () => {
      const cleaned = sanitizeServerSelection(dom.serverSelection.value);
      dom.serverSelection.value = cleaned;
      setLocalKey(cleaned);
    });
  }

  if (dom.authForm) {
    dom.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus(dom.authStatus, "Checking account...");
      const username = document.getElementById("auth-username").value;
      const password = document.getElementById("auth-password").value;
      if (username && !/^[a-zA-Z0-9._]+$/.test(username.trim())) {
        setStatus(dom.authStatus, "Username can only contain letters, numbers, dots, and underscores", true);
        return;
      }
      const { res, data } = await authEnter(username, password);
      if (!res.ok) {
        setStatus(dom.authStatus, data.error || "Auth failed", true);
        return;
      }
      state.currentUser = { username: data.username };
      if (dom.currentUserEl) dom.currentUserEl.textContent = `${data.username}`;
      setVisible(dom.logoutBtn, true);
      setVisible(dom.releaseBtn, true);
      setStatus(dom.authStatus, data.mode === "register" ? "Registered and logged in" : "Logged in");
      if (dom.page === "login") {
        setTimeout(() => {
          window.location.href = "/app.html";
        }, 400);
        return;
      }
      if (dom.page === "app") {
        setChatSectionVisibility(true);
        await refreshMessages({ forceBottom: true });
        initSocket();
        startIdleWatcher();
      }
    });
  }

  if (dom.logoutBtn) {
    dom.logoutBtn.addEventListener("click", async () => {
      await authLogout();
      state.currentUser = null;
      state.masterUnlocked = false;
      state.chatKey = null;
      state.chatSettings = null;
      state.roomId = "";
      stopSocket();
      stopPolling();
      stopIdleWatcher();
      stopTimeAgoUpdater(state);
      state.serverMessages = [];
      if (dom.page === "app") {
        location.replace("/login.html");
        return;
      }
      clearCurrentUserUI();
    });
  }

  if (dom.releaseBtn) {
    dom.releaseBtn.addEventListener("click", async () => {
      const confirmRelease = confirm("Are you sure you want to release your username?");
      if (!confirmRelease) return;
      if (!state.currentUser) return;
      const res = await authRelease();
      if (!res.ok) {
        let errorText = "Release failed";
        try {
          const data = await res.json();
          errorText = data.error || errorText;
        } catch (err) {
        }
        setStatus(dom.authStatus, errorText, true);
        return;
      }
      state.currentUser = null;
      stopSocket();
      stopPolling();
      stopIdleWatcher();
      stopTimeAgoUpdater(state);
      clearCurrentUserUI();
      setStatus(dom.authStatus, "Username released");
      state.serverMessages = [];
      if (dom.page === "app") {
        location.replace("/login.html");
        return;
      }
    });
  }

  if (dom.currentUserImg) dom.currentUserImg.addEventListener("click", openProfileModal);
  if (dom.currentUserEl) dom.currentUserEl.addEventListener("click", openProfileModal);
}

function init() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  initDom();
  bindAuthHandlers();
  bindChatHandlers();
  initProfileHandlers(refreshMessages);
  initMentionAutocomplete();
  bootstrap();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
  bindChatHandlers();
