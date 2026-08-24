import { WebSocketServer, WebSocket } from "ws";
import type { ClientToRelay, RelayToClient, RoomMember } from "../../shared/src/net/messages";
import { MAX_ROOM_SIZE, ROOM_CODE_LENGTH } from "../../shared/src/net/messages";

/**
 * ステートレス中継。ルーム表以外の状態を持たず、ゲームルールを一切知らない。
 * relay メッセージは中身を見ずに転送するだけ。
 */

interface Client {
  id: string;
  name: string;
  ws: WebSocket;
  room: Room | null;
}
interface Room {
  code: string;
  host: Client;
  members: Client[];
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい 0/O/1/I を除外

function randomCode(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

let nextClientId = 1;

export function createRelay(port: number): { wss: WebSocketServer; close: () => Promise<void>; roomCount: () => number } {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ port });

  const send = (c: Client, msg: RelayToClient) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const membersOf = (room: Room): RoomMember[] => room.members.map((m) => ({ id: m.id, name: m.name, host: m === room.host }));
  const broadcast = (room: Room, msg: RelayToClient, except?: Client) => {
    for (const m of room.members) if (m !== except) send(m, msg);
  };

  const leave = (c: Client) => {
    const room = c.room;
    if (!room) return;
    c.room = null;
    room.members = room.members.filter((m) => m !== c);
    if (room.host === c) {
      // ホスト切断 → 試合終了・ルーム解散（SPEC 10章）
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
    const c: Client = { id: `p${nextClientId++}`, name: "", ws, room: null };

    ws.on("message", (raw) => {
      let msg: ClientToRelay;
      try {
        msg = JSON.parse(String(raw)) as ClientToRelay;
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
          const room: Room = { code, host: c, members: [c] };
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
            send(c, { type: "error", message: "ルームが見つかりません" });
            return;
          }
          if (room.members.length >= MAX_ROOM_SIZE) {
            send(c, { type: "error", message: "ルームが満員です" });
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
          const out: RelayToClient = { type: "relay", from: c.id, payload: msg.payload };
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
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
