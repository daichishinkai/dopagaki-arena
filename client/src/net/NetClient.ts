import type { ClientToRelay, GameMessage, PlayerId, RelayToClient, RoomMember } from "@pvp/shared";

type Handler<T> = (v: T) => void;

/** 中継サーバーとのWebSocket。ゲームロジックは持たない */
export class NetClient {
  private ws: WebSocket | null = null;
  you: PlayerId = "";
  code = "";
  members: RoomMember[] = [];
  private listeners = new Map<string, Set<Handler<unknown>>>();

  get isHost(): boolean {
    return this.members.some((m) => m.id === this.you && m.host);
  }
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url: string): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("中継サーバーに接続できません"));
      ws.onclose = () => {
        this.ws = null;
        this.emit("closed", undefined);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as RelayToClient;
        if (msg.type === "created" || msg.type === "joined") {
          this.you = msg.you;
          this.code = msg.code;
          this.members = msg.members;
        } else if (msg.type === "members") {
          this.members = msg.members;
        } else if (msg.type === "hostLeft") {
          this.members = [];
          this.code = "";
        }
        this.emit(msg.type, msg);
        if (msg.type === "relay") this.emit(`game:${msg.payload.type}`, { from: msg.from, payload: msg.payload });
      };
    });
  }

  send(msg: ClientToRelay): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }
  sendGame(payload: GameMessage, to?: PlayerId): void {
    this.send(to ? { type: "relay", to, payload } : { type: "relay", payload });
  }
  on<T = unknown>(event: string, h: Handler<T>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(h as Handler<unknown>);
    return () => this.listeners.get(event)?.delete(h as Handler<unknown>);
  }
  private emit(event: string, v: unknown): void {
    this.listeners.get(event)?.forEach((h) => h(v));
  }
  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.members = [];
    this.code = "";
  }
}
