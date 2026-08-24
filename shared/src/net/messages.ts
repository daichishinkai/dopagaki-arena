import type { PlayerId, PlayerInput, SimEvent, SimState } from "../sim/types";
import type { CharClass } from "../balance";
import type { MatchMode } from "../sim/types";

export interface LobbyBot {
  id: PlayerId;
  name: string;
  cls: CharClass;
  level: 1 | 2 | 3;
}

/** ---- クライアント → 中継 ---- */
export type ClientToRelay =
  | { type: "create"; name: string }
  | { type: "join"; code: string; name: string }
  | { type: "relay"; to?: PlayerId; payload: GameMessage }; // to省略で全員へ

/** ---- 中継 → クライアント ---- */
export interface RoomMember {
  id: PlayerId;
  name: string;
  host: boolean;
}
export type RelayToClient =
  | { type: "created"; code: string; you: PlayerId; members: RoomMember[] }
  | { type: "joined"; code: string; you: PlayerId; members: RoomMember[] }
  | { type: "members"; members: RoomMember[] }
  | { type: "hostLeft" }
  | { type: "error"; message: string }
  | { type: "relay"; from: PlayerId; payload: GameMessage };

/** ---- ゲーム内メッセージ（中継は中身を見ない） ---- */
export type GameMessage =
  | { type: "start"; players: { id: PlayerId; name: string; cls: CharClass; team: number }[]; mode: MatchMode; bots: LobbyBot[] }
  | { type: "pick"; cls: CharClass }
  | { type: "lobby"; bots: LobbyBot[]; mode: MatchMode; rot: number }
  | { type: "input"; input: PlayerInput }
  | { type: "snapshot"; state: SimState; events: SimEvent[] }
  | { type: "rematch" };

export const MAX_ROOM_SIZE = 6;
export const ROOM_CODE_LENGTH = 6;
