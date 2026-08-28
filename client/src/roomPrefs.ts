import type { CharClass, LobbyBot, MatchMode } from "@pvp/shared";

/**
 * ルーム設定の保存（裁定57）。
 * ルームを作り直すたびにbotを並べ直すのが手間なので、前回の構成をブラウザに覚えさせる。
 *
 * 保存するのは「ホストが組んだ卓の形」だけ。ルームコードや参加者は毎回変わるので保存しない。
 * 読み込んだ値は必ず検証してから使う（古い版の保存が残っていても壊れないようにするため）。
 */

const KEY_V1 = "dopagaki.room.v1";
const KEY = "dopagaki.room.v2";
export const PRESET_COUNT = 3;
const CLASSES: CharClass[] = ["speed", "heavy", "support"];
const MODES: MatchMode[] = ["ffa", "teams", "boss"];

export interface RoomPrefs {
  bots: LobbyBot[];
  mode: MatchMode;
  rot: number;
  /** 自分が選んでいたキャラ */
  cls: CharClass;
}

function validBot(v: unknown, i: number): LobbyBot | null {
  if (typeof v !== "object" || v === null) return null;
  const b = v as Partial<LobbyBot>;
  const level = b.level === 1 || b.level === 2 || b.level === 3 ? b.level : 2;
  const cls = CLASSES.includes(b.cls as CharClass) ? (b.cls as CharClass) : "speed";
  // id と name は毎回この形で作り直す（保存された値を信用して重複IDを作らない）
  return { id: `bot-${i + 1}`, name: `CPU${i + 1}`, cls, level };
}

function parsePrefs(raw: string | null): RoomPrefs | null {
  try {
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<RoomPrefs>;
    const bots = Array.isArray(o.bots)
      ? o.bots.slice(0, 5).map(validBot).filter((b): b is LobbyBot => b !== null)
      : [];
    return {
      bots,
      mode: MODES.includes(o.mode as MatchMode) ? (o.mode as MatchMode) : "ffa",
      rot: typeof o.rot === "number" && Number.isFinite(o.rot) ? Math.max(0, Math.floor(o.rot)) : 0,
      cls: CLASSES.includes(o.cls as CharClass) ? (o.cls as CharClass) : "speed",
    };
  } catch {
    // 壊れた保存やプライベートモードでの読み取り失敗。既定に戻すだけでよい
    return null;
  }
}

/**
 * プリセット3枠（裁定60）。
 * slot = いま使っている枠。slots = 各枠の中身（未使用は null）。
 */
export interface PresetStore {
  slot: number;
  slots: (RoomPrefs | null)[];
}

export function loadPresets(): PresetStore {
  const empty: PresetStore = { slot: 0, slots: [null, null, null] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // 裁定57で作った単一保存が残っていたら、1枠目として引き継ぐ
      const old = parsePrefs(localStorage.getItem(KEY_V1));
      return old ? { slot: 0, slots: [old, null, null] } : empty;
    }
    const o = JSON.parse(raw) as { slot?: unknown; slots?: unknown };
    const slots: (RoomPrefs | null)[] = [];
    for (let i = 0; i < PRESET_COUNT; i++) {
      const v = Array.isArray(o.slots) ? o.slots[i] : null;
      slots.push(v ? parsePrefs(JSON.stringify(v)) : null);
    }
    const slot = typeof o.slot === "number" && o.slot >= 0 && o.slot < PRESET_COUNT ? Math.floor(o.slot) : 0;
    return { slot, slots };
  } catch {
    return empty;
  }
}

export function savePresets(store: PresetStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 容量超過やプライベートモード。保存できなくても遊べるので黙って諦める
  }
}
