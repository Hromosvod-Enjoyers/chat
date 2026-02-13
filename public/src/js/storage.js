export function getLocalKey() {
  return localStorage.getItem("s1") || "";
}

export function setLocalKey(value) {
  localStorage.setItem("s1", value);
}

export function sanitizeServerSelection(value) {
  return (value || "").replace(/[^a-zA-Z0-9-]/g, "");
}
