// src/server.ts
import { WebSocketServer, WebSocket } from "ws";

// ../shared/src/net/messages.ts
var MAX_ROOM_SIZE = 6;
var ROOM_CODE_LENGTH = 6;

// src/server.ts
var CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(len) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
var nextClientId = 1;
function createRelay(port2) {
  const rooms = /* @__PURE__ */ new Map();
  const wss = new WebSocketServer({ port: port2 });
  const send = (c, msg) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const membersOf = (room) => room.members.map((m) => ({ id: m.id, name: m.name, host: m === room.host }));
  const broadcast = (room, msg, except) => {
    for (const m of room.members) if (m !== except) send(m, msg);
  };
  const leave = (c) => {
    const room = c.room;
    if (!room) return;
    c.room = null;
    room.members = room.members.filter((m) => m !== c);
    if (room.host === c) {
      for (const m of room.members) {
        m.room = null;
        send(m, { type: "hostLeft" });
      }
      rooms.delete(room.code);
      return;
    }
    if (room.members.length === 0) {
      rooms.delete(room.code);
      return;
    }
    broadcast(room, { type: "members", members: membersOf(room) });
  };
  wss.on("connection", (ws) => {
    const c = { id: `p${nextClientId++}`, name: "", ws, room: null };
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        send(c, { type: "error", message: "bad json" });
        return;
      }
      switch (msg.type) {
        case "create": {
          if (c.room) leave(c);
          c.name = String(msg.name || "Player").slice(0, 16);
          let code = randomCode(ROOM_CODE_LENGTH);
          while (rooms.has(code)) code = randomCode(ROOM_CODE_LENGTH);
          const room = { code, host: c, members: [c] };
          rooms.set(code, room);
          c.room = room;
          send(c, { type: "created", code, you: c.id, members: membersOf(room) });
          break;
        }
        case "join": {
          if (c.room) leave(c);
          const code = String(msg.code || "").toUpperCase().trim();
          const room = rooms.get(code);
          if (!room) {
            send(c, { type: "error", message: "\u30EB\u30FC\u30E0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" });
            return;
          }
          if (room.members.length >= MAX_ROOM_SIZE) {
            send(c, { type: "error", message: "\u30EB\u30FC\u30E0\u304C\u6E80\u54E1\u3067\u3059" });
            return;
          }
          c.name = String(msg.name || "Player").slice(0, 16);
          room.members.push(c);
          c.room = room;
          send(c, { type: "joined", code, you: c.id, members: membersOf(room) });
          broadcast(room, { type: "members", members: membersOf(room) }, c);
          break;
        }
        case "relay": {
          const room = c.room;
          if (!room) return;
          const out = { type: "relay", from: c.id, payload: msg.payload };
          if (msg.to) {
            const target = room.members.find((m) => m.id === msg.to);
            if (target) send(target, out);
          } else {
            broadcast(room, out, c);
          }
          break;
        }
        default:
          send(c, { type: "error", message: "unknown message" });
      }
    });
    ws.on("close", () => leave(c));
    ws.on("error", () => leave(c));
  });
  return {
    wss,
    roomCount: () => rooms.size,
    close: () => new Promise((resolve) => {
      for (const client of wss.clients) client.terminate();
      wss.close(() => resolve());
    })
  };
}

// src/index.ts
var port = Number(process.env.PORT ?? 8080);
var relay = createRelay(port);
console.log(`[relay] listening on ws://localhost:${port}`);
relay.wss.on("connection", (_ws, req) => {
  console.log(`[relay] connection from ${req.socket.remoteAddress ?? "?"}`);
});
