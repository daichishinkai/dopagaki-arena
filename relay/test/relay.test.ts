import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRelay } from "../src/server";
import type { RelayToClient } from "../../shared/src/net/messages";

const PORT = 18080;
let relay: ReturnType<typeof createRelay>;

function connect(): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.once("open", () => res(ws));
    ws.once("error", rej);
  });
}
function next(ws: WebSocket, pred?: (m: RelayToClient) => boolean): Promise<RelayToClient> {
  return new Promise((res) => {
    const h = (raw: WebSocket.RawData) => {
      const m = JSON.parse(String(raw)) as RelayToClient;
      if (!pred || pred(m)) {
        ws.off("message", h);
        res(m);
      }
    };
    ws.on("message", h);
  });
}
const send = (ws: WebSocket, m: unknown) => ws.send(JSON.stringify(m));

beforeAll(() => {
  relay = createRelay(PORT);
});
afterAll(async () => {
  await relay.close();
});

describe("中継サーバー", () => {
  it("作成→参加→転送→ホスト切断で解散", async () => {
    const host = await connect();
    send(host, { type: "create", name: "Host" });
    const created = await next(host);
    expect(created.type).toBe("created");
    if (created.type !== "created") throw new Error();
    expect(created.code).toHaveLength(6);
    expect(created.members).toHaveLength(1);
    expect(created.members[0]!.host).toBe(true);

    const guest = await connect();
    const hostSeesJoin = next(host, (m) => m.type === "members");
    send(guest, { type: "join", code: created.code, name: "Guest" });
    const joined = await next(guest);
    expect(joined.type).toBe("joined");
    if (joined.type !== "joined") throw new Error();
    expect(joined.members).toHaveLength(2);
    const members = await hostSeesJoin;
    expect(members.type === "members" && members.members.length).toBe(2);

    // 転送（中身は解釈されない）
    const guestGets = next(guest, (m) => m.type === "relay");
    send(host, { type: "relay", payload: { type: "start", players: [] } });
    const relayed = await guestGets;
    expect(relayed.type === "relay" && relayed.from).toBe(created.you);
    expect(relayed.type === "relay" && relayed.payload.type).toBe("start");

    // 個別宛
    const hostGets = next(host, (m) => m.type === "relay");
    send(guest, { type: "relay", to: created.you, payload: { type: "rematch" } });
    expect((await hostGets).type).toBe("relay");

    expect(relay.roomCount()).toBe(1);

    // ホスト切断 → hostLeft & ルーム消滅
    const guestHostLeft = next(guest, (m) => m.type === "hostLeft");
    host.close();
    expect((await guestHostLeft).type).toBe("hostLeft");
    await new Promise((r) => setTimeout(r, 50));
    expect(relay.roomCount()).toBe(0);
    guest.close();
  });

  it("存在しないコードはエラー、非ホスト切断は継続", async () => {
    const a = await connect();
    send(a, { type: "join", code: "ZZZZZZ", name: "x" });
    expect((await next(a)).type).toBe("error");

    send(a, { type: "create", name: "A" });
    const created = await next(a);
    if (created.type !== "created") throw new Error();
    const b = await connect();
    const aSees = next(a, (m) => m.type === "members");
    send(b, { type: "join", code: created.code, name: "B" });
    await next(b);
    await aSees;
    const aSeesLeave = next(a, (m) => m.type === "members");
    b.close();
    const m = await aSeesLeave;
    expect(m.type === "members" && m.members.length).toBe(1);
    expect(relay.roomCount()).toBe(1);
    a.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(relay.roomCount()).toBe(0);
  });
});
