import Phaser from "phaser";
import { BALANCE, type CharClass, type LobbyBot, type MatchMode, type PlayerId, type RoomMember } from "@pvp/shared";
import type { GameMessage } from "@pvp/shared";
import { session } from "../session";
import { button, FONT, label, title } from "../ui";
import { applyView, VIEW } from "../viewport";

const CLASS_NAME: Record<CharClass, string> = { speed: "スピード", heavy: "タンク", support: "サポート" };

/**
 * 裁定54: 画面で選ぶモード。
 * 2vs2 と 3v3 はどちらも内部的には teams で、人数で決まる。
 * ボタンとしては別物なので、UI側だけこの4値で持つ（通信する MatchMode は従来どおり3値）。
 */
type ModeChoice = "ffa" | "duo" | "trio" | "boss";
const MODE_LABEL: Record<ModeChoice, string> = { ffa: "乱闘", boss: "ボス戦", duo: "2vs2", trio: "3v3" };
/** 表示順（ユーザー指定）。上から縦に並べる */
const MODE_ORDER: ModeChoice[] = ["ffa", "boss", "duo", "trio"];
/** 裁定55: カーソルを合わせたときに出す説明。人数条件は modeNeedText() が状況に応じて別に足す */
const MODE_DESC: Record<ModeChoice, string> = {
  ffa: "全員が敵。最後まで残った1人が勝ち。",
  boss: "3人でボス1体に挑む。ボスはHP10倍・体が大きく、扇状に弾を撒いてくる。挑戦者は残機を共有。",
  duo: "2人ずつの2チーム戦。一覧の前半が味方、後半が敵。中央エリアの取り合いがある。",
  trio: "3人ずつの2チーム戦。一覧の前半が味方、後半が敵。中央エリアの取り合いがある。",
};
/** そのモードに必要な合計人数 */
const MODE_SIZE: Record<ModeChoice, string> = { ffa: "2〜4人", boss: "4人ちょうど", duo: "4人ちょうど", trio: "6人ちょうど" };
const CLASS_ORDER: CharClass[] = ["speed", "heavy", "support"];

export class LobbyScene extends Phaser.Scene {
  private offs: Array<() => void> = [];
  /** 裁定48: 参加者一覧は行ごとに分けて、bot行はタッチで選べるようにする */
  private rows: Phaser.GameObjects.Text[] = [];
  private rowsTop = 0;
  private startBtn!: ReturnType<typeof button>;
  /** 裁定54: モードは縦4つのボタンから直接選ぶ（順ぐりのトグルは廃止） */
  private modeBtns = new Map<ModeChoice, ReturnType<typeof button>>();
  private modeHintLabel?: Phaser.GameObjects.Text;
  /** 裁定55: モードにカーソルを合わせたときの説明（背景つきの浮くパネル） */
  private tipBox?: Phaser.GameObjects.Container;
  private tipBg?: Phaser.GameObjects.Graphics;
  private tipText?: Phaser.GameObjects.Text;
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
    // 裁定56: フィールドを画面中央に置く（余白は左右へ均等）
    applyView(this);
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

    // 裁定54: モードは右側の縦4つから直接選ぶ。ホスト以外も「いま何が選ばれているか」が見える
    this.modeBtns.clear();
    label(this, W * 0.905, H * 0.315, "モード", 15, "#94a3b8");
    MODE_ORDER.forEach((choice, i) => {
      const y = H * 0.375 + i * 62;
      const b = button(this, W * 0.905, y, MODE_LABEL[choice], () => this.chooseMode(choice), 190, 52);
      // 裁定55: 説明は押せる／押せないに関係なく出す（押せない理由を読むためのものでもある）
      b.container.on("pointerover", () => this.showTip(choice, y));
      b.container.on("pointerout", () => this.hideTip());
      this.modeBtns.set(choice, b);
    });
    this.buildTip();
    // 押せないボタンの理由をここに出す（ボタン名を長くすると枠からはみ出すため）
    this.modeHintLabel = label(this, W * 0.905, H * 0.375 + 3 * 62 + 40, "", 12, "#64748b");

    // ホスト操作: bot・モード
    if (net.isHost) {
      // 上段: bot の増減とモード
      this.botBtns.push(button(this, W * 0.16, H * 0.72, "bot追加", () => this.addBot(), 250, 52));
      this.botBtns.push(button(this, W * 0.42, H * 0.72, "bot削除", () => this.removeBot(), 250, 52));
      this.botBtns.push(button(this, W * 0.68, H * 0.72, "チーム分け入替", () => this.rotate(), 250, 52));
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

  /** 裁定55: 説明パネルの箱を1つだけ作っておき、中身を差し替えて使い回す */
  private buildTip(): void {
    this.tipBg = this.add.graphics();
    this.tipText = this.add
      .text(0, 0, "", { fontFamily: FONT, fontSize: "15px", color: "#e5e7eb", wordWrap: { width: 300 }, lineSpacing: 4 })
      .setOrigin(0, 0);
    this.tipBox = this.add.container(0, 0, [this.tipBg, this.tipText]).setDepth(500).setVisible(false);
  }

  /** 説明をボタンの左側に出す。右側は画面外なので必ず左へ開く */
  private showTip(choice: ModeChoice, btnY: number): void {
    const { width: W } = BALANCE.field;
    if (!this.tipBox || !this.tipBg || !this.tipText) return;
    const pad = 12;
    this.tipText.setText(`【${MODE_LABEL[choice]}】\n${MODE_DESC[choice]}\n\n${this.modeNeedText(choice)}`);
    const w = this.tipText.width + pad * 2;
    const h = this.tipText.height + pad * 2;
    this.tipText.setPosition(pad, pad);
    this.tipBg.clear();
    this.tipBg.fillStyle(0x0b1a26, 0.97);
    this.tipBg.lineStyle(2, 0x22d3ee, 1);
    this.tipBg.fillRoundedRect(0, 0, w, h, 10);
    this.tipBg.strokeRoundedRect(0, 0, w, h, 10);
    // ボタンの左隣。上下は画面からはみ出さないように寄せる
    const x = W * 0.905 - 190 / 2 - 14 - w;
    const y = Math.max(8, Math.min(BALANCE.field.height - h - 8, btnY - h / 2));
    this.tipBox.setPosition(x, y).setVisible(true);
  }

  private hideTip(): void {
    this.tipBox?.setVisible(false);
  }

  /**
   * 裁定55: 「遊ぶには何人必要か」を今の顔ぶれから計算して文にする。
   * 人間は増やせないので、足りないぶんは bot を足す案内にする。
   */
  private modeNeedText(choice: ModeChoice): string {
    const roster = this.roster().length;
    const humans = session.net.members.length;
    const bots = this.bots.length;
    const now = `いま${roster}人（プレイヤー${humans}・bot${bots}）`;
    const cond = `条件: ${MODE_SIZE[choice]}`;

    if (choice === "ffa") {
      if (roster < 2) return `${cond}\n${now} → あと${2 - roster}人（botでも可）`;
      if (roster > 4) return `${cond}\n${now} → ${roster - 4}人減らす`;
      return `${cond}\n${now} → 遊べます`;
    }
    const need = choice === "trio" ? 6 : 4;
    const extra = choice === "boss" ? "\n一覧のいちばん下がbotであること" : "";
    if (roster < need) return `${cond}${extra}\n${now} → botをあと${need - roster}体追加`;
    if (roster > need) return `${cond}${extra}\n${now} → ${roster - need}人減らす`;
    if (choice === "boss" && !this.bossPossible()) {
      return `${cond}${extra}\n${now} → 人数は足りているが、いちばん下がプレイヤー。「チーム分け入替」で下をbotにする`;
    }
    return `${cond}${extra}\n${now} → 遊べます`;
  }

  /** 裁定54: ボタンで直接そのモードにする。選べない組み合わせは押せないので、ここへは来ない */
  private chooseMode(choice: ModeChoice): void {
    if (!session.net.isHost || !this.modeAvailable(choice)) return;
    this.mode = choice === "boss" ? "boss" : choice === "ffa" ? "ffa" : "teams";
    this.broadcastLobby();
  }

  /**
   * そのモードが今の人数で成立するか（裁定54）。
   * 2vs2 と 3v3 は内部的に同じ teams なので、人数だけが違い。
   */
  private modeAvailable(choice: ModeChoice): boolean {
    const n = this.roster().length;
    if (choice === "ffa") return n >= 2 && n <= 4;
    if (choice === "duo") return n === 4;
    if (choice === "trio") return n === 6;
    return this.bossPossible();
  }

  /** いま選ばれているモードを、画面の4択に翻訳する（裁定54） */
  private currentChoice(): ModeChoice {
    if (this.mode === "boss") return "boss";
    if (this.mode === "teams") return this.roster().length === 6 ? "trio" : "duo";
    return "ffa";
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
    // 裁定54: 人数が変わって今のモードが成立しなくなったら乱闘へ戻す
    if (!this.modeAvailable(this.currentChoice())) this.mode = "ffa";
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
    // 裁定54: 4つのボタンの「選択中」と「押せるか」を更新する。
    // ボス戦だけは理由が分かりにくいので、押せないときに条件を出す
    const choice = this.currentChoice();
    for (const [c, b] of this.modeBtns) {
      const ok = this.modeAvailable(c);
      b.setSelected(c === choice && ok);
      b.setEnabled(session.net.isHost && ok);
    }
    // 押せない理由を出す。ボス戦だけは条件が分かりにくいので優先して説明する
    const hint = !session.net.isHost
      ? "ホストが選びます"
      : !this.bossPossible() && n === 4
        ? "ボス戦は一覧の最後がbotのとき"
        : n === 4 || n === 6
          ? ""
          : "2vs2は4人・3v3は6人・ボス戦は4人";
    this.modeHintLabel?.setText(hint);
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
