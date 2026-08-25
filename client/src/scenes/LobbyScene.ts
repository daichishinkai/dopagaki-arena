import Phaser from "phaser";
import { BALANCE, type CharClass, type LobbyBot, type MatchMode, type PlayerId, type RoomMember } from "@pvp/shared";
import type { GameMessage } from "@pvp/shared";
import { session } from "../session";
import { button, label, title } from "../ui";

const CLASS_NAME: Record<CharClass, string> = { speed: "スピード", heavy: "タンク", support: "サポート" };
const CLASS_ORDER: CharClass[] = ["speed", "heavy", "support"];

export class LobbyScene extends Phaser.Scene {
  private offs: Array<() => void> = [];
  private list!: Phaser.GameObjects.Text;
  private startBtn!: ReturnType<typeof button>;
  private modeBtn!: ReturnType<typeof button>;
  private botBtns: ReturnType<typeof button>[] = [];
  private clsBtns = new Map<CharClass, ReturnType<typeof button>>();
  private picks = new Map<PlayerId, CharClass>();
  private bots: LobbyBot[] = [];
  private mode: MatchMode = "ffa";
  private rot = 0;

  constructor() {
    super("lobby");
  }

  create(): void {
    const { width: W, height: H } = BALANCE.field;
    const net = session.net;
    this.picks.clear();
    this.bots = [];
    this.mode = "ffa";
    this.rot = 0;
    this.botBtns = [];

    title(this, W / 2, H * 0.08, "ロビー", 40);
    const codeText = this.add
      .text(W / 2, H * 0.19, net.code, { fontFamily: "monospace", fontSize: "54px", color: "#fef08a", fontStyle: "bold" })
      .setOrigin(0.5)
      .setShadow(0, 0, "#facc15", 16, true, true)
      .setInteractive({ useHandCursor: true });
    const copied = label(this, W / 2, H * 0.265, "ルームコード（クリックでコピー）", 13, "#64748b");
    codeText.on("pointerdown", () => {
      void navigator.clipboard?.writeText(net.code).then(() => copied.setText("コピーしました"));
    });

    // キャラ選択（ミラー許可。SPEC 4章）
    label(this, W / 2, H * 0.33, "キャラ選択", 15, "#94a3b8");
    CLASS_ORDER.forEach((cls, i) => {
      const b = button(this, W / 2 + (i - 1) * 250, H * 0.4, CLASS_NAME[cls], () => this.pick(cls));
      this.clsBtns.set(cls, b);
    });

    label(this, W / 2, H * 0.48, "参加者", 15, "#94a3b8");
    this.list = label(this, W / 2, H * 0.585, "", 21);

    // ホスト操作: bot・モード
    if (net.isHost) {
      this.botBtns.push(button(this, W * 0.18, H * 0.76, "bot追加", () => this.addBot()));
      this.botBtns.push(button(this, W * 0.18, H * 0.86, "bot削除", () => this.removeBot()));
      this.modeBtn = button(this, W * 0.82, H * 0.76, "モード", () => this.toggleMode());
      this.botBtns.push(button(this, W * 0.5, H * 0.76, "チーム分け入替", () => this.rotate()));
      this.botBtns.push(button(this, W * 0.82, H * 0.86, "botのLv/キャラ", () => this.cycleBot()));
    }

    this.startBtn = button(this, W / 2 - 160, H * 0.88, "開始", () => this.start());
    button(this, W / 2 + 160, H * 0.88, "退出", () => {
      net.disconnect();
      this.scene.start("title");
    });
    label(this, W / 2, H * 0.965, "2人=1vs1 / 3〜4人=乱闘 / 4人=2vs2 / 6人=3v3（前半チーム vs 後半チーム）", 13, "#475569");

    this.pick(session.myCls, true);
    this.refresh();
    this.offs.push(net.on<{ members: RoomMember[] }>("members", () => this.refresh()));
    this.offs.push(net.on<{ members: RoomMember[] }>("joined", () => this.refresh()));
    this.offs.push(
      net.on<{ from: PlayerId; payload: GameMessage }>("game:pick", ({ from, payload }) => {
        if (payload.type !== "pick") return;
        this.picks.set(from, payload.cls);
        this.refresh();
      }),
    );
    this.offs.push(
      net.on<{ payload: GameMessage }>("game:lobby", ({ payload }) => {
        if (payload.type !== "lobby" || net.isHost) return;
        this.bots = payload.bots;
        this.mode = payload.mode;
        this.rot = payload.rot;
        this.refresh();
      }),
    );
    this.offs.push(
      net.on("hostLeft", () => {
        this.registry.set("message", "ホストが退出したためルームは解散しました");
        this.scene.start("title");
      }),
    );
    this.offs.push(
      net.on("closed", () => {
        this.registry.set("message", "中継サーバーとの接続が切れました");
        this.scene.start("title");
      }),
    );
    this.offs.push(
      net.on<{ payload: GameMessage }>("game:start", ({ payload }) => {
        if (payload.type !== "start") return;
        session.players = payload.players;
        session.matchMode = payload.mode;
        session.bots = payload.bots;
        this.scene.start("game");
      }),
    );
    this.events.once("shutdown", () => this.offs.forEach((f) => f()));
  }

  private roster(): { id: PlayerId; name: string; cls: CharClass; human: boolean }[] {
    const humans = session.net.members.map((m) => ({
      id: m.id,
      name: m.name,
      cls: this.picks.get(m.id) ?? ("speed" as CharClass),
      human: true,
    }));
    const bots = this.bots.map((b) => ({ id: b.id, name: b.name, cls: b.cls, human: false }));
    const all = [...humans, ...bots].slice(0, 6);
    // 並び順ローテーションでチーム分けを変える（前半 vs 後半）
    const r = all.length > 0 ? this.rot % all.length : 0;
    return [...all.slice(r), ...all.slice(0, r)];
  }

  private addBot(): void {
    if (this.roster().length >= 6) return;
    const n = this.bots.length + 1;
    this.bots.push({ id: `bot-${n}`, name: `CPU${n}`, cls: CLASS_ORDER[(n - 1) % 3]!, level: 2 });
    this.broadcastLobby();
  }

  private removeBot(): void {
    this.bots.pop();
    const n = this.roster().length;
    if (this.mode === "teams" && n !== 4 && n !== 6) this.mode = "ffa";
    this.broadcastLobby();
  }

  /** 最後のbotの Lv→キャラ を順に回す（Lv1→Lv2→Lv3→次キャラのLv1…） */
  private cycleBot(): void {
    const b = this.bots[this.bots.length - 1];
    if (!b) return;
    if (b.level < 3) b.level = (b.level + 1) as LobbyBot["level"];
    else {
      b.level = 1;
      b.cls = CLASS_ORDER[(CLASS_ORDER.indexOf(b.cls) + 1) % 3]!;
    }
    this.broadcastLobby();
  }

  private rotate(): void {
    this.rot += 1;
    this.broadcastLobby();
  }

  private toggleMode(): void {
    const n = this.roster().length;
    if (n !== 4 && n !== 6) return;
    if (n === 6) this.mode = "teams"; // 6人は3v3のみ（乱闘は3〜4人まで）
    else this.mode = this.mode === "ffa" ? "teams" : "ffa";
    this.broadcastLobby();
  }

  private broadcastLobby(): void {
    session.net.sendGame({ type: "lobby", bots: this.bots, mode: this.mode, rot: this.rot });
    this.refresh();
  }

  private pick(cls: CharClass, silent = false): void {
    session.myCls = cls;
    this.picks.set(session.net.you, cls);
    for (const [c, b] of this.clsBtns) b.setEnabled(c !== cls);
    if (!silent) session.net.sendGame({ type: "pick", cls });
    this.refresh();
  }

  private refresh(): void {
    const roster = this.roster();
    if (roster.length === 6) this.mode = "teams"; // 6人は自動で3v3
    const teams = this.mode === "teams" && (roster.length === 4 || roster.length === 6);
    const half = Math.ceil(roster.length / 2);
    this.list.setText(
      roster
        .map((m, i) => {
          const bot = this.bots.find((b) => b.id === m.id);
          const tag = bot ? `〈${CLASS_NAME[m.cls]}・Lv${bot.level}〉` : `〈${this.picks.has(m.id) ? CLASS_NAME[m.cls] : "選択中…"}〉`;
          const team = teams ? (i < half ? "🟦 " : "🟥 ") : "";
          const host = session.net.members[0]?.id === m.id && m.human ? "👑 " : "";
          return `${team}${host}${m.name} ${tag}${m.id === session.net.you ? "（あなた）" : ""}`;
        })
        .join("\n"),
    );
    const n = roster.length;
    const canStart = session.net.isHost && (n === 2 || n === 3 || n === 4 || n === 6);
    this.startBtn.setEnabled(canStart);
    const modeName =
      n <= 2 ? "1vs1" : this.mode === "teams" && n === 6 ? "3v3" : this.mode === "teams" && n === 4 ? "2vs2" : `乱闘 ${n}人`;
    this.startBtn.setText(
      session.net.isHost ? (n < 2 ? "相手を待っています…" : n === 5 ? "5人は不可（botで6人に）" : `開始（${modeName}）`) : "ホストの開始待ち",
    );
    if (this.modeBtn) {
      this.modeBtn.setEnabled(session.net.isHost && n === 4);
      this.modeBtn.setText(`モード: ${n === 6 ? "3v3" : this.mode === "teams" ? "2vs2" : "乱闘"}`);
    }
  }

  private start(): void {
    const roster = this.roster();
    const n = roster.length;
    if (n === 5) return;
    const mode: MatchMode = this.mode === "teams" && (n === 4 || n === 6) ? "teams" : "ffa";
    const half = Math.ceil(n / 2);
    const players = roster.map((m, i) => ({ id: m.id, name: m.name, cls: m.cls, team: mode === "teams" ? (i < half ? 0 : 1) : i }));
    session.players = players;
    session.matchMode = mode;
    session.bots = this.bots;
    session.net.sendGame({ type: "start", players, mode, bots: this.bots });
    this.scene.start("game");
  }
}
