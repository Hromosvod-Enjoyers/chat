import { dom } from "./dom.js";
import { state } from "./state.js";
import { MAX_IMAGE_BYTES } from "./constants.js";
import { decryptBinary, decryptMessage, encryptBinary, encryptMessage } from "./crypto.js";
import { stripImageMetadata } from "./media.js";
import { formatTimeAgoShort, startTimeAgoUpdater, stopTimeAgoUpdater, updateClientMessageTimes } from "./time.js";
import { getAvatarUrl, getProfileColor } from "./user.js";
import { setStatus } from "./ui.js";
import { fetchMessages, postImage, postMessage, deleteImage, deleteMessage } from "./api.js";
import { openUserProfile } from "./userProfileView.js";

let replyIndicator = null;

function createServerMessageLine(message) {
  const line = document.createElement("div");
  line.className = "chat-line server-message";
  const header = document.createElement("div");
  const userSpan = document.createElement("span");
  userSpan.className = "user";
  userSpan.textContent = "SERVER One-user";
  const timeSpan = document.createElement("span");
  timeSpan.className = "time";
  timeSpan.textContent = message.time;
  header.appendChild(userSpan);
  header.appendChild(timeSpan);

  const messageDiv = document.createElement("div");
  messageDiv.className = "message";
  messageDiv.textContent = message.text;

  line.appendChild(header);
  line.appendChild(messageDiv);
  return line;
}

function setVisible(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function isAtBottom() {
  if (!dom.chatLog) return true;
  return dom.chatLog.scrollHeight - dom.chatLog.scrollTop - dom.chatLog.clientHeight < 48;
}

function scrollToBottom() {
  if (!dom.chatLog) return;
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
  requestAnimationFrame(() => {
    if (!dom.chatLog) return;
    dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
    requestAnimationFrame(() => {
      if (dom.chatLog) dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
    });
  });
}

function updateNewMessageBanner() {
  if (!dom.newMessageBanner) return;
  if (state.unreadCount > 0) {
    const label = state.unreadCount === 1 ? "1 new message" : `${state.unreadCount} new messages`;
    dom.newMessageBanner.textContent = label;
    dom.newMessageBanner.classList.remove("hidden");
    return;
  }
  dom.newMessageBanner.classList.add("hidden");
}

function openImageModal(src) {
  if (!dom.imageModal || !dom.imageModalImg || !src) return;
  dom.imageModalImg.src = src;
  dom.imageModal.classList.add("show");
}

function closeImageModal() {
  if (!dom.imageModal) return;
  dom.imageModal.classList.remove("show");
  if (dom.imageModalImg) dom.imageModalImg.src = "";
}

function renderTextWithMentions(target, text) {
  target.textContent = "";
  if (!text) return;
  const regex = /@([a-zA-Z0-9._]+)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      target.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const span = document.createElement("span");
    span.className = "mention";
    const isSelf = state.currentUser && match[1] === state.currentUser.username;
    if (isSelf) {
      span.classList.add("mention-self");
    } else {
      const userColor = state.userColorMap.get(match[1]);
      if (userColor) {
        span.classList.add("mention-other");
        span.style.borderColor = userColor;
        span.style.backgroundColor = `${userColor}22`;
        span.style.color = userColor;
      }
    }
    span.textContent = `@${match[1]}`;
    target.appendChild(span);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    target.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function getGifUrl(text) {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const lowerPath = url.pathname.toLowerCase();
    if (lowerPath.endsWith(".gif")) return url.toString();
    if (url.hostname === "giphy.com") {
      const parts = url.pathname.split("-");
      const id = parts[parts.length - 1];
      if (id) return `https://media.giphy.com/media/${id}/giphy.gif`;
    }
    return "";
  } catch (err) {
    return "";
  }
}

function getTenorOembedUrl(text) {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname.endsWith("tenor.com")) return "";
    if (url.hostname === "media.tenor.com") return "";
    return `https://tenor.com/oembed?url=${encodeURIComponent(url.toString())}`;
  } catch (err) {
    return "";
  }
}

async function getGifUrlForMessage(text) {
  const direct = getGifUrl(text);
  if (direct) return direct;
  const oembedUrl = getTenorOembedUrl(text);
  if (!oembedUrl) return "";
  try {
    const res = await fetch(oembedUrl);
    if (!res.ok) return "";
    const data = await res.json();
    const candidate = data && (data.thumbnail_url || data.url);
    if (!candidate || typeof candidate !== "string") return "";
    return candidate;
  } catch (err) {
    return "";
  }
}

function scrollToMessage(messageId) {
  if (!dom.chatLog || !messageId) return;
  const targetLine = dom.chatLog.querySelector(`[data-message-id="${messageId}"]`);
  if (!targetLine) return;
  targetLine.scrollIntoView({ behavior: "smooth", block: "center" });
  targetLine.style.transition = "background-color 0.3s ease";
  targetLine.style.backgroundColor = "rgba(255, 122, 89, 0.15)";
  setTimeout(() => {
    targetLine.style.backgroundColor = "";
  }, 2000);
}

function ensureReplyIndicator() {
  if (replyIndicator || !dom.chatForm) return;
  replyIndicator = document.createElement("div");
  replyIndicator.id = "reply-indicator";
  replyIndicator.className = "reply-indicator";
  dom.chatForm.parentElement.insertBefore(replyIndicator, dom.chatForm);
}

function setReplyTarget(item) {
  if (!item || !item.id || !dom.chatInput) return;
  dom.chatInput.setAttribute("data-reply-to-id", item.id);
  dom.chatInput.setAttribute("data-reply-to-username", item.username || "");
  dom.chatInput.setAttribute("data-reply-to-text", (item.text || "").substring(0, 100));

  ensureReplyIndicator();
  if (!replyIndicator) return;
  replyIndicator.textContent = "";

  const content = document.createElement("div");
  content.className = "reply-indicator-content";

  const icon = document.createElement("span");
  icon.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" fill=\"currentColor\" viewBox=\"0 0 16 16\"><path fill-rule=\"evenodd\" d=\"M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5\"/></svg>";
  content.appendChild(icon);

  const textWrap = document.createElement("div");
  const replyToUser = document.createElement("div");
  replyToUser.className = "reply-to-user";
  replyToUser.textContent = `Replying to ${item.username || "user"}`;
  const replyText = document.createElement("div");
  replyText.className = "reply-to-text";
  const trimmed = (item.text || "").length > 50 ? (item.text || "").substring(0, 50) + "..." : (item.text || "");
  replyText.textContent = trimmed;
  textWrap.appendChild(replyToUser);
  textWrap.appendChild(replyText);
  content.appendChild(textWrap);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "reply-cancel";
  cancelBtn.type = "button";
  cancelBtn.textContent = "x";
  cancelBtn.addEventListener("click", clearReplyTarget);

  replyIndicator.appendChild(content);
  replyIndicator.appendChild(cancelBtn);
  replyIndicator.style.display = "flex";

  dom.chatInput.focus();
}

function clearReplyTarget() {
  if (dom.chatInput) {
    dom.chatInput.removeAttribute("data-reply-to-id");
    dom.chatInput.removeAttribute("data-reply-to-username");
    dom.chatInput.removeAttribute("data-reply-to-text");
  }
  if (replyIndicator) {
    replyIndicator.style.display = "none";
  }
}

function getReplyPayload() {
  if (!dom.chatInput) return {};
  const replyToId = dom.chatInput.getAttribute("data-reply-to-id");
  const replyToUsername = dom.chatInput.getAttribute("data-reply-to-username");
  const replyToText = dom.chatInput.getAttribute("data-reply-to-text");
  return { replyToId, replyToUsername, replyToText };
}

function updateUserMaps(item, color) {
  if (item.username && color) {
    state.userColorMap.set(item.username, color);
    state.userDataMap.set(item.username, {
      color,
      avatar_mime: item.avatar_mime,
      avatar_data: item.avatar_data
    });
  }
}

async function buildUserMessageLine(item) {
  if (!item) return null;
  const line = document.createElement("div");
  line.className = "chat-line";
  if (item.id != null) line.setAttribute("data-message-id", String(item.id));

  const canDelete = state.currentUser && item.username === state.currentUser.username;
  const avatarUrl = getAvatarUrl(item);
  const userColor = getProfileColor(item);
  updateUserMaps(item, userColor);

  const userZone = document.createElement("div");
  userZone.className = "userzone";

  const userWrap = document.createElement("div");
  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.src = avatarUrl;
  avatar.alt = item.username || "";
  avatar.width = 32;
  avatar.height = 32;

  const userSpan = document.createElement("span");
  userSpan.className = "user";
  userSpan.textContent = item.username || "";
  userSpan.style.color = userColor;

  userWrap.appendChild(avatar);
  userWrap.appendChild(userSpan);
  userWrap.classList.add("user-clickable");
  userWrap.addEventListener("click", () => openUserProfile(item));
  avatar.addEventListener("click", (event) => {
    event.stopPropagation();
    openUserProfile(item);
  });
  userSpan.addEventListener("click", (event) => {
    event.stopPropagation();
    openUserProfile(item);
  });

  const timeSpan = document.createElement("span");
  timeSpan.className = "time time-ago";
  if (item.createdAt) timeSpan.setAttribute("data-created-at", item.createdAt);
  timeSpan.textContent = item.createdAt ? formatTimeAgoShort(item.createdAt) : "";

  userZone.appendChild(userWrap);
  userZone.appendChild(timeSpan);

  const replyBtn = document.createElement("button");
  replyBtn.className = "reply-btn";
  replyBtn.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" viewBox=\"0 0 16 16\"><path fill-rule=\"evenodd\" d=\"M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5\"/></svg>";
  replyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setReplyTarget(item);
  });
  userZone.appendChild(replyBtn);

  if (canDelete && item.id != null) {
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.setAttribute("data-id", item.id);
    deleteBtn.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-trash\" viewBox=\"0 0 16 16\"><path d=\"M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z\"/><path d=\"M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z\"/></svg>";
    userZone.appendChild(deleteBtn);
  }

  const messageDiv = document.createElement("div");
  messageDiv.className = "message";

  if (item.reply_to_id && item.reply_to_username && item.reply_to_text) {
    const replyPreview = document.createElement("div");
    replyPreview.className = "reply-preview";
    replyPreview.setAttribute("data-reply-to", item.reply_to_id);

    const replyHeader = document.createElement("div");
    replyHeader.className = "reply-header";
    replyHeader.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5"/></svg> <span>${item.reply_to_username}</span>`;

    const replyText = document.createElement("div");
    replyText.className = "reply-text";
    replyText.textContent = item.reply_to_text.length > 80 ? item.reply_to_text.substring(0, 80) + "..." : item.reply_to_text;

    replyPreview.appendChild(replyHeader);
    replyPreview.appendChild(replyText);

    replyPreview.addEventListener("click", (e) => {
      e.stopPropagation();
      scrollToMessage(String(item.reply_to_id));
    });

    messageDiv.appendChild(replyPreview);
  }

  const textDiv = document.createElement("div");
  const gifUrl = await getGifUrlForMessage(item.text || "");
  if (gifUrl) {
    const imgEl = document.createElement("img");
    imgEl.className = "chat-image";
    imgEl.loading = "lazy";
    imgEl.src = gifUrl;
    imgEl.alt = "GIF";
    imgEl.addEventListener("click", (e) => {
      e.stopPropagation();
      openImageModal(gifUrl);
    });
    textDiv.appendChild(imgEl);
  } else {
    renderTextWithMentions(textDiv, item.text || "");
  }
  messageDiv.appendChild(textDiv);

  line.appendChild(userZone);
  line.appendChild(messageDiv);
  return line;
}

async function buildImageLine(item) {
  if (!item) return null;
  const line = document.createElement("div");
  line.className = "chat-line";
  if (item.id != null) line.setAttribute("data-message-id", String(item.id));
  const canDelete = state.currentUser && item.username === state.currentUser.username;
  const avatarUrl = getAvatarUrl(item);
  const userColor = getProfileColor(item);
  updateUserMaps(item, userColor);

  const userZone = document.createElement("div");
  userZone.className = "userzone";

  const userWrap = document.createElement("div");
  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.src = avatarUrl;
  avatar.alt = item.username || "";
  avatar.width = 32;
  avatar.height = 32;

  const userSpan = document.createElement("span");
  userSpan.className = "user";
  userSpan.textContent = item.username || "";
  userSpan.style.color = userColor;

  userWrap.appendChild(avatar);
  userWrap.appendChild(userSpan);
  userWrap.classList.add("user-clickable");
  userWrap.addEventListener("click", () => openUserProfile(item));
  avatar.addEventListener("click", (event) => {
    event.stopPropagation();
    openUserProfile(item);
  });
  userSpan.addEventListener("click", (event) => {
    event.stopPropagation();
    openUserProfile(item);
  });

  const timeSpan = document.createElement("span");
  timeSpan.className = "time time-ago";
  if (item.createdAt) timeSpan.setAttribute("data-created-at", item.createdAt);
  timeSpan.textContent = item.createdAt ? formatTimeAgoShort(item.createdAt) : "";

  userZone.appendChild(userWrap);
  userZone.appendChild(timeSpan);

  const replyBtn = document.createElement("button");
  replyBtn.className = "reply-btn";
  replyBtn.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" viewBox=\"0 0 16 16\"><path fill-rule=\"evenodd\" d=\"M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5\"/></svg>";
  replyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setReplyTarget({ ...item, text: "[Image/File]" });
  });
  userZone.appendChild(replyBtn);

  if (canDelete && item.id != null) {
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.setAttribute("data-image-id", item.id);
    deleteBtn.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-trash\" viewBox=\"0 0 16 16\"><path d=\"M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z\"/><path d=\"M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z\"/></svg>";
    userZone.appendChild(deleteBtn);
  }

  const messageDiv = document.createElement("div");
  messageDiv.className = "message";
  const decrypted = await decryptBinary(item.ciphertext, item.iv, state.chatKey);
  if (!decrypted) {
    messageDiv.textContent = "[Unable to decrypt file]";
  } else {
    const blob = new Blob([decrypted], { type: item.mime || "application/octet-stream" });
    const objectUrl = URL.createObjectURL(blob);
    const mime = item.mime || "";

    if (mime.startsWith("image/")) {
      const imgEl = document.createElement("img");
      imgEl.className = "chat-image";
      imgEl.loading = "lazy";
      imgEl.src = objectUrl;
      imgEl.alt = "Image";
      imgEl.addEventListener("click", (e) => {
        e.stopPropagation();
        openImageModal(objectUrl);
      });
      messageDiv.appendChild(imgEl);
    } else if (mime.startsWith("video/")) {
      const videoEl = document.createElement("video");
      videoEl.className = "chat-video";
      videoEl.controls = true;
      videoEl.src = objectUrl;
      videoEl.addEventListener("loadedmetadata", () => URL.revokeObjectURL(objectUrl));
      messageDiv.appendChild(videoEl);
    } else if (mime.startsWith("audio/")) {
      const audioEl = document.createElement("audio");
      audioEl.className = "chat-audio";
      audioEl.controls = true;
      audioEl.src = objectUrl;
      audioEl.addEventListener("loadedmetadata", () => URL.revokeObjectURL(objectUrl));
      messageDiv.appendChild(audioEl);
    } else {
      const fileDiv = document.createElement("div");
      fileDiv.className = "chat-file";
      const downloadLink = document.createElement("a");
      downloadLink.href = objectUrl;
      downloadLink.download = "file";
      const label = mime ? `file (${mime})` : "file (unknown)";
      downloadLink.textContent = label;
      downloadLink.className = "file-link";
      fileDiv.appendChild(downloadLink);
      messageDiv.appendChild(fileDiv);
    }
  }

  line.appendChild(userZone);
  line.appendChild(messageDiv);
  return line;
}

function hasDuplicateItems(items) {
  const seen = new Set();
  for (const item of items) {
    if (!item || item.id == null) continue;
    if (item.kind !== "user" && item.kind !== "image") continue;
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function addServerMessage(text) {
  if (!text) return;
  const entry = { text, time: new Date().toISOString() };
  state.serverMessages.push(entry);
}

export async function appendUserMessageLine(item) {
  if (!dom.chatLog || !item) return null;
  const line = await buildUserMessageLine(item);
  if (!line) return null;
  dom.chatLog.appendChild(line);
  updateClientMessageTimes(dom.chatLog);
  state.lastRenderedCount += 1;
  state.lastSeenCount += 1;
  state.unreadCount = 0;
  updateNewMessageBanner();
  scrollToBottom();
  return line;
}

async function appendIncomingItem(item) {
  if (!dom.chatLog || !item) return;
  if (item.kind === "server") {
    dom.chatLog.appendChild(createServerMessageLine({ text: item.text, time: item.createdAt }));
    updateClientMessageTimes(dom.chatLog);
    scrollToBottom();
    return;
  }
  if (item.kind === "image") {
    const line = await buildImageLine(item);
    if (!line) return;
    dom.chatLog.appendChild(line);
    updateClientMessageTimes(dom.chatLog);
    scrollToBottom();
    return;
  }
  const line = await buildUserMessageLine(item);
  if (!line) return;
  dom.chatLog.appendChild(line);
  updateClientMessageTimes(dom.chatLog);
  scrollToBottom();
}

export async function refreshMessages(options = {}) {
  const { preserveScrollTop = false, scrollTop = 0, forceBottom = false } = options;
  if (!state.masterUnlocked || !state.chatKey || !dom.chatLog || !state.currentUser) return;
  const previousCount = state.lastSeenCount;
  const shouldHideDuringLoad = dom.chatLog.childElementCount === 0;
  if (shouldHideDuringLoad) dom.chatLog.style.visibility = "hidden";
  const previousScrollTop = dom.chatLog.scrollTop;
  const previousScrollHeight = dom.chatLog.scrollHeight;
  const wasAtBottom = previousScrollHeight - previousScrollTop - dom.chatLog.clientHeight < 48;
  const { res, data } = await fetchMessages(state.roomId);
  if (!res.ok) {
    if (shouldHideDuringLoad) dom.chatLog.style.visibility = "";
    return;
  }

  const fragment = document.createDocumentFragment();
  const combined = [];

  for (const msg of data.messages || []) {
    const text = await decryptMessage(msg.ciphertext, msg.iv, state.chatKey);
    combined.push({
      kind: "user",
      id: msg.id,
      username: msg.username,
      avatar_mime: msg.avatar_mime,
      avatar_data: msg.avatar_data,
      description: msg.description,
      banner_mime: msg.banner_mime,
      banner_data: msg.banner_data,
      profile_color: msg.profile_color,
      createdAt: msg.created_at,
      text,
      reply_to_id: msg.reply_to_id,
      reply_to_username: msg.reply_to_username,
      reply_to_text: msg.reply_to_text
    });
  }

  state.serverMessages.forEach((entry) => {
    combined.push({
      kind: "server",
      createdAt: entry.time,
      text: entry.text
    });
  });

  if (Array.isArray(data.images)) {
    data.images.forEach((img) => {
      combined.push({
        kind: "image",
        id: img.id,
        username: img.username,
        avatar_mime: img.avatar_mime,
        avatar_data: img.avatar_data,
        description: img.description,
        banner_mime: img.banner_mime,
        banner_data: img.banner_data,
        profile_color: img.profile_color,
        createdAt: img.created_at,
        iv: img.iv,
        ciphertext: img.ciphertext,
        mime: img.mime
      });
    });
  }

  const newCount = Math.max(0, combined.length - previousCount);

  combined.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (hasDuplicateItems(combined)) {
    if (!state.duplicateReloaded) {
      state.duplicateReloaded = true;
      location.reload();
    }
    return;
  }

  for (const item of combined) {
    if (item.kind === "server") {
      fragment.appendChild(createServerMessageLine({ text: item.text, time: item.createdAt }));
      continue;
    }
    if (item.kind === "image") {
      const line = await buildImageLine(item);
      if (line) fragment.appendChild(line);
      continue;
    }
    const line = await buildUserMessageLine(item);
    if (line) fragment.appendChild(line);
  }

  dom.chatLog.replaceChildren(fragment);
  state.lastRenderedCount = combined.length;
  state.lastSeenCount = combined.length;
  if (shouldHideDuringLoad) {
    requestAnimationFrame(() => {
      if (dom.chatLog) dom.chatLog.style.visibility = "";
    });
  }

  updateClientMessageTimes(dom.chatLog);

  if (preserveScrollTop) {
    dom.chatLog.scrollTop = scrollTop;
    return;
  }

  if (forceBottom || wasAtBottom) {
    state.unreadCount = 0;
    updateNewMessageBanner();
    scrollToBottom();
    return;
  }

  if (newCount > 0) {
    state.unreadCount += newCount;
    updateNewMessageBanner();
  }

  const newScrollTop = previousScrollTop + (dom.chatLog.scrollHeight - previousScrollHeight);
  dom.chatLog.scrollTop = Math.max(0, newScrollTop);
}

export function initSocket() {
  if (state.socket || !dom.chatLog) return;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${protocol}://${location.host}/ws`);
  state.socket.addEventListener("open", () => {
    if (state.roomId) {
      state.socket.send(JSON.stringify({ type: "subscribe", roomId: state.roomId }));
    }
    stopPolling();
  });
  state.socket.addEventListener("error", () => {
    startPolling();
  });
  state.socket.addEventListener("close", () => {
    startPolling();
  });
  state.socket.addEventListener("message", async (event) => {
    if (!state.masterUnlocked || !state.chatKey) return;
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "info") {
        addServerMessage(payload.message || "");
        const atBottom = isAtBottom();
        if (atBottom) {
          await appendIncomingItem({
            kind: "server",
            createdAt: new Date().toISOString(),
            text: payload.message || ""
          });
          state.lastRenderedCount += 1;
          state.lastSeenCount += 1;
        } else {
          state.unreadCount += 1;
          state.lastSeenCount += 1;
          updateNewMessageBanner();
        }
        return;
      }
      if (payload.type === "new_message") {
        if (!payload.message || payload.message.room_id !== state.roomId) return;
        if (state.currentUser && payload.message.username === state.currentUser.username) return;
        const atBottom = isAtBottom();
        if (atBottom) {
          const text = await decryptMessage(payload.message.ciphertext, payload.message.iv, state.chatKey);
          await appendIncomingItem({
            kind: "user",
            id: payload.message.id,
            username: payload.message.username,
            avatar_mime: payload.message.avatar_mime,
            avatar_data: payload.message.avatar_data,
            description: payload.message.description,
            banner_mime: payload.message.banner_mime,
            banner_data: payload.message.banner_data,
            profile_color: payload.message.profile_color,
            createdAt: payload.message.created_at,
            text,
            reply_to_id: payload.message.reply_to_id,
            reply_to_username: payload.message.reply_to_username,
            reply_to_text: payload.message.reply_to_text
          });
          state.lastRenderedCount += 1;
          state.lastSeenCount += 1;
        } else {
          state.unreadCount += 1;
          state.lastSeenCount += 1;
          updateNewMessageBanner();
        }
        return;
      }
      if (payload.type === "new_image") {
        if (!payload.image || payload.image.room_id !== state.roomId) return;
        const atBottom = isAtBottom();
        if (atBottom) {
          await appendIncomingItem({
            kind: "image",
            id: payload.image.id,
            username: payload.image.username,
            avatar_mime: payload.image.avatar_mime,
            avatar_data: payload.image.avatar_data,
            description: payload.image.description,
            banner_mime: payload.image.banner_mime,
            banner_data: payload.image.banner_data,
            profile_color: payload.image.profile_color,
            createdAt: payload.image.created_at,
            iv: payload.image.iv,
            ciphertext: payload.image.ciphertext,
            mime: payload.image.mime
          });
          state.lastRenderedCount += 1;
          state.lastSeenCount += 1;
        } else {
          state.unreadCount += 1;
          state.lastSeenCount += 1;
          updateNewMessageBanner();
        }
        return;
      }
      if (payload.type === "delete_image" || payload.type === "delete_message") {
        const previousScrollTop = dom.chatLog ? dom.chatLog.scrollTop : 0;
        await refreshMessages({ preserveScrollTop: true, scrollTop: previousScrollTop });
        return;
      }
    } catch (err) {
    }
  });
}

export function stopSocket() {
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
}

export function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(async () => {
    if (!state.masterUnlocked || !state.chatKey || !dom.chatLog || !state.currentUser) return;
    const atBottom = isAtBottom();
    const { res, data } = await fetchMessages(state.roomId);
    if (!res.ok) return;
    const combined = [];

    for (const msg of data.messages || []) {
      const text = await decryptMessage(msg.ciphertext, msg.iv, state.chatKey);
      combined.push({
        kind: "user",
        id: msg.id,
        username: msg.username,
        avatar_mime: msg.avatar_mime,
        avatar_data: msg.avatar_data,
        description: msg.description,
        banner_mime: msg.banner_mime,
        banner_data: msg.banner_data,
        profile_color: msg.profile_color,
        createdAt: msg.created_at,
        text
      });
    }

    state.serverMessages.forEach((entry) => {
      combined.push({
        kind: "server",
        createdAt: entry.time,
        text: entry.text
      });
    });

    if (Array.isArray(data.images)) {
      data.images.forEach((img) => {
        combined.push({
          kind: "image",
          id: img.id,
          username: img.username,
          avatar_mime: img.avatar_mime,
          avatar_data: img.avatar_data,
          description: img.description,
          banner_mime: img.banner_mime,
          banner_data: img.banner_data,
          profile_color: img.profile_color,
          createdAt: img.created_at,
          iv: img.iv,
          ciphertext: img.ciphertext,
          mime: img.mime
        });
      });
    }

    combined.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    if (combined.length < state.lastRenderedCount) {
      await refreshMessages({ forceBottom: atBottom });
      return;
    }

    if (combined.length <= state.lastSeenCount) return;

    const newItems = combined.slice(state.lastRenderedCount);
    if (!atBottom) {
      state.unreadCount += combined.length - state.lastSeenCount;
      state.lastSeenCount = combined.length;
      updateNewMessageBanner();
      return;
    }

    for (const item of newItems) {
      await appendIncomingItem(item);
    }
    state.lastRenderedCount = combined.length;
    state.lastSeenCount = combined.length;
  }, 3000);
}

export function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

export function resetIdleTimer() {
  state.lastActivity = Date.now();
}

export function startIdleWatcher() {
  if (state.idleTimer) clearInterval(state.idleTimer);
  state.idleTimer = setInterval(() => {
    if (!document.hasFocus()) return;
    const idleMs = Date.now() - state.lastActivity;
    if (idleMs >= 30000 && state.currentUser && state.masterUnlocked) {
      refreshMessages();
      state.lastActivity = Date.now();
    }
  }, 1000);
}

export function stopIdleWatcher() {
  if (state.idleTimer) clearInterval(state.idleTimer);
  state.idleTimer = null;
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (!state.currentUser) {
    setStatus(dom.chatStatus, "Login required to send messages", true);
    return;
  }
  if (!dom.chatInput) return;
  const message = dom.chatInput.value.trim();
  if (!message) return;

  const { replyToId, replyToUsername, replyToText } = getReplyPayload();

  setStatus(dom.chatStatus, "Sending...");
  const pendingLine = await appendUserMessageLine({
    kind: "user",
    id: null,
    username: state.currentUser.username,
    avatar_mime: state.currentUser.avatar_mime,
    avatar_data: state.currentUser.avatar_data,
    description: state.currentUser.description,
    banner_mime: state.currentUser.banner_mime,
    banner_data: state.currentUser.banner_data,
    profile_color: state.currentUser.profile_color,
    createdAt: new Date().toISOString(),
    text: message,
    reply_to_id: replyToId,
    reply_to_username: replyToUsername,
    reply_to_text: replyToText
  });

  const encrypted = await encryptMessage(message, state.chatKey);
  const requestData = { ...encrypted, roomId: state.roomId };
  if (replyToId) {
    requestData.reply_to_id = replyToId;
    requestData.reply_to_username = replyToUsername;
    requestData.reply_to_text = replyToText;
  }

  const { res, data } = await postMessage(requestData);
  if (!res.ok) {
    if (pendingLine && pendingLine.parentNode) {
      pendingLine.parentNode.removeChild(pendingLine);
    }
    const errorText = data.error || "Send failed";
    setStatus(dom.chatStatus, errorText, true);
    return;
  }

  dom.chatInput.value = "";
  clearReplyTarget();
  setStatus(dom.chatStatus, "Sent");

  const serverMessage = data.message || {};
  const createdAt = serverMessage.created_at || new Date().toISOString();
  if (pendingLine) {
    if (serverMessage.id != null) {
      pendingLine.setAttribute("data-message-id", String(serverMessage.id));
      const userZone = pendingLine.querySelector(".userzone");
      if (userZone) {
        let deleteBtn = userZone.querySelector(".delete-btn");
        if (!deleteBtn) {
          deleteBtn = document.createElement("button");
          deleteBtn.className = "delete-btn";
          deleteBtn.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-trash\" viewBox=\"0 0 16 16\"><path d=\"M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z\"/><path d=\"M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z\"/></svg>";
          userZone.appendChild(deleteBtn);
        }
        deleteBtn.setAttribute("data-id", String(serverMessage.id));
      }
    }
    const timeEl = pendingLine.querySelector(".time.time-ago");
    if (timeEl) {
      timeEl.setAttribute("data-created-at", createdAt);
      timeEl.textContent = formatTimeAgoShort(createdAt);
    }
  }
}

async function handleImageUpload() {
  if (!dom.imageInput) return;
  const file = dom.imageInput.files && dom.imageInput.files[0];
  dom.imageInput.value = "";
  if (!file) return;
  if (!state.currentUser) {
    setStatus(dom.chatStatus, "Login required to send files", true);
    return;
  }
  if (!state.chatKey) {
    setStatus(dom.chatStatus, "Unlock chat to send files", true);
    return;
  }
  try {
    setStatus(dom.chatStatus, "Preparing file...");
    let buffer;
    let mime;
    if (file.type && file.type.startsWith("image/") && file.type !== "image/gif" && file.type !== "image/svg+xml") {
      const result = await stripImageMetadata(file);
      buffer = result.buffer;
      mime = result.mime;
    } else {
      buffer = await file.arrayBuffer();
      mime = file.type || "application/octet-stream";
    }
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      setStatus(dom.chatStatus, "File too large (max 15MB)", true);
      return;
    }
    setStatus(dom.chatStatus, "Encrypting file...");
    const encrypted = await encryptBinary(buffer, state.chatKey);
    setStatus(dom.chatStatus, "Uploading file...");
    const { res, data } = await postImage({ ...encrypted, roomId: state.roomId, mime });
    if (!res.ok) {
      const errorText = data.error || "File upload failed";
      setStatus(dom.chatStatus, errorText, true);
      return;
    }
    setStatus(dom.chatStatus, "File sent");
    await refreshMessages();
  } catch (err) {
    setStatus(dom.chatStatus, "File upload failed", true);
  }
}

async function handleChatLogClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.classList.contains("delete-btn") && target.hasAttribute("data-image-id")) {
    const id = target.getAttribute("data-image-id");
    if (!id) return;
    const previousScrollTop = dom.chatLog ? dom.chatLog.scrollTop : 0;
    const res = await deleteImage(id, state.roomId);
    if (!res.ok) {
      let errorText = "Delete failed";
      try {
        const data = await res.json();
        errorText = data.error || errorText;
      } catch (err) {
      }
      setStatus(dom.chatStatus, errorText, true);
      return;
    }
    await refreshMessages({ preserveScrollTop: true, scrollTop: previousScrollTop });
    return;
  }
  if (!target.classList.contains("delete-btn")) return;
  const id = target.getAttribute("data-id");
  if (!id) return;
  const previousScrollTop = dom.chatLog ? dom.chatLog.scrollTop : 0;
  const res = await deleteMessage(id, state.roomId);
  if (!res.ok) {
    let errorText = "Delete failed";
    try {
      const data = await res.json();
      errorText = data.error || errorText;
    } catch (err) {
    }
    setStatus(dom.chatStatus, errorText, true);
    return;
  }
  await refreshMessages({ preserveScrollTop: true, scrollTop: previousScrollTop });
}

export function bindChatHandlers() {
  if (dom.chatForm) {
    dom.chatForm.addEventListener("submit", handleChatSubmit);
  }

  if (dom.imageInput) {
    dom.imageInput.addEventListener("change", handleImageUpload);
  }

  if (dom.chatLog) {
    dom.chatLog.addEventListener("click", handleChatLogClick);
    dom.chatLog.addEventListener("scroll", () => {
      if (isAtBottom()) {
        state.unreadCount = 0;
        updateNewMessageBanner();
      }
    });
  }

  if (dom.newMessageBanner) {
    dom.newMessageBanner.addEventListener("click", () => {
      state.unreadCount = 0;
      updateNewMessageBanner();
      refreshMessages({ forceBottom: true });
    });
  }

  if (dom.page === "app") {
    ["mousemove", "keydown", "scroll", "click", "touchstart"].forEach((evt) => {
      window.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    window.addEventListener("blur", () => {
      stopSocket();
      stopTimeAgoUpdater(state);
    });
    window.addEventListener("focus", async () => {
      resetIdleTimer();
      if (state.currentUser && state.masterUnlocked) {
        initSocket();
        await refreshMessages({ forceBottom: true });
        startTimeAgoUpdater(state, dom.chatLog);
        if (!state.socket) startPolling();
      }
    });
    startIdleWatcher();
    startTimeAgoUpdater(state, dom.chatLog);
  }

  if (dom.imageModalClose && dom.imageModal) {
    dom.imageModalClose.addEventListener("click", closeImageModal);
    dom.imageModal.addEventListener("click", (e) => {
      if (e.target === dom.imageModal) closeImageModal();
    });
  }
}

export function setAuthSectionVisibility(visible) {
  setVisible(dom.authSection, visible);
}

export function setChatSectionVisibility(visible) {
  setVisible(dom.chatSection, visible);
}
