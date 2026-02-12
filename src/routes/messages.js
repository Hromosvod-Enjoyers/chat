const express = require("express");

function createMessagesRouter({
  db,
  dbAll,
  dbGet,
  dbRun,
  cleanupOldMessages,
  cleanupOldImages,
  getUserFromCookie,
  ensureChatSettings,
  broadcastToRoom
}) {
  const router = express.Router();

  router.get("/chat-settings", (req, res) => {
    const settings = ensureChatSettings(db);
    res.json({ salt: settings.salt, iterations: settings.iterations });
  });

  router.get("/messages", (req, res) => {
    const roomId = typeof req.query.roomId === "string" ? req.query.roomId : "";
    if (!roomId) return res.status(400).json({ error: "roomId required" });
    const rows = dbAll(
      db,
      `
        SELECT m.id, m.room_id, m.iv, m.ciphertext, m.created_at, m.reply_to_id, m.reply_to_username, m.reply_to_text,
               u.username, u.avatar_mime, u.avatar_data, u.description, u.banner_mime, u.banner_data, u.profile_color
        FROM messages m
        JOIN users u ON u.id = m.user_id
        WHERE m.room_id = ?
        ORDER BY m.id ASC
        LIMIT 200
      `,
      [roomId]
    );
    const images = dbAll(
      db,
      `
        SELECT i.id, i.room_id, i.iv, i.ciphertext, i.created_at, i.mime, u.username, u.avatar_mime, u.avatar_data, u.description, u.banner_mime, u.banner_data, u.profile_color
        FROM images i
        JOIN users u ON u.id = i.user_id
        WHERE i.room_id = ?
        ORDER BY i.id ASC
        LIMIT 15
      `,
      [roomId]
    );
    res.json({ messages: rows, images });
  });

  router.post("/messages", (req, res) => {
    const user = getUserFromCookie(db, req);
    if (!user) return res.status(401).json({ error: "Login required" });

    const { ciphertext, iv, roomId, reply_to_id, reply_to_username, reply_to_text } = req.body || {};
    
    if (
      !ciphertext ||
      typeof ciphertext !== "string" ||
      !iv ||
      typeof iv !== "string" ||
      !roomId ||
      typeof roomId !== "string"
    ) {
      return res.status(400).json({ error: "Ciphertext, iv, and roomId required" });
    }

    if (ciphertext.length > 1800) {
      return res.status(400).json({ error: "Message too long (max 800 chars)" });
    }

    try {
      cleanupOldMessages(db);
      
      // Insert with reply data if present
      if (reply_to_id) {
        dbRun(db, "INSERT INTO messages (user_id, room_id, iv, ciphertext, reply_to_id, reply_to_username, reply_to_text) VALUES (?, ?, ?, ?, ?, ?, ?)", [
          user.id,
          roomId,
          iv,
          ciphertext,
          reply_to_id,
          reply_to_username || "",
          reply_to_text || ""
        ]);
      } else {
        dbRun(db, "INSERT INTO messages (user_id, room_id, iv, ciphertext) VALUES (?, ?, ?, ?)", [
          user.id,
          roomId,
          iv,
          ciphertext
        ]);
      }

      let row = dbGet(
        db,
        `
          SELECT m.id, m.room_id, m.iv, m.ciphertext, m.created_at, m.reply_to_id, m.reply_to_username, m.reply_to_text,
                 u.username, u.avatar_mime, u.avatar_data, u.description, u.banner_mime, u.banner_data, u.profile_color
          FROM messages m
          JOIN users u ON u.id = m.user_id
          WHERE m.id = (SELECT last_insert_rowid())
        `
      );

      if (!row) {
        row = dbGet(
          db,
          `
            SELECT m.id, m.room_id, m.iv, m.ciphertext, m.created_at, m.reply_to_id, m.reply_to_username, m.reply_to_text,
                   u.username, u.avatar_mime, u.avatar_data, u.description, u.banner_mime, u.banner_data, u.profile_color
            FROM messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.user_id = ? AND m.room_id = ?
            ORDER BY m.id DESC
            LIMIT 1
          `,
          [user.id, roomId]
        );
      }

      if (row) {
        broadcastToRoom(row.room_id, { type: "new_message", message: row });
      }

      res.json({ ok: true, message: row || null });
    } catch (err) {
      res.status(500).json({ error: "Failed to store message" });
    }
  });

  router.post("/images", (req, res) => {
    const user = getUserFromCookie(db, req);
    if (!user) return res.status(401).json({ error: "Login required" });

    const { ciphertext, iv, roomId, mime } = req.body || {};
    if (
      !ciphertext ||
      typeof ciphertext !== "string" ||
      !iv ||
      typeof iv !== "string" ||
      !roomId ||
      typeof roomId !== "string" ||
      !mime ||
      typeof mime !== "string"
    ) {
      return res.status(400).json({ error: "ciphertext, iv, roomId, and mime required" });
    }

    if (ciphertext.length > 25000000) {
      return res.status(400).json({ error: "File too large" });
    }

    try {
      dbRun(db, "INSERT INTO images (user_id, room_id, iv, ciphertext, mime) VALUES (?, ?, ?, ?, ?)", [
        user.id,
        roomId,
        iv,
        ciphertext,
        mime
      ]);

      cleanupOldImages(db, roomId);

      const row = dbGet(
        db,
        `
          SELECT i.id, i.room_id, i.iv, i.ciphertext, i.created_at, i.mime, u.username, u.avatar_mime, u.avatar_data, u.description, u.banner_mime, u.banner_data, u.profile_color
          FROM images i
          JOIN users u ON u.id = i.user_id
          WHERE i.id = (SELECT last_insert_rowid())
        `
      );

      if (row) {
        broadcastToRoom(row.room_id, { type: "new_image", image: row });
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to store file" });
    }
  });

  router.delete("/images/:id", (req, res) => {
    const user = getUserFromCookie(db, req);
    if (!user) return res.status(401).json({ error: "Login required" });
    const id = Number(req.params.id);
    const roomId = typeof req.query.roomId === "string" ? req.query.roomId : "";
    if (!id || !roomId) {
      return res.status(400).json({ error: "Image id and roomId required" });
    }

    const img = dbGet(db, "SELECT id, user_id, room_id FROM images WHERE id = ?", [id]);
    if (!img || img.room_id !== roomId) {
      return res.status(404).json({ error: "Image not found" });
    }
    if (img.user_id !== user.id) {
      return res.status(403).json({ error: "Not allowed" });
    }

    try {
      dbRun(db, "DELETE FROM images WHERE id = ?", [id]);
      broadcastToRoom(roomId, { type: "delete_image", id });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  router.delete("/messages/:id", (req, res) => {
    const user = getUserFromCookie(db, req);
    if (!user) return res.status(401).json({ error: "Login required" });
    const id = Number(req.params.id);
    const roomId = typeof req.query.roomId === "string" ? req.query.roomId : "";
    if (!id || !roomId) {
      return res.status(400).json({ error: "Message id and roomId required" });
    }

    const msg = dbGet(db, "SELECT id, user_id, room_id FROM messages WHERE id = ?", [id]);
    if (!msg || msg.room_id !== roomId) {
      return res.status(404).json({ error: "Message not found" });
    }
    if (msg.user_id !== user.id) {
      return res.status(403).json({ error: "Not allowed" });
    }

    try {
      dbRun(db, "DELETE FROM messages WHERE id = ?", [id]);
      broadcastToRoom(roomId, { type: "delete_message", id });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete message" });
    }
  });

  return router;
}

module.exports = { createMessagesRouter };
