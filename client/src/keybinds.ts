/** キー設定（localStorage保存）。マウス（照準・攻撃・武器切替の右クリック）は固定 */
export type BindAction = "up" | "down" | "left" | "right" | "guard" | "switchWeapon" | "skill1" | "skill2" | "skill3";

export const BIND_LABEL: Record<BindAction, string> = {
  up: "上移動",
  down: "下移動",
  left: "左移動",
  right: "右移動",
  guard: "防御",
  switchWeapon: "武器切替",
  skill1: "スキル1",
  skill2: "スキル2",
  skill3: "スキル3",
};

export const DEFAULT_BINDS: Record<BindAction, string> = {
  up: "W",
  down: "S",
  left: "A",
  right: "D",
  guard: "SPACE",
  switchWeapon: "Q",
  skill1: "E",
  skill2: "R",
  skill3: "F",
};

const KEY = "dopagaki-keybinds";

export function loadBinds(): Record<BindAction, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_BINDS };
    return { ...DEFAULT_BINDS, ...(JSON.parse(raw) as Partial<Record<BindAction, string>>) };
  } catch {
    return { ...DEFAULT_BINDS };
  }
}

export function saveBinds(binds: Record<BindAction, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(binds));
  } catch {
    // localStorage不可の環境では保存なしで続行
  }
}
