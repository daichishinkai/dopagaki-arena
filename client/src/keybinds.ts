/** キー設定（localStorage保存）。マウスは固定（照準・左クリック=主武器・右クリック=副武器） */
export type BindAction = "up" | "down" | "left" | "right" | "guard" | "skill1" | "skill2" | "skill3";

export const BIND_LABEL: Record<BindAction, string> = {
  up: "上移動",
  down: "下移動",
  left: "左移動",
  right: "右移動",
  guard: "防御",
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
  skill1: "E",
  skill2: "R",
  skill3: "F",
};

/** マウスサイドボタン（第4=戻る / 第5=進む）。押下判定は pointer.buttons のビットマスクで行う */
export function isMouseBind(name: string): boolean {
  return name === "MOUSE4" || name === "MOUSE5";
}

export function mouseMaskOf(name: string): number {
  return name === "MOUSE4" ? 8 : 16;
}

export function bindDisplay(name: string): string {
  if (name === "MOUSE4") return "マウス4（戻る）";
  if (name === "MOUSE5") return "マウス5（進む）";
  return name;
}

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
