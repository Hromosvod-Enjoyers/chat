import { dom } from "./dom.js";
import { state } from "./state.js";
import { MAX_AVATAR_BYTES, MAX_BANNER_BYTES, PROFILE_COLORS } from "./constants.js";
import { prepareAvatarImage } from "./media.js";
import { arrayBufferToBase64 } from "./crypto.js";
import { describeFileType, getAvatarUrl, getProfileColor } from "./user.js";
import { setStatus } from "./ui.js";
import { uploadAvatar, updateProfile } from "./api.js";

let pendingBannerData = null;
let pendingBannerMime = null;
let pendingAvatarData = null;
let pendingAvatarMime = null;
let pendingProfileColor = "";

function renderProfileColors(selectedColor) {
  if (!dom.profileColors) return;
  dom.profileColors.textContent = "";
  PROFILE_COLORS.forEach((color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "profile-color-btn";
    btn.style.backgroundColor = color;
    if (color === selectedColor) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      pendingProfileColor = color;
      renderProfileColors(color);
    });
    dom.profileColors.appendChild(btn);
  });
}

export function openProfileModal() {
  if (!state.currentUser || !dom.profileModal) return;
  dom.profileModal.classList.add("show");
  if (dom.profileDescription) dom.profileDescription.value = state.currentUser.description || "";
  pendingProfileColor = getProfileColor(state.currentUser);
  renderProfileColors(pendingProfileColor);
  if (dom.profileAvatarPreview) dom.profileAvatarPreview.src = getAvatarUrl(state.currentUser);
  if (dom.bannerPreview) {
    if (state.currentUser.banner_mime && state.currentUser.banner_data) {
      dom.bannerPreview.style.backgroundImage = `url(data:${state.currentUser.banner_mime};base64,${state.currentUser.banner_data})`;
      dom.bannerPreview.classList.add("has-image");
      dom.bannerPreview.textContent = "";
    } else {
      dom.bannerPreview.style.backgroundImage = "";
      dom.bannerPreview.classList.remove("has-image");
      dom.bannerPreview.textContent = "No banner";
    }
  }
  pendingBannerData = null;
  pendingBannerMime = null;
  pendingAvatarData = null;
  pendingAvatarMime = null;
}

async function handleAvatarUpload(file, refreshMessages) {
  if (!state.currentUser) {
    setStatus(dom.chatStatus, "Login required to set avatar", true);
    return;
  }
  if (!file.type || !file.type.startsWith("image/")) {
    setStatus(dom.chatStatus, `Unsupported file type: ${describeFileType(file)}`, true);
    return;
  }
  try {
    setStatus(dom.chatStatus, "Preparing avatar...");
    const { buffer, mime } = await prepareAvatarImage(file);
    if (buffer.byteLength > MAX_AVATAR_BYTES) {
      setStatus(dom.chatStatus, "Avatar too large (max 200KB)", true);
      return;
    }
    setStatus(dom.chatStatus, "Uploading avatar...");
    const data = arrayBufferToBase64(buffer);
    const res = await uploadAvatar(mime, data);
    if (!res.ok) {
      let errorText = "Avatar upload failed";
      try {
        const payload = await res.json();
        errorText = payload.error || errorText;
      } catch (err) {
      }
      setStatus(dom.chatStatus, errorText, true);
      return;
    }
    state.currentUser.avatar_mime = mime;
    state.currentUser.avatar_data = data;
    if (dom.currentUserImg) dom.currentUserImg.src = getAvatarUrl(state.currentUser);
    await refreshMessages();
    setStatus(dom.chatStatus, "Avatar updated");
  } catch (err) {
    setStatus(dom.chatStatus, "Avatar upload failed", true);
  }
}

export function initProfileHandlers(refreshMessages) {
  if (dom.profileModalClose && dom.profileModal) {
    dom.profileModalClose.addEventListener("click", () => {
      dom.profileModal.classList.remove("show");
    });
    dom.profileModal.addEventListener("click", (e) => {
      if (e.target === dom.profileModal) dom.profileModal.classList.remove("show");
    });
  }

  if (dom.userModalClose && dom.userModal) {
    dom.userModalClose.addEventListener("click", () => {
      dom.userModal.classList.remove("show");
    });
    dom.userModal.addEventListener("click", (e) => {
      if (e.target === dom.userModal) dom.userModal.classList.remove("show");
    });
  }

  if (dom.bannerUploadBtn && dom.bannerInput) {
    dom.bannerUploadBtn.addEventListener("click", () => dom.bannerInput.click());
  }

  if (dom.profileAvatarBtn && dom.profileAvatarInput) {
    dom.profileAvatarBtn.addEventListener("click", () => dom.profileAvatarInput.click());
  }

  if (dom.profileAvatarInput) {
    dom.profileAvatarInput.addEventListener("change", async () => {
      const file = dom.profileAvatarInput.files && dom.profileAvatarInput.files[0];
      dom.profileAvatarInput.value = "";
      if (!file) return;
      if (!file.type || !file.type.startsWith("image/")) {
        setStatus(dom.chatStatus, `Unsupported file type: ${describeFileType(file)}`, true);
        return;
      }
      try {
        const { buffer, mime } = await prepareAvatarImage(file);
        if (buffer.byteLength > MAX_AVATAR_BYTES) {
          setStatus(dom.chatStatus, "Avatar too large (max 200KB)", true);
          return;
        }
        pendingAvatarData = arrayBufferToBase64(buffer);
        pendingAvatarMime = mime;
        if (dom.profileAvatarPreview) {
          dom.profileAvatarPreview.src = `data:${mime};base64,${pendingAvatarData}`;
        }
        setStatus(dom.chatStatus, "Avatar ready to save");
      } catch (err) {
        setStatus(dom.chatStatus, "Avatar upload failed", true);
      }
    });
  }

  if (dom.bannerInput) {
    dom.bannerInput.addEventListener("change", async () => {
      const file = dom.bannerInput.files && dom.bannerInput.files[0];
      dom.bannerInput.value = "";
      if (!file) return;
      if (!file.type || !file.type.startsWith("image/")) {
        setStatus(dom.chatStatus, `Unsupported file type: ${describeFileType(file)}`, true);
        return;
      }
      try {
        const { buffer, mime } = await prepareAvatarImage(file);
        if (buffer.byteLength > MAX_BANNER_BYTES) {
          setStatus(dom.chatStatus, "Banner too large (max 500KB)", true);
          return;
        }
        pendingBannerData = arrayBufferToBase64(buffer);
        pendingBannerMime = mime;
        if (dom.bannerPreview) {
          dom.bannerPreview.style.backgroundImage = `url(data:${mime};base64,${pendingBannerData})`;
          dom.bannerPreview.classList.add("has-image");
          dom.bannerPreview.textContent = "";
        }
        setStatus(dom.chatStatus, "Banner ready to save");
      } catch (err) {
        setStatus(dom.chatStatus, "Banner upload failed", true);
      }
    });
  }

  if (dom.profileSaveBtn) {
    dom.profileSaveBtn.addEventListener("click", async () => {
      if (!state.currentUser) return;
      const description = dom.profileDescription ? dom.profileDescription.value.trim() : "";
      const updates = { description };
      if (pendingBannerData !== null && pendingBannerMime !== null) {
        updates.bannerMime = pendingBannerMime;
        updates.bannerData = pendingBannerData;
      }
      if (pendingAvatarData !== null && pendingAvatarMime !== null) {
        updates.avatarMime = pendingAvatarMime;
        updates.avatarData = pendingAvatarData;
      }
      if (pendingProfileColor) {
        updates.color = pendingProfileColor;
      }
      setStatus(dom.chatStatus, "Saving profile...");
      const res = await updateProfile(updates);
      if (!res.ok) {
        let errorText = "Profile update failed";
        try {
          const data = await res.json();
          errorText = data.error || errorText;
        } catch (err) {
        }
        setStatus(dom.chatStatus, errorText, true);
        return;
      }
      state.currentUser.description = description;
      if (pendingBannerData) {
        state.currentUser.banner_mime = pendingBannerMime;
        state.currentUser.banner_data = pendingBannerData;
      }
      if (pendingAvatarData) {
        state.currentUser.avatar_mime = pendingAvatarMime;
        state.currentUser.avatar_data = pendingAvatarData;
        if (dom.currentUserImg) dom.currentUserImg.src = getAvatarUrl(state.currentUser);
        if (dom.userProfileAvatar) dom.userProfileAvatar.src = getAvatarUrl(state.currentUser);
      }
      if (pendingProfileColor) {
        state.currentUser.profile_color = pendingProfileColor;
        if (dom.currentUserEl) dom.currentUserEl.style.color = getProfileColor(state.currentUser);
      }
      if (dom.profileModal) dom.profileModal.classList.remove("show");
      setStatus(dom.chatStatus, "Profile updated");
      await refreshMessages();
    });
  }

  if (dom.avatarInput) {
    dom.avatarInput.addEventListener("change", async () => {
      const file = dom.avatarInput.files && dom.avatarInput.files[0];
      dom.avatarInput.value = "";
      if (!file) return;
      await handleAvatarUpload(file, refreshMessages);
    });
  }
}
