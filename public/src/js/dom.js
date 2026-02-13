export const dom = {
  authSection: null,
  chatSection: null,
  authStatus: null,
  chatStatus: null,
  currentUserEl: null,
  currentUserImg: null,
  logoutBtn: null,
  releaseBtn: null,
  chatLog: null,
  chatForm: null,
  chatInput: null,
  imageInput: null,
  newMessageBanner: null,
  mentionAutocomplete: null,
  avatarInput: null,
  profileModal: null,
  profileModalClose: null,
  profileDescription: null,
  profileAvatarInput: null,
  profileAvatarBtn: null,
  profileAvatarPreview: null,
  bannerInput: null,
  bannerUploadBtn: null,
  bannerPreview: null,
  profileSaveBtn: null,
  profileColors: null,
  imageModal: null,
  imageModalClose: null,
  imageModalImg: null,
  userModal: null,
  userModalClose: null,
  userBanner: null,
  userProfileAvatar: null,
  userProfileName: null,
  userProfileDescription: null,
  authForm: null,
  serverSelection: null,
  page: ""
};

export function initDom() {
  dom.authSection = document.getElementById("auth-section");
  dom.chatSection = document.getElementById("chat-section");
  dom.authStatus = document.getElementById("auth-status");
  dom.chatStatus = document.getElementById("chat-status");
  dom.currentUserEl = document.getElementById("current-user");
  dom.currentUserImg = document.getElementById("current-user-img");
  dom.logoutBtn = document.getElementById("logout-btn");
  dom.releaseBtn = document.getElementById("release-btn");
  dom.chatLog = document.getElementById("chat-log");
  dom.chatForm = document.getElementById("chat-form");
  dom.chatInput = document.getElementById("chat-input");
  dom.imageInput = document.getElementById("image-input");
  dom.newMessageBanner = document.getElementById("new-message-banner");
  dom.mentionAutocomplete = document.getElementById("mention-autocomplete");
  dom.avatarInput = document.getElementById("avatar-input");
  dom.profileModal = document.getElementById("profile-modal");
  dom.profileModalClose = document.querySelector("#profile-modal .modal-close");
  dom.profileDescription = document.getElementById("profile-description");
  dom.profileAvatarInput = document.getElementById("profile-avatar-input");
  dom.profileAvatarBtn = document.getElementById("profile-avatar-btn");
  dom.profileAvatarPreview = document.getElementById("profile-avatar-preview");
  dom.bannerInput = document.getElementById("banner-input");
  dom.bannerUploadBtn = document.getElementById("banner-upload-btn");
  dom.bannerPreview = document.getElementById("banner-preview");
  dom.profileSaveBtn = document.getElementById("profile-save-btn");
  dom.profileColors = document.getElementById("profile-colors");
  dom.imageModal = document.getElementById("image-modal");
  dom.imageModalClose = document.querySelector("#image-modal .modal-close");
  dom.imageModalImg = document.getElementById("image-modal-img");
  dom.userModal = document.getElementById("user-modal");
  dom.userModalClose = document.querySelector("#user-modal .modal-close");
  dom.userBanner = document.getElementById("user-banner");
  dom.userProfileAvatar = document.getElementById("user-profile-avatar");
  dom.userProfileName = document.getElementById("user-profile-name");
  dom.userProfileDescription = document.getElementById("user-profile-description");
  dom.authForm = document.getElementById("auth-form");
  dom.serverSelection = document.getElementById("server-selection");
  dom.page = document.body?.dataset?.page || "";
}
