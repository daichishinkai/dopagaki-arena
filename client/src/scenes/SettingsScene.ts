import Phaser from "phaser";
import { BALANCE } from "@pvp/shared";
import { BIND_LABEL, DEFAULT_BINDS, bindDisplay, loadBinds, saveBinds, type BindAction } from "../keybinds";
import { getVolumes, setVolume, SFX } from "../sound";
import { button, label, title } from "../ui";

const ORDER: BindAction[] = ["up", "down", "left", "right", "guard", "skill1", "skill2", "skill3"];
const CAP_W = 260;
const CAP_H = 40;

export class SettingsScene extends Phaser.Scene {
  private binds = loadBinds();
  private rows = new Map<BindAction, { text: Phaser.GameObjects.Text; box: Phaser.GameObjects.Graphics; x: number; y: number }>();
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
    this.hint = label(this, W / 2, H * 0.19, "変更したい行をクリック → キーかマウスのサイドボタンを押す（左クリック=主武器 / 右クリック=副武器 は固定）", 16, "#94a3b8");

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
      const x = W * 0.32 + CAP_W / 2;
      const box = this.add.graphics();
      const t = this.add
        .text(x, y, "", { fontFamily: "monospace", fontSize: "20px", color: "#fef08a" })
        .setOrigin(0.5);
      const zone = this.add
        .zone(x, y, CAP_W, CAP_H)
        .setInteractive({ useHandCursor: true });
      zone.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
        if (ptr.button !== 0) return; // サイドボタン割り当て中の誤反応を防ぐ
        this.waiting = action;
        this.refresh();
      });
      this.rows.set(action, { text: t, box, x, y });
    });

    button(this, W / 2 - 180, H * 0.92, "初期設定に戻す", () => {
      this.binds = { ...DEFAULT_BINDS };
      saveBinds(this.binds);
      this.waiting = null;
      this.refresh();
    });
    button(this, W / 2 + 180, H * 0.92, "保存して戻る", () => {
      saveBinds(this.binds);
      const back = (this.registry.get("settingsReturn") as string | undefined) ?? "title";
      this.registry.set("settingsReturn", "title");
      this.scene.start(back);
    });

    this.input.keyboard!.on("keydown", (ev: KeyboardEvent) => {
      if (!this.waiting) return;
      ev.preventDefault();
      const name = ev.code === "Space" ? "SPACE" : ev.key.toUpperCase();
      this.assign(name);
    });

    // マウスサイドボタン（第4/第5）の割り当て
    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      if (!this.waiting) return;
      const btn = (ptr.event as MouseEvent).button;
      if (btn === 3) this.assign("MOUSE4");
      else if (btn === 4) this.assign("MOUSE5");
    });

    this.refresh();
  }

  private assign(name: string): void {
    if (!this.waiting) return;
    // 重複していたら入れ替え
    for (const a of ORDER) {
      if (a !== this.waiting && this.binds[a] === name) this.binds[a] = this.binds[this.waiting];
    }
    this.binds[this.waiting] = name;
    saveBinds(this.binds);
    this.waiting = null;
    this.refresh();
  }

  private refresh(): void {
    for (const [action, r] of this.rows) {
      const active = this.waiting === action;
      r.text.setText(active ? "入力待ち…" : bindDisplay(this.binds[action]));
      r.text.setColor(active ? "#67e8f9" : "#fef08a");
      r.box.clear();
      r.box.lineStyle(2, active ? 0x67e8f9 : 0x22d3ee, 1).fillStyle(active ? 0x0e2a3a : 0x0b1a26, 1);
      r.box.fillRoundedRect(r.x - CAP_W / 2, r.y - CAP_H / 2, CAP_W, CAP_H, 8);
      r.box.strokeRoundedRect(r.x - CAP_W / 2, r.y - CAP_H / 2, CAP_W, CAP_H, 8);
    }
    this.hint.setColor(this.waiting ? "#67e8f9" : "#94a3b8");
  }
}
