export const state = {
  chatKey: null,
  currentUser: null,
  masterUnlocked: false,
  chatSettings: null,
  socket: null,
  roomId: "",
  idleTimer: null,
  lastActivity: Date.now(),
  serverMessages: [],
  timeAgoTimer: null,
  duplicateReloaded: false,
  unreadCount: 0,
  pollTimer: null,
  lastRenderedCount: 0,
  lastSeenCount: 0,
  userColorMap: new Map(),
  userDataMap: new Map()
};
