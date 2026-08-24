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

/** DOMの入力欄（ルームコード用） */
export function textInput(scene: Phaser.Scene, x: number, y: number, placeholder: string, maxLength: number): Phaser.GameObjects.DOMElement {
  const el = document.createElement("input");
  el.type = "text";
  el.placeholder = placeholder;
  el.maxLength = maxLength;
  el.autocomplete = "off";
  el.style.cssText =
    "width:280px;padding:12px;font-size:24px;text-align:center;letter-spacing:6px;text-transform:uppercase;" +
    "background:#0b1a26;color:#e5e7eb;border:2px solid #22d3ee;border-radius:10px;outline:none;font-family:monospace;";
  return scene.add.dom(x, y, el);
}
