import type { CharClass, LobbyBot, MatchMode, MatchResult, PlayerId } from "@pvp/shared";
import { NetClient } from "./net/NetClient";

export type Mode = "solo" | "online";

const TOUCH_KEY = "dopagaki-touch";
/** 操作方式（裁定40）: 保存があればそれ、なければタッチ端末かどうかで自動判定 */
export function loadTouchPref(): boolean {
  try {
    const v = localStorage.getItem(TOUCH_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    // 読めなければ自動判定
  }
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const hasTouch = typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0;
  return Boolean(coarse && hasTouch);
}
export function saveTouchPref(v: boolean): void {
  try {
    localStorage.setItem(TOUCH_KEY, v ? "1" : "0");
  } catch {
    // 保存できなくても続行
  }
}

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
  lastStats: null as { linkCount: number; maxLinkDamage: number; elapsed: number; players: { id: PlayerId; name: string; team: number; kills: number; deaths: number; damageDealt: number }[] } | null,
  relayUrl: (import.meta.env.VITE_RELAY_URL as string | undefined) ?? "ws://localhost:8080",
  /** タッチ操作（裁定40）。タイトルで切替 */
  touch: loadTouchPref(),
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
