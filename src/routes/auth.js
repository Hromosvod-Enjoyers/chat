const express = require("express");
const bcrypt = require("bcryptjs");

const MAX_AVATAR_BYTES = 200 * 1024;
const MAX_BANNER_BYTES = 500 * 1024;
const MAX_DESCRIPTION_LENGTH = 500;

function createAuthRouter({ db, dbGet, dbRun, getUserFromCookie }) {
  const router = express.Router();

  router.post("/logout", (req, res) => {
    res.clearCookie("user_id");
    res.json({ ok: true });
  });

  router.post("/release", (req, res) => {
    const user = getUserFromCookie(db, req);
    if (!user) return res.status(401).json({ error: "Login required" });
    dbRun(db, "DELETE FROM users WHERE id = ?", [user.id]);
    res.clearCookie("user_id");
    res.json({ ok: true });
  });

  router.post("/register", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const hash = bcrypt.hashSync(password, 10);
    try {
      dbRun(db, "INSERT INTO users (username, password_hash, avatar_mime, avatar_data, description, banner_mime, banner_data) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        username.trim(),
        hash,
        "",
        "",
        "",
        "",
        ""
      ]);

      const created = dbGet(db, "SELECT id, username FROM users WHERE username = ?", [
        username.trim()
      ]);
      if (!created) {
        return res.status(500).json({ error: "Registration failed" });
      }

      res.cookie("user_id", String(created.id), {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 30
      });

      res.json({ ok: true, username: created.username });
    } catch (err) {
      return res.status(409).json({ error: "Username already taken" });
    }
  });

  router.post("/login", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const user = dbGet(db, "SELECT id, username, password_hash FROM users WHERE username = ?", [
      username.trim()
    ]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    res.cookie("user_id", String(user.id), {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30
    });
    res.json({ ok: true, username: user.username });
  });

  router.post("/enter", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const existing = dbGet(db, "SELECT id, username, password_hash FROM users WHERE username = ?", [
      username.trim()
    ]);

    if (existing) {
      if (!bcrypt.compareSync(password, existing.password_hash)) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      res.cookie("user_id", String(existing.id), {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 30
      });
      return res.json({ ok: true, username: existing.username, mode: "login" });
    }

    const hash = bcrypt.hashSync(password, 10);
    try {
      dbRun(db, "INSERT INTO users (username, password_hash, avatar_mime, avatar_data, description, banner_mime, banner_data) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        username.trim(),
        hash,
        "",
        "",
        "",
        "",
        ""
      ]);
      const created = dbGet(db, "SELECT id, username FROM users WHERE username = ?", [
        username.trim()
      ]);
      if (!created) {
        return res.status(500).json({ error: "Registration failed" });
      }
      res.cookie("user_id", String(created.id), {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 30
      });
      return res.json({ ok: true, username: created.username, mode: "register" });
    } catch (err) {
      return res.status(409).json({ error: "Username already taken" });
    }
  });

  router.post("/avatar", (req, res) => {
    const user = getUserFromCookie(db, req);
    if (!user) return res.status(401).json({ error: "Login required" });

    const { mime, data } = req.body || {};
    if (!mime || typeof mime !== "string" || !data || typeof data !== "string") {
      return res.status(400).json({ error: "mime and data required" });
    }
    if (!mime.startsWith("image/")) {
      return res.status(400).json({ error: "Only image uploads allowed" });
    }

    let buffer;
    try {
      buffer = Buffer.from(data, "base64");
    } catch (err) {
      return res.status(400).json({ error: "Invalid image data" });
    }
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: "Invalid image data" });
    }
    if (buffer.length > MAX_AVATAR_BYTES) {
      return res.status(400).json({ error: "Avatar too large" });
    }

    dbRun(db, "UPDATE users SET avatar_mime = ?, avatar_data = ? WHERE id = ?", [
      mime,
      data,
      user.id
    ]);
    res.json({ ok: true });
  });

  router.post("/profile", (req, res) => {
    const user = getUserFromCookie(db, req);
    if (!user) return res.status(401).json({ error: "Login required" });

    const { description, bannerMime, bannerData } = req.body || {};
    
    if (description !== undefined) {
      if (typeof description !== "string") {
        return res.status(400).json({ error: "Invalid description" });
      }
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        return res.status(400).json({ error: "Description too long" });
      }
      dbRun(db, "UPDATE users SET description = ? WHERE id = ?", [description.trim(), user.id]);
    }

    if (bannerMime !== undefined && bannerData !== undefined) {
      if (typeof bannerMime !== "string" || typeof bannerData !== "string") {
        return res.status(400).json({ error: "Invalid banner data" });
      }
      if (bannerMime && !bannerMime.startsWith("image/")) {
        return res.status(400).json({ error: "Only image uploads allowed" });
      }
      if (bannerData) {
        let buffer;
        try {
          buffer = Buffer.from(bannerData, "base64");
        } catch (err) {
          return res.status(400).json({ error: "Invalid banner data" });
        }
        if (buffer.length > MAX_BANNER_BYTES) {
          return res.status(400).json({ error: "Banner too large" });
        }
      }
      dbRun(db, "UPDATE users SET banner_mime = ?, banner_data = ? WHERE id = ?", [
        bannerMime,
        bannerData,
        user.id
      ]);
    }

    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    const user = getUserFromCookie(db, req);
    res.json({ user });
  });

  return router;
}

module.exports = { createAuthRouter };
