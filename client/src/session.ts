import type { CharClass, LobbyBot, MatchMode, MatchResult, PlayerId } from "@pvp/shared";
import { NetClient } from "./net/NetClient";

export type Mode = "solo" | "online";

/** シーンをまたいで共有する状態（描画やロジックは持たない） */
export const session = {
  net: new NetClient(),
  mode: "solo" as Mode,
  name: "Player",
  /** 試合参加者（ホストが決めて start で配る） */
  players: [] as { id: PlayerId; name: string; cls: CharClass; team: number }[],
  matchMode: "ffa" as MatchMode,
  bots: [] as LobbyBot[],
  /** 自分のキャラ選択（ロビー/練習で設定） */
  myCls: "speed" as CharClass,
  /** 練習相手: 0=的 / 1-3=bot Lv */
  practiceFoe: 0,
  lastResult: null as MatchResult | null,
  /** リザルト称号用の試合統計 */
  lastStats: null as { linkCount: number; maxLinkDamage: number; players: { id: PlayerId; name: string; team: number; kills: number; deaths: number; damageDealt: number }[] } | null,
  relayUrl: (import.meta.env.VITE_RELAY_URL as string | undefined) ?? "ws://localhost:8080",
};

export const COLORS = {
  bg: 0x07070f,
  grid: 0x141428,
  speed: 0x22e5ff, // 速=シアン系
  ally: 0x3b82f6, // 自チーム青
  enemy: 0xef4444, // 敵チーム赤
  bullet: 0xa5f3fc,
  hp: 0x4ade80,
  shield: 0x60a5fa,
  guard: 0xfbbf24,
  text: "#e5e7eb",
};
