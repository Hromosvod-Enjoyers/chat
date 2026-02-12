const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const initSqlJs = require("sql.js");

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "chat.db");
const LARGE_IMAGE_BYTES = 1024 * 1024;
const LARGE_IMAGE_KEEP = 30;
const ROOM_SALT_BYTES = 16;
const ARGON2_OPSLIMIT = 2;
const ARGON2_MEMLIMIT = 64 * 1024 * 1024;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveDb(db) {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function dbRun(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  saveDb(db);
}

function ensureMessageIvColumn(db) {
  const columns = dbAll(db, "PRAGMA table_info(messages)");
  const hasIv = columns.some((col) => col.name === "iv");
  if (!hasIv) {
    dbRun(db, "ALTER TABLE messages ADD COLUMN iv TEXT NOT NULL DEFAULT ''");
  }
}

function ensureMessageRoomColumn(db) {
  const columns = dbAll(db, "PRAGMA table_info(messages)");
  const hasRoom = columns.some((col) => col.name === "room_id");
  if (!hasRoom) {
    dbRun(db, "ALTER TABLE messages ADD COLUMN room_id TEXT NOT NULL DEFAULT ''");
  }
}

function ensureUserAvatarColumns(db) {
  const columns = dbAll(db, "PRAGMA table_info(users)");
  const hasAvatarMime = columns.some((col) => col.name === "avatar_mime");
  const hasAvatarData = columns.some((col) => col.name === "avatar_data");
  if (!hasAvatarMime) {
    dbRun(db, "ALTER TABLE users ADD COLUMN avatar_mime TEXT NOT NULL DEFAULT ''");
  }
  if (!hasAvatarData) {
    dbRun(db, "ALTER TABLE users ADD COLUMN avatar_data TEXT NOT NULL DEFAULT ''");
  }
}

function ensureUserProfileColumns(db) {
  const columns = dbAll(db, "PRAGMA table_info(users)");
  const hasDescription = columns.some((col) => col.name === "description");
  const hasBannerMime = columns.some((col) => col.name === "banner_mime");
  const hasBannerData = columns.some((col) => col.name === "banner_data");
  if (!hasDescription) {
    dbRun(db, "ALTER TABLE users ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  if (!hasBannerMime) {
    dbRun(db, "ALTER TABLE users ADD COLUMN banner_mime TEXT NOT NULL DEFAULT ''");
  }
  if (!hasBannerData) {
    dbRun(db, "ALTER TABLE users ADD COLUMN banner_data TEXT NOT NULL DEFAULT ''");
  }
}

function ensureUserColorColumn(db) {
  const columns = dbAll(db, "PRAGMA table_info(users)");
  const hasColor = columns.some((col) => col.name === "profile_color");
  if (!hasColor) {
    dbRun(db, "ALTER TABLE users ADD COLUMN profile_color TEXT NOT NULL DEFAULT ''");
  }
}

function ensureMessageReplyColumns(db) {
  const columns = dbAll(db, "PRAGMA table_info(messages)");
  const hasReplyToId = columns.some((col) => col.name === "reply_to_id");
  const hasReplyToUsername = columns.some((col) => col.name === "reply_to_username");
  const hasReplyToText = columns.some((col) => col.name === "reply_to_text");
  
  if (!hasReplyToId) {
    dbRun(db, "ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL");
  }
  if (!hasReplyToUsername) {
    dbRun(db, "ALTER TABLE messages ADD COLUMN reply_to_username TEXT DEFAULT ''");
  }
  if (!hasReplyToText) {
    dbRun(db, "ALTER TABLE messages ADD COLUMN reply_to_text TEXT DEFAULT ''");
  }
}

function ensureImageSizeColumn(db) {
  const columns = dbAll(db, "PRAGMA table_info(images)");
  const hasSize = columns.some((col) => col.name === "size_bytes");
  if (!hasSize) {
    dbRun(db, "ALTER TABLE images ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0");
  }
}

function cleanupOldMessages(db) {
  dbRun(db, "DELETE FROM messages WHERE created_at < datetime('now', '-90 days')");
}

function cleanupOldImages(db, roomId) {
  if (!roomId) return;
  dbRun(
    db,
    `
      DELETE FROM images
      WHERE room_id = ?
        AND size_bytes >= ?
        AND id NOT IN (
          SELECT id FROM images
          WHERE room_id = ?
            AND size_bytes >= ?
          ORDER BY id DESC
          LIMIT ${LARGE_IMAGE_KEEP}
        )
    `,
    [roomId, LARGE_IMAGE_BYTES, roomId, LARGE_IMAGE_BYTES]
  );
}

async function initDatabase() {
  const SQL = await initSqlJs();
  let db;
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    db = new SQL.Database(new Uint8Array(data));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_mime TEXT NOT NULL DEFAULT '',
      avatar_data TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      banner_mime TEXT NOT NULL DEFAULT '',
      banner_data TEXT NOT NULL DEFAULT '',
      profile_color TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id TEXT NOT NULL,
      iv TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id TEXT NOT NULL,
      iv TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      mime TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      room_id TEXT PRIMARY KEY,
      salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureMessageIvColumn(db);
  ensureMessageRoomColumn(db);
  ensureUserAvatarColumns(db);
  ensureUserProfileColumns(db);
  ensureUserColorColumn(db);
  ensureMessageReplyColumns(db);
  ensureImageSizeColumn(db);
  cleanupOldMessages(db);

  saveDb(db);
  return db;
}

function getRoomSettings(db, roomId) {
  if (!roomId) return null;
  let row = dbGet(db, "SELECT salt FROM rooms WHERE room_id = ?", [roomId]);
  if (!row) {
    const salt = crypto.randomBytes(ROOM_SALT_BYTES).toString("base64");
    dbRun(db, "INSERT OR REPLACE INTO rooms (room_id, salt) VALUES (?, ?)", [roomId, salt]);
    row = { salt };
  }
  return {
    salt: row.salt,
    opslimit: ARGON2_OPSLIMIT,
    memlimit: ARGON2_MEMLIMIT
  };
}

function getUserFromCookie(db, req) {
  const sessionId = req.signedCookies.session_id;
  if (!sessionId) return null;
  return dbGet(
    db,
    "SELECT u.id, u.username, u.avatar_mime, u.avatar_data, u.description, u.banner_mime, u.banner_data, u.profile_color FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.id = ?",
    [sessionId]
  );
}

function createSession(db, userId) {
  const sessionId = crypto.randomBytes(32).toString("base64url");
  dbRun(db, "INSERT INTO sessions (id, user_id) VALUES (?, ?)", [sessionId, userId]);
  return sessionId;
}

function deleteSession(db, sessionId) {
  if (!sessionId) return;
  dbRun(db, "DELETE FROM sessions WHERE id = ?", [sessionId]);
}

function deleteUserSessions(db, userId) {
  if (!userId) return;
  dbRun(db, "DELETE FROM sessions WHERE user_id = ?", [userId]);
}

module.exports = {
  initDatabase,
  getRoomSettings,
  cleanupOldMessages,
  cleanupOldImages,
  dbGet,
  dbAll,
  dbRun,
  getUserFromCookie,
  createSession,
  deleteSession,
  deleteUserSessions
};
