import Phaser from "phaser";
import { BALANCE } from "@pvp/shared";
import { session } from "../session";
import { button, label, textInput, title } from "../ui";

export class TitleScene extends Phaser.Scene {
  constructor() {
    super("title");
  }

  create(): void {
    const { width: W, height: H } = BALANCE.field;
    const msg = (this.registry.get("message") as string | undefined) ?? "";
    this.registry.set("message", "");

    title(this, W / 2, H * 0.22, "ドパガキアリーナ", 72);
    label(this, W / 2, H * 0.22 + 60, "DOPAGAKI ARENA — 3日目標ビルド", 18, "#94a3b8");
    const status = label(this, W / 2, H * 0.92, msg, 18, "#f87171");

    const input = textInput(this, W / 2, H * 0.62, "ルームコード", 6);

    const withNet = async (fn: () => void) => {
      status.setText("接続中…").setColor("#94a3b8");
      try {
        await session.net.connect(session.relayUrl);
        fn();
      } catch (e) {
        status.setText(`${(e as Error).message}（中継サーバー: ${session.relayUrl}）`).setColor("#f87171");
      }
    };

    button(this, W / 2, H * 0.42, "ルームを作る", () =>
      withNet(() => {
        session.mode = "online";
        const off = session.net.on("created", () => {
          off();
          this.scene.start("lobby");
        });
        session.net.send({ type: "create", name: session.name });
      }),
    );

    button(this, W / 2, H * 0.72, "コードで参加", () => {
      const code = String((input.node as HTMLInputElement).value || "").toUpperCase().trim();
      if (code.length !== 6) {
        status.setText("6桁のコードを入力してください").setColor("#f87171");
        return;
      }
      withNet(() => {
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
        session.net.send({ type: "join", code, name: session.name });
      });
    });

    const CLASS_NAME = { speed: "スピード型", heavy: "重量型", support: "支援型" } as const;
    const order = ["speed", "heavy", "support"] as const;
    const clsBtn = button(this, W / 2 - 270, H * 0.84, `練習キャラ: ${CLASS_NAME[session.myCls]}`, () => {
      const i = order.indexOf(session.myCls);
      session.myCls = order[(i + 1) % order.length]!;
      clsBtn.setText(`練習キャラ: ${CLASS_NAME[session.myCls]}`);
    });
    const foeNames = ["的", "bot Lv1", "bot Lv2", "bot Lv3"];
    const foeBtn = button(this, W / 2 - 20, H * 0.84, `相手: ${foeNames[session.practiceFoe]}`, () => {
      session.practiceFoe = (session.practiceFoe + 1) % 4;
      foeBtn.setText(`相手: ${foeNames[session.practiceFoe]}`);
    });
    button(this, W / 2 + 210, H * 0.84, "練習開始", () => {
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

    button(this, W * 0.9, H * 0.06, "キー設定", () => this.scene.start("settings"));
    label(this, W / 2, H * 0.985, "WASD 移動 / マウス 照準 / 左クリック 攻撃 / スペース 防御 / Q・右クリック 武器切替 / E・R・F スキル", 15, "#64748b");
  }
}
