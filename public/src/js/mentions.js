import { dom } from "./dom.js";
import { state } from "./state.js";
import { PROFILE_COLORS } from "./constants.js";
import { fetchMessages } from "./api.js";

let mentionStartPos = -1;
let mentionQuery = "";
let selectedMentionIndex = -1;

async function getAvailableUsernames() {
  const usernames = new Set();
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

  if (usernames.size > 0) {
    return Array.from(usernames).filter((u) => u && u !== state.currentUser?.username).sort();
  }

  if (state.roomId && state.masterUnlocked && state.chatKey) {
    try {
      const { res, data } = await fetchMessages(state.roomId);
      if (res.ok) {
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
    }
  }

  return Array.from(usernames).filter((u) => u && u !== state.currentUser?.username).sort();
}

function hideMentionDropdown() {
  if (dom.mentionAutocomplete) {
    dom.mentionAutocomplete.classList.remove("visible");
    dom.mentionAutocomplete.innerHTML = "";
    dom.mentionAutocomplete.style.width = "";
    dom.mentionAutocomplete.style.left = "";
    dom.mentionAutocomplete.style.bottom = "";
  }
  mentionStartPos = -1;
  mentionQuery = "";
  selectedMentionIndex = -1;
}

async function showMentionDropdown(query) {
  if (!dom.mentionAutocomplete || !dom.chatInput) return;
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

  const rect = dom.chatInput.getBoundingClientRect();
  dom.mentionAutocomplete.style.width = `${rect.width}px`;
  dom.mentionAutocomplete.style.left = `${rect.left}px`;
  dom.mentionAutocomplete.style.bottom = `${window.innerHeight - rect.top + 8}px`;

  dom.mentionAutocomplete.innerHTML = "";
  filtered.forEach((username, index) => {
    const item = document.createElement("div");
    item.className = "mention-autocomplete-item";
    if (index === selectedMentionIndex) {
      item.classList.add("selected");
    }

    const userData = state.userDataMap.get(username);
    const userColor = userData ? userData.color : PROFILE_COLORS[2];

    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = userData && userData.avatar_mime && userData.avatar_data
      ? `data:${userData.avatar_mime};base64,${userData.avatar_data}`
      : `https://api.dicebear.com/9.x/rings/svg?size=32&seed=${encodeURIComponent(username)}`;
    avatar.alt = username;
    avatar.width = 28;
    avatar.height = 28;
    item.appendChild(avatar);

    const usernameSpan = document.createElement("span");
    usernameSpan.className = "username";
    usernameSpan.textContent = username;
    usernameSpan.style.color = userColor;
    usernameSpan.style.fontWeight = "700";
    item.appendChild(usernameSpan);

    item.addEventListener("click", () => {
      insertMention(username);
    });

    dom.mentionAutocomplete.appendChild(item);
  });

  dom.mentionAutocomplete.classList.add("visible");
}

function insertMention(username) {
  if (!dom.chatInput || mentionStartPos === -1) return;
  const before = dom.chatInput.value.substring(0, mentionStartPos);
  const after = dom.chatInput.value.substring(dom.chatInput.selectionStart);
  dom.chatInput.value = `${before}@${username} ${after}`;
  const newPos = `${before}@${username} `.length;
  dom.chatInput.setSelectionRange(newPos, newPos);
  dom.chatInput.focus();
  hideMentionDropdown();
}

async function updateMentionDropdown() {
  if (!dom.chatInput) return;
  const value = dom.chatInput.value;
  const cursorPos = dom.chatInput.selectionStart;

  let atPos = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (value[i] === "@") {
      atPos = i;
      break;
    }
    if (value[i] === " " || value[i] === "\n") break;
  }

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

export function initMentionAutocomplete() {
  if (!dom.chatInput || !dom.mentionAutocomplete) return;

  dom.chatInput.addEventListener("input", updateMentionDropdown);

  dom.chatInput.addEventListener("keydown", (e) => {
    if (!dom.mentionAutocomplete.classList.contains("visible")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const items = dom.mentionAutocomplete.querySelectorAll(".mention-autocomplete-item");
      if (items.length === 0) return;
      selectedMentionIndex = (selectedMentionIndex + 1) % items.length;
      items.forEach((item, i) => item.classList.toggle("selected", i === selectedMentionIndex));
      items[selectedMentionIndex].scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const items = dom.mentionAutocomplete.querySelectorAll(".mention-autocomplete-item");
      if (items.length === 0) return;
      selectedMentionIndex = (selectedMentionIndex - 1 + items.length) % items.length;
      items.forEach((item, i) => item.classList.toggle("selected", i === selectedMentionIndex));
      items[selectedMentionIndex].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const items = dom.mentionAutocomplete.querySelectorAll(".mention-autocomplete-item");
      if (items[selectedMentionIndex]) {
        const username = items[selectedMentionIndex].querySelector(".username")?.textContent;
        if (username) insertMention(username);
      }
    } else if (e.key === "Escape") {
      hideMentionDropdown();
    }
  });

  document.addEventListener("click", (e) => {
    if (!dom.mentionAutocomplete.contains(e.target) && e.target !== dom.chatInput) {
      hideMentionDropdown();
    }
  });
}
