import Phaser from "phaser";
import { BALANCE } from "@pvp/shared";
import { session } from "../session";
import { button, FONT, label, panel, title } from "../ui";

export class TitleScene extends Phaser.Scene {
  private code = "";
  private codeText!: Phaser.GameObjects.Text;

  constructor() {
    super("title");
  }

  create(): void {
    const { width: W, height: H } = BALANCE.field;
    const msg = (this.registry.get("message") as string | undefined) ?? "";
    this.registry.set("message", "");
    this.code = "";

    title(this, W / 2, 96, "ドパガキアリーナ", 68);
    label(this, W / 2, 150, "DOPAGAKI ARENA", 18, "#94a3b8");
    const status = label(this, W / 2, 610, msg, 18, "#f87171");

    // ---- 左パネル: フレンド対戦 ----
    panel(this, 330, 385, 480, 350, "フレンド対戦");

    button(this, 330, 300, "ルームを作る", () =>
      this.withNet(status, () => {
        session.mode = "online";
        const off = session.net.on("created", () => {
          off();
          this.scene.start("lobby");
        });
        session.net.send({ type: "create", name: session.name });
      }),
    );

    // ルームコード入力（キャンバス内描画・常時入力受付）
    const boxW = 320;
    const box = this.add.graphics();
    box.lineStyle(2, 0x22d3ee, 1).fillStyle(0x0b1a26, 1);
    box.fillRoundedRect(330 - boxW / 2, 390 - 28, boxW, 56, 10);
    box.strokeRoundedRect(330 - boxW / 2, 390 - 28, boxW, 56, 10);
    this.codeText = this.add
      .text(330, 390, "", { fontFamily: "monospace", fontSize: "28px", color: "#e5e7eb" })
      .setOrigin(0.5)
      .setLetterSpacing(8);
    this.drawCode();
    label(this, 330, 432, "キー入力でコードを打てます", 13, "#64748b");

    const join = () => {
      if (this.code.length !== 6) {
        status.setText("6桁のコードを入力してください").setColor("#f87171");
        return;
      }
      this.withNet(status, () => {
        session.mode = "online";
        const offJ = session.net.on("joined", () => {
          offJ();
          offE();
          this.scene.start("lobby");
        });
        const offE = session.net.on<{ message: string }>("error", (m) => {
          offJ();
          offE();
          status.setText(m.message).setColor("#f87171");
        });
        session.net.send({ type: "join", code: this.code, name: session.name });
      });
    };

    button(this, 330, 480, "コードで参加", join);

    this.input.keyboard!.on("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Backspace") {
        this.code = this.code.slice(0, -1);
        this.drawCode();
      } else if (ev.key === "Enter") {
        join();
      } else if (/^[a-zA-Z0-9]$/.test(ev.key) && this.code.length < 6) {
        this.code += ev.key.toUpperCase();
        this.drawCode();
      }
    });

    // ---- 右パネル: トレーニング ----
    panel(this, 950, 385, 480, 350, "トレーニング");

    const CLASS_NAME = { speed: "スピード型", heavy: "重量型", support: "支援型" } as const;
    const order = ["speed", "heavy", "support"] as const;
    const clsBtn = button(this, 950, 300, `キャラ: ${CLASS_NAME[session.myCls]}`, () => {
      const i = order.indexOf(session.myCls);
      session.myCls = order[(i + 1) % order.length]!;
      clsBtn.setText(`キャラ: ${CLASS_NAME[session.myCls]}`);
    });
    const foeNames = ["的", "bot Lv1", "bot Lv2", "bot Lv3"];
    const foeBtn = button(this, 950, 390, `相手: ${foeNames[session.practiceFoe]}`, () => {
      session.practiceFoe = (session.practiceFoe + 1) % 4;
      foeBtn.setText(`相手: ${foeNames[session.practiceFoe]}`);
    });
    button(this, 950, 480, "練習開始", () => {
      session.mode = "solo";
      const foes = ["的", "bot Lv1", "bot Lv2", "bot Lv3"] as const;
      const foe = foes[session.practiceFoe]!;
      const botCls = (["speed", "heavy", "support"] as const)[Math.floor(Math.random() * 3)]!;
      session.players =
        foe === "的"
          ? [
              { id: "me", name: session.name, cls: session.myCls, team: 0 },
              { id: "dummy", name: "的", cls: "support", team: 1 },
            ]
          : [
              { id: "me", name: session.name, cls: session.myCls, team: 0 },
              { id: "bot-1", name: foe, cls: botCls, team: 1 },
            ];
      session.matchMode = "ffa";
      session.bots = foe === "的" ? [] : [{ id: "bot-1", name: foe, cls: botCls, level: (session.practiceFoe as 1 | 2 | 3) }];
      this.scene.start("game");
    });

    // キャラ説明: アイコンを押すと各キャラの説明画面へ
    label(this, 950, 528, "キャラクター解説", 14, "#7dd3fc");
    const CLASS_COLOR = { speed: 0x22d3ee, heavy: 0xfb923c, support: 0xa3e635 } as const;
    order.forEach((c, i) => {
      const ix = 950 + (i - 1) * 96;
      const g = this.add.graphics();
      g.fillStyle(CLASS_COLOR[c], 0.75).fillCircle(ix, 570, 24);
      g.lineStyle(2, CLASS_COLOR[c], 1).strokeCircle(ix, 570, 24);
      this.add
        .text(ix, 570, CLASS_NAME[c].slice(0, 2), { fontFamily: FONT, fontSize: "14px", color: "#0a1420", fontStyle: "bold" })
        .setOrigin(0.5);
      this.add
        .zone(ix, 570, 56, 56)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.scene.start("character", { cls: c }));
    });

    button(this, W - 130, 40, "キー設定", () => this.scene.start("settings"), 200, 44);
    label(this, W / 2, H - 22, "WASD 移動 / マウス 照準 / 左クリック 主武器 / 右クリック 副武器 / スペース 防御 / E・R・F スキル / ESC メニュー", 15, "#64748b");
  }

  private drawCode(): void {
    if (this.code.length === 0) {
      this.codeText.setText("ルームコード").setColor("#475569");
    } else {
      this.codeText.setText(this.code).setColor("#e5e7eb");
    }
  }

  private async withNet(status: Phaser.GameObjects.Text, fn: () => void): Promise<void> {
    status.setText("接続中…").setColor("#94a3b8");
    try {
      await session.net.connect(session.relayUrl);
      fn();
    } catch (e) {
      status.setText(`${(e as Error).message}（中継サーバー: ${session.relayUrl}）`).setColor("#f87171");
    }
  }
}
