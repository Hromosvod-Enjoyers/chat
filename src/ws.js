const { WebSocketServer } = require("ws");

function createWebSocketServer({ server }) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  function broadcastToRoom(roomId, payload) {
    const data = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.roomId === roomId) {
        client.send(data);
      }
    });
  }

  wss.on("connection", (ws) => {
    ws.roomId = "";
    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (payload.type === "subscribe" && typeof payload.roomId === "string") {
          ws.roomId = payload.roomId;
        }
      } catch (err) {
        // ignore
      }
    });
  });

  return { wss, broadcastToRoom };
}

module.exports = { createWebSocketServer };
