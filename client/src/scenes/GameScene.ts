import Phaser from "phaser";
import {
  BALANCE,
  moveSpeedOf,
  botInput,
  createBotMemory,
  createMatch,
  isAlive,
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
import { loadBinds, type BindAction } from "../keybinds";
import { COLORS, session } from "../session";
import { BGM, SFX } from "../sound";
import { FONT } from "../ui";

const F = BALANCE.field;
const P = BALANCE.player;
const DT = 1 / BALANCE.tickRate;
const SNAPSHOT_HZ = 20;
const INPUT_HZ = 60;
const INTERP_DELAY = 0.1;
const KILL_SLOWMO_SECONDS = 0.3;
const KILL_SLOWMO_SCALE = 0.3;

const CLASS_COLOR: Record<string, number> = { speed: COLORS.speed, heavy: 0xfb923c, support: 0xa3e635 };
const WEAPON_LABEL: Record<string, string> = { saber: "セイバー", pistol: "ピストル", hmg: "HMG", knife: "ナイフ", sniper: "スナイパー", heal: "回復弾", jab: "素手" };
const SKILL_LABEL: Record<string, [string, string, string]> = {
  speed: ["高速移動 35", "スモーク 30", "過装填"],
  heavy: ["スラム 60", "壁 70", "かばう 50"],
  support: ["鈴", "範囲回復", "スタン弾"],
};

interface Snapshot { at: number; state: SimState }

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
  private prevRight = false;
  private botMems = new Map<PlayerId, BotMemory>();

  private gfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private skillHud!: Phaser.GameObjects.Text;
  private names = new Map<PlayerId, Phaser.GameObjects.Text>();
  private keys!: Record<BindAction, Phaser.Input.Keyboard.Key>;
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
    this.state = createMatch(session.players, session.matchMode);
    this.botMems.clear();
    for (const b of session.bots) this.botMems.set(b.id, createBotMemory());
    this.inputs = {};
    this.snapshots = [];
    this.accumulator = 0;
    this.slowmo = 0;
    this.ending = false;
    this.pendingEvents = [];

    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.drawBackground();
    this.gfx = this.add.graphics();
    this.hud = this.add.text(F.width / 2, 14, "", { fontFamily: FONT, fontSize: "22px", color: COLORS.text }).setOrigin(0.5, 0);
    this.skillHud = this.add.text(F.width / 2, F.height - 14, "", { fontFamily: FONT, fontSize: "18px", color: COLORS.text }).setOrigin(0.5, 1);
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
    const key = (name: string) => kb.addKey(name === "SPACE" ? Phaser.Input.Keyboard.KeyCodes.SPACE : name);
    this.keys = {
      up: key(binds.up), down: key(binds.down), left: key(binds.left), right: key(binds.right),
      guard: key(binds.guard), switchWeapon: key(binds.switchWeapon),
      skill1: key(binds.skill1), skill2: key(binds.skill2), skill3: key(binds.skill3),
    };
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
            this.showBanner(`${p.name} が退出しました`);
          }
        }),
      );
    }
    this.events.once("shutdown", () => {
      BGM.stop();
      this.cameras.main.setZoom(1);
      this.offs.forEach((f) => f());
      this.offs = [];
      this.names.forEach((t) => t.destroy());
      this.names.clear();
    });
  }

  private leave(message: string): void {
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
          this.showBanner("処理落ち検知：演出を簡略化");
        }
      }
    }
    const input = this.readLocalInput();

    if (this.isHost) {
      this.inputs[this.me] = input;
      const scale = this.slowmo > 0 ? KILL_SLOWMO_SCALE : 1;
      this.slowmo = Math.max(0, this.slowmo - dt);
      this.accumulator += dt * scale;
      while (this.accumulator >= DT) {
        this.accumulator -= DT;
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
          if (i.switchWeapon || i.skill1 || i.skill2 || i.skill3) this.inputs[id] = { ...i, switchWeapon: false, skill1: false, skill2: false, skill3: false };
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
        session.net.sendGame({ type: "input", input }, this.hostId());
      }
      // クライアント予測: 自機の移動をローカル入力で先行させ、権威スナップショットへ吸着
      const meAuth = this.state.players.find((p) => p.id === this.me);
      if (meAuth && isAlive(meAuth)) {
        if (!this.predicted) this.predicted = { x: meAuth.x, y: meAuth.y };
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

  private readLocalInput(): PlayerInput {
    const me = this.stateFor(this.me);
    const ptr = this.input.activePointer;
    const aim = me ? Math.atan2(ptr.worldY - me.y, ptr.worldX - me.x) : 0;
    const rightNow = ptr.rightButtonDown();
    const rightEdge = rightNow && !this.prevRight;
    this.prevRight = rightNow;
    return {
      mx: (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0),
      my: (this.keys.down.isDown ? 1 : 0) - (this.keys.up.isDown ? 1 : 0),
      aim,
      fire: ptr.leftButtonDown(),
      guard: this.keys.guard.isDown,
      switchWeapon: Phaser.Input.Keyboard.JustDown(this.keys.switchWeapon) || rightEdge,
      skill1: Phaser.Input.Keyboard.JustDown(this.keys.skill1),
      skill2: Phaser.Input.Keyboard.JustDown(this.keys.skill2),
      skill3: Phaser.Input.Keyboard.JustDown(this.keys.skill3),
    };
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
          if (e.target === this.me) this.shake = Math.max(this.shake, e.center ? 6 : 3);
          if (e.attacker === this.me && e.damage > 0) {
            const now = this.time.now / 1000;
            this.combo = now - this.comboAt < 1 ? this.combo + 1 : 0;
            this.comboAt = now;
            if (e.center) SFX.center();
            else SFX.hit(this.combo); // 連続ヒットでピッチ上昇
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
        case "link": {
          const names: Record<string, string> = { breach: "ブリーチ", echoWall: "エコーウォール", mistSignal: "ミストシグナル" };
          this.showBanner(`LINK! ${names[e.pair] ?? ""}`);
          SFX.link();
          // 2人の色が混ざるエフェクト（簡易: 2色スパーク）
          for (let i = 0; i < (this.lowSpec ? 6 : 14); i++) {
            const a = (Math.PI * 2 * i) / 14;
            const c = i % 2 === 0 ? 0x22e5ff : 0xfb923c;
            const dot = this.add.circle(e.x, e.y, 4, c).setBlendMode(Phaser.BlendModes.ADD);
            this.tweens.add({ targets: dot, x: e.x + Math.cos(a) * 120, y: e.y + Math.sin(a) * 120, alpha: 0, duration: 700, onComplete: () => dot.destroy() });
          }
          break;
        }
        case "erase":
          this.popText(this.pos(e.owner).x, this.pos(e.owner).y - 44, "弾消し!", "#67e8f9", false);
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
          SFX.kill();
          // 撃破時 0.3秒スロー＋ズーム（SPEC 14章）
          const cam = this.cameras.main;
          cam.zoomTo(1.1, 120, "Cubic.Out");
          this.time.delayedCall(360, () => cam.zoomTo(1, 260, "Cubic.Out"));
          // 味方ダウン（2vs2/3v3）: バナー＋専用SE（SPEC 13章）
          const meP = this.stateFor(this.me);
          const tgt = this.stateFor(e.target);
          if (this.state.mode === "teams" && meP && tgt && tgt.team === meP.team && e.target !== this.me) {
            this.showBanner("味方ダウン！CD半減中");
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
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 650, ease: "Cubic.Out", onComplete: () => t.destroy() });
  }

  /** 毎ヒットの小さな着弾火花 */
  private impact(x: number, y: number, center: boolean): void {
    const n = center ? 6 : 4;
    const color = center ? 0xfef08a : 0xa5f3fc;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 18 + Math.random() * 26;
      const dot = this.add.circle(x, y, 2 + Math.random() * 2, color).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: dot, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, duration: 220 + Math.random() * 130, ease: "Cubic.Out", onComplete: () => dot.destroy() });
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
    for (const w of to.walls) {
      const ratio = w.hp / BALANCE.heavySkills.wall.hp;
      const base = w.echo ? 0xa3e635 : w.breach ? 0x22e5ff : 0xfb923c;
      g.lineStyle(BALANCE.heavySkills.wall.thickness, base, 0.35 + 0.5 * ratio);
      g.lineBetween(w.x1, w.y1, w.x2, w.y2);
      g.lineStyle(2, 0xffffff, w.breach ? 0.5 : 0.9);
      g.lineBetween(w.x1, w.y1, w.x2, w.y2);
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

    // HUD
    const me = to.players.find((p) => p.id === this.me);
    const tl = Math.ceil(to.timeLeft);
    const clock = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, "0")}`;
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
          const key = ["E", "R", "F"][i];
          return cd > 0 ? `[${key}] ${l} (${cd.toFixed(1)})` : `[${key}] ${l}`;
        })
        .join("   ");
      const wname = WEAPON_LABEL[WEAPONS[me.cls][me.weapon] ?? ""] ?? "";
      const gauge = me.cls === "speed" ? `逃げ ${Math.floor(me.escapeGauge)}` : me.cls === "heavy" ? `統合 ${Math.floor(me.unifiedGauge)}` : "";
      this.skillHud.setText(`武器: ${wname}（Q/右クリックで切替）   ${skillText}   ${gauge}`);
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
      // 近接の振りアーク
      g.lineStyle(4, bodyColor, 0.8);
      g.beginPath();
      g.arc(x, y, r + 16, p.aim - 1.0, p.aim + 1.0, false);
      g.strokePath();
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
