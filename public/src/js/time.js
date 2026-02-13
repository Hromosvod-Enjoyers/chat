export function normalizeTimestampToDate(timestamp) {
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp === "number") return new Date(timestamp);
  if (typeof timestamp !== "string") return new Date(NaN);
  const trimmed = timestamp.trim();
  if (!trimmed) return new Date(NaN);
  const needsUtc = !/[zZ]|([+-]\d{2}:?\d{2})$/.test(trimmed);
  if (needsUtc) {
    const utcNormalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    return new Date(`${utcNormalized}Z`);
  }
  return new Date(trimmed);
}

export function formatTimeAgoShort(timestamp) {
  const createdAt = normalizeTimestampToDate(timestamp);
  if (Number.isNaN(createdAt.getTime())) return "";
  const diffMs = Date.now() - createdAt.getTime();
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return diffMonths === 1 ? "a month ago" : `${diffMonths} months ago`;
  }
  const diffYears = Math.floor(diffDays / 365);
  return diffYears === 1 ? "a year ago" : `${diffYears} years ago`;
}

export function updateClientMessageTimes(chatLog) {
  if (!chatLog) return;
  const timeEls = chatLog.querySelectorAll(".time.time-ago[data-created-at]");
  timeEls.forEach((el) => {
    const createdAt = el.getAttribute("data-created-at");
    if (!createdAt) return;
    el.textContent = formatTimeAgoShort(createdAt);
  });
}

export function startTimeAgoUpdater(state, chatLog) {
  if (state.timeAgoTimer) return;
  updateClientMessageTimes(chatLog);
  state.timeAgoTimer = setInterval(() => updateClientMessageTimes(chatLog), 1000);
}

export function stopTimeAgoUpdater(state) {
  if (state.timeAgoTimer) clearInterval(state.timeAgoTimer);
  state.timeAgoTimer = null;
}
