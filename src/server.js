const path = require("path");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const {
  initDatabase,
  ensureChatSettings,
  dbGet,
  dbAll,
  dbRun,
  cleanupOldMessages,
  cleanupOldImages,
  getUserFromCookie
} = require("./db");
const { createAuthRouter } = require("./routes/auth");
const { createMessagesRouter } = require("./routes/messages");
const { createWebSocketServer } = require("./ws");

const PORT = process.env.PORT || 8080;
const COOKIE_SECRET = process.env.COOKIE_SECRET || "ufoheurghuierhu";

async function main() {
  const db = await initDatabase();
  ensureChatSettings(db);

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser(COOKIE_SECRET));
  app.use(express.static(path.join(process.cwd(), "public")));

  const server = http.createServer(app);
  const { broadcastToRoom } = createWebSocketServer({ server });

  app.use(
    "/auth",
    createAuthRouter({
      db,
      dbGet,
      dbRun,
      getUserFromCookie
    })
  );

  app.use(
    "/api/auth",
    createAuthRouter({
      db,
      dbGet,
      dbRun,
      getUserFromCookie
    })
  );

  app.use(
    "/api",
    createMessagesRouter({
      db,
      dbAll,
      dbGet,
      dbRun,
      cleanupOldMessages,
      cleanupOldImages,
      getUserFromCookie,
      ensureChatSettings,
      broadcastToRoom
    })
  );

  app.get("*", (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "index.html"));
  });

  server.listen(PORT, () => {
    console.log(`Chat app running on http://localhost:${PORT}`);
  });
}

main();
