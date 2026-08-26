import Phaser from "phaser";
import { BALANCE, type CharClass, type LobbyBot, type MatchMode, type PlayerId, type RoomMember } from "@pvp/shared";
import type { GameMessage } from "@pvp/shared";
import { session } from "../session";
import { button, label, title } from "../ui";

const CLASS_NAME: Record<CharClass, string> = { speed: "スピード", heavy: "タンク", support: "サポート" };
const CLASS_ORDER: CharClass[] = ["speed", "heavy", "support"];

export class LobbyScene extends Phaser.Scene {
  private offs: Array<() => void> = [];
  /** 裁定48: 参加者一覧は行ごとに分けて、bot行はタッチで選べるようにする */
  private rows: Phaser.GameObjects.Text[] = [];
  private rowsTop = 0;
  private startBtn!: ReturnType<typeof button>;
  private modeBtn!: ReturnType<typeof button>;
  private botBtns: ReturnType<typeof button>[] = [];
  private botLevelBtn?: ReturnType<typeof button>;
  private botClsBtn?: ReturnType<typeof button>;
  private botHintLabel?: Phaser.GameObjects.Text;
  private clsBtns = new Map<CharClass, ReturnType<typeof button>>();
  private picks = new Map<PlayerId, CharClass>();
  private bots: LobbyBot[] = [];
  private mode: MatchMode = "ffa";
  private rot = 0;
  /** 裁定44: Lv/キャラを編集する対象のbot（bots配列の添字） */
  private botSel = 0;

  constructor() {
    super("lobby");
  }

  create(): void {
    const { width: W, height: H } = BALANCE.field;
    const net = session.net;
    this.picks.clear();
    this.bots = [];
    this.botSel = 0;
    for (const r of this.rows) r.destroy();
    this.rows = [];
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
    this.rowsTop = H * 0.525;
    this.rows = [];

    // ホスト操作: bot・モード
    if (net.isHost) {
      // 上段: bot の増減とモード
      this.botBtns.push(button(this, W * 0.16, H * 0.72, "bot追加", () => this.addBot(), 250, 52));
      this.botBtns.push(button(this, W * 0.42, H * 0.72, "bot削除", () => this.removeBot(), 250, 52));
      this.botBtns.push(button(this, W * 0.68, H * 0.72, "チーム分け入替", () => this.rotate(), 250, 52));
      this.modeBtn = button(this, W * 0.9, H * 0.72, "モード", () => this.toggleMode(), 200, 52);
      // 裁定44: 下段は「対象のbotを選ぶ → Lv とキャラを個別に切り替える」
      // 裁定48: 対象は一覧の名前を押して選ぶ。ボタンは Lv とキャラだけ
      this.botHintLabel = label(this, W * 0.19, H * 0.815, "", 17, "#64748b");
      this.botLevelBtn = button(this, W * 0.46, H * 0.815, "Lv: -", () => this.cycleBotLevel(), 150, 52);
      this.botClsBtn = button(this, W * 0.68, H * 0.815, "キャラ: -", () => this.cycleBotClass(), 250, 52);
      this.botBtns.push(this.botLevelBtn, this.botClsBtn);
    }

    this.startBtn = button(this, W / 2 - 170, H * 0.915, "開始", () => this.start(), 300, 54);
    button(this, W / 2 + 170, H * 0.915, "退出", () => {
      net.disconnect();
      this.scene.start("title");
    }, 300, 54);
    label(this, W / 2, H * 0.985, "2人=1vs1 / 3〜4人=乱闘 / 4人=2vs2 / 6人=3v3（前半チーム vs 後半チーム）", 13, "#475569");

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
    this.botSel = this.bots.length - 1; // 追加したbotをそのまま編集できる
    this.broadcastLobby();
  }

  private removeBot(): void {
    this.bots.pop();
    if (this.botSel >= this.bots.length) this.botSel = Math.max(0, this.bots.length - 1);
    const n = this.roster().length;
    if (this.mode === "teams" && n !== 4 && n !== 6) this.mode = "ffa";
    if (this.mode === "boss" && !this.bossPossible()) this.mode = "ffa"; // 裁定49
    this.broadcastLobby();
  }

  /** 裁定44: 選択中のbotのLvを 1→2→3→1 と回す */
  private cycleBotLevel(): void {
    const b = this.selectedBot();
    if (!b) return;
    b.level = ((b.level % 3) + 1) as LobbyBot["level"];
    this.broadcastLobby();
  }

  /** 裁定44: 選択中のbotのキャラを次へ */
  private cycleBotClass(): void {
    const b = this.selectedBot();
    if (!b) return;
    b.cls = CLASS_ORDER[(CLASS_ORDER.indexOf(b.cls) + 1) % 3]!;
    this.broadcastLobby();
  }

  private selectedBot(): LobbyBot | undefined {
    if (this.bots.length === 0) return undefined;
    if (this.botSel >= this.bots.length) this.botSel = this.bots.length - 1;
    return this.bots[this.botSel];
  }

  private rotate(): void {
    this.rot += 1;
    this.broadcastLobby();
  }

  private toggleMode(): void {
    const n = this.roster().length;
    if (n !== 4 && n !== 6) return;
    if (n === 6) this.mode = "teams"; // 6人は3v3のみ（乱闘は3〜4人まで）
    // 裁定49: 4人のときは 乱闘 → 2vs2 → ボス戦 の順に回す。
    // ボス戦は「最後の1人がボス」なので、ボスはbotである必要がある
    else if (this.mode === "ffa") this.mode = "teams";
    else if (this.mode === "teams" && this.bossPossible()) this.mode = "boss";
    else this.mode = "ffa";
    this.broadcastLobby();
  }

  /** 裁定49: ボス戦にできるか（4人ちょうどで、一覧の最後がbot） */
  private bossPossible(): boolean {
    const roster = this.roster();
    if (roster.length !== 4) return false;
    const last = roster[roster.length - 1];
    return !!last && this.bots.some((b) => b.id === last.id);
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
    if (roster.length === 6) this.mode = "teams";
    if (this.mode === "boss" && !this.bossPossible()) this.mode = "ffa";
    const boss = this.mode === "boss";
    const teams = boss || (this.mode === "teams" && (roster.length === 4 || roster.length === 6));
    const half = Math.ceil(roster.length / 2);
    // 裁定48: 行ごとにテキストを作り直す。bot行はホストなら押して編集対象にできる
    for (const r of this.rows) r.destroy();
    this.rows = [];
    const W = BALANCE.field.width;
    const LINE = 30;
    roster.forEach((m, i) => {
      const bot = this.bots.find((b) => b.id === m.id);
      const tag = bot ? `〈${CLASS_NAME[m.cls]}・Lv${bot.level}〉` : `〈${this.picks.has(m.id) ? CLASS_NAME[m.cls] : "選択中…"}〉`;
      const selected = !!bot && bot.id === this.selectedBot()?.id;
      const editable = session.net.isHost && !!bot;
      const mark = editable ? (selected ? "▶ " : "・") : "";
      const team = teams ? ((boss ? i < roster.length - 1 : i < half) ? "🟦 " : "🟥 ") : "";
      const host = session.net.members[0]?.id === m.id && m.human ? "👑 " : "";
      const text = `${mark}${team}${host}${m.name} ${tag}${m.id === session.net.you ? "（あなた）" : ""}`;
      const color = editable ? (selected ? "#67e8f9" : "#cbd5e1") : "#e5e7eb";
      const t = label(this, W / 2, this.rowsTop + i * LINE, text, 21, color);
      if (editable && bot) {
        // タッチ・クリックの当たり判定は行の高さぶん確保する（指で押しやすいように）
        t.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(-20, -4, t.width + 40, LINE), hitAreaCallback: Phaser.Geom.Rectangle.Contains });
        t.on("pointerover", () => t.setColor("#a5f3fc"));
        t.on("pointerout", () => t.setColor(bot.id === this.selectedBot()?.id ? "#67e8f9" : "#cbd5e1"));
        t.on("pointerdown", () => {
          this.botSel = this.bots.findIndex((b) => b.id === bot.id);
          this.refresh();
        });
      }
      this.rows.push(t);
    });
    // 裁定44: bot編集ボタンの表示を選択中のbotに合わせる
    const sel = this.selectedBot();
    this.botHintLabel?.setText(sel ? `編集中: ${sel.name}（名前を押して変更）` : "bot を追加してください");
    this.botLevelBtn?.setText(sel ? `Lv: ${sel.level}` : "Lv: -");
    this.botClsBtn?.setText(sel ? `キャラ: ${CLASS_NAME[sel.cls]}` : "キャラ: -");
    this.botLevelBtn?.setEnabled(!!sel);
    this.botClsBtn?.setEnabled(!!sel);

    const n = roster.length;
    const canStart = session.net.isHost && (n === 2 || n === 3 || n === 4 || n === 6);
    this.startBtn.setEnabled(canStart);
    const modeName =
      this.mode === "boss"
        ? "ボス戦 3vs強敵"
        : n <= 2
          ? "1vs1"
          : this.mode === "teams" && n === 6
            ? "3v3"
            : this.mode === "teams" && n === 4
              ? "2vs2"
              : `乱闘 ${n}人`;
    this.startBtn.setText(
      session.net.isHost ? (n < 2 ? "相手を待っています…" : n === 5 ? "5人は不可（botで6人に）" : `開始（${modeName}）`) : "ホストの開始待ち",
    );
    if (this.modeBtn) {
      this.modeBtn.setEnabled(session.net.isHost && n === 4);
      this.modeBtn.setText(
        `モード: ${n === 6 ? "3v3" : this.mode === "boss" ? "ボス戦" : this.mode === "teams" ? "2vs2" : "乱闘"}`,
      );
    }
  }

  private start(): void {
    const roster = this.roster();
    const n = roster.length;
    if (n === 5) return;
    const mode: MatchMode =
      this.mode === "boss" && this.bossPossible()
        ? "boss"
        : this.mode === "teams" && (n === 4 || n === 6)
          ? "teams"
          : "ffa";
    const half = Math.ceil(n / 2);
    const players = roster.map((m, i) => ({
      id: m.id,
      name: m.name,
      cls: m.cls,
      // 裁定49: ボス戦は最後の1人（bot）だけがチーム1
      team: mode === "boss" ? (i === n - 1 ? 1 : 0) : mode === "teams" ? (i < half ? 0 : 1) : i,
    }));
    session.players = players;
    session.matchMode = mode;
    session.bots = this.bots;
    session.net.sendGame({ type: "start", players, mode, bots: this.bots });
    this.scene.start("game");
  }
}
