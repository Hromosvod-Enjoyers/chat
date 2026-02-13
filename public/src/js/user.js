import { PROFILE_COLORS } from "./constants.js";

export function getAvatarUrl(user) {
  if (user && user.avatar_mime && user.avatar_data) {
    return `data:${user.avatar_mime};base64,${user.avatar_data}`;
  }
  const seed = user && user.username ? user.username : "default";
  return `https://api.dicebear.com/9.x/rings/svg?size=32&seed=${encodeURIComponent(seed)}`;
}

export function getProfileColor(user) {
  const color = user && user.profile_color ? user.profile_color : "";
  return PROFILE_COLORS.includes(color) ? color : PROFILE_COLORS[2];
}

export function describeFileType(file) {
  const name = file && file.name ? file.name : "unknown";
  const mime = file && file.type ? file.type : "unknown";
  return `${name} (${mime})`;
}
