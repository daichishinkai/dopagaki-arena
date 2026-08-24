import Phaser from "phaser";
import { COLORS } from "./session";

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans JP', sans-serif";

export function title(scene: Phaser.Scene, x: number, y: number, text: string, size = 48): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color: "#67e8f9", fontStyle: "bold" })
    .setOrigin(0.5)
    .setShadow(0, 0, "#22d3ee", 18, true, true);
}

export function label(scene: Phaser.Scene, x: number, y: number, text: string, size = 20, color = COLORS.text): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color }).setOrigin(0.5);
}

export interface Button {
  container: Phaser.GameObjects.Container;
  setEnabled(v: boolean): void;
  setText(t: string): void;
}

export function button(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, w = 320, h = 56): Button {
  const g = scene.add.graphics();
  const draw = (hover: boolean, enabled: boolean) => {
    g.clear();
    g.lineStyle(2, enabled ? (hover ? 0x67e8f9 : 0x22d3ee) : 0x334155, 1);
    g.fillStyle(enabled ? (hover ? 0x0e2a3a : 0x0b1a26) : 0x0b0f17, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
  };
  const t = scene.add.text(0, 0, text, { fontFamily: FONT, fontSize: "22px", color: COLORS.text }).setOrigin(0.5);
  const c = scene.add.container(x, y, [g, t]);
  let enabled = true;
  draw(false, enabled);
  c.setSize(w, h).setInteractive({ useHandCursor: true });
  c.on("pointerover", () => draw(true, enabled));
  c.on("pointerout", () => draw(false, enabled));
  c.on("pointerdown", () => {
    if (enabled) onClick();
  });
  return {
    container: c,
    setEnabled(v: boolean) {
      enabled = v;
      t.setAlpha(v ? 1 : 0.4);
      draw(false, enabled);
    },
    setText(s: string) {
      t.setText(s);
    },
  };
}

/** セクション枠（角丸パネル＋見出し）。x,y は中心座標 */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, heading: string): void {
  const g = scene.add.graphics();
  g.lineStyle(1, 0x1e3a4d, 1).fillStyle(0x0a1420, 0.6);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 14);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 14);
  scene.add
    .text(x, y - h / 2 + 28, heading, { fontFamily: FONT, fontSize: "20px", color: "#7dd3fc", fontStyle: "bold" })
    .setOrigin(0.5);
}
