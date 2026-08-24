import Phaser from "phaser";
import { BALANCE } from "@pvp/shared";
import { BIND_LABEL, DEFAULT_BINDS, loadBinds, saveBinds, type BindAction } from "../keybinds";
import { getVolumes, setVolume, SFX } from "../sound";
import { button, label, title } from "../ui";

const ORDER: BindAction[] = ["up", "down", "left", "right", "guard", "switchWeapon", "skill1", "skill2", "skill3"];

export class SettingsScene extends Phaser.Scene {
  private binds = loadBinds();
  private rows = new Map<BindAction, Phaser.GameObjects.Text>();
  private waiting: BindAction | null = null;
  private hint!: Phaser.GameObjects.Text;

  constructor() {
    super("settings");
  }

  create(): void {
    const { width: W, height: H } = BALANCE.field;
    this.binds = loadBinds();
    this.waiting = null;
    this.rows.clear();

    title(this, W / 2, H * 0.1, "キー設定", 44);
    this.hint = label(this, W / 2, H * 0.19, "変更したい行をクリック → 割り当てたいキーを押す（マウス操作は固定）", 16, "#94a3b8");

    // 音量（BGM / SE）
    const vol = getVolumes();
    const volRow = (yr: number, name: string, ch: "sfx" | "bgm", init: number) => {
      let v = Math.round(init * 10) * 10;
      label(this, W * 0.72, yr, name, 20).setOrigin(1, 0.5);
      const value = this.add
        .text(W * 0.8, yr, `${v}%`, { fontFamily: "monospace", fontSize: "22px", color: "#fef08a" })
        .setOrigin(0.5);
      const mk = (dx: number, txt: string, delta: number) => {
        const b = this.add
          .text(W * 0.8 + dx, yr, txt, { fontFamily: "monospace", fontSize: "26px", color: "#67e8f9" })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        b.on("pointerdown", () => {
          v = Math.min(100, Math.max(0, v + delta));
          setVolume(ch, v / 100);
          value.setText(`${v}%`);
          if (ch === "sfx") SFX.hit(0); // 試し鳴らし
        });
      };
      mk(-90, "◀", -10);
      mk(90, "▶", 10);
    };
    volRow(H * 0.3, "BGM音量", "bgm", vol.bgm);
    volRow(H * 0.39, "SE音量", "sfx", vol.sfx);

    ORDER.forEach((action, i) => {
      const y = H * (0.28 + i * 0.062);
      label(this, W * 0.28, y, BIND_LABEL[action], 20).setOrigin(1, 0.5);
      const t = this.add
        .text(W * 0.32, y, this.binds[action], { fontFamily: "monospace", fontSize: "22px", color: "#fef08a" })
        .setOrigin(0, 0.5)
        .setInteractive({ useHandCursor: true });
      t.on("pointerdown", () => {
        this.waiting = action;
        this.refresh();
      });
      this.rows.set(action, t);
    });

    button(this, W / 2 - 180, H * 0.92, "初期設定に戻す", () => {
      this.binds = { ...DEFAULT_BINDS };
      saveBinds(this.binds);
      this.waiting = null;
      this.refresh();
    });
    button(this, W / 2 + 180, H * 0.92, "保存して戻る", () => {
      saveBinds(this.binds);
      this.scene.start("title");
    });

    this.input.keyboard!.on("keydown", (ev: KeyboardEvent) => {
      if (!this.waiting) return;
      ev.preventDefault();
      const name = ev.code === "Space" ? "SPACE" : ev.key.length === 1 ? ev.key.toUpperCase() : ev.key.toUpperCase();
      // 重複していたら入れ替え
      for (const a of ORDER) {
        if (a !== this.waiting && this.binds[a] === name) this.binds[a] = this.binds[this.waiting];
      }
      this.binds[this.waiting] = name;
      saveBinds(this.binds);
      this.waiting = null;
      this.refresh();
    });
    this.refresh();
  }

  private refresh(): void {
    for (const [action, t] of this.rows) {
      const active = this.waiting === action;
      t.setText(active ? "キーを押してください…" : this.binds[action]);
      t.setColor(active ? "#67e8f9" : "#fef08a");
    }
    this.hint.setColor(this.waiting ? "#67e8f9" : "#94a3b8");
  }
}
