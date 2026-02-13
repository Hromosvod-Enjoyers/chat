import { dom } from "./dom.js";
import { getAvatarUrl, getProfileColor } from "./user.js";

export function openUserProfile(user) {
  if (!user || !dom.userModal) return;
  dom.userModal.classList.add("show");
  if (dom.userProfileAvatar) dom.userProfileAvatar.src = getAvatarUrl(user);
  if (dom.userProfileName) {
    dom.userProfileName.textContent = user.username || "";
    dom.userProfileName.style.color = getProfileColor(user);
  }
  if (dom.userProfileDescription) {
    dom.userProfileDescription.textContent = user.description || "No description";
  }
  if (dom.userBanner) {
    if (user.banner_mime && user.banner_data) {
      dom.userBanner.style.backgroundImage = `url(data:${user.banner_mime};base64,${user.banner_data})`;
      dom.userBanner.textContent = "";
    } else {
      dom.userBanner.style.backgroundImage = "";
      dom.userBanner.textContent = "No banner";
    }
  }
}
