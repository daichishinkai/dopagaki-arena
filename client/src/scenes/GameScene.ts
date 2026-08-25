import Phaser from "phaser";
import {
  BALANCE,
  type CharClass,
  moveSpeedOf,
  botInput,
  createBotMemory,
  createMatch,
  isAlive,
  NULL_INPUT,
  shieldMaxOf,
  step,
  WEAPONS,
  type BotMemory,
  type BulletState,
  type GameMessage,
  type PlayerId,
  type PlayerInput,
  type PlayerState,
  type SimEvent,
  type SimState,
} from "@pvp/shared";
import { bindShort, isMouseBind, loadBinds, mouseMaskOf, type BindAction } from "../keybinds";
import { COLORS, session } from "../session";
import { BGM, SFX } from "../sound";
import { button, FONT, label } from "../ui";

const F = BALANCE.field;
const P = BALANCE.player;
const DT = 1 / BALANCE.tickRate;
const SNAPSHOT_HZ = 20;
const INPUT_HZ = 60;
const INTERP_DELAY = 0.1;
const KILL_SLOWMO_SECONDS = 0.3;
const KILL_SLOWMO_SCALE = 0.3;

const CLASS_COLOR: Record<string, number> = { speed: COLORS.speed, heavy: 0xfb923c, support: 0xa3e635 };
const CLASS_LABEL: Record<CharClass, string> = { speed: "スピード", heavy: "タンク", support: "サポート" };
const WEAPON_LABEL: Record<string, string> = { saber: "刀", pistol: "ピストル", hmg: "HMG", knife: "ナイフ", sniper: "スナイパー", heal: "回復弾", jab: "素手" };
const SKILL_LABEL: Record<string, [string, string, string]> = {
  speed: ["ソニック 35", "クラウド 30", "チャージ"],
  heavy: ["スラム 60", "ビルドウォール 70", "かばう 50"],
  support: ["バレットプルーフ", "ポーション", "スタン弾"],
};

interface Snapshot { at: number; state: SimState }

/** キーボードキーまたはマウスボタン（ビットマスク）のどちらかで発火するバインド */
interface Bind { key?: Phaser.Input.Keyboard.Key; mask?: number }

export class GameScene extends Phaser.Scene {
  private isHost = false;
  private me: PlayerId = "";
  private state!: SimState;
  private inputs: Record<PlayerId, PlayerInput> = {};
  private accumulator = 0;
  private snapshotTimer = 0;
  private inputTimer = 0;
  private slowmo = 0;
  private snapshots: Snapshot[] = [];
  private offs: Array<() => void> = [];
  private ending = false;
  private pendingEvents: SimEvent[] = [];
  private botMems = new Map<PlayerId, BotMemory>();

  private gfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private skillHud!: Phaser.GameObjects.Text;
  private countText!: Phaser.GameObjects.Text;
  private ammoText!: Phaser.GameObjects.Text;
  private notice!: Phaser.GameObjects.Text;
  private names = new Map<PlayerId, Phaser.GameObjects.Text>();
  private keys!: Record<BindAction, Bind>;
  private mouseEdges: Partial<Record<BindAction, boolean>> = {};
  /** HUDに出すキー表示（キー設定を反映） */
  private bindNames = { guard: "SPACE", skill1: "E", skill2: "R", skill3: "F" };
  /** 押した瞬間を保持しておく入力ラッチ（裁定11） */
  private latch = { skill1: false, skill2: false, skill3: false };
  private menuOpen = false;
  private menuObjects: Phaser.GameObjects.GameObject[] = [];
  private combo = 0;
  private comboAt = 0;
  private predicted: { x: number; y: number } | null = null;
  private meleeChain = new Map<string, { count: number; at: number }>();
  private lagWindow: number[] = [];
  private lowSpec = false;
  private flashUntil = new Map<PlayerId, number>();
  private hitFreeze = 0;
  private banner!: Phaser.GameObjects.Text;
  private shake = 0;

  constructor() {
    super("game");
  }

  create(): void {
    this.isHost = session.mode === "solo" || session.net.isHost;
    this.me = session.mode === "solo" ? "me" : session.net.you;
    this.state = createMatch(session.players, session.matchMode, { practice: session.mode === "solo" });
    this.botMems.clear();
    for (const b of session.bots) this.botMems.set(b.id, createBotMemory());
    this.inputs = {};
    this.snapshots = [];
    this.accumulator = 0;
    this.slowmo = 0;
    this.ending = false;
    this.pendingEvents = [];
    this.leaving = false;

    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.drawBackground();
    this.gfx = this.add.graphics();
    this.hud = this.add.text(F.width / 2, 14, "", { fontFamily: FONT, fontSize: "22px", color: COLORS.text }).setOrigin(0.5, 0);
    this.skillHud = this.add.text(F.width / 2, F.height - 14, "", { fontFamily: FONT, fontSize: "18px", color: COLORS.text }).setOrigin(0.5, 1);
    this.notice = this.add
      .text(16, 44, "", { fontFamily: FONT, fontSize: "16px", color: "#fbbf24", fontStyle: "bold" })
      .setOrigin(0, 0)
      .setAlpha(0)
      .setDepth(500);
    this.ammoText = this.add
      .text(16, F.height - 16, "", { fontFamily: FONT, fontSize: "22px", color: "#fef08a" })
      .setOrigin(0, 1);
    this.countText = this.add
      .text(F.width / 2, F.height / 2 - 30, "", { fontFamily: FONT, fontSize: "150px", color: "#67e8f9", fontStyle: "bold" })
      .setOrigin(0.5)
      .setShadow(0, 0, "#22d3ee", 30, true, true)
      .setDepth(8000)
      .setVisible(false);
    this.banner = this.add
      .text(F.width / 2, F.height / 2, "", { fontFamily: FONT, fontSize: "56px", color: "#fef08a", fontStyle: "bold" })
      .setOrigin(0.5)
      .setShadow(0, 0, "#facc15", 20, true, true)
      .setAlpha(0);
    for (const p of this.state.players) {
      this.names.set(p.id, this.add.text(0, 0, p.name, { fontFamily: FONT, fontSize: "14px", color: "#cbd5e1" }).setOrigin(0.5, 1));
    }

    const kb = this.input.keyboard!;
    const binds = loadBinds();
    const bind = (name: string): Bind =>
      isMouseBind(name)
        ? { mask: mouseMaskOf(name) }
        : { key: kb.addKey(name === "SPACE" ? Phaser.Input.Keyboard.KeyCodes.SPACE : name) };
    this.keys = {
      up: bind(binds.up), down: bind(binds.down), left: bind(binds.left), right: bind(binds.right),
      guard: bind(binds.guard),
      skill1: bind(binds.skill1), skill2: bind(binds.skill2), skill3: bind(binds.skill3),
    };
    this.mouseEdges = {};
    this.bindNames = {
      guard: bindShort(binds.guard),
      skill1: bindShort(binds.skill1),
      skill2: bindShort(binds.skill2),
      skill3: bindShort(binds.skill3),
    };

    // ESCメニュー（訓練場: リセット/ゲージ全快/キー設定/退出、対戦: キー設定/退出）
    this.menuObjects = [];
    this.menuOpen = false;
    this.input.keyboard!.on("keydown-ESC", () => this.toggleMenu());
    label(this, F.width - 60, 20, "ESC メニュー", 13, "#475569");
    this.combo = 0;
    this.predicted = null;
    this.flashUntil.clear();
    this.hitFreeze = 0;
    this.input.mouse?.disableContextMenu();
    BGM.start();

    if (session.mode === "online") {
      const net = session.net;
      this.offs.push(
        net.on<{ from: PlayerId; payload: GameMessage }>("game:input", ({ from, payload }) => {
          if (this.isHost && payload.type === "input") this.inputs[from] = payload.input;
        }),
        net.on<{ payload: GameMessage }>("game:snapshot", ({ payload }) => {
          if (!this.isHost && payload.type === "snapshot") this.onSnapshot(payload.state, payload.events);
        }),
        net.on("hostLeft", () => this.leave("ホストが切断しました")),
        net.on("closed", () => this.leave("中継サーバーとの接続が切れました")),
        net.on<{ members: { id: PlayerId }[] }>("members", ({ members }) => {
          if (!this.isHost) return;
          const ids = new Set(members.map((m) => m.id));
          const gone = this.state.players.filter((p) => !ids.has(p.id) && !p.id.startsWith("bot-") && p.id !== "dummy" && p.lives > 0);
          for (const p of gone) {
            this.state = { ...this.state, players: this.state.players.map((q) => (q.id === p.id ? { ...q, lives: 0, respawn: Infinity } : q)) };
            this.notify(`${p.name} が退出しました`);
          }
        }),
      );
    }
    this.events.once("shutdown", () => {
      BGM.stop();
      // 注意: この時点でカメラは既に破棄されている（cameras.main は undefined）。
      // ここで cameras に触ると例外で遷移が止まり「ホームに戻る」が効かなくなる
      this.offs.forEach((f) => f());
      this.offs = [];
      this.closeMenu();
      this.names.forEach((t) => t.destroy());
      this.names.clear();
    });
  }

  /**
   * ESCメニュー（裁定19）。
   * 「非表示にするだけ」だと Phaser では隠れたボタンが入力を拾い続けることがあるため、
   * 開くたびに生成し、閉じるたびに完全に破棄する。
   */
  private openMenu(): void {
    if (this.menuOpen) return;
    const solo = session.mode === "solo";
    const items: Array<[string, () => void]> = solo
      ? [
          ["リセット", () => { this.closeMenu(); this.resetPractice(); }],
          // 裁定39: 使いたいキャラを直接選ぶ（今のキャラ以外の2つを並べる）
          ...(["speed", "heavy", "support"] as CharClass[])
            .filter((c) => c !== session.myCls)
            .map((c): [string, () => void] => [`${CLASS_LABEL[c]}に変更`, () => { this.closeMenu(); this.changePracticeClass(c); }]),
          ["ゲージ全快", () => { this.closeMenu(); this.refillGauges(); }],
          ["キー設定", () => { this.closeMenu(); this.openSettings(); }],
          ["対戦に戻る", () => this.closeMenu()],
          ["ホームに戻る", () => { this.closeMenu(); this.scene.start("title"); }],
        ]
      : [
          // 対戦中はシーンを離れると同期が切れるため、キー設定はタイトルからのみ
          ["対戦に戻る", () => this.closeMenu()],
          ["ホームに戻る", () => { this.closeMenu(); this.leave("マッチから退出しました"); }],
        ];

    const h = 62 * items.length + 56;
    const top = F.height / 2 - h / 2;
    const bg = this.add.graphics().setDepth(9000);
    bg.fillStyle(0x000000, 0.72).fillRect(0, 0, F.width, F.height);
    bg.lineStyle(2, 0x22d3ee, 1).fillStyle(0x0a1420, 0.97);
    bg.fillRoundedRect(F.width / 2 - 180, top, 360, h, 14);
    bg.strokeRoundedRect(F.width / 2 - 180, top, 360, h, 14);
    // 背面クリックが下のゲームへ抜けないよう全面で受け止める
    const blocker = this.add.zone(F.width / 2, F.height / 2, F.width, F.height).setInteractive().setDepth(9000);
    const hint = label(this, F.width / 2, top + 24, "ESC でメニューを閉じる", 13, "#64748b").setDepth(9002);
    this.menuObjects = [bg, blocker, hint];

    items.forEach(([text, fn], i) => {
      const b = button(this, F.width / 2, top + 56 + i * 62, text, fn, 300, 48);
      b.container.setDepth(9001);
      this.menuObjects.push(b.container);
    });
    this.menuOpen = true;
  }

  private closeMenu(): void {
    if (!this.menuOpen) return;
    for (const o of this.menuObjects) o.destroy();
    this.menuObjects = [];
    this.menuOpen = false;
  }

  private toggleMenu(): void {
    if (this.menuOpen) this.closeMenu();
    else this.openMenu();
  }

  private openSettings(): void {
    this.registry.set("settingsReturn", "game");
    this.scene.start("settings");
  }

  /** 訓練場を初期状態へ戻す（裁定14: ゲージはゼロ・経過時間は扱わない） */
  private resetPractice(): void {
    this.state = createMatch(session.players, session.matchMode === "ffa" ? "ffa" : "teams", { practice: true });
    for (const p of this.state.players) {
      p.escapeGauge = 0;
      p.unifiedGauge = 0;
      p.guardGauge = 0;
    }
    this.inputs = {};
    this.botMems.clear();
    for (const b of session.bots) this.botMems.set(b.id, createBotMemory());
    this.predicted = null;
    this.combo = 0;
    this.latch = { skill1: false, skill2: false, skill3: false };
    this.notify("リセット", "#67e8f9");
  }

  /** 訓練場でキャラを切り替える（裁定35・39）: 指定したキャラにしてリセット、入り直す */
  private changePracticeClass(next: CharClass): void {
    if (next === session.myCls) return;
    session.myCls = next;
    session.players = session.players.map((p) => (p.id === this.me ? { ...p, cls: next } : p));
    this.resetPractice();
    this.notify(`キャラ変更: ${CLASS_LABEL[next]}`, "#67e8f9");
  }

  /** ゲージだけ満タンにする（コンボ・合体技の反復練習用） */
  private refillGauges(): void {
    const me = this.stateFor(this.me);
    if (!me) return;
    me.escapeGauge = BALANCE.speedSkills.gaugeMax;
    me.unifiedGauge = BALANCE.unifiedGauge.max;
    me.guardGauge = BALANCE.guard.max;
    me.skillCd = [0, 0, 0];
    me.skillLock = [0, 0, 0];
    this.notify("ゲージ全快", "#67e8f9");
  }

  private leaving = false;

  private leave(message: string): void {
    // disconnect() が "closed" を発火して leave が二重に呼ばれ、タイトルの再生成とメッセージ上書きが起きるのを防ぐ
    if (this.leaving) return;
    this.leaving = true;
    this.registry.set("message", message);
    session.net.disconnect();
    this.scene.start("title");
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    if (this.isHost) {
      this.lagWindow.push(deltaMs);
      if (this.lagWindow.length > 60) this.lagWindow.shift();
      if (!this.lowSpec && this.lagWindow.length >= 30) {
        const avg = this.lagWindow.reduce((a, b) => a + b, 0) / this.lagWindow.length;
        if (avg > 40) {
          this.lowSpec = true; // 演出を落として処理を守る（bot削減より先の逃げ道）
          this.notify("処理落ち検知：演出を簡略化", "#94a3b8");
        }
      }
    }
    this.pollEdges();

    if (this.isHost) {
      const scale = this.slowmo > 0 ? KILL_SLOWMO_SCALE : 1;
      this.slowmo = Math.max(0, this.slowmo - dt);
      this.accumulator += dt * scale;
      while (this.accumulator >= DT) {
        this.accumulator -= DT;
        // tickごとにラッチを1回消費する（押した入力が踏み潰されない）
        this.inputs[this.me] = this.readLocalInput(true);
        for (const b of session.bots) {
          const mem = this.botMems.get(b.id);
          if (mem) this.inputs[b.id] = botInput(this.state, b.id, b.level, mem);
        }
        const r = step(this.state, this.inputs, DT);
        this.state = r.state;
        this.applyEvents(r.events);
        // エッジ入力は1tickで消費
        for (const id of Object.keys(this.inputs)) {
          const i = this.inputs[id]!;
          if (i.skill1 || i.skill2 || i.skill3) this.inputs[id] = { ...i, skill1: false, skill2: false, skill3: false };
        }
      }
      if (session.mode === "online") {
        this.snapshotTimer += dt;
        if (this.snapshotTimer >= 1 / SNAPSHOT_HZ) {
          this.snapshotTimer = 0;
          session.net.sendGame({ type: "snapshot", state: this.state, events: this.pendingEvents });
          this.pendingEvents = [];
        }
      }
      if (this.hitFreeze > 0) this.hitFreeze -= dt;
      else this.render(this.state, this.state);
    } else {
      this.inputTimer += dt;
      if (this.inputTimer >= 1 / INPUT_HZ) {
        this.inputTimer = 0;
        session.net.sendGame({ type: "input", input: this.readLocalInput(true) }, this.hostId());
      }
      // クライアント予測: 自機の移動をローカル入力で先行させ、権威スナップショットへ吸着
      const meAuth = this.state.players.find((p) => p.id === this.me);
      if (meAuth && isAlive(meAuth)) {
        if (!this.predicted) this.predicted = { x: meAuth.x, y: meAuth.y };
        const input = this.readLocalInput(false);
        let mx = input.mx, my = input.my;
        const len = Math.hypot(mx, my);
        if (len > 1) { mx /= len; my /= len; }
        const locked = meAuth.cc > 0 || meAuth.guardBreak > 0 || meAuth.turnLock > 0;
        const speed = locked ? 0 : moveSpeedOf(meAuth.cls);
        this.predicted.x += mx * speed * dt;
        this.predicted.y += my * speed * dt;
        this.predicted.x = Phaser.Math.Clamp(this.predicted.x, P.radius, F.width - P.radius);
        this.predicted.y = Phaser.Math.Clamp(this.predicted.y, P.radius, F.height - P.radius);
        // 権威位置へ毎フレーム少しずつ吸着（ずれの発散防止）
        this.predicted.x = Phaser.Math.Linear(this.predicted.x, meAuth.x, 0.12);
        this.predicted.y = Phaser.Math.Linear(this.predicted.y, meAuth.y, 0.12);
      } else {
        this.predicted = null;
      }
      const view = this.interpolated();
      if (this.hitFreeze > 0) this.hitFreeze -= dt;
      else if (view) this.render(view.from, view.to, view.alpha);
    }

    if (this.state.phase === "ended" && !this.ending) {
      this.ending = true;
      session.lastResult = this.state.result;
      session.lastStats = {
        linkCount: this.state.linkCount,
        maxLinkDamage: Math.round(this.state.maxLinkDamage),
        players: this.state.players.map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, damageDealt: Math.round(p.damageDealt) })),
      };
      this.showBanner("FINISH");
      this.time.delayedCall(1200, () => this.scene.start("result"));
    }
  }

  private hostId(): PlayerId | undefined {
    return session.net.members.find((m) => m.host)?.id;
  }

  private bindDown(b: Bind): boolean {
    if (b.key) return b.key.isDown;
    return (this.input.activePointer.buttons & (b.mask ?? 0)) !== 0;
  }

  /** 押した瞬間だけtrue（キーはJustDown、マウスは前フレームとの比較） */
  private bindEdge(b: Bind, action: BindAction): boolean {
    if (b.key) return Phaser.Input.Keyboard.JustDown(b.key);
    const now = this.bindDown(b);
    const was = this.mouseEdges[action] ?? false;
    this.mouseEdges[action] = now;
    return now && !was;
  }

  /**
   * 押した瞬間の入力をラッチに溜める（裁定11）。
   * 毎フレーム呼ぶ。tickや送信が走らないフレームで拾ったエッジも消えずに残るので、
   * 高リフレッシュレート環境でもスキルが不発にならない。
   */
  private pollEdges(): void {
    if (this.bindEdge(this.keys.skill1, "skill1")) this.latch.skill1 = true;
    if (this.bindEdge(this.keys.skill2, "skill2")) this.latch.skill2 = true;
    if (this.bindEdge(this.keys.skill3, "skill3")) this.latch.skill3 = true;
  }

  /** ラッチを1回ぶん消費して入力を組み立てる */
  private readLocalInput(consume: boolean): PlayerInput {
    const me = this.stateFor(this.me);
    const ptr = this.input.activePointer;
    const aim = me ? Math.atan2(ptr.worldY - me.y, ptr.worldX - me.x) : 0;
    if (this.menuOpen) {
      // メニュー操作が攻撃・移動として飛ばないよう、開いている間は無入力にする
      this.latch = { skill1: false, skill2: false, skill3: false };
      return { ...NULL_INPUT, aim };
    }
    const input: PlayerInput = {
      mx: (this.bindDown(this.keys.right) ? 1 : 0) - (this.bindDown(this.keys.left) ? 1 : 0),
      my: (this.bindDown(this.keys.down) ? 1 : 0) - (this.bindDown(this.keys.up) ? 1 : 0),
      aim,
      // 裁定10: 左クリック=主武器 / 右クリック=副武器
      fire: ptr.leftButtonDown(),
      fire2: ptr.rightButtonDown(),
      // ビルドウォールの設置位置（裁定21）
      aimDist: me ? Math.hypot(ptr.worldX - me.x, ptr.worldY - me.y) : 0,
      skill1Held: this.bindDown(this.keys.skill1),
      skill2Held: this.bindDown(this.keys.skill2),
      // バレットプルーフ（裁定26）: カーソルに一番近い味方を自動選択
      aimAllyId: this.nearestAlly(ptr.worldX, ptr.worldY),
      guard: this.bindDown(this.keys.guard),
      skill1: this.latch.skill1,
      skill2: this.latch.skill2,
      skill3: this.latch.skill3,
    };
    if (consume) this.latch = { skill1: false, skill2: false, skill3: false };
    return input;
  }

  /** カーソルに最も近い味方（自分を除く）。乱闘など味方がいなければ null */
  private nearestAlly(x: number, y: number): PlayerId | null {
    const me = this.stateFor(this.me);
    if (!me) return null;
    let best: PlayerId | null = null;
    let bestD = Infinity;
    for (const p of this.state.players) {
      if (p.id === me.id || p.team !== me.team || !isAlive(p)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = p.id; }
    }
    return best;
  }

  /** ソニックの残像（裁定24）: 経路線＋等間隔のシルエット＋始点リング */
  private sonicTrail(fromX: number, fromY: number, toX: number, toY: number, color: number): void {
    if (this.lowSpec) return;
    const line = this.add.graphics().setDepth(4);
    line.lineStyle(2, color, 0.55);
    line.lineBetween(fromX, fromY, toX, toY);
    line.lineStyle(3, color, 0.5);
    line.strokeCircle(fromX, fromY, P.radius);
    this.tweens.add({ targets: line, alpha: 0, duration: 260, onComplete: () => line.destroy() });

    const N = 5;
    for (let i = 0; i < N; i++) {
      const u = (i + 1) / (N + 1);
      const gx = fromX + (toX - fromX) * u;
      const gy = fromY + (toY - fromY) * u;
      const ghost = this.add.graphics().setDepth(4);
      ghost.fillStyle(color, 0.16 + 0.12 * u); // 手前ほど薄い
      ghost.fillCircle(gx, gy, P.radius);
      this.tweens.add({ targets: ghost, alpha: 0, duration: 250, delay: i * 18, onComplete: () => ghost.destroy() });
    }
    // 始点の衝撃波
    // Graphicsの拡大は自身の原点(0,0)基準なので、円は原点に描いて位置を始点に置く（ワールド座標に描くと拡大で飛んでいく）
    const ring = this.add.graphics({ x: fromX, y: fromY }).setDepth(4);
    ring.lineStyle(3, color, 0.9);
    ring.strokeCircle(0, 0, P.radius);
    this.tweens.add({ targets: ring, alpha: 0, scaleX: 2.2, scaleY: 2.2, duration: 300, onComplete: () => ring.destroy() });
  }

  /** 中心から外へ広がって消えるリング（裁定38）。startScale→1.0 に広がり、最後に薄くなる */
  private expandRing(x: number, y: number, radius: number, endScale: number, color: number, width: number, duration: number, fillAlpha = 0): void {
    const ring = this.add.graphics({ x, y }).setDepth(5);
    ring.lineStyle(width, color, 0.95);
    ring.strokeCircle(0, 0, radius);
    if (fillAlpha > 0) {
      ring.fillStyle(color, fillAlpha);
      ring.fillCircle(0, 0, radius);
    }
    ring.setScale(endScale === 1 ? 0.15 : 1);
    this.tweens.add({
      targets: ring,
      scaleX: endScale, scaleY: endScale,
      alpha: 0,
      duration,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  /** グラウンドスラム発動の衝撃波（裁定33）: 中心から範囲の縁まで一気に広がって消える */
  private slamShockwave(x: number, y: number, radius: number): void {
    const color = 0xfb923c;
    // Graphicsの拡大は原点基準なので、原点に描いて位置を中心に置く（ソニックのリングと同じ罠）
    const ring = this.add.graphics({ x, y }).setDepth(5);
    ring.lineStyle(6, color, 0.95);
    ring.strokeCircle(0, 0, radius);
    ring.fillStyle(color, 0.18);
    ring.fillCircle(0, 0, radius);
    ring.setScale(0.1);
    this.tweens.add({
      targets: ring,
      scaleX: 1, scaleY: 1,
      duration: 160,
      ease: "Cubic.easeOut",
      onComplete: () => this.tweens.add({ targets: ring, alpha: 0, duration: 220, onComplete: () => ring.destroy() }),
    });
    const flash = this.add.circle(x, y, 18, 0xffffff).setBlendMode(Phaser.BlendModes.ADD).setDepth(6);
    this.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 200, ease: "Cubic.easeOut", onComplete: () => flash.destroy() });
  }

  /**
   * スキルリンク（裁定28）の広がり演出。
   * 着弾点(ox,oy)を起点に、スラム範囲(x,y,radius)へ一瞬で駆け抜ける。
   * ライトニングスラム=水色の感電 / ヒールスラム=緑の回復。
   */
  private slamLinkBurst(pair: "slamStun" | "slamPotion", ox: number, oy: number, x: number, y: number, radius: number): void {
    const color = pair === "slamStun" ? 0x7dd3fc : 0x4ade80;
    // 着弾点からスラム中心へ走る線
    const bolt = this.add.graphics().setDepth(6);
    bolt.lineStyle(4, color, 0.95);
    if (pair === "slamStun") {
      // ジグザグで感電らしく
      const steps = 6;
      let px = ox, py = oy;
      bolt.beginPath();
      bolt.moveTo(ox, oy);
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        const jitter = i === steps ? 0 : (Math.random() - 0.5) * 26;
        px = ox + (x - ox) * u - (y - oy) / (Math.hypot(x - ox, y - oy) || 1) * jitter;
        py = oy + (y - oy) * u + (x - ox) / (Math.hypot(x - ox, y - oy) || 1) * jitter;
        bolt.lineTo(px, py);
      }
      bolt.strokePath();
    } else {
      bolt.lineBetween(ox, oy, x, y);
    }
    this.tweens.add({ targets: bolt, alpha: 0, duration: 320, onComplete: () => bolt.destroy() });

    // スラム範囲に一瞬で広がるリング
    const ring = this.add.graphics().setDepth(6);
    ring.lineStyle(5, color, 0.9);
    ring.strokeCircle(x, y, radius);
    ring.fillStyle(color, 0.14);
    ring.fillCircle(x, y, radius);
    ring.setScale(0.15);
    ring.setPosition(x - x * 0.15, y - y * 0.15);
    this.tweens.add({
      targets: ring,
      scaleX: 1, scaleY: 1, x: 0, y: 0,
      duration: 180,
      ease: "Cubic.easeOut",
      onComplete: () => {
        this.tweens.add({ targets: ring, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
      },
    });
    SFX.hit("sniper", 0, true); // スラムのリンク成立: 重い一撃＋中心ヒットの抜け音
  }

  /**
   * スキルリンク成立の演出（裁定30）。
   * 2色のリングが交差して弾ける＋中心のフラッシュ＋放射スパーク。
   * 中央にテキストを出さず、起きた場所で見せる。
   */
  private linkBurst(x: number, y: number, pair: string): void {
    const pal: Record<string, [number, number]> = {
      breach: [0x22e5ff, 0xfb923c],
      lightning: [0x7dd3fc, 0xe879f9],
      slamStun: [0x7dd3fc, 0xfb923c],
      slamPotion: [0x4ade80, 0xfb923c],
    };
    const [c1, c2] = pal[pair] ?? [0x22e5ff, 0xfb923c];

    // 中心のフラッシュ
    const flash = this.add.circle(x, y, 26, 0xffffff).setBlendMode(Phaser.BlendModes.ADD).setDepth(7);
    this.tweens.add({ targets: flash, scale: 2.6, alpha: 0, duration: 260, ease: "Cubic.easeOut", onComplete: () => flash.destroy() });

    // 2色のリングが時間差で広がる
    [c1, c2].forEach((c, i) => {
      const ring = this.add.circle(x, y, 20).setStrokeStyle(4, c, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(7);
      this.tweens.add({
        targets: ring,
        scale: 5.5,
        alpha: 0,
        delay: i * 70,
        duration: 520,
        ease: "Cubic.easeOut",
        onComplete: () => ring.destroy(),
      });
    });

    if (this.lowSpec) return;
    // 放射スパーク（2色を交互に）
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
      const dist = 90 + Math.random() * 70;
      const dot = this.add.circle(x, y, 3 + Math.random() * 2, i % 2 === 0 ? c1 : c2).setBlendMode(Phaser.BlendModes.ADD).setDepth(7);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist,
        alpha: 0,
        duration: 520 + Math.random() * 260,
        ease: "Cubic.easeOut",
        onComplete: () => dot.destroy(),
      });
    }
    this.shake = Math.max(this.shake, 5);
  }

  private colorOf(id: PlayerId): number {
    const p = this.stateFor(id);
    return p && p.id === this.me ? 0x67e8f9 : 0xf472b6;
  }

  private stateFor(id: PlayerId): PlayerState | undefined {
    return this.state.players.find((p) => p.id === id);
  }

  private onSnapshot(state: SimState, events: SimEvent[]): void {
    this.snapshots.push({ at: this.time.now / 1000, state });
    if (this.snapshots.length > 30) this.snapshots.shift();
    this.state = state;
    this.applyEvents(events);
  }

  private interpolated(): { from: SimState; to: SimState; alpha: number } | null {
    const n = this.snapshots.length;
    if (n === 0) return null;
    const renderAt = this.time.now / 1000 - INTERP_DELAY;
    let i = n - 1;
    while (i > 0 && this.snapshots[i - 1]!.at > renderAt) i--;
    const to = this.snapshots[i]!;
    const from = this.snapshots[Math.max(0, i - 1)]!;
    const span = to.at - from.at;
    const alpha = span > 0 ? Phaser.Math.Clamp((renderAt - from.at) / span, 0, 1) : 1;
    return { from: from.state, to: to.state, alpha };
  }

  private applyEvents(events: SimEvent[]): void {
    if (this.isHost && session.mode === "online") this.pendingEvents.push(...events);
    for (const e of events) {
      switch (e.type) {
        case "countdown": {
          SFX.shoot(); // 短いビープ代わり
          this.countText.setScale(1.6).setAlpha(1);
          this.tweens.add({ targets: this.countText, scale: 1, duration: 220, ease: "Cubic.easeOut" });
          break;
        }
        case "shoot": {
          if (e.owner === this.me) SFX.shoot();
          if (!this.lowSpec) {
            const shooter = this.stateFor(e.owner);
            if (shooter) {
              const mx = shooter.x + Math.cos(shooter.aim) * (P.radius + 12);
              const my = shooter.y + Math.sin(shooter.aim) * (P.radius + 12);
              const fl = this.add.circle(mx, my, 7, 0xfff7cc).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9);
              this.tweens.add({ targets: fl, alpha: 0, scale: 0.3, duration: 70, onComplete: () => fl.destroy() });
            }
          }
          break;
        }
        case "swing":
          if (e.owner === this.me) SFX.swing();
          break;
        case "hit": {
          // ダメージ比例の数字（6ダメと48ダメで脳への効きを変える）
          const size = e.guarded ? 20 : Math.round(Math.min(48, 16 + e.damage * 0.75));
          this.popText(e.x, e.y - 30, e.guarded ? "GUARD" : `${Math.round(e.damage)}`, e.center ? "#fef08a" : e.guarded ? "#fbbf24" : "#f8fafc", e.center, size);
          if (e.damage > 0) {
            this.flashUntil.set(e.target, this.time.now + 90); // 被弾側を白く光らせる
            if (!this.lowSpec) this.impact(e.x, e.y, e.center);
          }
          if (e.target === this.me) {
            this.shake = Math.max(this.shake, e.center ? 6 : 3);
            if (e.damage > 0) SFX.hurt(e.center); // 裁定37: 被弾側にも音を出す
          }
          if (e.attacker === this.me && e.damage > 0) {
            const now = this.time.now / 1000;
            this.combo = now - this.comboAt < 1 ? this.combo + 1 : 0;
            this.comboAt = now;
            SFX.hit(e.weapon, this.combo, e.center); // 裁定37: 武器別ヒット音＋連続ヒットでピッチ上昇
            // 短いヒットストップ（描画フリーズ方式: ホスト・非ホストに等しく効く）
            this.hitFreeze = Math.max(this.hitFreeze, e.center || e.melee ? 0.055 : 0.03);
          }
          if (e.target === this.me && e.damage > 0) this.hitFreeze = Math.max(this.hitFreeze, 0.03);
          // ビッグヒット専用演出（SPEC 14章: 最大溜め中心・多段全段）
          if (e.damage > 0) {
            let big = e.center && e.damage >= 40; // 最大溜め中心クラス
            if (e.melee) {
              const key = `${e.attacker}>${e.target}`;
              const now = this.time.now / 1000;
              const chain = this.meleeChain.get(key);
              const count = chain && now - chain.at < 0.6 ? chain.count + 1 : 1;
              this.meleeChain.set(key, { count, at: now });
              if (count >= 4) big = true; // セイバー多段全段
            }
            if (big) {
              this.popText(e.x, e.y - 60, "BIG HIT!", "#fef08a", true, 40);
              SFX.bigHit();
              this.shake = Math.max(this.shake, 10);
              this.hitFreeze = Math.max(this.hitFreeze, 0.09);
              if (!this.lowSpec) this.sparks(e.x, e.y);
            }
          }
          if (e.guarded && (e.attacker === this.me || e.target === this.me)) SFX.guard();
          break;
        }
        case "heal":
          this.popText(e.x, e.y - 30, `+${Math.round(e.amount)}`, "#4ade80", false);
          if (e.from === this.me || e.target === this.me) SFX.heal();
          break;
        case "bulletproof": {
          // 裁定38: 発動の瞬間に水色のシールドが弾けて広がる＋専用音
          this.popText(e.x, e.y - 40, "PROOF", "#67e8f9", true);
          if (!this.lowSpec) this.expandRing(e.x, e.y, P.radius + 10, 2.4, 0x67e8f9, 5, 260);
          if (e.from === this.me || e.target === this.me) SFX.bulletproof();
          break;
        }
        case "potion": {
          // 裁定38: 着弾点に回復範囲の円が広がって消える（回復した相手がいなくても出す）
          if (!this.lowSpec) {
            this.expandRing(e.x, e.y, e.radius, 1, 0x4ade80, 4, 420, 0.35);
            const puff = this.add.circle(e.x, e.y, 14, 0x4ade80, 0.8).setDepth(4);
            this.tweens.add({ targets: puff, scale: 3, alpha: 0, duration: 300, ease: "Cubic.easeOut", onComplete: () => puff.destroy() });
          }
          if (e.owner === this.me) SFX.potionBurst();
          break;
        }
        case "link": {
          // 裁定30: 中央のテキストは出さず、現場のエフェクトだけで見せる
          SFX.link();
          this.linkBurst(e.x, e.y, e.pair);
          break;
        }
        case "slamLink": {
          this.slamLinkBurst(e.pair, e.ox, e.oy, e.x, e.y, e.radius);
          break;
        }
        case "sonic": {
          this.sonicTrail(e.fromX, e.fromY, e.x, e.y, this.colorOf(e.owner));
          break;
        }
        case "skill": {
          // グラウンドスラム発動（裁定33）: 中心から外へ抜ける衝撃波
          const owner = this.stateFor(e.owner);
          if (owner && owner.cls === "heavy" && e.skill === 0 && !this.lowSpec) {
            this.slamShockwave(owner.x, owner.y, BALANCE.heavySkills.slam.radius);
          }
          break;
        }
        case "erase":
          SFX.deflect(); // 裁定25: 表示は出さず、軽快な「シャキン」だけ
          break;
        case "justGuard":
          this.popText(this.pos(e.target).x, this.pos(e.target).y - 44, "JUST!", "#67e8f9", true);
          break;
        case "guardBreak":
          this.popText(this.pos(e.target).x, this.pos(e.target).y - 40, "BREAK!", "#f97316", true);
          if (e.target === this.me || this.isHost) SFX.guardBreak();
          break;
        case "kill": {
          this.slowmo = KILL_SLOWMO_SECONDS;
          const pos = this.pos(e.target);
          if (!this.lowSpec) this.sparks(pos.x, pos.y);
          this.shake = Math.max(this.shake, 8);
          SFX.kill(e.attacker === this.me ? "mine" : e.target === this.me ? "me" : "other"); // 裁定37: 撃破音の3分岐
          // 撃破時 0.3秒スロー＋ズーム（SPEC 14章）
          const cam = this.cameras.main;
          cam.zoomTo(1.1, 120, "Cubic.easeOut");
          this.time.delayedCall(360, () => cam.zoomTo(1, 260, "Cubic.easeOut"));
          // 味方ダウン（2vs2/3v3）: バナー＋専用SE（SPEC 13章）
          const meP = this.stateFor(this.me);
          const tgt = this.stateFor(e.target);
          if (this.state.mode === "teams" && meP && tgt && tgt.team === meP.team && e.target !== this.me) {
            this.notify("味方ダウン！CD半減中");
            SFX.allyDown();
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private pos(id: PlayerId): { x: number; y: number } {
    const p = this.stateFor(id);
    return p ? { x: p.x, y: p.y } : { x: F.width / 2, y: F.height / 2 };
  }

  private popText(x: number, y: number, text: string, color: string, big: boolean, size?: number): void {
    const px = size ?? (big ? 30 : 22);
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: `${px}px`, color, fontStyle: "bold" })
      .setOrigin(0.5)
      .setShadow(0, 0, color, 10, true, true);
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 650, ease: "Cubic.easeOut", onComplete: () => t.destroy() });
  }

  /** 毎ヒットの小さな着弾火花 */
  private impact(x: number, y: number, center: boolean): void {
    const n = center ? 6 : 4;
    const color = center ? 0xfef08a : 0xa5f3fc;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 18 + Math.random() * 26;
      const dot = this.add.circle(x, y, 2 + Math.random() * 2, color).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: dot, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, duration: 220 + Math.random() * 130, ease: "Cubic.easeOut", onComplete: () => dot.destroy() });
    }
  }

  private sparks(x: number, y: number): void {
    for (let i = 0; i < 18; i++) {
      const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
      const d = 60 + Math.random() * 80;
      const s = this.add.circle(x, y, 3 + Math.random() * 3, COLORS.speed).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: s, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, scale: 0.2, duration: 500 + Math.random() * 300, onComplete: () => s.destroy() });
    }
  }

  /** 左上の小さな通知（裁定29）。ゲーム進行を邪魔しない情報はこちらに出す */
  private notify(text: string, color = "#fbbf24"): void {
    this.notice.setText(text).setColor(color).setAlpha(1);
    this.tweens.killTweensOf(this.notice);
    this.tweens.add({ targets: this.notice, alpha: 0, delay: 1600, duration: 500 });
  }

  private showBanner(text: string): void {
    this.banner.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    this.tweens.add({ targets: this.banner, alpha: 0, delay: 900, duration: 400 });
  }

  private drawBackground(): void {
    const g = this.add.graphics();
    g.lineStyle(1, COLORS.grid, 1);
    for (let x = 0; x <= F.width; x += 80) g.lineBetween(x, 0, x, F.height);
    for (let y = 0; y <= F.height; y += 80) g.lineBetween(0, y, F.width, y);
    g.lineStyle(4, 0x1e3a5f, 1);
    g.strokeRect(2, 2, F.width - 4, F.height - 4);
  }

  private render(from: SimState, to: SimState, alpha = 1): void {
    const g = this.gfx;
    g.clear();
    if (this.shake > 0) {
      this.cameras.main.setScroll((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - 0.6);
    } else this.cameras.main.setScroll(0, 0);

    // 生成物
    // ビルドウォール（裁定31）: 厚みのある構造物として描く
    for (const w of to.walls) {
      const ratio = w.hp / BALANCE.heavySkills.wall.hp;
      const base = w.breach ? 0x22e5ff : 0xfb923c;
      const th = BALANCE.heavySkills.wall.thickness;
      // 外周のグロー
      g.lineStyle(th + 6, base, 0.14);
      g.lineBetween(w.x1, w.y1, w.x2, w.y2);
      // 本体（耐久が減るほど暗くなる）
      g.lineStyle(th, base, 0.4 + 0.5 * ratio);
      g.lineBetween(w.x1, w.y1, w.x2, w.y2);
      // 立体感: 上辺を明るく、下辺を暗く
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (th / 2 - 1.5);
      const ny = (dx / len) * (th / 2 - 1.5);
      g.lineStyle(2, 0xffffff, 0.55 * ratio + 0.15);
      g.lineBetween(w.x1 + nx, w.y1 + ny, w.x2 + nx, w.y2 + ny);
      g.lineStyle(2, 0x000000, 0.35);
      g.lineBetween(w.x1 - nx, w.y1 - ny, w.x2 - nx, w.y2 - ny);
      // 耐久を示すリベット（等間隔の点）
      const rivets = 4;
      g.fillStyle(0xffffff, 0.25 + 0.45 * ratio);
      for (let i = 0; i < rivets; i++) {
        const u = (i + 0.5) / rivets;
        g.fillCircle(w.x1 + dx * u, w.y1 + dy * u, 2.2);
      }
      // 端のキャップ
      g.fillStyle(base, 0.5 + 0.4 * ratio);
      g.fillCircle(w.x1, w.y1, th / 2);
      g.fillCircle(w.x2, w.y2, th / 2);
    }
    for (const s of to.smokes) {
      g.fillStyle(0x64748b, 0.55);
      g.fillCircle(s.x, s.y, s.radius);
    }

    const fromById = new Map(from.players.map((p) => [p.id, p]));
    for (const p of to.players) {
      const f = fromById.get(p.id) ?? p;
      let x = Phaser.Math.Linear(f.x, p.x, alpha);
      let y = Phaser.Math.Linear(f.y, p.y, alpha);
      if (p.id === this.me && this.predicted) {
        x = this.predicted.x;
        y = this.predicted.y;
      }
      const name = this.names.get(p.id);
      if (!isAlive(p)) {
        name?.setVisible(false);
        continue;
      }
      name?.setVisible(true).setPosition(x, y - P.radius - 28);
      this.drawPlayer(g, p, x, y);
    }

    const fromBullets = new Map(from.bullets.map((b) => [b.id, b]));
    for (const b of to.bullets) {
      const fb = fromBullets.get(b.id) ?? b;
      this.drawBullet(g, b, Phaser.Math.Linear(fb.x, b.x, alpha), Phaser.Math.Linear(fb.y, b.y, alpha));
    }

    // 開始カウントダウン（裁定16）
    if (to.countdown > 0) {
      this.countText.setText(String(Math.ceil(to.countdown))).setVisible(true).setAlpha(1);
    } else if (this.countText.visible) {
      this.countText.setText("START").setScale(1);
      this.tweens.add({ targets: this.countText, alpha: 0, scale: 1.5, duration: 500, onComplete: () => this.countText.setVisible(false) });
    }

    // HUD
    const me = to.players.find((p) => p.id === this.me);
    const tl = Math.ceil(to.timeLeft);
    // 訓練場に制限時間の概念はないので時計を出さない（裁定14）
    const clock = session.mode === "solo" ? "訓練場" : `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, "0")}`;
    if (to.mode === "teams" && me) {
      const myPool = to.teamLives[me.team] ?? 0;
      const foeTeam = Object.keys(to.teamLives).map(Number).find((t) => t !== me.team);
      const foePool = foeTeam !== undefined ? to.teamLives[foeTeam] ?? 0 : 0;
      const teamSize = to.players.filter((p) => p.team === me.team).length;
      const maxStock = teamSize >= 3 ? BALANCE.teams.sharedLives3 : BALANCE.teams.sharedLives;
      const stock = (n: number) => "◆".repeat(Math.max(0, n)) + "◇".repeat(Math.max(0, maxStock - n));
      this.hud.setText(`味方 ${stock(myPool)}   ${clock}   敵 ${stock(foePool)}`);
    } else {
      const others = to.players.filter((p) => p.id !== this.me);
      const fmt = (p: PlayerState) => `${p.name} ${"◆".repeat(Math.max(0, p.lives))}${"◇".repeat(Math.max(0, P.lives - p.lives))}`;
      this.hud.setText(`${me ? fmt(me) : ""}   ${clock}   ${others.map(fmt).join("  ")}`);
    }
    // 弔い合戦の表示
    if (me && to.t < me.boostUntil) {
      this.hud.setColor("#fbbf24");
    } else {
      this.hud.setColor("#e5e7eb");
    }

    if (me) {
      const myDanger = to.mode === "teams" ? (to.teamLives[me.team] ?? 9) <= 1 : me.lives <= 1;
      BGM.setDanger(myDanger);
      const labels = SKILL_LABEL[me.cls]!;
      const skillText = labels
        .map((l, i) => {
          const cd = me.skillCd[i]!;
          const key = [this.bindNames.skill1, this.bindNames.skill2, this.bindNames.skill3][i];
          return cd > 0 ? `[${key}] ${l} (${cd.toFixed(1)})` : `[${key}] ${l}`;
        })
        .join("   ");
      // 裁定10: 武器切替は廃止。左右どちらのクリックで何が出るかを常時表示する
      const wMain = me.cls === "support" ? "狙撃(溜め)/ヒール(単押し)" : WEAPON_LABEL[WEAPONS[me.cls][0] ?? ""] ?? "";
      const wSub = WEAPON_LABEL[WEAPONS[me.cls][1] ?? ""] ?? "";
      // 残弾（裁定22）: 弾を使う武器を持つクラスのみ左下に表示
      const magMax = me.cls === "heavy" ? BALANCE.hmg.magazine : BALANCE.pistol.magazine;
      if (me.cls === "support") {
        this.ammoText.setText("");
      } else if (me.reload > 0) {
        this.ammoText.setText(`リロード中 ${me.reload.toFixed(1)}s`).setColor("#f87171");
      } else {
        this.ammoText.setText(`残弾 ${me.magazine} / ${magMax}`).setColor(me.magazine <= magMax * 0.25 ? "#fb923c" : "#fef08a");
      }
      const gauge = me.cls === "speed" ? `逃げ ${Math.floor(me.escapeGauge)}` : me.cls === "heavy" ? `統合 ${Math.floor(me.unifiedGauge)}` : "";
      this.skillHud.setText(`左 ${wMain} / 右 ${wSub}   [${this.bindNames.guard}] 防御   ${skillText}   ${gauge}`);
    }
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics, p: PlayerState, x: number, y: number): void {
    const meState = this.state.players.find((q) => q.id === this.me);
    const mine = p.id === this.me;
    const allied = meState ? p.team === meState.team : mine;
    const teamColor = allied ? COLORS.ally : COLORS.enemy;
    const flashing = (this.flashUntil.get(p.id) ?? 0) > this.time.now;
    const bodyColor = flashing ? 0xffffff : (CLASS_COLOR[p.cls] ?? COLORS.speed);
    const r = P.radius;
    const danger =
      this.state.mode === "teams" ? (this.state.teamLives[p.team] ?? 9) <= 1 : p.lives <= 1;
    const dangerBlink = danger && Math.floor(this.time.now / 220) % 2 === 0;
    const blink = p.invuln > 0 && Math.floor(this.time.now / 80) % 2 === 0;
    const bodyAlpha = flashing ? 1 : blink ? 0.35 : dangerBlink ? 0.55 : 0.9;

    // 形状: 速=鋭い三角 / 重=六角 / 支=円（SPEC 13章の色覚対応）
    g.fillStyle(bodyColor, bodyAlpha);
    if (p.cls === "speed") {
      const pts = [
        { x: x + Math.cos(p.aim) * r * 1.25, y: y + Math.sin(p.aim) * r * 1.25 },
        { x: x + Math.cos(p.aim + 2.5) * r, y: y + Math.sin(p.aim + 2.5) * r },
        { x: x + Math.cos(p.aim - 2.5) * r, y: y + Math.sin(p.aim - 2.5) * r },
      ];
      g.fillPoints(pts, true);
      g.lineStyle(p.guarding ? 6 : 3, p.guarding ? COLORS.guard : teamColor, 1);
      g.strokePoints(pts, true);
    } else if (p.cls === "heavy") {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = p.aim + (Math.PI / 3) * i;
        pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
      }
      g.fillPoints(pts, true);
      g.lineStyle(p.guarding ? 6 : 3, p.guarding ? COLORS.guard : teamColor, 1);
      g.strokePoints(pts, true);
    } else {
      g.fillCircle(x, y, r * 0.95);
      g.lineStyle(p.guarding ? 6 : 3, p.guarding ? COLORS.guard : teamColor, 1);
      g.strokeCircle(x, y, r * 0.95);
    }

    // 静穏オーラ（裁定9）: 薄く淡い円。tick数字は出さない
    if (p.cls === "support") {
      g.fillStyle(0xa3e635, 0.05);
      g.fillCircle(x, y, BALANCE.calmAura.radius);
      g.lineStyle(1, 0xa3e635, 0.18);
      g.strokeCircle(x, y, BALANCE.calmAura.radius);
    }

    // 向き
    g.lineStyle(3, 0xffffff, 0.7);
    g.lineBetween(x, y, x + Math.cos(p.aim) * (r + 8), y + Math.sin(p.aim) * (r + 8));

    // 世界側に乗せる「敵にも見える情報」（SPEC 13章）
    if (p.swingT > 0) {
      const m = meleeVisual(p.cls);
      // 扇の範囲（薄く・敵からも見える）
      g.fillStyle(bodyColor, 0.1);
      g.slice(x, y, m.reach + r, p.aim - m.arc, p.aim + m.arc, false);
      g.fillPath();
      g.lineStyle(1, bodyColor, 0.35);
      g.beginPath();
      g.arc(x, y, m.reach + r, p.aim - m.arc, p.aim + m.arc, false);
      g.strokePath();
      // 棒本体: キャラ中心から前方に伸ばして振る
      if (p.swingAngle !== null) {
        const a = p.aim + p.swingAngle;
        g.lineStyle(6, 0xffffff, 0.95);
        g.lineBetween(x, y, x + Math.cos(a) * (m.reach + r), y + Math.sin(a) * (m.reach + r));
        // 残像（直前の角度側へ薄く）
        const trail = p.aim + p.swingAngle * 0.75;
        g.lineStyle(4, bodyColor, 0.45);
        g.lineBetween(x, y, x + Math.cos(trail) * (m.reach + r) * 0.92, y + Math.sin(trail) * (m.reach + r) * 0.92);
      }
    }
    // グラウンドスラムの溜め（裁定21・裁定33）: 範囲は敵にも見える。円が中心から外へ広がって着弾を予告する
    if (p.slamT > 0) {
      const R = BALANCE.heavySkills.slam;
      const u = 1 - p.slamT / R.windupSeconds; // 0→1
      g.fillStyle(0xfb923c, 0.08);
      g.fillCircle(x, y, R.radius);
      g.lineStyle(2, 0xfb923c, 0.5);
      g.strokeCircle(x, y, R.radius);
      g.lineStyle(4, 0xfb923c, 0.95);
      g.strokeCircle(x, y, Math.max(P.radius, R.radius * u));
    }
    // バレットプルーフ中（裁定38）: 水色の六角シールドが取り囲む。残り時間で薄くなる
    if (p.bulletproofT > 0) {
      const S = BALANCE.supportSkills.bell;
      const u = p.bulletproofT / S.invulnSeconds; // 1→0
      const rr = r + 9;
      const rot = this.time.now / 400;
      g.lineStyle(3, 0x67e8f9, 0.35 + 0.6 * u);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = rot + (i / 6) * Math.PI * 2;
        const hx = x + Math.cos(a) * rr;
        const hy = y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(hx, hy);
        else g.lineTo(hx, hy);
      }
      g.closePath();
      g.strokePath();
      g.fillStyle(0x67e8f9, 0.12 * u);
      g.fillCircle(x, y, rr);
    }
    // ポーションの構え（裁定38）: 着弾予定地点に回復範囲の円と投擲線を出す
    if (p.potionAiming) {
      const SP = BALANCE.supportSkills.areaHeal;
      const maxD = SP.throwMaxPlayers * P.radius * 2;
      const d = p.id === this.me ? Math.min(Math.hypot(this.input.activePointer.worldX - x, this.input.activePointer.worldY - y), maxD) : maxD;
      const tx = Math.min(Math.max(P.radius, x + Math.cos(p.aim) * d), F.width - P.radius);
      const ty = Math.min(Math.max(P.radius, y + Math.sin(p.aim) * d), F.height - P.radius);
      g.lineStyle(1, 0x4ade80, 0.35);
      g.lineBetween(x, y, tx, ty);
      g.fillStyle(0x4ade80, 0.1);
      g.fillCircle(tx, ty, SP.radius);
      g.lineStyle(2, 0x4ade80, 0.6);
      g.strokeCircle(tx, ty, SP.radius);
      g.fillStyle(0x4ade80, 0.9);
      g.fillCircle(tx, ty, 4);
    }
    // ビルドウォールの構え（裁定21）: 設置予定位置にプレビューを出す
    if (p.wallAiming) {
      const W = BALANCE.heavySkills.wall;
      const maxD = W.placeMaxPlayers * P.radius * 2;
      const d = p.id === this.me ? Math.min(Math.hypot(this.input.activePointer.worldX - x, this.input.activePointer.worldY - y), maxD) : maxD;
      const cx = x + Math.cos(p.aim) * d;
      const cy = y + Math.sin(p.aim) * d;
      const half = (W.lengthPlayers * P.radius * 2) / 2;
      const nx = Math.cos(p.aim + Math.PI / 2);
      const ny = Math.sin(p.aim + Math.PI / 2);
      g.lineStyle(1, 0xfb923c, 0.3);
      g.lineBetween(x, y, cx, cy);
      g.lineStyle(W.thickness, 0xfb923c, 0.45);
      g.lineBetween(cx - nx * half, cy - ny * half, cx + nx * half, cy + ny * half);
    }
    if (p.chargeT > 0) {
      // 溜め発光（溜め量に比例）
      const u = Math.min(1, p.chargeT / BALANCE.sniper.chargeMax);
      g.lineStyle(2 + 4 * u, 0xa3e635, 0.3 + 0.6 * u);
      g.strokeCircle(x, y, r + 6 + 6 * u);
    }
    if (p.overloadShots > 0) {
      g.lineStyle(3, 0xfef08a, 0.9);
      g.strokeCircle(x + Math.cos(p.aim) * (r + 10), y + Math.sin(p.aim) * (r + 10), 6);
    }
    if (p.shell > 0) {
      g.lineStyle(3, 0x93c5fd, 0.8);
      g.strokeCircle(x, y, r + 12);
    }
    if (p.cc > 0) {
      g.lineStyle(2, 0xe879f9, 0.9);
      g.strokeCircle(x, y, r + 4);
    }
    if (p.guardBreak > 0) {
      g.lineStyle(2, 0xf97316, 0.8);
      g.strokeCircle(x, y, r + 8);
    }
    // マーク（頭上の可視スタック）
    if (p.marks && p.marks.stacks > 0) {
      g.fillStyle(0xfef08a, 1);
      for (let i = 0; i < p.marks.stacks; i++) g.fillCircle(x - 12 + i * 12, y - r - 14, 4);
    }
    // リロード円弧
    const reloadMax = p.cls === "heavy" ? BALANCE.hmg.reloadSeconds : BALANCE.pistol.reloadSeconds;
    if (p.reload > 0) {
      g.lineStyle(3, 0xfef08a, 0.9);
      g.beginPath();
      g.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - p.reload / reloadMax), false);
      g.strokePath();
    }

    // 自キャラ直下の小バー
    const bw = 64;
    const by = y + r + 10;
    const bar = (yy: number, ratio: number, color: number) => {
      g.fillStyle(0x0f172a, 0.9);
      g.fillRect(x - bw / 2, yy, bw, 5);
      g.fillStyle(color, 1);
      g.fillRect(x - bw / 2, yy, bw * Phaser.Math.Clamp(ratio, 0, 1), 5);
    };
    bar(by, p.hp / P.hp, mine ? COLORS.hp : COLORS.enemy);
    bar(by + 7, p.shield / shieldMaxOf(p.cls), COLORS.shield);
    if (mine) {
      const guardRatio = p.cls === "heavy" ? p.unifiedGauge / BALANCE.unifiedGauge.max : p.guardGauge / BALANCE.guard.max;
      bar(by + 14, guardRatio, COLORS.guard);
      if (p.cls === "speed") bar(by + 21, p.escapeGauge / BALANCE.speedSkills.gaugeMax, 0x22d3ee);
    }
  }

  private drawBullet(g: Phaser.GameObjects.Graphics, b: BulletState, x: number, y: number): void {
    // フラスコ（裁定26）: 回転しながら飛ぶ。水色=バレットプルーフ / 緑=ポーション
    if (b.kind === "bell" || b.kind === "potion") {
      const isBell = b.kind === "bell";
      const col = isBell ? 0x67e8f9 : 0x4ade80;
      // 飛んでいる間も着弾点に範囲を出しておく（裁定38）
      if (!isBell && b.tx !== undefined && b.ty !== undefined) {
        g.lineStyle(2, col, 0.45);
        g.strokeCircle(b.tx, b.ty, BALANCE.supportSkills.areaHeal.radius);
        g.fillStyle(col, 0.06);
        g.fillCircle(b.tx, b.ty, BALANCE.supportSkills.areaHeal.radius);
      }
      const spin = this.time.now / (isBell ? 40 : 90); // 速い弾ほど速く回る
      const r = b.radius;
      g.fillStyle(col, 0.25);
      g.fillCircle(x, y, r + 4);
      g.fillStyle(col, 1);
      g.fillCircle(x, y, r);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeCircle(x, y, r);
      // 首（回転を見せる棒）
      const nx = Math.cos(spin) * (r + 5);
      const ny = Math.sin(spin) * (r + 5);
      g.lineStyle(4, 0xffffff, 0.95);
      g.lineBetween(x, y, x + nx, y + ny);
      g.lineStyle(2, col, 1);
      g.lineBetween(x, y, x + nx, y + ny);
      return;
    }
    const color = b.kind === "heal" ? 0x4ade80 : b.kind === "stun" ? 0xe879f9 : b.kind === "sniper" ? 0xa3e635 : b.kind === "hmg" ? 0xfdba74 : COLORS.bullet;
    const len = b.kind === "heal" ? 8 : 16;
    const s = Math.hypot(b.vx, b.vy) || 1;
    const dx = (b.vx / s) * len;
    const dy = (b.vy / s) * len;
    g.lineStyle(b.radius + 3, color, 0.25);
    g.lineBetween(x - dx, y - dy, x, y);
    g.lineStyle(2, 0xffffff, 1);
    g.lineBetween(x - dx, y - dy, x, y);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, b.radius);
  }
}

/** 近接の見た目仕様（判定と同じ数値を balance.ts から引く） */
function meleeVisual(cls: CharClass): { reach: number; arc: number } {
  if (cls === "speed") return { reach: BALANCE.saber.reach, arc: BALANCE.saber.arcRadians };
  if (cls === "heavy") return { reach: BALANCE.knife.reach, arc: BALANCE.knife.arcRadians };
  return { reach: BALANCE.jab.reach, arc: BALANCE.jab.arcRadians };
}
