import Phaser from "phaser";
import { FONT } from "./ui";
import { VIEW } from "./viewport";

/**
 * タッチ操作（裁定40・Brawl Stars方式）
 * - 画面左側: どこを触ってもそこにスティックが出る（移動）
 * - 右側: ボタン群。タップ=即発動（オートエイム）／ドラッグ=手動照準／離す=発射／ボタンの上に戻して離す=キャンセル
 * 描画はシーンのHUD層（カメラに追従しない）に行う。入力の意味づけは GameScene 側。
 */

export type TouchButtonId = "main" | "sub" | "guard" | "skill1" | "skill2" | "skill3";

export interface TouchButtonState {
  /** 指が乗っている */
  held: boolean;
  /** このフレームで押された（消費されるまで残る） */
  pressed: boolean;
  /** このフレームで離された（消費されるまで残る） */
  released: boolean;
  /** 離した時点でキャンセル（ボタンの上に戻して離した） */
  cancelled: boolean;
  /** ドラッグ照準中 */
  aiming: boolean;
  /** 離した瞬間に照準していた（released と同時に見る。ratio/angle はその時点の値を保持） */
  releaseAiming: boolean;
  /** このフレームでドラッグ照準に入った（消費されるまで残る） */
  aimStart: boolean;
  /** 今回の押下中に一度でもドラッグ照準に入った */
  everAimed: boolean;
  /** 照準角（ラジアン）。aiming=false でも直前の値を保持 */
  angle: number;
  /** ドラッグ量 0..1 */
  ratio: number;
  /** 押してからの秒数 */
  heldFor: number;
}

const DRAG_START = 18; // これ以上動かすと照準モード
const DRAG_MAX = 96; // 照準の最大ドラッグ量
const STICK_R = 64;

/**
 * 裁定56: ボタンは画面の右下隅からの相対位置で持つ。
 * 端末が横長なほどフィールドの外（余白）へ出ていき、**指がフィールドに被らなくなる。**
 * x/y は relayout() が VIEW から毎回計算して書き込む。
 */
interface ButtonDef { id: TouchButtonId; dx: number; dy: number; x: number; y: number; r: number; color: number }

const LAYOUT: ButtonDef[] = [
  { id: "main", dx: -112, dy: -140, x: 0, y: 0, r: 72 /* 裁定63: 60→72 */, color: 0x38bdf8 },
  { id: "sub", dx: -218, dy: -65, x: 0, y: 0, r: 42, color: 0xa78bfa },
  { id: "guard", dx: -325, dy: -65, x: 0, y: 0, r: 42, color: 0xfbbf24 },
  { id: "skill1", dx: -98, dy: -268, x: 0, y: 0, r: 40, color: 0x4ade80 },
  { id: "skill2", dx: -192, dy: -302, x: 0, y: 0, r: 40, color: 0x4ade80 },
  { id: "skill3", dx: -286, dy: -268, x: 0, y: 0, r: 40, color: 0x4ade80 },
];

/** 画面の広さからボタンの実座標を決める。VIEW が変わっても追従するよう毎フレーム呼ぶ */
function relayout(): void {
  for (const b of LAYOUT) {
    b.x = VIEW.width + b.dx;
    b.y = VIEW.height + b.dy;
  }
}
relayout();

const DEPTH = 8500; // ESCメニュー(9000)より下、ゲーム描画より上

export class TouchControls {
  readonly buttons: Record<TouchButtonId, TouchButtonState>;
  /** スティック: 出ている間だけ有効 */
  stick = { active: false, pointerId: -1, baseX: 0, baseY: 0, mx: 0, my: 0 };
  private owners = new Map<number, TouchButtonId | "stick">();
  private g: Phaser.GameObjects.Graphics;
  private labels: Record<TouchButtonId, Phaser.GameObjects.Text>;
  private cooldown: Record<TouchButtonId, number> = { main: 0, sub: 0, guard: 0, skill1: 0, skill2: 0, skill3: 0 };
  private disabled: Record<TouchButtonId, boolean> = { main: false, sub: false, guard: false, skill1: false, skill2: false, skill3: false };
  private handlers: Array<() => void> = [];

  constructor(private scene: Phaser.Scene) {
    this.buttons = Object.fromEntries(
      LAYOUT.map((b) => [b.id, { held: false, pressed: false, released: false, cancelled: false, aiming: false, releaseAiming: false, aimStart: false, everAimed: false, angle: 0, ratio: 0, heldFor: 0 }]),
    ) as Record<TouchButtonId, TouchButtonState>;
    this.g = scene.add.graphics().setDepth(DEPTH).setScrollFactor(0);
    this.labels = Object.fromEntries(
      LAYOUT.map((b) => [
        b.id,
        scene.add
          .text(b.x, b.y, "", { fontFamily: FONT, fontSize: b.r >= 50 ? "16px" : "13px", color: "#f8fafc", fontStyle: "bold", align: "center" })
          .setOrigin(0.5)
          .setDepth(DEPTH + 1)
          .setScrollFactor(0),
      ]),
    ) as Record<TouchButtonId, Phaser.GameObjects.Text>;

    // 同時押しのために指を4本まで受け付ける
    scene.input.addPointer(3);
    const onDown = (p: Phaser.Input.Pointer) => this.onDown(p);
    const onMove = (p: Phaser.Input.Pointer) => this.onMove(p);
    const onUp = (p: Phaser.Input.Pointer) => this.onUp(p);
    scene.input.on("pointerdown", onDown);
    scene.input.on("pointermove", onMove);
    scene.input.on("pointerup", onUp);
    scene.input.on("pointerupoutside", onUp);
    this.handlers.push(() => {
      scene.input.off("pointerdown", onDown);
      scene.input.off("pointermove", onMove);
      scene.input.off("pointerup", onUp);
      scene.input.off("pointerupoutside", onUp);
    });
  }

  destroy(): void {
    this.handlers.forEach((h) => h());
    this.g.destroy();
    Object.values(this.labels).forEach((t) => t.destroy());
  }

  setLabel(id: TouchButtonId, text: string): void {
    this.labels[id].setText(text);
  }

  /** 0=使える / 0..1=残りCD割合（暗く塗る）。disabled=ゲージ不足などで押せない */
  setCooldown(id: TouchButtonId, ratio: number, disabled = false): void {
    this.cooldown[id] = Math.max(0, Math.min(1, ratio));
    this.disabled[id] = disabled;
  }

  /** いずれかのボタンがドラッグ照準中ならそのボタンID */
  aimingButton(): TouchButtonId | null {
    for (const b of LAYOUT) if (this.buttons[b.id].aiming) return b.id;
    return null;
  }

  /** tick で消費したエッジを消す */
  consumeEdges(): void {
    for (const b of LAYOUT) {
      const s = this.buttons[b.id];
      s.pressed = false;
      s.released = false;
      s.cancelled = false;
      s.releaseAiming = false;
      s.aimStart = false;
    }
  }

  /** 毎フレーム呼ぶ: 経過時間の更新と描画 */
  update(dt: number): void {
    relayout();
    for (const b of LAYOUT) {
      if (this.buttons[b.id].held) this.buttons[b.id].heldFor += dt;
      this.labels[b.id].setPosition(b.x, b.y);
    }
    this.draw();
  }

  // ---------------- pointer handling ----------------

  private hit(x: number, y: number): ButtonDef | null {
    let best: ButtonDef | null = null;
    let bestD = Infinity;
    for (const b of LAYOUT) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d <= b.r + 12 && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.owners.has(p.id)) return;
    const b = this.hit(p.x, p.y);
    if (b) {
      const s = this.buttons[b.id];
      if (s.held) return; // 既に別の指が乗っている
      this.owners.set(p.id, b.id);
      s.held = true;
      s.pressed = true;
      s.aiming = false;
      s.everAimed = false;
      s.ratio = 0;
      s.heldFor = 0;
      return;
    }
    // 裁定56: 判定は画面全体の左45%。フィールドの外（左の余白）を触っても動かせる
    if (p.x < VIEW.width * 0.45 && !this.stick.active) {
      this.owners.set(p.id, "stick");
      this.stick = { active: true, pointerId: p.id, baseX: p.x, baseY: p.y, mx: 0, my: 0 };
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const owner = this.owners.get(p.id);
    if (owner === undefined) return;
    if (owner === "stick") {
      const dx = p.x - this.stick.baseX;
      const dy = p.y - this.stick.baseY;
      const d = Math.hypot(dx, dy);
      const dead = 10;
      if (d < dead) { this.stick.mx = 0; this.stick.my = 0; return; }
      const mag = Math.min(1, (d - dead) / (STICK_R - dead));
      this.stick.mx = (dx / d) * mag;
      this.stick.my = (dy / d) * mag;
      // 指が遠くへ行ったら台座を引きずる（浮遊スティック）
      if (d > STICK_R) {
        this.stick.baseX = p.x - (dx / d) * STICK_R;
        this.stick.baseY = p.y - (dy / d) * STICK_R;
      }
      return;
    }
    const def = LAYOUT.find((b) => b.id === owner)!;
    const s = this.buttons[owner];
    const dx = p.x - def.x;
    const dy = p.y - def.y;
    const d = Math.hypot(dx, dy);
    if (d >= DRAG_START) {
      if (!s.aiming) s.aimStart = true;
      s.aiming = true;
      s.everAimed = true;
      s.angle = Math.atan2(dy, dx);
      s.ratio = Math.min(1, (d - DRAG_START) / (DRAG_MAX - DRAG_START));
    } else if (s.aiming) {
      // ボタンの上に戻った: 照準は解除（このまま離せばキャンセル）
      s.ratio = 0;
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const owner = this.owners.get(p.id);
    if (owner === undefined) return;
    this.owners.delete(p.id);
    if (owner === "stick") {
      this.stick = { active: false, pointerId: -1, baseX: 0, baseY: 0, mx: 0, my: 0 };
      return;
    }
    const def = LAYOUT.find((b) => b.id === owner)!;
    const s = this.buttons[owner];
    const d = Math.hypot(p.x - def.x, p.y - def.y);
    s.cancelled = s.aiming && d < def.r; // 照準した後にボタンの上へ戻して離した
    s.releaseAiming = s.aiming && !s.cancelled;
    s.held = false;
    s.released = true;
    s.aiming = false;
  }

  // ---------------- drawing ----------------

  private draw(): void {
    const g = this.g;
    g.clear();
    if (this.stick.active) {
      g.lineStyle(2, 0x94a3b8, 0.5);
      g.strokeCircle(this.stick.baseX, this.stick.baseY, STICK_R);
      g.fillStyle(0xe2e8f0, 0.35);
      g.fillCircle(this.stick.baseX + this.stick.mx * STICK_R, this.stick.baseY + this.stick.my * STICK_R, 26);
    }
    for (const b of LAYOUT) {
      const s = this.buttons[b.id];
      const cd = this.cooldown[b.id];
      const dis = this.disabled[b.id];
      g.fillStyle(b.color, s.held ? 0.55 : dis ? 0.12 : 0.28);
      g.fillCircle(b.x, b.y, b.r);
      if (cd > 0) {
        // 残りCDぶんを上から暗く塗る
        g.fillStyle(0x000000, 0.55);
        g.slice(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cd, false);
        g.fillPath();
      }
      g.lineStyle(2, b.color, s.held ? 1 : 0.7);
      g.strokeCircle(b.x, b.y, b.r);
      if (s.aiming) {
        // ドラッグ方向を示す矢印
        const ax = b.x + Math.cos(s.angle) * (b.r + 8 + s.ratio * 40);
        const ay = b.y + Math.sin(s.angle) * (b.r + 8 + s.ratio * 40);
        g.lineStyle(4, 0xffffff, 0.9);
        g.lineBetween(b.x, b.y, ax, ay);
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(ax, ay, 6);
      }
      this.labels[b.id].setAlpha(dis && !s.held ? 0.45 : 1);
    }
  }
}
