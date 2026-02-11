const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const initSqlJs = require("sql.js");

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "chat.db");

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
        AND id NOT IN (
          SELECT id FROM images
          WHERE room_id = ?
          ORDER BY id DESC
          LIMIT 15
        )
    `,
    [roomId, roomId]
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  ensureMessageIvColumn(db);
  ensureMessageRoomColumn(db);
  ensureUserAvatarColumns(db);
  ensureUserProfileColumns(db);
  ensureUserColorColumn(db);
  cleanupOldMessages(db);

  saveDb(db);
  return db;
}

function ensureChatSettings(db) {
  const storedSalt = dbGet(db, "SELECT value FROM settings WHERE key = 'chat_salt'");
  const storedIterations = dbGet(db, "SELECT value FROM settings WHERE key = 'kdf_iterations'");

  if (!storedSalt) {
    const salt = crypto.randomBytes(16).toString("base64");
    dbRun(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_salt', ?)", [salt]);
  }

  if (!storedIterations) {
    dbRun(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('kdf_iterations', ?)", [
      "150000"
    ]);
  }

  return {
    salt: dbGet(db, "SELECT value FROM settings WHERE key = 'chat_salt'").value,
    iterations: Number(dbGet(db, "SELECT value FROM settings WHERE key = 'kdf_iterations'").value)
  };
}

function getUserFromCookie(db, req) {
  const id = req.signedCookies.user_id;
  if (!id) return null;
  return dbGet(db, "SELECT id, username, avatar_mime, avatar_data, description, banner_mime, banner_data, profile_color FROM users WHERE id = ?", [id]);
}

module.exports = {
  initDatabase,
  ensureChatSettings,
  cleanupOldMessages,
  cleanupOldImages,
  dbGet,
  dbAll,
  dbRun,
  getUserFromCookie
};
