import Phaser from "phaser";
import { BALANCE } from "@pvp/shared";
import { saveTouchPref, session } from "../session";
import { button, FONT, label, panel, title } from "../ui";
import { BUILD_ID } from "../build";
import { applyView, VIEW } from "../viewport";

export class TitleScene extends Phaser.Scene {
  private code = "";
  private codeText!: Phaser.GameObjects.Text;

  constructor() {
    super("title");
  }

  create(): void {
    // 裁定56: フィールドを画面中央に置く（余白は左右へ均等）
    applyView(this);
    const { width: W, height: H } = BALANCE.field;
    const msg = (this.registry.get("message") as string | undefined) ?? "";
    this.registry.set("message", "");
    this.code = "";

    title(this, W / 2, 96, "ドパガキアリーナ", 68);
    label(this, W / 2, 150, "DOPAGAKI ARENA", 18, "#94a3b8");
    const status = label(this, W / 2, 610, msg, 18, "#f87171");

    // ---- 左パネル: フレンド対戦 ----
    panel(this, 215, 385, 390, 350, "フレンド対戦");

    button(this, 215, 300, "ルームを作る", () =>
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
    box.fillRoundedRect(215 - boxW / 2, 390 - 28, boxW, 56, 10);
    box.strokeRoundedRect(215 - boxW / 2, 390 - 28, boxW, 56, 10);
    this.codeText = this.add
      .text(215, 390, "", { fontFamily: "monospace", fontSize: "28px", color: "#e5e7eb" })
      .setOrigin(0.5)
      .setLetterSpacing(8);
    this.drawCode();
    label(this, 215, 432, "キー入力でコードを打てます", 13, "#64748b");

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

    button(this, 215, 480, "コードで参加", join);

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

    // ---- 中央パネル: 弾幕モード（裁定64・裁定65で独立） ----
    panel(this, 640, 385, 390, 350, "弾幕モード");
    // 砲台とリング弾のイメージ
    const art = this.add.graphics();
    art.fillStyle(0xef4444, 0.85).fillCircle(640, 320, 22);
    art.lineStyle(2, 0xfca5a5, 1).strokeCircle(640, 320, 22);
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12;
      art.fillStyle(0xa5f3fc, 0.9).fillCircle(640 + Math.cos(a) * 58, 320 + Math.sin(a) * 58, 5);
    }
    art.fillStyle(0x22e5ff, 1).fillCircle(700, 372, 9);
    art.fillStyle(0xffffff, 1).fillCircle(700, 372, 3);
    label(this, 640, 405, "スピード限定・ひとり用", 15, "#e5e7eb");
    label(this, 640, 428, "中央の砲台の弾幕を避けながら削る", 13, "#94a3b8");
    label(this, 640, 448, `残機${BALANCE.danmaku.playerLives}・制限時間${Math.round(BALANCE.danmaku.seconds / 60)}分・剣で弾を消せる`, 13, "#94a3b8");
    button(this, 640, 500, "挑戦する", () => {
      session.mode = "solo";
      session.players = [
        { id: "me", name: session.name, cls: "speed", team: 0 },
        { id: "turret", name: "砲台", cls: "heavy", team: 1 },
      ];
      session.matchMode = "danmaku";
      session.bots = [];
      this.scene.start("game");
    }, 300, 52);

    // ---- 右パネル: トレーニング ----
    panel(this, 1065, 385, 390, 350, "トレーニング");

    const CLASS_NAME = { speed: "スピード", heavy: "タンク", support: "サポート" } as const;
    const order = ["speed", "heavy", "support"] as const;
    const clsBtn = button(this, 1065, 300, `キャラ: ${CLASS_NAME[session.myCls]}`, () => {
      const i = order.indexOf(session.myCls);
      session.myCls = order[(i + 1) % order.length]!;
      clsBtn.setText(`キャラ: ${CLASS_NAME[session.myCls]}`);
    });
    const foeNames = ["的", "bot Lv1", "bot Lv2", "bot Lv3"];
    const foeBtn = button(this, 1065, 390, `相手: ${foeNames[session.practiceFoe]}`, () => {
      session.practiceFoe = (session.practiceFoe + 1) % 4;
      foeBtn.setText(`相手: ${foeNames[session.practiceFoe]}`);
    });
    button(this, 1065, 480, "練習開始", () => {
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
    label(this, 1065, 528, "キャラクター解説", 14, "#7dd3fc");
    const CLASS_COLOR = { speed: 0x22d3ee, heavy: 0xfb923c, support: 0xa3e635 } as const;
    order.forEach((c, i) => {
      const ix = 1065 + (i - 1) * 96;
      const g = this.add.graphics();
      g.fillStyle(CLASS_COLOR[c], 0.75).fillCircle(ix, 570, 30);
      g.lineStyle(2, CLASS_COLOR[c], 1).strokeCircle(ix, 570, 30);
      this.add
        .text(ix, 570, CLASS_NAME[c], { fontFamily: FONT, fontSize: "12px", color: "#0a1420", fontStyle: "bold" })
        .setOrigin(0.5);
      this.add
        .zone(ix, 570, 64, 64)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.scene.start("character", { cls: c }));
    });

    button(this, W - 130, 40, "キー設定", () => this.scene.start("settings"), 200, 44);
    // 裁定40: 操作方式の切替（タッチ端末なら初期値がタッチ）
    const ctlBtn = button(this, W - 350, 40, `操作: ${session.touch ? "タッチ" : "キーボード"}`, () => {
      session.touch = !session.touch;
      saveTouchPref(session.touch);
      ctlBtn.setText(`操作: ${session.touch ? "タッチ" : "キーボード"}`);
    }, 210, 44);
    label(this, W / 2, H - 22, "WASD 移動 / マウス 照準 / 左クリック 主武器 / 右クリック 副武器 / スペース 防御 / E・R・F スキル / ESC メニュー", 15, "#64748b");
    // ビルド印（裁定50）: 古いzipを上げてしまった事故に気づくための版表示
    this.add
      .text(W - 12, H - 10, BUILD_ID, { fontFamily: "monospace", fontSize: "12px", color: "#334155" })
      .setOrigin(1, 1);
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
