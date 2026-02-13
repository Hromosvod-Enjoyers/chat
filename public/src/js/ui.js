export function setStatus(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.className = `status ${isError ? "error" : ""}`;
}

export function setVisible(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}
