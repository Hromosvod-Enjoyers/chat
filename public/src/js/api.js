import { AUTH_BASE } from "./constants.js";

export async function authMe() {
  const res = await fetch(`${AUTH_BASE}/me`);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function authEnter(username, password) {
  const res = await fetch(`${AUTH_BASE}/enter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function authLogout() {
  return fetch(`${AUTH_BASE}/logout`, { method: "POST" });
}

export async function authRelease() {
  return fetch(`${AUTH_BASE}/release`, { method: "POST" });
}

export async function loadRoomSettings(roomId) {
  const res = await fetch(`/api/room-settings?roomId=${encodeURIComponent(roomId)}`);
  if (!res.ok) throw new Error("Unable to load room settings");
  return res.json();
}

export async function fetchMessages(roomId) {
  const res = await fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}`);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function postMessage(body) {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function deleteMessage(id, roomId) {
  return fetch(`/api/messages/${id}?roomId=${encodeURIComponent(roomId)}`, {
    method: "DELETE"
  });
}

export async function postImage(body) {
  const res = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function deleteImage(id, roomId) {
  return fetch(`/api/images/${id}?roomId=${encodeURIComponent(roomId)}`, {
    method: "DELETE" }
  );
}

export async function uploadAvatar(mime, data) {
  return fetch(`${AUTH_BASE}/avatar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mime, data })
  });
}

export async function updateProfile(updates) {
  return fetch(`${AUTH_BASE}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates)
  });
}
