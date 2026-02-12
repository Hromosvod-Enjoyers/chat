const authSection = document.getElementById("auth-section");
    const chatSection = document.getElementById("chat-section");
    const authStatus = document.getElementById("auth-status");
    const chatStatus = document.getElementById("chat-status");
    const currentUserEl = document.getElementById("current-user");
    const currentUserImg = document.getElementById("current-user-img");
    const logoutBtn = document.getElementById("logout-btn");
    const releaseBtn = document.getElementById("release-btn");
    const chatLog = document.getElementById("chat-log");
    const page = document.body?.dataset?.page || "";
    const AUTH_BASE = "/api/auth";
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    let chatKey = null;
    let currentUser = null;
    let masterUnlocked = false;
    let chatSettings = null;
    let socket = null;
    let roomId = "";
    let idleTimer = null;
    let lastActivity = Date.now();
    let serverMessages = [];
    let timeAgoTimer = null;
    let duplicateReloaded = false;
    let userModal = null;
    let userModalClose = null;
    let userBanner = null;
    let userProfileAvatar = null;
    let userProfileName = null;
    let userProfileDescription = null;
    let newMessageBanner = null;
    let unreadCount = 0;
    let pollTimer = null;
    let lastRenderedCount = 0;
    let lastSeenCount = 0;
    const userColorMap = new Map(); // Map of username -> profile_color
    const userDataMap = new Map(); // Map of username -> {color, avatar_mime, avatar_data}

    const textEncoder = new TextEncoder();
    const textDecoder = new TextDecoder();
    const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    const MAX_AVATAR_BYTES = 200 * 1024;
    const AVATAR_SIZE = 128;
    const PROFILE_COLORS = [
    "#ff7a59",
    "#ffc857",
    "#45d6ff",
    "#a8ff9f",
    "#b994ff",
    "#ff8fb1",
    "#7cf3ff",
    "#f2f2f2"
    ];

    function setStatus(el, text, isError = false) {
    if (!el) return;
    el.textContent = text;
    el.className = `status ${isError ? "error" : ""}`;
    }

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

    function normalizeTimestampToDate(timestamp) {
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

    function formatTimeAgoShort(timestamp) {
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

    function updateClientMessageTimes() {
    if (!chatLog) return;
    const timeEls = chatLog.querySelectorAll(".time.time-ago[data-created-at]");
    timeEls.forEach((el) => {
        const createdAt = el.getAttribute("data-created-at");
        if (!createdAt) return;
        el.textContent = formatTimeAgoShort(createdAt);
    });
    }

    function startTimeAgoUpdater() {
    if (timeAgoTimer) return;
    updateClientMessageTimes();
    timeAgoTimer = setInterval(updateClientMessageTimes, 1000);
    }

    function stopTimeAgoUpdater() {
    if (timeAgoTimer) clearInterval(timeAgoTimer);
    timeAgoTimer = null;
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
    serverMessages.push(entry);
    }

    function setVisible(el, visible) {
    if (!el) return;
    el.classList.toggle("hidden", !visible);
    }

    function isAtBottom() {
    if (!chatLog) return true;
    return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 48;
    }

    function scrollToBottom() {
    if (!chatLog) return;
    chatLog.scrollTop = chatLog.scrollHeight;
    requestAnimationFrame(() => {
        if (!chatLog) return;
        chatLog.scrollTop = chatLog.scrollHeight;
        requestAnimationFrame(() => {
        if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
        });
    });
    }

    function updateNewMessageBanner() {
    if (!newMessageBanner) return;
    if (unreadCount > 0) {
        const label = unreadCount === 1 ? "1 new message" : `${unreadCount} new messages`;
        newMessageBanner.textContent = label;
        newMessageBanner.classList.remove("hidden");
        return;
    }
    newMessageBanner.classList.add("hidden");
    }

    function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
        if (!masterUnlocked || !chatKey || !chatLog || !currentUser) return;
        const atBottom = isAtBottom();
        const res = await fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const combined = [];

        for (const msg of data.messages || []) {
        const text = await decryptMessage(msg.ciphertext, msg.iv);
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

        serverMessages.forEach((entry) => {
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

        if (combined.length < lastRenderedCount) {
        await refreshMessages({ forceBottom: atBottom });
        return;
        }

        if (combined.length <= lastSeenCount) return;

        const newItems = combined.slice(lastRenderedCount);
        if (!atBottom) {
        unreadCount += combined.length - lastSeenCount;
        lastSeenCount = combined.length;
        updateNewMessageBanner();
        return;
        }

        for (const item of newItems) {
        await appendIncomingItem(item);
        }
        lastRenderedCount = combined.length;
        lastSeenCount = combined.length;
    }, 3000);
    }

    function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    }

    function getAvatarUrl(user) {
    if (user && user.avatar_mime && user.avatar_data) {
        return `data:${user.avatar_mime};base64,${user.avatar_data}`;
    }
    const seed = user && user.username ? user.username : "default";
    return `https://api.dicebear.com/9.x/rings/svg?size=32&seed=${encodeURIComponent(seed)}`;
    }

    function getProfileColor(user) {
    const color = user && user.profile_color ? user.profile_color : "";
    return PROFILE_COLORS.includes(color) ? color : PROFILE_COLORS[2];
    }

    function describeFileType(file) {
    const name = file && file.name ? file.name : "unknown";
    const mime = file && file.type ? file.type : "unknown";
    return `${name} (${mime})`;
    }

    function openUserProfile(user) {
    if (!user || !userModal) return;
    userModal.classList.add("show");
    if (userProfileAvatar) userProfileAvatar.src = getAvatarUrl(user);
    if (userProfileName) {
        userProfileName.textContent = user.username || "";
        userProfileName.style.color = getProfileColor(user);
    }
    if (userProfileDescription) {
        userProfileDescription.textContent = user.description || "No description";
    }
    if (userBanner) {
        if (user.banner_mime && user.banner_data) {
        userBanner.style.backgroundImage = `url(data:${user.banner_mime};base64,${user.banner_data})`;
        userBanner.textContent = "";
        } else {
        userBanner.style.backgroundImage = "";
        userBanner.textContent = "No banner";
        }
    }
    }

    async function buildUserMessageLine(item) {
    if (!item) return null;
    const line = document.createElement("div");
    line.className = "chat-line";
    if (item.id != null) line.setAttribute("data-message-id", String(item.id));

    const canDelete = currentUser && item.username === currentUser.username;
    const avatarUrl = getAvatarUrl(item);
    const userColor = getProfileColor(item);
    
    // Store user color and data for mention coloring and autocomplete
    if (item.username && userColor) {
        userColorMap.set(item.username, userColor);
        userDataMap.set(item.username, {
            color: userColor,
            avatar_mime: item.avatar_mime,
            avatar_data: item.avatar_data
        });
    }

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
    const nameColor = (item.username === currentUser?.username) ? 'var(--accent-1)' : userColor;
    userSpan.style.color = nameColor;

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
        createReply(item);
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
    
    // Handle reply-to if present
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
        textDiv.appendChild(imgEl);
    } else {
        renderTextWithMentions(textDiv, item.text || "");
    }
    messageDiv.appendChild(textDiv);

    line.appendChild(userZone);
    line.appendChild(messageDiv);
    return line;
    }

    function scrollToMessage(messageId) {
        if (!chatLog || !messageId) return;
        const targetLine = chatLog.querySelector(`[data-message-id="${messageId}"]`);
        if (!targetLine) return;
        targetLine.scrollIntoView({ behavior: "smooth", block: "center" });
        targetLine.style.transition = "background-color 0.3s ease";
        targetLine.style.backgroundColor = "rgba(255, 122, 89, 0.15)";
        setTimeout(() => {
            targetLine.style.backgroundColor = "";
        }, 2000);
    }

    function createReply(item) {
        if (!item || !item.id) return;
        const chatInput = document.getElementById("chat-input");
        if (!chatInput) return;
        
        // Store reply data for sending
        chatInput.setAttribute("data-reply-to-id", item.id);
        chatInput.setAttribute("data-reply-to-username", item.username || "");
        chatInput.setAttribute("data-reply-to-text", (item.text || "").substring(0, 100));
        
        // Show reply indicator
        let replyIndicator = document.getElementById("reply-indicator");
        if (!replyIndicator) {
            replyIndicator = document.createElement("div");
            replyIndicator.id = "reply-indicator";
            replyIndicator.className = "reply-indicator";
            const chatForm = document.getElementById("chat-form");
            chatForm.parentElement.insertBefore(replyIndicator, chatForm);
        }
        
        const replyText = (item.text || "").length > 50 ? (item.text || "").substring(0, 50) + "..." : (item.text || "");
        replyIndicator.innerHTML = `
            <div class="reply-indicator-content">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5"/></svg>
                <div>
                    <div class="reply-to-user">Replying to ${item.username || "user"}</div>
                    <div class="reply-to-text">${replyText}</div>
                </div>
            </div>
            <button class="reply-cancel" onclick="cancelReply()">×</button>
        `;
        replyIndicator.style.display = "flex";
        
        chatInput.focus();
    }

    window.cancelReply = function() {
        const chatInput = document.getElementById("chat-input");
        const replyIndicator = document.getElementById("reply-indicator");
        
        if (chatInput) {
            chatInput.removeAttribute("data-reply-to-id");
            chatInput.removeAttribute("data-reply-to-username");
            chatInput.removeAttribute("data-reply-to-text");
        }
        
        if (replyIndicator) {
            replyIndicator.style.display = "none";
        }
    };

    async function appendUserMessageLine(item) {
    if (!chatLog || !item) return null;
    const line = await buildUserMessageLine(item);
    if (!line) return null;
    chatLog.appendChild(line);
    updateClientMessageTimes();
    lastRenderedCount += 1;
    lastSeenCount += 1;
    unreadCount = 0;
    updateNewMessageBanner();
    scrollToBottom();
    return line;
    }

    async function buildImageLine(item) {
    if (!item) return null;
    const line = document.createElement("div");
    line.className = "chat-line";
    if (item.id != null) line.setAttribute("data-message-id", String(item.id));
    const canDelete = currentUser && item.username === currentUser.username;
    const avatarUrl = getAvatarUrl(item);
    const userColor = getProfileColor(item);
    
    // Store user color and data for mention coloring and autocomplete
    if (item.username && userColor) {
        userColorMap.set(item.username, userColor);
        userDataMap.set(item.username, {
            color: userColor,
            avatar_mime: item.avatar_mime,
            avatar_data: item.avatar_data
        });
    }

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
    const nameColor = (item.username === currentUser?.username) ? 'var(--accent-1)' : userColor;
    userSpan.style.color = nameColor;

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
        createReply({ ...item, text: "[Image/File]" });
    });
    userZone.appendChild(replyBtn);

    if (canDelete && item.id != null) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.setAttribute("data-image-id", item.id);
        deleteBtn.textContent = "Delete";
        userZone.appendChild(deleteBtn);
    }

    const messageDiv = document.createElement("div");
    messageDiv.className = "message";
    const decrypted = await decryptBinary(item.ciphertext, item.iv);
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
        imgEl.addEventListener("load", () => URL.revokeObjectURL(objectUrl));
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
        const fileIcon = document.createElement("span");
        fileIcon.textContent = "📎 ";
        const downloadLink = document.createElement("a");
        downloadLink.href = objectUrl;
        downloadLink.download = "file";
        const label = mime ? `file (${mime})` : "file (unknown)";
        downloadLink.textContent = label;
        downloadLink.className = "file-link";
        fileDiv.appendChild(fileIcon);
        fileDiv.appendChild(downloadLink);
        messageDiv.appendChild(fileDiv);
        }
    }

    line.appendChild(userZone);
    line.appendChild(messageDiv);
    return line;
    }

    async function appendIncomingItem(item) {
    if (!chatLog || !item) return;
    if (item.kind === "server") {
        chatLog.appendChild(createServerMessageLine({ text: item.text, time: item.createdAt }));
        updateClientMessageTimes();
        scrollToBottom();
        return;
    }
    if (item.kind === "image") {
        const line = await buildImageLine(item);
        if (!line) return;
        chatLog.appendChild(line);
        updateClientMessageTimes();
        scrollToBottom();
        return;
    }
    const line = await buildUserMessageLine(item);
    if (!line) return;
    chatLog.appendChild(line);
    updateClientMessageTimes();
    scrollToBottom();
    }

    async function appendIncomingMessageFromPayload(message) {
    if (!chatLog || !message) return;
    const text = await decryptMessage(message.ciphertext, message.iv);
    const line = await buildUserMessageLine({
        kind: "user",
        id: message.id,
        username: message.username,
        avatar_mime: message.avatar_mime,
        avatar_data: message.avatar_data,
        description: message.description,
        banner_mime: message.banner_mime,
        banner_data: message.banner_data,
        profile_color: message.profile_color,
        createdAt: message.created_at,
        text
    });
    if (!line) return;
    chatLog.appendChild(line);
    updateClientMessageTimes();
    lastRenderedCount += 1;
    scrollToBottom();
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
        const isSelf = currentUser && match[1] === currentUser.username;
        if (isSelf) {
            span.classList.add("mention-self");
        } else {
            // Color the mention based on the user's profile color
            const userColor = userColorMap.get(match[1]);
            if (userColor) {
                span.classList.add("mention-other");
                span.style.borderColor = userColor;
                span.style.backgroundColor = userColor + "22"; // 22 = 13% opacity
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

    function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
    }

    function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary);
    }

    function concatUint8(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
    }

    function getLocalKey() {
    return localStorage.getItem("s1") || "";
    }

    function sanitizeServerSelection(value) {
        return (value || "").replace(/[^a-zA-Z0-9-]/g, "");
    }


    async function deriveKey(passphrase, saltBase64, iterations) {
    const passphraseKey = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(passphrase),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    const salt = base64ToArrayBuffer(saltBase64);
    return crypto.subtle.deriveKey(
        {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256"
        },
        passphraseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
    }

    async function deriveRoomId(passphrase, saltBase64, iterations) {
    const passphraseKey = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(passphrase),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
    );
    const salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
    const saltWithLabel = concatUint8(salt, textEncoder.encode("room"));
    const bits = await crypto.subtle.deriveBits(
        {
        name: "PBKDF2",
        salt: saltWithLabel,
        iterations,
        hash: "SHA-256"
        },
        passphraseKey,
        256
    );
    return arrayBufferToBase64(bits);
    }

    async function encryptMessage(message) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = textEncoder.encode(message);
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        chatKey,
        data
    );
    return {
        iv: arrayBufferToBase64(iv.buffer),
        ciphertext: arrayBufferToBase64(encrypted)
    };
    }

    async function encryptBinary(buffer) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        chatKey,
        buffer
    );
    return {
        iv: arrayBufferToBase64(iv.buffer),
        ciphertext: arrayBufferToBase64(encrypted)
    };
    }

    async function stripImageMetadata(file) {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    const outputMime = allowedMimes.includes(file.type) ? file.type : "image/png";
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(bitmap, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputMime, 0.92));
        if (!blob) throw new Error("Image conversion failed");
        return { buffer: await blob.arrayBuffer(), mime: outputMime };
    } finally {
        if (typeof bitmap.close === "function") bitmap.close();
    }
    }

    async function prepareAvatarImage(file) {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    const outputMime = allowedMimes.includes(file.type) ? file.type : "image/png";
    const bitmap = await createImageBitmap(file);
    try {
        const size = Math.min(bitmap.width, bitmap.height);
        const sx = Math.floor((bitmap.width - size) / 2);
        const sy = Math.floor((bitmap.height - size) / 2);
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputMime, 0.92));
        if (!blob) throw new Error("Image conversion failed");
        return { buffer: await blob.arrayBuffer(), mime: outputMime };
    } finally {
        if (typeof bitmap.close === "function") bitmap.close();
    }
    }

    async function uploadAvatar(file) {
    if (!currentUser) {
        setStatus(chatStatus, "Login required to set avatar", true);
        return;
    }
    if (!file.type || !file.type.startsWith("image/")) {
        setStatus(chatStatus, `Unsupported file type: ${describeFileType(file)}`, true);
        return;
    }
    try {
        setStatus(chatStatus, "Preparing avatar...");
        const { buffer, mime } = await prepareAvatarImage(file);
        if (buffer.byteLength > MAX_AVATAR_BYTES) {
        setStatus(chatStatus, "Avatar too large (max 200KB)", true);
        return;
        }
        setStatus(chatStatus, "Uploading avatar...");
        const data = arrayBufferToBase64(buffer);
        const res = await fetch(`${AUTH_BASE}/avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime, data })
        });
        if (!res.ok) {
        let errorText = "Avatar upload failed";
        try {
            const payload = await res.json();
            errorText = payload.error || errorText;
        } catch (err) {
        }
        setStatus(chatStatus, errorText, true);
        return;
        }
        currentUser.avatar_mime = mime;
        currentUser.avatar_data = data;
        if (currentUserImg) currentUserImg.src = getAvatarUrl(currentUser);
        await refreshMessages();
        setStatus(chatStatus, "Avatar updated");
    } catch (err) {
        setStatus(chatStatus, "Avatar upload failed", true);
    }
    }

    async function decryptMessage(ciphertext, iv) {
    try {
        if (!iv) return "[Unsupported message]";
        const buffer = base64ToArrayBuffer(ciphertext);
        const ivBuffer = base64ToArrayBuffer(iv);
        const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
        chatKey,
        buffer
        );
        return textDecoder.decode(decrypted);
    } catch (err) {
        return "[Unable to decrypt]";
    }
    }

    async function decryptBinary(ciphertext, iv) {
    try {
        if (!iv) return null;
        const buffer = base64ToArrayBuffer(ciphertext);
        const ivBuffer = base64ToArrayBuffer(iv);
        const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
        chatKey,
        buffer
        );
        return decrypted;
    } catch (err) {
        return null;
    }
    }

    async function loadChatSettings() {
    const res = await fetch("/api/chat-settings");
    if (!res.ok) throw new Error("Unable to load chat settings");
    return res.json();
    }

    async function refreshMessages(options = {}) {
    const { preserveScrollTop = false, scrollTop = 0, forceBottom = false } = options;
    if (!masterUnlocked || !chatKey || !chatLog || !currentUser) return;
    const previousCount = lastSeenCount;
    const shouldHideDuringLoad = chatLog.childElementCount === 0;
    if (shouldHideDuringLoad) chatLog.style.visibility = "hidden";
    const previousScrollTop = chatLog.scrollTop;
    const previousScrollHeight = chatLog.scrollHeight;
    const wasAtBottom = previousScrollHeight - previousScrollTop - chatLog.clientHeight < 48;
    const res = await fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}`);
    if (!res.ok) {
        if (shouldHideDuringLoad) chatLog.style.visibility = "";
        return;
    }
    const data = await res.json();
    const fragment = document.createDocumentFragment();
    const combined = [];

    for (const msg of data.messages) {
        const text = await decryptMessage(msg.ciphertext, msg.iv);
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

    serverMessages.forEach((entry) => {
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
        if (!duplicateReloaded) {
        duplicateReloaded = true;
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
        const line = document.createElement("div");
        line.className = "chat-line";
        if (item.id != null) line.setAttribute("data-message-id", String(item.id));
        const canDelete = currentUser && item.username === currentUser.username;
        const avatarUrl = getAvatarUrl(item);
        const userColor = getProfileColor(item);
        
        // Store user data for mention coloring and autocomplete
        if (item.username && userColor) {
            userColorMap.set(item.username, userColor);
            userDataMap.set(item.username, {
                color: userColor,
                avatar_mime: item.avatar_mime,
                avatar_data: item.avatar_data
            });
        }

        const userZone = document.createElement("div");
        userZone.className = "userzone";

        const userWrap = document.createElement("div");
        const avatar = document.createElement("img");
        avatar.className = "avatar";
        avatar.src = avatarUrl;
        avatar.alt = item.username;
        avatar.width = 32;
        avatar.height = 32;

        const userSpan = document.createElement("span");
        userSpan.className = "user";
        userSpan.textContent = item.username;
        const nameColor = (item.username === currentUser?.username) ? 'var(--accent-1)' : getProfileColor(item);
        userSpan.style.color = nameColor;

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
        timeSpan.setAttribute("data-created-at", item.createdAt);
        timeSpan.textContent = formatTimeAgoShort(item.createdAt);

        userZone.appendChild(userWrap);
        userZone.appendChild(timeSpan);

        const replyBtn = document.createElement("button");
        replyBtn.className = "reply-btn";
        replyBtn.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" viewBox=\"0 0 16 16\"><path fill-rule=\"evenodd\" d=\"M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5\"/></svg>";
        replyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            createReply({ ...item, text: "[Image/File]" });
        });
        userZone.appendChild(replyBtn);

        if (canDelete) {
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "delete-btn";
            deleteBtn.setAttribute("data-image-id", item.id);
            deleteBtn.textContent = "Delete";
            userZone.appendChild(deleteBtn);
        }

        const messageDiv = document.createElement("div");
        messageDiv.className = "message";
        const decrypted = await decryptBinary(item.ciphertext, item.iv);
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
                imgEl.addEventListener("load", () => URL.revokeObjectURL(objectUrl));
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
                const fileIcon = document.createElement("span");
                fileIcon.textContent = "📎 ";
                const downloadLink = document.createElement("a");
                downloadLink.href = objectUrl;
                downloadLink.download = "file";
                const label = mime ? `file (${mime})` : "file (unknown)";
                downloadLink.textContent = label;
                downloadLink.className = "file-link";
                fileDiv.appendChild(fileIcon);
                fileDiv.appendChild(downloadLink);
                messageDiv.appendChild(fileDiv);
            }
        }

        line.appendChild(userZone);
        line.appendChild(messageDiv);
        fragment.appendChild(line);
        continue;
        }

        const line = document.createElement("div");
        line.className = "chat-line";
        if (item.id != null) line.setAttribute("data-message-id", String(item.id));
        const canDelete = currentUser && item.username === currentUser.username;
        const avatarUrl = getAvatarUrl(item);

        const userZone = document.createElement("div");
        userZone.className = "userzone";

        const userWrap = document.createElement("div");
        const avatar = document.createElement("img");
        avatar.className = "avatar";
        avatar.src = avatarUrl;
        avatar.alt = item.username;
        avatar.width = 32;
        avatar.height = 32;

        const userSpan = document.createElement("span");
        userSpan.className = "user";
        userSpan.textContent = item.username;
        const nameColor = (item.username === currentUser?.username) ? 'var(--accent-1)' : getProfileColor(item);
        userSpan.style.color = nameColor;

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
        timeSpan.setAttribute("data-created-at", item.createdAt);
        timeSpan.textContent = formatTimeAgoShort(item.createdAt);

        userZone.appendChild(userWrap);
        userZone.appendChild(timeSpan);

        const replyBtn = document.createElement("button");
        replyBtn.className = "reply-btn";
        replyBtn.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" viewBox=\"0 0 16 16\"><path fill-rule=\"evenodd\" d=\"M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5\"/></svg>";
        replyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            createReply(item);
        });
        userZone.appendChild(replyBtn);

        if (canDelete) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.setAttribute("data-id", item.id);
        deleteBtn.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-trash\" viewBox=\"0 0 16 16\"><path d=\"M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z\"/><path d=\"M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z\"/></svg>";
        userZone.appendChild(deleteBtn);
        }

        const messageDiv = document.createElement("div");
        messageDiv.className = "message";
        
        // Handle reply-to if present
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
        const gifUrl = await getGifUrlForMessage(item.text);
        if (gifUrl) {
        const imgEl = document.createElement("img");
        imgEl.className = "chat-image";
        imgEl.loading = "lazy";
        imgEl.src = gifUrl;
        imgEl.alt = "GIF";
        textDiv.appendChild(imgEl);
        } else {
        renderTextWithMentions(textDiv, item.text);
        }
        messageDiv.appendChild(textDiv);

        line.appendChild(userZone);
        line.appendChild(messageDiv);
        fragment.appendChild(line);
    }

    chatLog.replaceChildren(fragment);
    lastRenderedCount = combined.length;
    lastSeenCount = combined.length;
    if (shouldHideDuringLoad) {
        requestAnimationFrame(() => {
        if (chatLog) chatLog.style.visibility = "";
        });
    }

    updateClientMessageTimes();

    if (preserveScrollTop) {
        chatLog.scrollTop = scrollTop;
        return;
    }

    if (forceBottom || wasAtBottom) {
        unreadCount = 0;
        updateNewMessageBanner();
        scrollToBottom();
        return;
    }

    if (newCount > 0) {
        unreadCount += newCount;
        updateNewMessageBanner();
    }

    const newScrollTop = previousScrollTop + (chatLog.scrollHeight - previousScrollHeight);
    chatLog.scrollTop = Math.max(0, newScrollTop);
    }

    function initSocket() {
    if (socket || !chatLog) return;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${protocol}://${location.host}/ws`);
    socket.addEventListener("open", () => {
        if (roomId) {
        socket.send(JSON.stringify({ type: "subscribe", roomId }));
        }
        stopPolling();
    });
    socket.addEventListener("error", () => {
        startPolling();
    });
    socket.addEventListener("close", () => {
        startPolling();
    });
    socket.addEventListener("message", async (event) => {
        if (!masterUnlocked || !chatKey) return;
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
            lastRenderedCount += 1;
            lastSeenCount += 1;
            } else {
            unreadCount += 1;
            lastSeenCount += 1;
            updateNewMessageBanner();
            }
            return;
        }
        if (payload.type === "new_message") {
            if (!payload.message || payload.message.room_id !== roomId) return;
            if (currentUser && payload.message.username === currentUser.username) return;
            const atBottom = isAtBottom();
            if (atBottom) {
            const text = await decryptMessage(payload.message.ciphertext, payload.message.iv);
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
            lastRenderedCount += 1;
            lastSeenCount += 1;
            } else {
            unreadCount += 1;
            lastSeenCount += 1;
            updateNewMessageBanner();
            }
            return;
        }
        if (payload.type === "new_image") {
            if (!payload.image || payload.image.room_id !== roomId) return;
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
            lastRenderedCount += 1;
            lastSeenCount += 1;
            } else {
            unreadCount += 1;
            lastSeenCount += 1;
            updateNewMessageBanner();
            }
            return;
        }
        if (payload.type === "delete_image" || payload.type === "delete_message") {
            const previousScrollTop = chatLog ? chatLog.scrollTop : 0;
            await refreshMessages({ preserveScrollTop: true, scrollTop: previousScrollTop });
            return;
        }
        } catch (err) {
        // ignore
        }
    });
    }

    function stopSocket() {
    if (socket) {
        socket.close();
        socket = null;
    }
    }

    function resetIdleTimer() {
    lastActivity = Date.now();
    }

    function startIdleWatcher() {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(() => {
        if (!document.hasFocus()) return;
        const idleMs = Date.now() - lastActivity;
        if (idleMs >= 30000 && currentUser && masterUnlocked) {
        refreshMessages();
        lastActivity = Date.now();
        }
    }, 1000);
    }

    function stopIdleWatcher() {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    }

    async function bootstrap() {
    const res = await fetch(`${AUTH_BASE}/me`);
    const data = await res.json();
    currentUser = data.user;
    masterUnlocked = Boolean(chatKey);

    setVisible(authSection, page === "login" || page === "app");
    setVisible(chatSection, page === "app" && Boolean(currentUser));

    if (currentUser && currentUserEl) {
        if (currentUserImg) currentUserImg.src = getAvatarUrl(currentUser);
        currentUserEl.textContent = `${currentUser.username}`;
        currentUserEl.style.color = getProfileColor(currentUser);
        setVisible(logoutBtn, true);
        setVisible(releaseBtn, true);
    }

    const savedPass = getLocalKey();
    if (savedPass) {
        try {
        chatSettings = await loadChatSettings();
        chatKey = await deriveKey(savedPass, chatSettings.salt, chatSettings.iterations);
        roomId = await deriveRoomId(savedPass, chatSettings.salt, chatSettings.iterations);
        masterUnlocked = true;
        if (page === "login" && currentUser) {
            location.replace("/app.html");
            return;
        }
        if (page === "app") {
            if (currentUser) {
            await refreshMessages({ forceBottom: true });
            initSocket();
            startIdleWatcher();
            } else {
            setVisible(chatSection, false);
            }
        }
        } catch (err) {
        // ignore
        }
    }

    if ((!savedPass || !currentUser) && page === "app") {
        location.replace("/login.html");
    }
    }

    DocumentReady();

    function DocumentReady() {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setupHandlers);
    } else {
        setupHandlers();
    }
    }

    function setupHandlers() {
    const masterForm = document.getElementById("master-form");
    if (masterForm) {
        masterForm.remove();
    }

    const authForm = document.getElementById("auth-form");
    const serverSelection = document.getElementById("server-selection");
    if (serverSelection) {
        const saved = getLocalKey();
        if (saved) serverSelection.value = saved;
        serverSelection.addEventListener("input", () => {
            const cleaned = sanitizeServerSelection(serverSelection.value);
            if (serverSelection.value !== cleaned) {
                serverSelection.value = cleaned;
            }
            localStorage.setItem("s1", cleaned);
        });
        serverSelection.addEventListener("blur", () => {
            const cleaned = sanitizeServerSelection(serverSelection.value);
            serverSelection.value = cleaned;
            localStorage.setItem("s1", cleaned);
        });
    }
    if (authForm) authForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setStatus(authStatus, "Checking account...");
        const username = document.getElementById("auth-username").value;
        const password = document.getElementById("auth-password").value;
        if (username && !/^[a-zA-Z0-9._]+$/.test(username.trim())) {
            setStatus(authStatus, "Username can only contain letters, numbers, dots, and underscores", true);
            return;
        }
        const res = await fetch(`${AUTH_BASE}/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
        setStatus(authStatus, data.error || "Auth failed", true);
        return;
        }
        currentUser = { username: data.username };
        currentUserEl.textContent = `${data.username}`;
        setVisible(logoutBtn, true);
        setVisible(releaseBtn, true);
        setStatus(authStatus, data.mode === "register" ? "Registered and logged in" : "Logged in");
        if (page === "login") {
        setTimeout(() => {            
            window.location.href = "/app.html";
        }, 400);
        return;
        }
        if (page === "app") {
        setVisible(chatSection, true);
        await refreshMessages({ forceBottom: true });
        initSocket();
        startIdleWatcher();
        }
    });

    if (logoutBtn) logoutBtn.addEventListener("click", async () => {
        await fetch(`${AUTH_BASE}/logout`, { method: "POST" });
        currentUser = null;
        masterUnlocked = false;
        chatKey = null;
        chatSettings = null;
        roomId = "";
        // key stored in localStorage (s1); do not clear
        stopSocket();
        stopPolling();
        stopIdleWatcher();
        serverMessages = [];
        if (page === "app") {
        location.replace("/login.html");
        return;
        }
        setVisible(logoutBtn, false);
        setVisible(releaseBtn, false);
        currentUserEl.textContent = "";
    });


    if (releaseBtn) releaseBtn.addEventListener("click", async () => {
        const confirmRelease = confirm('Are you sure you want to release your username?');
        if (!confirmRelease) return;
        if (!currentUser) return;
        const res = await fetch(`${AUTH_BASE}/release`, { method: "POST" });
        if (!res.ok) {
        let errorText = "Release failed";
        try {
            const data = await res.json();
            errorText = data.error || errorText;
        } catch (err) {
            // ignore
        }
        setStatus(authStatus, errorText, true);
        return;
        }
        currentUser = null;
        setVisible(logoutBtn, false);
        setVisible(releaseBtn, false);
        currentUserEl.textContent = "";
        setStatus(authStatus, "Username released");
        serverMessages = [];
    });

    const chatForm = document.getElementById("chat-form");
    if (chatForm) chatForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!currentUser) {
        setStatus(chatStatus, "Login required to send messages", true);
        return;
        }
        const input = document.getElementById("chat-input");
        const message = input.value.trim();
        if (!message) return;

        // Get reply data if present
        const replyToId = input.getAttribute("data-reply-to-id");
        const replyToUsername = input.getAttribute("data-reply-to-username");
        const replyToText = input.getAttribute("data-reply-to-text");

        setStatus(chatStatus, "Sending...");
        const pendingLine = await appendUserMessageLine({
        kind: "user",
        id: null,
        username: currentUser.username,
        avatar_mime: currentUser.avatar_mime,
        avatar_data: currentUser.avatar_data,
        description: currentUser.description,
        banner_mime: currentUser.banner_mime,
        banner_data: currentUser.banner_data,
        profile_color: currentUser.profile_color,
        createdAt: new Date().toISOString(),
        text: message,
        reply_to_id: replyToId,
        reply_to_username: replyToUsername,
        reply_to_text: replyToText
        });
        const encrypted = await encryptMessage(message);
        
        // Include reply data in request
        const requestData = { 
            ...encrypted, 
            roomId
        };
        if (replyToId) {
            requestData.reply_to_id = replyToId;
            requestData.reply_to_username = replyToUsername;
            requestData.reply_to_text = replyToText;
        }
        
        const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData)
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
        if (pendingLine && pendingLine.parentNode) {
            pendingLine.parentNode.removeChild(pendingLine);
        }
        const errorText = payload.error || "Send failed";
        setStatus(chatStatus, errorText, true);
        return;
        }
        input.value = "";
        cancelReply(); // Clear reply indicator
        setStatus(chatStatus, "Sent");
        const serverMessage = payload.message || {};
        const createdAt = serverMessage.created_at || new Date().toISOString();
        if (pendingLine) {
        if (serverMessage.id != null) pendingLine.setAttribute("data-message-id", String(serverMessage.id));
        const timeEl = pendingLine.querySelector(".time.time-ago");
        if (timeEl) {
            timeEl.setAttribute("data-created-at", createdAt);
            timeEl.textContent = formatTimeAgoShort(createdAt);
        }
        }
    });

    const imageInput = document.getElementById("image-input");
    if (imageInput) {
    imageInput.addEventListener("change", async () => {
        const file = imageInput.files && imageInput.files[0];
        imageInput.value = "";
        if (!file) return;
        if (!currentUser) {
        setStatus(chatStatus, "Login required to send files", true);
        return;
        }
        if (!chatKey) {
        setStatus(chatStatus, "Unlock chat to send files", true);
        return;
        }
        try {
        setStatus(chatStatus, "Preparing file...");
        let buffer, mime;
        if (file.type && file.type.startsWith("image/") && file.type !== "image/gif" && file.type !== "image/svg+xml") {
            const result = await stripImageMetadata(file);
            buffer = result.buffer;
            mime = result.mime;
        } else {
            buffer = await file.arrayBuffer();
            mime = file.type || "application/octet-stream";
        }
        if (buffer.byteLength > MAX_IMAGE_BYTES) {
            setStatus(chatStatus, "File too large (max 15MB)", true);
            return;
        }
        setStatus(chatStatus, "Encrypting file...");
        const encrypted = await encryptBinary(buffer);
        setStatus(chatStatus, "Uploading file...");
        const res = await fetch("/api/images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...encrypted, roomId, mime })
        });
        if (!res.ok) {
            let errorText = "File upload failed";
            try {
            const data = await res.json();
            errorText = data.error || errorText;
            } catch (err) {
            // ignore
            }
            setStatus(chatStatus, errorText, true);
            return;
        }
        setStatus(chatStatus, "File sent");
        await refreshMessages();
        } catch (err) {
        setStatus(chatStatus, "File upload failed", true);
        }
    });
    }

    const avatarInput = document.getElementById("avatar-input");
    const profileModal = document.getElementById("profile-modal");
    const profileModalClose = document.querySelector("#profile-modal .modal-close");
    const profileDescription = document.getElementById("profile-description");
    const profileAvatarInput = document.getElementById("profile-avatar-input");
    const profileAvatarBtn = document.getElementById("profile-avatar-btn");
    const profileAvatarPreview = document.getElementById("profile-avatar-preview");
    const bannerInput = document.getElementById("banner-input");
    const bannerUploadBtn = document.getElementById("banner-upload-btn");
    const bannerPreview = document.getElementById("banner-preview");
    const profileSaveBtn = document.getElementById("profile-save-btn");
    const profileColors = document.getElementById("profile-colors");
    newMessageBanner = document.getElementById("new-message-banner");
    userModal = document.getElementById("user-modal");
    userModalClose = document.querySelector("#user-modal .modal-close");
    userBanner = document.getElementById("user-banner");
    userProfileAvatar = document.getElementById("user-profile-avatar");
    userProfileName = document.getElementById("user-profile-name");
    userProfileDescription = document.getElementById("user-profile-description");

    let pendingBannerData = null;
    let pendingBannerMime = null;
    let pendingAvatarData = null;
    let pendingAvatarMime = null;
    let pendingProfileColor = "";

    const renderProfileColors = (selectedColor) => {
        if (!profileColors) return;
        profileColors.textContent = "";
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
            profileColors.appendChild(btn);
        });
    };

    const openProfileModal = () => {
        if (!currentUser) return;
        if (profileModal) {
            profileModal.classList.add("show");
            if (profileDescription) profileDescription.value = currentUser.description || "";
            pendingProfileColor = getProfileColor(currentUser);
            renderProfileColors(pendingProfileColor);
            if (profileAvatarPreview) profileAvatarPreview.src = getAvatarUrl(currentUser);
            if (bannerPreview) {
                if (currentUser.banner_mime && currentUser.banner_data) {
                    bannerPreview.style.backgroundImage = `url(data:${currentUser.banner_mime};base64,${currentUser.banner_data})`;
                    bannerPreview.classList.add("has-image");
                    bannerPreview.textContent = "";
                } else {
                    bannerPreview.style.backgroundImage = "";
                    bannerPreview.classList.remove("has-image");
                    bannerPreview.textContent = "No banner";
                }
            }
            pendingBannerData = null;
            pendingBannerMime = null;
            pendingAvatarData = null;
            pendingAvatarMime = null;
        }
    };

    if (currentUserImg) currentUserImg.addEventListener("click", openProfileModal);
    if (currentUserEl) currentUserEl.addEventListener("click", openProfileModal);

    if (profileModalClose && profileModal) {
        profileModalClose.addEventListener("click", () => {
            profileModal.classList.remove("show");
        });
        profileModal.addEventListener("click", (e) => {
            if (e.target === profileModal) profileModal.classList.remove("show");
        });
    }

    if (userModalClose && userModal) {
        userModalClose.addEventListener("click", () => {
            userModal.classList.remove("show");
        });
        userModal.addEventListener("click", (e) => {
            if (e.target === userModal) userModal.classList.remove("show");
        });
    }

    if (bannerUploadBtn && bannerInput) {
        bannerUploadBtn.addEventListener("click", () => bannerInput.click());
    }

    if (profileAvatarBtn && profileAvatarInput) {
        profileAvatarBtn.addEventListener("click", () => profileAvatarInput.click());
    }

    if (profileAvatarInput) {
        profileAvatarInput.addEventListener("change", async () => {
            const file = profileAvatarInput.files && profileAvatarInput.files[0];
            profileAvatarInput.value = "";
            if (!file) return;
            if (!file.type || !file.type.startsWith("image/")) {
                setStatus(chatStatus, `Unsupported file type: ${describeFileType(file)}`, true);
                return;
            }
            try {
                const { buffer, mime } = await prepareAvatarImage(file);
                if (buffer.byteLength > MAX_AVATAR_BYTES) {
                    setStatus(chatStatus, "Avatar too large (max 200KB)", true);
                    return;
                }
                pendingAvatarData = arrayBufferToBase64(buffer);
                pendingAvatarMime = mime;
                if (profileAvatarPreview) {
                    profileAvatarPreview.src = `data:${mime};base64,${pendingAvatarData}`;
                }
                setStatus(chatStatus, "Avatar ready to save");
            } catch (err) {
                setStatus(chatStatus, "Avatar upload failed", true);
            }
        });
    }

    if (bannerInput) {
        bannerInput.addEventListener("change", async () => {
            const file = bannerInput.files && bannerInput.files[0];
            bannerInput.value = "";
            if (!file) return;
            if (!file.type || !file.type.startsWith("image/")) {
                setStatus(chatStatus, `Unsupported file type: ${describeFileType(file)}`, true);
                return;
            }
            try {
                const { buffer, mime } = await prepareAvatarImage(file);
                if (buffer.byteLength > 500 * 1024) {
                    setStatus(chatStatus, "Banner too large (max 500KB)", true);
                    return;
                }
                pendingBannerData = arrayBufferToBase64(buffer);
                pendingBannerMime = mime;
                if (bannerPreview) {
                    bannerPreview.style.backgroundImage = `url(data:${mime};base64,${pendingBannerData})`;
                    bannerPreview.classList.add("has-image");
                    bannerPreview.textContent = "";
                }
                setStatus(chatStatus, "Banner ready to save");
            } catch (err) {
                setStatus(chatStatus, "Banner upload failed", true);
            }
        });
    }

    if (profileSaveBtn) {
        profileSaveBtn.addEventListener("click", async () => {
            if (!currentUser) return;
            const description = profileDescription ? profileDescription.value.trim() : "";
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
            setStatus(chatStatus, "Saving profile...");
            const res = await fetch(`${AUTH_BASE}/profile`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates)
            });
            if (!res.ok) {
                let errorText = "Profile update failed";
                try {
                    const data = await res.json();
                    errorText = data.error || errorText;
                } catch (err) {
                }
                setStatus(chatStatus, errorText, true);
                return;
            }
            currentUser.description = description;
            if (pendingBannerData) {
                currentUser.banner_mime = pendingBannerMime;
                currentUser.banner_data = pendingBannerData;
            }
            if (pendingAvatarData) {
                currentUser.avatar_mime = pendingAvatarMime;
                currentUser.avatar_data = pendingAvatarData;
                if (currentUserImg) currentUserImg.src = getAvatarUrl(currentUser);
                if (userProfileAvatar) userProfileAvatar.src = getAvatarUrl(currentUser);
            }
            if (pendingProfileColor) {
                currentUser.profile_color = pendingProfileColor;
                if (currentUserEl) currentUserEl.style.color = getProfileColor(currentUser);
            }
            if (profileModal) profileModal.classList.remove("show");
            setStatus(chatStatus, "Profile updated");
            await refreshMessages();
        });
    }

    if (avatarInput) {
    avatarInput.addEventListener("change", async () => {
        const file = avatarInput.files && avatarInput.files[0];
        avatarInput.value = "";
        if (!file) return;
        await uploadAvatar(file);
    });
    }

    if (chatLog) chatLog.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.classList.contains("delete-btn") && target.hasAttribute("data-image-id")) {
        const id = target.getAttribute("data-image-id");
        if (!id) return;
        const previousScrollTop = chatLog.scrollTop;
        const res = await fetch(`/api/images/${id}?roomId=${encodeURIComponent(roomId)}`, {
            method: "DELETE"
        });
        if (!res.ok) {
            let errorText = "Delete failed";
            try {
            const data = await res.json();
            errorText = data.error || errorText;
            } catch (err) {
            // ignore
            }
            setStatus(chatStatus, errorText, true);
            return;
        }
        await refreshMessages({ preserveScrollTop: true, scrollTop: previousScrollTop });
        return;
        }
        if (!target.classList.contains("delete-btn")) return;
        const id = target.getAttribute("data-id");
        if (!id) return;
        const previousScrollTop = chatLog.scrollTop;
        const res = await fetch(`/api/messages/${id}?roomId=${encodeURIComponent(roomId)}`, {
        method: "DELETE"
        });
        if (!res.ok) {
        let errorText = "Delete failed";
        try {
            const data = await res.json();
            errorText = data.error || errorText;
        } catch (err) {
            // ignore
        }
        setStatus(chatStatus, errorText, true);
        return;
        }
        await refreshMessages({ preserveScrollTop: true, scrollTop: previousScrollTop });
    });

    if (chatLog) {
    chatLog.addEventListener("scroll", () => {
        if (isAtBottom()) {
        unreadCount = 0;
        updateNewMessageBanner();
        }
    });
    }

    if (newMessageBanner) {
    newMessageBanner.addEventListener("click", () => {
        unreadCount = 0;
        updateNewMessageBanner();
        refreshMessages({ forceBottom: true });
    });
    }

    if (page === "app") {
        ["mousemove", "keydown", "scroll", "click", "touchstart"].forEach((evt) => {
        window.addEventListener(evt, resetIdleTimer, { passive: true });
        });
        window.addEventListener("blur", () => {
        stopSocket();
        stopTimeAgoUpdater();
        });
        window.addEventListener("focus", async () => {
        resetIdleTimer();
        if (currentUser && masterUnlocked) {
            initSocket();
            await refreshMessages({ forceBottom: true });
            startTimeAgoUpdater();
            if (!socket) startPolling();
        }
        });
        startIdleWatcher();
        startTimeAgoUpdater();
    }
}

// Mention autocomplete system - declare functions at global scope
const mentionAutocomplete = document.getElementById("mention-autocomplete");
const chatInput = document.getElementById("chat-input");
let mentionStartPos = -1;
let mentionQuery = "";
let selectedMentionIndex = -1;

async function getAvailableUsernames() {
    const usernames = new Set();
    
    // First, try to extract from rendered chat-line elements
    const chatLines = document.querySelectorAll(".chat-line");
    chatLines.forEach((line) => {
        const userSpan = line.querySelector("span.user");
        if (userSpan && userSpan.textContent) {
            const username = userSpan.textContent.trim();
            if (username && username !== "SERVER" && username !== "SERVER One-user") {
                usernames.add(username);
            }
        }
    });

    // If we have usernames from DOM, return them
    if (usernames.size > 0) {
        return Array.from(usernames).filter((u) => u && u !== currentUser?.username).sort();
    }

    // Fallback: fetch from database via API
    if (roomId && masterUnlocked && chatKey) {
        try {
            const res = await fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.messages)) {
                    data.messages.forEach((msg) => {
                        if (msg.username && msg.username !== "SERVER") {
                            usernames.add(msg.username);
                        }
                    });
                }
                if (Array.isArray(data.images)) {
                    data.images.forEach((img) => {
                        if (img.username && img.username !== "SERVER") {
                            usernames.add(img.username);
                        }
                    });
                }
            }
        } catch (err) {
            // silently fail and return empty
        }
    }

    return Array.from(usernames).filter((u) => u && u !== currentUser?.username).sort();
}

function hideMentionDropdown() {
    if (mentionAutocomplete) {
        mentionAutocomplete.classList.remove("visible");
        mentionAutocomplete.innerHTML = "";
        mentionAutocomplete.style.width = "";
        mentionAutocomplete.style.left = "";
        mentionAutocomplete.style.bottom = "";
    }
    mentionStartPos = -1;
    mentionQuery = "";
    selectedMentionIndex = -1;
}

async function showMentionDropdown(query) {
    if (!mentionAutocomplete || !chatInput) return;
    const usernames = await getAvailableUsernames();
    
    let filtered;
    if (query.length === 0) {
        filtered = usernames;
    } else {
        const lowerQuery = query.toLowerCase();
        const matches = usernames.filter((u) => u.toLowerCase().includes(lowerQuery));
        const nonMatches = usernames.filter((u) => !u.toLowerCase().includes(lowerQuery));
        filtered = [...matches, ...nonMatches];
    }

    if (filtered.length === 0) {
        hideMentionDropdown();
        return;
    }

    // Position the dropdown above the input
    const rect = chatInput.getBoundingClientRect();
    mentionAutocomplete.style.width = rect.width + "px";
    mentionAutocomplete.style.left = rect.left + "px";
    mentionAutocomplete.style.bottom = (window.innerHeight - rect.top + 8) + "px";

    mentionAutocomplete.innerHTML = "";
    filtered.forEach((username, index) => {
        const item = document.createElement("div");
        item.className = "mention-autocomplete-item";
        if (index === selectedMentionIndex) {
            item.classList.add("selected");
        }

        // Get user data (avatar and color)
        const userData = userDataMap.get(username);
        const userColor = userData ? userData.color : PROFILE_COLORS[2];
        
        // Create avatar if available
        if (userData && userData.avatar_mime && userData.avatar_data) {
            const avatar = document.createElement("img");
            avatar.className = "avatar";
            avatar.src = `data:${userData.avatar_mime};base64,${userData.avatar_data}`;
            avatar.alt = username;
            avatar.width = 28;
            avatar.height = 28;
            item.appendChild(avatar);
        } else {
            const avatar = document.createElement("img");
            avatar.className = "avatar";
            avatar.src = `https://api.dicebear.com/9.x/rings/svg?size=32&seed=${encodeURIComponent(username)}`;
            avatar.alt = username;
            avatar.width = 28;
            avatar.height = 28;
            item.appendChild(avatar);
        }

        const usernameSpan = document.createElement("span");
        usernameSpan.className = "username";
        usernameSpan.textContent = username;
        usernameSpan.style.color = userColor;
        usernameSpan.style.fontWeight = "700";
        item.appendChild(usernameSpan);

        item.addEventListener("click", () => {
            insertMention(username);
        });

        mentionAutocomplete.appendChild(item);
    });

    mentionAutocomplete.classList.add("visible");
}

function insertMention(username) {
    if (!chatInput || mentionStartPos === -1) return;
    const before = chatInput.value.substring(0, mentionStartPos);
    const after = chatInput.value.substring(chatInput.selectionStart);
    chatInput.value = before + "@" + username + " " + after;
    const newPos = (before + "@" + username + " ").length;
    chatInput.setSelectionRange(newPos, newPos);
    chatInput.focus();
    hideMentionDropdown();
}

async function updateMentionDropdown() {
    if (!chatInput) return;
    const value = chatInput.value;
    const cursorPos = chatInput.selectionStart;

    // Find @ before cursor
    let atPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
        if (value[i] === "@") {
            atPos = i;
            break;
        }
        if (value[i] === " " || value[i] === "\n") break;
    }

    // Show dropdown if @ found at start or after whitespace
    if (atPos !== -1 && (atPos === 0 || /\s/.test(value[atPos - 1]))) {
        const query = value.substring(atPos + 1, cursorPos);
        if (/^[a-zA-Z0-9._]*$/.test(query)) {
            mentionStartPos = atPos;
            mentionQuery = query;
            selectedMentionIndex = 0;
            await showMentionDropdown(query);
            return;
        }
    }

    hideMentionDropdown();
}

// Attach event listeners
if (chatInput && mentionAutocomplete) {
    chatInput.addEventListener("input", updateMentionDropdown);

    chatInput.addEventListener("keydown", (e) => {
        if (!mentionAutocomplete.classList.contains("visible")) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            const items = mentionAutocomplete.querySelectorAll(".mention-autocomplete-item");
            if (items.length === 0) return;
            selectedMentionIndex = (selectedMentionIndex + 1) % items.length;
            items.forEach((item, i) => item.classList.toggle("selected", i === selectedMentionIndex));
            items[selectedMentionIndex].scrollIntoView({ block: "nearest" });
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const items = mentionAutocomplete.querySelectorAll(".mention-autocomplete-item");
            if (items.length === 0) return;
            selectedMentionIndex = (selectedMentionIndex - 1 + items.length) % items.length;
            items.forEach((item, i) => item.classList.toggle("selected", i === selectedMentionIndex));
            items[selectedMentionIndex].scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const items = mentionAutocomplete.querySelectorAll(".mention-autocomplete-item");
            if (items[selectedMentionIndex]) {
                const username = items[selectedMentionIndex].querySelector(".username").textContent;
                insertMention(username);
            }
        } else if (e.key === "Escape") {
            hideMentionDropdown();
        }
    });

    document.addEventListener("click", (e) => {
        if (!mentionAutocomplete.contains(e.target) && e.target !== chatInput) {
            hideMentionDropdown();
        }
    });
}

bootstrap();