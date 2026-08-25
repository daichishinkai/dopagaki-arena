import { BALANCE, moveSpeedOf, shieldMaxOf, type CharClass } from "../balance";
import type {
  BulletKind,
  BulletState,
  HitWeapon,
  LinkPair,
  MatchResult,
  PlayerId,
  PlayerInput,
  PlayerState,
  SimEvent,
  SimState,
  SkillRecord,
  SmokeState,
  WallState,
} from "./types";
import { NULL_INPUT } from "./types";

const F = BALANCE.field;
const P = BALANCE.player;
const SH = BALANCE.shield;
const G = BALANCE.guard;

export const WEAPONS: Record<CharClass, ReadonlyArray<string>> = {
  speed: ["saber", "pistol"],
  heavy: ["hmg", "knife"],
  // 裁定10: 支援型の左は「狙撃/ヒール」融合枠、右はジャブ。ヒールは単クリックで発射される
  support: ["sniper", "jab"],
};

const SPAWNS: ReadonlyArray<{ x: number; y: number }> = [
  { x: F.width * 0.18, y: F.height * 0.5 },
  { x: F.width * 0.82, y: F.height * 0.5 },
  { x: F.width * 0.5, y: F.height * 0.18 },
  { x: F.width * 0.5, y: F.height * 0.82 },
  { x: F.width * 0.18, y: F.height * 0.2 },
  { x: F.width * 0.82, y: F.height * 0.8 },
];
/** teams: 左列=チーム0・右列=チーム1（味方が同じ側に湧く） */
const TEAM_SPAWNS: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>> = [
  [
    { x: F.width * 0.14, y: F.height * 0.3 },
    { x: F.width * 0.14, y: F.height * 0.5 },
    { x: F.width * 0.14, y: F.height * 0.7 },
  ],
  [
    { x: F.width * 0.86, y: F.height * 0.3 },
    { x: F.width * 0.86, y: F.height * 0.5 },
    { x: F.width * 0.86, y: F.height * 0.7 },
  ],
];

export function spawnPoint(mode: "ffa" | "teams", team: number, indexInTeam: number, slot: number): { x: number; y: number } {
  if (mode === "teams") {
    const col = TEAM_SPAWNS[team % 2]!;
    return col[indexInTeam % col.length]!;
  }
  return SPAWNS[slot % SPAWNS.length] ?? SPAWNS[0]!;
}

export function createPlayer(id: PlayerId, name: string, cls: CharClass, slot: number): PlayerState {
  const spawn = SPAWNS[slot % SPAWNS.length] ?? SPAWNS[0]!;
  return {
    id,
    name,
    cls,
    team: slot, // 1vs1・乱闘: 全員別チーム（2vs2はv1後半で）
    x: spawn.x,
    y: spawn.y,
    aim: 0,
    hp: P.hp,
    shield: shieldMaxOf(cls),
    lastDamagedAt: -Infinity,
    guardGauge: G.max,
    guarding: false,
    guardStartedAt: -Infinity,
    guardBreak: 0,
    lastGuardDrainSwing: -1,
    weapon: 0,
    magazine: cls === "heavy" ? BALANCE.hmg.magazine : BALANCE.pistol.magazine,
    reload: 0,
    fireCooldown: 0,
    prevFire: false,
    prevFire2: false,
    hmgSpin: 0,
    hmgFireHeld: 0,
    hmgSinceStop: Infinity,
    swingT: 0,
    swingId: 0,
    swingHitsDone: 0,
    swingAngle: null,
    swingHitIds: [],
    swingPass: -1,
    swingSub: false,
    wallAiming: false,
    slamT: 0,
    bellAiming: false,
    bellHoldT: 0,
    bulletproofT: 0,
    potionAiming: false,
    snipeBoostUntil: -Infinity,
    eraseCd: 0,
    eraseUsedThisSwing: false,
    chargeT: 0,
    holdT: 0,
    escapeGauge: BALANCE.speedSkills.gaugeMax,
    unifiedGauge: BALANCE.unifiedGauge.max,
    skillCd: [0, 0, 0],
    skillLock: [0, 0, 0],
    overloadShots: 0,
    overloadExpire: 0,
    turnLock: 0,
    lastMoveDir: null,
    dashFreeUntil: 0,
    markBoostUntil: 0,
    damageDealt: 0,
    cc: 0,
    shell: 0,
    marks: null,
    stealWindowStart: 0,
    stealWindowAmount: 0,
    lives: P.lives,
    boostUntil: 0,
    respawn: 0,
    invuln: 0,
    kills: 0,
    deaths: 0,
  };
}

export function createMatch(
  players: ReadonlyArray<{ id: PlayerId; name: string; cls?: CharClass; team?: number }>,
  mode: "ffa" | "teams" = "ffa",
  options: { practice?: boolean } = {},
): SimState {
  const half = Math.ceil(players.length / 2);
  const teamIndex: Record<number, number> = {};
  const ps = players.map((p, i) => {
    const created = createPlayer(p.id, p.name, p.cls ?? "speed", i);
    created.team = mode === "teams" ? (p.team ?? (i < half ? 0 : 1)) : (p.team ?? i);
    if (mode === "teams") {
      created.lives = 1; // 個人残機は使わない（チーム共有）
      const idx = teamIndex[created.team] ?? 0;
      teamIndex[created.team] = idx + 1;
      const sp = spawnPoint("teams", created.team, idx, i);
      created.x = sp.x;
      created.y = sp.y;
    }
    return created;
  });
  const teamLives: Record<number, number> = {};
  if (mode === "teams") {
    const sizes: Record<number, number> = {};
    for (const p of ps) sizes[p.team] = (sizes[p.team] ?? 0) + 1;
    for (const p of ps) teamLives[p.team] = (sizes[p.team] ?? 2) >= 3 ? BALANCE.teams.sharedLives3 : BALANCE.teams.sharedLives;
  }
  return {
    countdown: BALANCE.countdownSeconds,
    t: 0,
    tick: 0,
    phase: "playing",
    mode,
    teamLives,
    timeLeft: BALANCE.matchSeconds,
    practice: options.practice === true,
    players: ps,
    bullets: [],
    walls: [],
    smokes: [],
    slamZones: [],
    nextId: 1,
    recentSkills: [],
    pendingLinks: [],
    linkWindows: [],
    linkCount: 0,
    maxLinkDamage: 0,
    result: null,
  };
}

export function isAlive(p: PlayerState): boolean {
  return p.respawn <= 0 && p.lives > 0;
}

// ---------------- 幾何 ----------------
function closestPointOnSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + dx * t, y: ay + dy * t, t, d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) };
}

/** 線分同士の最近接。戻り: 距離と、線分1側のパラメータ */
function segSegClosest(p1x: number, p1y: number, p2x: number, p2y: number, q1x: number, q1y: number, q2x: number, q2y: number) {
  const d1x = p2x - p1x, d1y = p2y - p1y;
  const d2x = q2x - q1x, d2y = q2y - q1y;
  const rx = p1x - q1x, ry = p1y - q1y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    s = 0; t = 0;
  } else if (a <= 1e-9) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= 1e-9) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  const cx = p1x + d1x * s, cy = p1y + d1y * s;
  const dx = q1x + d2x * t, dy = q1y + d2y * t;
  return { d: Math.hypot(cx - dx, cy - dy), s, wallT: t };
}

export function falloffMultiplier(distance: number): number {
  const ratio = distance / F.width;
  for (const band of BALANCE.pistol.falloff) if (ratio <= band.maxRatio) return band.multiplier;
  return 0.5;
}

// ---------------- ダメージ・CC ----------------
export interface DamageResult { hpDamage: number; shieldDamage: number; total: number }

export function applyDamage(target: PlayerState, rawDamage: number): DamageResult {
  let dmg = rawDamage * BALANCE.classes[target.cls].damageTaken;
  if (target.shell > 0) dmg *= 1 - BALANCE.heavySkills.cover.shellDamageCut;
  const shieldDamage = Math.min(target.shield, dmg);
  const hpDamage = Math.min(target.hp, dmg - shieldDamage);
  target.shield -= shieldDamage;
  target.hp -= hpDamage;
  return { hpDamage, shieldDamage, total: shieldDamage + hpDamage };
}

/** 重複CC半減（SPEC 5.5）: CC中への追加CCは効果時間半減で加算 */
export function applyCC(target: PlayerState, seconds: number): void {
  target.cc = target.cc > 0 ? target.cc + seconds * BALANCE.cc.stackMultiplier : seconds;
  target.guarding = false;
  target.chargeT = 0;
  target.holdT = 0;
  target.swingT = 0;
}

/** 秒間キャップ付きの回復量を返す（rolling 1秒窓） */
function cappedSteal(p: PlayerState, t: number, want: number, capPerSecond: number): number {
  if (t - p.stealWindowStart >= 1) {
    p.stealWindowStart = t;
    p.stealWindowAmount = 0;
  }
  const allowed = Math.max(0, capPerSecond - p.stealWindowAmount);
  const got = Math.min(want, allowed);
  p.stealWindowAmount += got;
  return got;
}

/** LINK成立後3秒間の参加者与ダメを集計（最大連携ダメージ） */
function recordLinkDamage(state: SimState, attackerId: PlayerId, amount: number): void {
  for (const w of state.linkWindows) {
    if (state.t <= w.until && (w.owners[0] === attackerId || w.owners[1] === attackerId)) {
      w.damage += amount;
      if (w.damage > state.maxLinkDamage) state.maxLinkDamage = w.damage;
    }
  }
}

function gainShield(p: PlayerState, amount: number): void {
  p.shield = Math.min(shieldMaxOf(p.cls), p.shield + amount);
}

// ---------------- 弾生成 ----------------
function spawnBullet(state: SimState, p: PlayerState, kind: BulletKind, angle: number, speed: number, damage: number, radius: number, normal: boolean, reflects: number): BulletState {
  const muzzle = P.radius + radius + 2;
  const x = p.x + Math.cos(angle) * muzzle;
  const y = p.y + Math.sin(angle) * muzzle;
  const b: BulletState = {
    id: state.nextId++,
    kind,
    owner: p.id,
    ownerTeam: p.team,
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    ox: x, oy: y,
    damage, radius, normal,
    reflectsLeft: reflects,
    boost: 1,
    mist: false,
  };
  state.bullets.push(b);
  return b;
}

// ---------------- 武器処理 ----------------
function firePistol(state: SimState, p: PlayerState, events: SimEvent[]): void {
  if (p.fireCooldown > 0 || p.reload > 0) return;
  if (p.magazine <= 0) { p.reload = BALANCE.pistol.reloadSeconds; return; }
  p.magazine -= 1;
  p.fireCooldown = 1 / BALANCE.pistol.shotsPerSecond;
  p.invuln = 0;
  let dmg = BALANCE.pistol.damage;
  if (p.overloadShots > 0 && state.t < p.overloadExpire) {
    dmg *= BALANCE.speedSkills.overload.damageMultiplier;
    p.overloadShots -= 1;
  }
  spawnBullet(state, p, "pistol", p.aim, BALANCE.pistol.bulletSpeed, dmg, BALANCE.pistol.bulletRadius, true, 0);
  events.push({ type: "shoot", owner: p.id, x: p.x, y: p.y, kind: "pistol" });
  if (p.magazine <= 0) p.reload = BALANCE.pistol.reloadSeconds;
}

function fireHmg(state: SimState, p: PlayerState, dt: number, events: SimEvent[]): void {
  const H = BALANCE.hmg;
  p.hmgSpin += dt;
  p.hmgSinceStop = 0;
  if (p.hmgSpin < H.spinupSeconds) return;
  p.hmgFireHeld += dt;
  if (p.fireCooldown > 0 || p.reload > 0) return;
  if (p.magazine <= 0) { p.reload = H.reloadSeconds; return; }
  p.magazine -= 1;
  p.fireCooldown = 1 / H.shotsPerSecond;
  p.invuln = 0;
  const u = Math.min(1, p.hmgFireHeld / H.convergeSeconds);
  const spread = H.spreadStartRad + (H.spreadEndRad - H.spreadStartRad) * u;
  const angle = p.aim + (Math.random() * 2 - 1) * spread;
  spawnBullet(state, p, "hmg", angle, H.bulletSpeed, H.damage, H.bulletRadius, true, 0);
  events.push({ type: "shoot", owner: p.id, x: p.x, y: p.y, kind: "hmg" });
  if (p.magazine <= 0) p.reload = H.reloadSeconds;
}

function releaseSniper(state: SimState, p: PlayerState, events: SimEvent[]): void {
  const S = BALANCE.sniper;
  const charge = Math.min(p.chargeT, S.chargeMax);
  p.chargeT = 0;
  p.holdT = 0;
  if (charge < S.chargeMin) return; // 0.3秒未満は発射不可
  const u = (charge - S.chargeMin) / (S.chargeMax - S.chargeMin);
  const dmg = S.damageMin + (S.damageMax - S.damageMin) * u;
  const radius = S.radiusMax + (S.radiusMin - S.radiusMax) * u;
  const speed = S.speedBase * (1 + (S.speedMaxMultiplier - 1) * u);
  p.invuln = 0;
  spawnBullet(state, p, "sniper", p.aim, speed, dmg, radius, false, S.wallReflects);
  events.push({ type: "shoot", owner: p.id, x: p.x, y: p.y, kind: "sniper" });
}

function fireHeal(state: SimState, p: PlayerState, events: SimEvent[]): void {
  const H = BALANCE.healShot;
  if (p.fireCooldown > 0) return;
  p.fireCooldown = H.intervalSeconds;
  spawnBullet(state, p, "heal", p.aim, H.bulletSpeed, 0, H.bulletRadius, true, H.wallReflects);
  events.push({ type: "shoot", owner: p.id, x: p.x, y: p.y, kind: "heal" });
}

function startSwing(p: PlayerState, sub: boolean, events: SimEvent[]): void {
  const spec = meleeSpec(p.cls);
  p.swingT = spec.total;
  p.swingId += 1;
  p.swingHitsDone = 0;
  p.swingHitIds = [];
  p.swingSub = sub;
  p.swingAngle = stickAngleAt(spec, 0);
  p.eraseUsedThisSwing = false;
  p.invuln = 0;
  events.push({ type: "swing", owner: p.id });
}

/**
 * 1つの武器スロットを処理する（裁定10）。
 * sub=false は左クリック（主武器）、sub=true は右クリック（副武器）。
 * 近接はスイング中に他方を出せないよう swingT で自然に排他になる。
 */
function useWeapon(
  state: SimState,
  p: PlayerState,
  w: string,
  sub: boolean,
  down: boolean,
  prevDown: boolean,
  input: PlayerInput,
  dt: number,
  events: SimEvent[],
): void {
  if (down) p.weapon = sub ? 1 : 0;
  if (w === "pistol") {
    if (down) firePistol(state, p, events);
  } else if (w === "hmg") {
    if (down) fireHmg(state, p, dt, events);
  } else if (w === "sniper") {
    // 支援型の左クリック: 押している間だけ溜め、離した瞬間の溜め時間で3分岐
    if (down) {
      if (p.swingT > 0) return; // ジャブ中は溜めない
      p.chargeT += dt;
      if (p.chargeT >= BALANCE.sniper.chargeMax) {
        p.holdT += dt;
        if (p.holdT >= BALANCE.sniper.holdMaxSeconds) releaseSupportPrimary(state, p, events); // 超過で自動発射
      }
    } else if (prevDown) {
      releaseSupportPrimary(state, p, events);
    }
  } else if (w === "heal") {
    if (down) fireHeal(state, p, events);
  } else {
    // 近接（saber / knife / jab）。刀は押しっぱなしで連続しない（裁定25）
    const edgeOnly = w === "saber";
    if (down && (!edgeOnly || !prevDown) && p.swingT <= 0) startSwing(p, sub, events);
  }
}

/**
 * 支援型の左クリックを離したときの分岐（裁定10）。
 * 単クリック(<tapSeconds)=ヒール / それ以上 chargeMin 未満=不発（溜めフェイント） / chargeMin 以上=狙撃
 */
function releaseSupportPrimary(state: SimState, p: PlayerState, events: SimEvent[]): void {
  const S = BALANCE.sniper;
  const charge = p.chargeT;
  if (charge < S.tapSeconds) {
    p.chargeT = 0;
    p.holdT = 0;
    // 裁定27: スタン弾を当てた直後の単押しは、即最大溜めの狙撃になる（威力は通常の最大溜めの60%）
    if (state.t <= p.snipeBoostUntil) {
      p.snipeBoostUntil = -Infinity;
      const dmg = S.damageMax * S.boostDamageRatio;
      p.invuln = 0;
      spawnBullet(state, p, "sniper", p.aim, S.speedBase * S.speedMaxMultiplier, dmg, S.radiusMin, false, S.wallReflects);
      events.push({ type: "shoot", owner: p.id, x: p.x, y: p.y, kind: "sniper" });
      return;
    }
    fireHeal(state, p, events);
    return;
  }
  releaseSniper(state, p, events); // chargeMin 未満なら中で不発になる
}

interface MeleeSpec {
  total: number;
  damage: number;
  reach: number;
  arc: number;
  /** 棒が扇を掃く区間。passes=往復数×2（片道1パス） */
  sweep: { start: number; passes: number; passSeconds: number };
}

function meleeSpec(cls: CharClass): MeleeSpec {
  if (cls === "speed") return { total: BALANCE.saber.swingSeconds, damage: BALANCE.saber.damagePerHit, reach: BALANCE.saber.reach, arc: BALANCE.saber.arcRadians, sweep: BALANCE.saber.sweep };
  if (cls === "heavy") return { total: BALANCE.knife.swingSeconds, damage: BALANCE.knife.damage, reach: BALANCE.knife.reach, arc: BALANCE.knife.arcRadians, sweep: BALANCE.knife.sweep };
  return { total: BALANCE.jab.swingSeconds, damage: BALANCE.jab.damage, reach: BALANCE.jab.reach, arc: BALANCE.jab.arcRadians, sweep: BALANCE.jab.sweep };
}

/**
 * 経過時間における棒の角度（p.aim からの相対角）。掃き区間外は null。
 * パスごとに向きが反転するので、passes=4 なら「左端→右端→左端→右端→左端」の2往復になる。
 */
/** 経過時間におけるパス番号（掃き区間外は null） */
export function stickPassAt(spec: MeleeSpec, elapsed: number): number | null {
  const { start, passes, passSeconds } = spec.sweep;
  const rel = elapsed - start;
  if (rel < 0 || rel > passes * passSeconds) return null;
  return Math.min(passes - 1, Math.floor(rel / passSeconds));
}

export function stickAngleAt(spec: MeleeSpec, elapsed: number): number | null {
  const { start, passes, passSeconds } = spec.sweep;
  const rel = elapsed - start;
  if (rel < 0 || rel > passes * passSeconds) return null;
  const idx = Math.min(passes - 1, Math.floor(rel / passSeconds));
  const u = (rel - idx * passSeconds) / passSeconds; // 0..1
  // 偶数パスは -arc → +arc、奇数パスは +arc → -arc
  return idx % 2 === 0 ? -spec.arc + 2 * spec.arc * u : spec.arc - 2 * spec.arc * u;
}

/**
 * 相手の相対角（p.aim基準・-PI..PI）と、その見かけの角度半幅。射程外なら null。
 * 裁定23: 中心点だけで判定すると、体が扇に重なっていても中心が外なら当たらず
 * 「先端に判定がない」ように感じる。相手の半径ぶんの角度幅を許容に含める。
 */
/** -PI..PI に畳む。非有限値でも無限ループしないようにガードする */
function normalizeAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  let v = (a + Math.PI) % (Math.PI * 2);
  if (v < 0) v += Math.PI * 2;
  return v - Math.PI;
}

function relAngle(p: PlayerState, target: PlayerState, reach: number): { da: number; half: number } | null {
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d > reach + P.radius) return null;
  const da = normalizeAngle(Math.atan2(dy, dx) - p.aim);
  // 距離dから見た半径P.radiusの見込み角。密着時は広く、先端では狭くなる
  const half = d <= P.radius ? Math.PI : Math.asin(Math.min(1, P.radius / d));
  return { da, half };
}

/** クラスごとの近接武器名（裁定37: ヒット音の分岐用） */
function meleeWeapon(cls: CharClass): HitWeapon {
  return cls === "speed" ? "saber" : cls === "heavy" ? "knife" : "jab";
}

/** 棒が prevA→curA と動く間に相手の体（角度幅half）を横切ったか（裁定13・23） */
function stickCrossed(da: number, half: number, prevA: number, curA: number): boolean {
  const lo = Math.min(prevA, curA) - half;
  const hi = Math.max(prevA, curA) + half;
  return da >= lo && da <= hi;
}

/** 棒が prevA→curA と掃いた区間で横切った相手にヒットを入れる（裁定13） */
function meleeSweepHit(state: SimState, p: PlayerState, prevA: number, curA: number, events: SimEvent[]): void {
  const spec = meleeSpec(p.cls);
  for (const target of state.players) {
    if (target.team === p.team || !isAlive(target)) continue;
    const rel = relAngle(p, target, spec.reach);
    if (rel === null || !stickCrossed(rel.da, rel.half, prevA, curA)) continue;
    if (p.swingHitIds.includes(target.id)) continue; // 1パスにつき1ヒット（裁定23）
    const firstOnTarget = p.swingHitsDone === 0;

    if (target.guarding) {
      // ジャスガ: 直前0.1秒以内の入力ならゲージ消費なし＋攻撃側を軽くのけぞらせる
      if (state.t - target.guardStartedAt <= G.justWindowSeconds) {
        applyCC(p, G.justStaggerSeconds);
        events.push({ type: "justGuard", target: target.id, attacker: p.id });
        continue;
      }
      // 三すくみ 防御>近接: 無効化。多段のゲージ削りは1振り1回分
      if (target.lastGuardDrainSwing !== p.swingId) {
        target.lastGuardDrainSwing = p.swingId;
        drainGuard(target, G.meleeCost, events);
      }
      events.push({ type: "hit", target: target.id, attacker: p.id, x: target.x, y: target.y, damage: 0, center: false, guarded: true, melee: true, weapon: meleeWeapon(p.cls) });
      continue;
    }
    if (target.invuln > 0) continue;

    let dmg = spec.damage;
    // マーク回収: セイバー初撃が全スタック消費（SPEC 6.1）
    if (p.cls === "speed" && firstOnTarget && target.marks && target.marks.from === p.id && state.t < target.marks.expire) {
      const stacks = target.marks.stacks;
      dmg += BALANCE.saber.markBonusDamage * stacks;
      p.escapeGauge = Math.min(BALANCE.speedSkills.gaugeMax, p.escapeGauge + BALANCE.saber.markGaugeRefund * stacks);
      target.marks = null;
    }
    p.swingHitIds.push(target.id);
    p.swingHitsDone += 1;
    const result = applyDamage(target, dmg);
    target.lastDamagedAt = state.t;
    p.damageDealt += result.total;
    recordLinkDamage(state, p.id, result.total);
    events.push({ type: "hit", target: target.id, attacker: p.id, x: target.x, y: target.y, damage: result.total, center: false, guarded: false, melee: true, weapon: meleeWeapon(p.cls) });

    // 回復系: セイバー=背面180度限定シールド2/hit(キャップ12/s)、ナイフ=与ダメ50%+ゲージ20、素手=HP+3(キャップ8/s・シールドと置換)
    if (p.cls === "speed") {
      const tx = Math.cos(target.aim), ty = Math.sin(target.aim);
      const ax = p.x - target.x, ay = p.y - target.y;
      const behind = tx * ax + ty * ay < 0;
      if (behind) gainShield(p, cappedSteal(p, state.t, BALANCE.saber.lifestealPerHit, BALANCE.saber.lifestealCapPerSecond));
    } else if (p.cls === "heavy") {
      gainShield(p, result.total * (p.cls === "heavy" ? SH.heavyLifestealRatio : SH.lifestealRatio));
      p.unifiedGauge = Math.min(BALANCE.unifiedGauge.max, p.unifiedGauge + BALANCE.unifiedGauge.knifeHitGain);
    } else {
      const heal = cappedSteal(p, state.t, BALANCE.jab.hpStealPerHit, BALANCE.jab.hpStealCapPerSecond);
      p.hp = Math.min(P.hp, p.hp + heal);
    }
    if (target.hp <= 0) onKill(state, target, p, events);
  }
}

function drainGuard(target: PlayerState, cost: number, events: SimEvent[]): void {
  if (target.cls === "heavy") {
    target.unifiedGauge = Math.max(0, target.unifiedGauge - cost);
    if (target.unifiedGauge <= 0) breakGuard(target, events);
  } else {
    target.guardGauge = Math.max(0, target.guardGauge - cost);
    if (target.guardGauge <= 0) breakGuard(target, events);
  }
}

function breakGuard(target: PlayerState, events: SimEvent[]): void {
  target.guarding = false;
  target.guardBreak = G.breakStunSeconds * (target.cls === "heavy" ? G.heavyBreakMultiplier : 1);
  events.push({ type: "guardBreak", target: target.id });
}

function onKill(state: SimState, target: PlayerState, attacker: PlayerState | undefined, events: SimEvent[]): void {
  target.hp = 0;
  target.deaths += 1;
  target.guarding = false;
  target.cc = 0;
  if (state.practice) {
    // 訓練場（裁定35）: 残機は減らさず、通常の復活時間で自動復活
    target.respawn = P.respawnSeconds;
  } else if (state.mode === "teams") {
    const pool = (state.teamLives[target.team] ?? 0) - 1;
    state.teamLives[target.team] = pool;
    if (pool > 0) {
      target.respawn = P.respawnSeconds;
    } else {
      target.lives = 0; // 補充なし。以後は永久退場
      target.respawn = Infinity;
    }
    // 弔い合戦: 味方撃破後10秒、残メンバーを強化（SPEC 5.4）
    for (const ally of state.players) {
      if (ally.team === target.team && ally.id !== target.id && ally.lives > 0) {
        ally.boostUntil = state.t + BALANCE.teams.mourningSeconds;
      }
    }
  } else {
    target.lives -= 1;
    target.respawn = target.lives > 0 ? P.respawnSeconds : Infinity;
  }
  if (attacker) {
    attacker.kills += 1;
    attacker.hp = Math.min(P.hp, attacker.hp + P.killHealHp);
  }
  events.push({ type: "kill", target: target.id, attacker: attacker?.id ?? target.id });
}

// ---------------- スキル ----------------
function pathBlockedByWall(state: SimState, x1: number, y1: number, x2: number, y2: number, team?: number): number | null {
  let minS: number | null = null;
  for (const w of state.walls) {
    if (w.breach && team !== undefined && w.ownerTeam === team) continue; // ブリーチ壁は味方すり抜け可
    const hit = segSegClosest(x1, y1, x2, y2, w.x1, w.y1, w.x2, w.y2);
    if (hit.d <= BALANCE.heavySkills.wall.thickness / 2 + P.radius) {
      if (minS === null || hit.s < minS) minS = hit.s;
    }
  }
  return minS;
}

/** グラウンドスラムの効果本体（裁定21: windup後に呼ばれる） */
function detonateSlam(state: SimState, p: PlayerState, events: SimEvent[]): void {
  const S = BALANCE.heavySkills;
  state.bullets = state.bullets.filter((b) => !(b.ownerTeam !== p.team && Math.hypot(b.x - p.x, b.y - p.y) <= S.slam.radius));
  for (const t of state.players) {
    if (t.team === p.team || !isAlive(t) || t.invuln > 0) continue;
    if (Math.hypot(t.x - p.x, t.y - p.y) <= S.slam.radius) applyCC(t, S.slam.staggerSeconds);
  }
  state.walls = state.walls.filter((w) => {
    if (w.ownerTeam === p.team) return true;
    const c = closestPointOnSegment(w.x1, w.y1, w.x2, w.y2, p.x, p.y);
    if (c.d <= S.slam.radius) { events.push({ type: "wallBreak", id: w.id }); return false; }
    return true;
  });
  state.smokes = state.smokes.filter((sm) => !(sm.owner !== p.id && Math.hypot(sm.x - p.x, sm.y - p.y) <= S.slam.radius));
  // スキルリンク受付（裁定28）: のけぞりが切れるまでスタン弾／ポーションの着弾を待つ
  state.slamZones.push({ owner: p.id, team: p.team, x: p.x, y: p.y, until: state.t + S.slam.staggerSeconds });
}

/** スラム痕跡に投擲物が着弾したときのスキルリンク（裁定28）。成立したら true */
function trySlamLink(state: SimState, team: number, kind: "slamStun" | "slamPotion", x: number, y: number, owner: PlayerId, events: SimEvent[]): boolean {
  const R = BALANCE.heavySkills.slam.radius;
  const zone = state.slamZones.find((z) => z.team === team && state.t <= z.until && Math.hypot(z.x - x, z.y - y) <= R);
  if (!zone) return false;
  if (kind === "slamStun") {
    for (const t of state.players) {
      if (t.team === team || !isAlive(t) || t.invuln > 0) continue;
      if (Math.hypot(t.x - zone.x, t.y - zone.y) <= R) applyCC(t, BALANCE.link.slamStun.stunSeconds);
    }
  } else {
    for (const t of state.players) {
      if (t.team !== team || !isAlive(t)) continue;
      if (Math.hypot(t.x - zone.x, t.y - zone.y) <= R) {
        const before = t.hp;
        t.hp = Math.min(P.hp, t.hp + BALANCE.link.slamPotion.heal);
        if (t.hp > before) events.push({ type: "heal", target: t.id, from: owner, amount: t.hp - before, x: t.x, y: t.y });
      }
    }
  }
  const owners: [PlayerId, PlayerId] = [zone.owner, owner];
  state.linkCount += 1;
  state.linkWindows.push({ until: state.t + BALANCE.link.damageWindowSeconds, owners, damage: 0 });
  events.push({ type: "slamLink", pair: kind, x: zone.x, y: zone.y, ox: x, oy: y, radius: R });
  events.push({ type: "link", pair: kind, owners, x: zone.x, y: zone.y });
  return true;
}

/** ビルドウォールを設置する（裁定21: 構えを離した位置・最大5キャラ分） */
function placeWall(state: SimState, p: PlayerState, input: PlayerInput, events: SimEvent[]): void {
  const S = BALANCE.heavySkills;
  const maxD = S.wall.placeMaxPlayers * P.radius * 2;
  const d = Math.min(Math.max(0, input.aimDist), maxD);
  const cx = Math.min(Math.max(P.radius, p.x + Math.cos(p.aim) * d), F.width - P.radius);
  const cy = Math.min(Math.max(P.radius, p.y + Math.sin(p.aim) * d), F.height - P.radius);
  const half = (S.wall.lengthPlayers * P.radius * 2) / 2;
  // 壁はカーソル方向に対して直交に立てる（従来と同じ向きの決め方）
  const nx = Math.cos(p.aim + Math.PI / 2);
  const ny = Math.sin(p.aim + Math.PI / 2);
  const wallId = state.nextId++;
  state.walls.push({
    id: wallId,
    owner: p.id,
    ownerTeam: p.team,
    x1: cx - nx * half, y1: cy - ny * half,
    x2: cx + nx * half, y2: cy + ny * half,
    hp: S.wall.hp,
    expire: state.t + S.wall.seconds,
    breach: false,
    echo: false,
  });
  recordSkill(state, p, "wall", wallId);
}

/** バレットプルーフを付与する（裁定26。自分への単押し／味方への着弾の両方） */
function applyBulletproof(p: PlayerState, from: PlayerId, events: SimEvent[]): void {
  const S = BALANCE.supportSkills;
  p.invuln = Math.max(p.invuln, S.bell.invulnSeconds);
  p.bulletproofT = S.bell.invulnSeconds;
  p.cc = 0;
  p.guardBreak = 0;
  events.push({ type: "bulletproof", target: p.id, from, x: p.x, y: p.y });
}

/** ポーション着弾（裁定26）: 範囲の味方を回復。自分は selfRatio 倍だけ回復する */
function detonatePotion(state: SimState, owner: PlayerState, x: number, y: number, events: SimEvent[]): void {
  const S = BALANCE.supportSkills.areaHeal;
  events.push({ type: "potion", owner: owner.id, x, y, radius: S.radius });
  for (const t of state.players) {
    if (t.team !== owner.team || !isAlive(t)) continue;
    if (Math.hypot(t.x - x, t.y - y) > S.radius) continue;
    const amount = t.id === owner.id ? S.heal * S.selfRatio : S.heal;
    const before = t.hp;
    t.hp = Math.min(P.hp, t.hp + amount);
    if (t.hp > before) events.push({ type: "heal", target: t.id, from: owner.id, amount: t.hp - before, x: t.x, y: t.y });
  }
  trySlamLink(state, owner.team, "slamPotion", x, y, owner.id, events);
}

function useSkill(state: SimState, p: PlayerState, index: 0 | 1 | 2, input: PlayerInput, events: SimEvent[]): void {
  const lock = p.skillLock[index];
  if (lock > 0 || p.skillCd[index] > 0) return;

  const spendGauge = (cost: number, kind: "escape" | "unified"): boolean => {
    const cur = kind === "escape" ? p.escapeGauge : p.unifiedGauge;
    if (cur < cost) return false;
    if (kind === "escape") p.escapeGauge = cur - cost;
    else p.unifiedGauge = cur - cost;
    p.skillLock[index] = kind === "escape" ? BALANCE.speedSkills.sameSkillLockSeconds : BALANCE.heavySkills.sameSkillLockSeconds;
    return true;
  };

  if (p.cls === "speed") {
    const S = BALANCE.speedSkills;
    if (index === 0) {
      if (!spendGauge(S.dash.cost, "escape")) return;
      const len = Math.hypot(input.mx, input.my);
      const dir = len > 0.01 ? Math.atan2(input.my, input.mx) : p.aim;
      const dist = F.width * S.dash.distanceRatio;
      let tx = p.x + Math.cos(dir) * dist;
      let ty = p.y + Math.sin(dir) * dist;
      // キャラのみすり抜け。生成物（壁）は抜けられない
      const blocked = pathBlockedByWall(state, p.x, p.y, tx, ty, p.team);
      if (blocked !== null) {
        const s = Math.max(0, blocked - 0.05);
        tx = p.x + (tx - p.x) * s;
        ty = p.y + (ty - p.y) * s;
      }
      const fromX = p.x, fromY = p.y;
      p.x = Math.min(F.width - P.radius, Math.max(P.radius, tx));
      p.y = Math.min(F.height - P.radius, Math.max(P.radius, ty));
      p.dashFreeUntil = state.t + BALANCE.turnLock.dashExemptSeconds;
      events.push({ type: "sonic", owner: p.id, fromX, fromY, x: p.x, y: p.y });
      recordSkill(state, p, "dash", null);
    } else if (index === 1) {
      if (!spendGauge(S.smoke.cost, "escape")) return;
      const smokeId = state.nextId++;
      state.smokes.push({ id: smokeId, owner: p.id, ownerTeam: p.team, x: p.x, y: p.y, radius: S.smoke.radius, expire: state.t + S.smoke.seconds, mist: false });
      recordSkill(state, p, "smoke", smokeId);
    } else {
      // 過装填: 独立CD10秒
      p.skillCd[2] = S.overload.cooldown;
      p.overloadShots = S.overload.shots;
      p.overloadExpire = state.t + S.overload.expireSeconds;
    }
  } else if (p.cls === "heavy") {
    const S = BALANCE.heavySkills;
    if (index === 0) {
      // 裁定21: ゲージは構え開始時に消費し、windup後に発動する（中断しても返らない）
      if (p.slamT > 0) return;
      if (!spendGauge(S.slam.cost, "unified")) return;
      p.slamT = S.slam.windupSeconds;
      events.push({ type: "slamWindup", owner: p.id });
    } else if (index === 1) {
      // 裁定21: 押した瞬間にゲージを消費して「構え」に入る。離した位置に設置される
      if (p.wallAiming) return;
      if (!spendGauge(S.wall.cost, "unified")) return;
      p.wallAiming = true;
    } else {
      // かばう: 2vs2は味方へ吸着ダッシュ＋到着後3秒シェル。1vs1・乱闘は前方ダッシュ＋1秒シェル（SPEC 6.2）
      if (!spendGauge(S.cover.cost, "unified")) return;
      let dist: number = S.cover.fallbackDashDistance;
      let dir = p.aim;
      let shellSec: number = S.cover.fallbackShellSeconds;
      if (state.mode === "teams") {
        let best: PlayerState | null = null;
        let bestScore = Infinity;
        for (const ally of state.players) {
          if (ally.id === p.id || ally.team !== p.team || !isAlive(ally)) continue;
          let da = Math.atan2(ally.y - p.y, ally.x - p.x) - p.aim;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          const score = Math.abs(da); // カーソル方向最寄り
          if (score < bestScore) { bestScore = score; best = ally; }
        }
        if (best) {
          const d = Math.hypot(best.x - p.x, best.y - p.y);
          dir = Math.atan2(best.y - p.y, best.x - p.x);
          dist = Math.min(BALANCE.teams.cover.dashMax, Math.max(0, d - P.radius * 2 - BALANCE.teams.cover.arriveGap));
          shellSec = BALANCE.teams.cover.shellSeconds;
        }
      }
      let tx = p.x + Math.cos(dir) * dist;
      let ty = p.y + Math.sin(dir) * dist;
      const blocked = pathBlockedByWall(state, p.x, p.y, tx, ty);
      if (blocked !== null) {
        const s = Math.max(0, blocked - 0.05);
        tx = p.x + (tx - p.x) * s;
        ty = p.y + (ty - p.y) * s;
      }
      p.x = Math.min(F.width - P.radius, Math.max(P.radius, tx));
      p.y = Math.min(F.height - P.radius, Math.max(P.radius, ty));
      p.shell = shellSec;
    }
  } else {
    const S = BALANCE.supportSkills;
    if (index === 0) {
      // バレットプルーフ（裁定26）: 押した瞬間は構えるだけ。CDは離したときに消費する
      if (p.bellAiming) return;
      p.bellAiming = true;
      p.bellHoldT = 0;
    } else if (index === 1) {
      // ポーション（裁定26）: 押す→離すでカーソル位置へ投擲。CDは離したときに消費する
      if (p.potionAiming) return;
      p.potionAiming = true;
    } else {
      p.skillCd[2] = S.stun.cooldown;
      p.invuln = 0;
      const stunBullet = spawnBullet(state, p, "stun", p.aim, S.stun.bulletSpeed, 0, S.stun.bulletRadius, false, BALANCE.sniper.wallReflects);
      recordSkill(state, p, "stun", stunBullet.id);
    }
  }
  events.push({ type: "skill", owner: p.id, skill: index });
}

// ---------------- 層2合体技（SPEC 7.2） ----------------
const LINK_DEFS: ReadonlyArray<{ pair: LinkPair; a: SkillRecord["kind"]; b: SkillRecord["kind"] }> = [
  { pair: "breach", a: "wall", b: "dash" },
  { pair: "lightning", a: "smoke", b: "stun" },
];

function recordSkill(state: SimState, p: PlayerState, kind: SkillRecord["kind"], refId: number | null): void {
  const rec: SkillRecord = { owner: p.id, team: p.team, kind, t: state.t, x: p.x, y: p.y, refId };
  // 相方（同チーム・別人・0.5秒以内・画面幅25%以内）を探す
  const maxDist = F.width * BALANCE.link.maxDistanceRatio;
  for (const other of state.recentSkills) {
    if (other.team !== p.team || other.owner === p.id) continue;
    if (state.t - other.t > BALANCE.link.windowSeconds) continue;
    if (Math.hypot(other.x - rec.x, other.y - rec.y) > maxDist) continue;
    for (const def of LINK_DEFS) {
      const match =
        (rec.kind === def.a && other.kind === def.b) || (rec.kind === def.b && other.kind === def.a);
      if (!match) continue;
      const wallRec = rec.kind === "wall" ? rec : other.kind === "wall" ? other : null;
      const smokeRec = rec.kind === "smoke" ? rec : other.kind === "smoke" ? other : null;
      const stunRec = rec.kind === "stun" ? rec : other.kind === "stun" ? other : null;
      state.pendingLinks.push({
        pair: def.pair,
        applyAt: state.t + BALANCE.link.stanceSeconds,
        team: p.team,
        owners: [other.owner, p.id],
        refA: wallRec?.refId ?? smokeRec?.refId ?? null,
        refB: def.pair === "breach" ? (rec.kind === "dash" ? null : null) : stunRec?.refId ?? null,
      });
      state.linkCount += 1;
      state.recentSkills = state.recentSkills.filter((r) => r !== other);
      return; // 1発動につき1成立
    }
  }
  state.recentSkills.push(rec);
}

/** 構え0.3秒を経てLINKボーナスを適用 */
function applyPendingLinks(state: SimState, events: SimEvent[]): void {
  if (state.pendingLinks.length === 0) return;
  const remain: typeof state.pendingLinks = [];
  for (const link of state.pendingLinks) {
    if (state.t < link.applyAt) {
      remain.push(link);
      continue;
    }
    const at = { x: F.width / 2, y: F.height / 2 };
    if (link.pair === "breach") {
      const wall = state.walls.find((w) => w.id === link.refA);
      if (wall) {
        wall.breach = true; // 味方のみすり抜け可（生成物すり抜け不可の唯一の例外）
        at.x = (wall.x1 + wall.x2) / 2;
        at.y = (wall.y1 + wall.y2) / 2;
      }
      for (const id of link.owners) {
        const p = state.players.find((q) => q.id === id);
        if (p && p.cls === "speed") p.markBoostUntil = state.t + BALANCE.link.breach.markBoostSeconds;
      }
    } else {
      const smoke = state.smokes.find((sm) => sm.id === link.refA);
      const bullet = state.bullets.find((b) => b.id === link.refB);
      if (smoke) {
        smoke.mist = true;
        at.x = smoke.x;
        at.y = smoke.y;
        // 成立した瞬間に霧が炸裂する（SPEC 7.2）。
        // スタン弾が構え0.3秒より先にスモークを通過してしまう配置でも成立効果が消えないようにする。
        for (const t of state.players) {
          if (t.team === link.team || !isAlive(t) || t.invuln > 0) continue;
          if (Math.hypot(t.x - smoke.x, t.y - smoke.y) <= smoke.radius) {
            applyCC(t, BALANCE.link.lightning.stunSeconds);
            events.push({ type: "hit", target: t.id, attacker: link.owners[0]!, x: t.x, y: t.y, damage: 0, center: false, guarded: false, melee: false, weapon: "link" });
          }
        }
      }
      if (bullet) bullet.mist = true;
    }
    state.linkWindows.push({ until: state.t + BALANCE.link.damageWindowSeconds, owners: link.owners, damage: 0 });
    events.push({ type: "link", pair: link.pair, owners: link.owners, x: at.x, y: at.y });
  }
  state.pendingLinks = remain;
}

// ---------------- 弾の当たり ----------------
function resolveBulletPlayerHit(state: SimState, b: BulletState, target: PlayerState, attacker: PlayerState | undefined, hitX: number, hitY: number, perp: number, events: SimEvent[]): void {
  if (b.kind === "heal") {
    if (target.team === b.ownerTeam) {
      if (target.hp < P.hp) {
        const before = target.hp;
        target.hp = Math.min(P.hp, target.hp + BALANCE.healShot.heal * b.boost);
        events.push({ type: "heal", target: target.id, from: b.owner, amount: target.hp - before, x: hitX, y: hitY });
      }
    }
    return; // 敵に当たると消滅・ダメージ0（ボディブロック）
  }
  if (b.kind === "stun") {
    if (target.invuln > 0) return;
    applyCC(target, BALANCE.supportSkills.stun.stunSeconds);
    target.skillCd = [
      target.skillCd[0] + BALANCE.supportSkills.stun.cdDelaySeconds,
      target.skillCd[1] + BALANCE.supportSkills.stun.cdDelaySeconds,
      target.skillCd[2] + BALANCE.supportSkills.stun.cdDelaySeconds,
    ];
    events.push({ type: "hit", target: target.id, attacker: b.owner, x: hitX, y: hitY, damage: 0, center: false, guarded: false, melee: false, weapon: b.kind });
    // 裁定27: 通常ヒットで「次の狙撃が即最大溜め」を獲得（スピード型の粘着対策）
    const shooter = state.players.find((q) => q.id === b.owner);
    if (shooter) shooter.snipeBoostUntil = state.t + BALANCE.supportSkills.stun.snipeBoostSeconds;
    return;
  }

  if (target.guarding) {
    if (state.t - target.guardStartedAt <= G.justWindowSeconds) {
      events.push({ type: "justGuard", target: target.id, attacker: b.owner });
      return;
    }
    drainGuard(target, G.shotCost, events);
    events.push({ type: "hit", target: target.id, attacker: b.owner, x: hitX, y: hitY, damage: 0, center: false, guarded: true, melee: false, weapon: b.kind });
    return;
  }
  if (target.invuln > 0) return;

  const center = perp <= P.radius * P.centerHitRatio;
  let dmg = b.damage * b.boost;
  if (b.kind === "pistol") dmg *= falloffMultiplier(Math.hypot(hitX - b.ox, hitY - b.oy));
  if (center) dmg *= P.centerHitMultiplier;

  const result = applyDamage(target, dmg);
  target.lastDamagedAt = state.t;
  if (attacker) attacker.damageDealt += result.total;
  recordLinkDamage(state, b.owner, result.total);
  events.push({ type: "hit", target: target.id, attacker: b.owner, x: hitX, y: hitY, damage: result.total, center, guarded: false, melee: false, weapon: b.kind });

  if (attacker) {
    gainShield(attacker, result.total * (attacker.cls === "heavy" ? SH.heavyLifestealRatio : SH.lifestealRatio));
    if (b.kind === "hmg") attacker.unifiedGauge = Math.min(BALANCE.unifiedGauge.max, attacker.unifiedGauge + BALANCE.unifiedGauge.hmgHitGain);
    if (b.kind === "pistol" && attacker.cls === "speed") {
      const prev = target.marks && target.marks.from === attacker.id && state.t < target.marks.expire ? target.marks.stacks : 0;
      const gain = state.t < attacker.markBoostUntil ? BALANCE.link.breach.markBoostMultiplier : 1;
      target.marks = { from: attacker.id, stacks: Math.min(BALANCE.pistol.markMax, prev + gain), expire: state.t + BALANCE.pistol.markSeconds };
    }
  }
  if (target.hp <= 0) onKill(state, target, attacker, events);
}

// ---------------- 判定 ----------------
export function judgeTimeout(state: SimState): MatchResult {
  if (state.mode === "teams") {
    const teams = Object.keys(state.teamLives).map(Number);
    const score = (team: number) => ({
      lives: state.teamLives[team] ?? 0,
      hp: state.players.filter((p) => p.team === team && isAlive(p)).reduce((s, p) => s + p.hp, 0),
    });
    const sorted = teams.map((t) => ({ team: t, ...score(t) })).sort((a, b) => b.lives - a.lives || b.hp - a.hp);
    const [f, sec] = [sorted[0], sorted[1]];
    if (!f) return { winner: null, winnerTeam: null, reason: "draw" };
    const rep = state.players.find((p) => p.team === f.team)!;
    if (!sec || f.lives !== sec.lives) return { winner: rep.id, winnerTeam: f.team, reason: "timeout-lives" };
    if (f.hp !== sec.hp) return { winner: rep.id, winnerTeam: f.team, reason: "timeout-hp" };
    return { winner: null, winnerTeam: null, reason: "draw" };
  }
  const sorted = [...state.players].sort((a, b) => b.lives - a.lives || b.hp - a.hp);
  const first = sorted[0];
  const second = sorted[1];
  if (!first) return { winner: null, winnerTeam: null, reason: "draw" };
  if (!second) return { winner: first.id, winnerTeam: first.team, reason: "timeout-lives" };
  if (first.lives !== second.lives) return { winner: first.id, winnerTeam: first.team, reason: "timeout-lives" };
  if (first.hp !== second.hp) return { winner: first.id, winnerTeam: first.team, reason: "timeout-hp" };
  return { winner: null, winnerTeam: null, reason: "draw" };
}

function clearHeavyCharges(p: PlayerState): void {
  p.wallAiming = false;
  p.slamT = 0;
}

function respawnPlayer(state: SimState, p: PlayerState, events: SimEvent[]): void {
  const slot = state.players.findIndex((q) => q.id === p.id);
  const idxInTeam = state.players.filter((q, i) => q.team === p.team && i < slot).length;
  const spawn = spawnPoint(state.mode, p.team, idxInTeam, slot);
  const fresh = createPlayer(p.id, p.name, p.cls, slot);
  Object.assign(p, fresh, {
    lives: p.lives,
    kills: p.kills,
    deaths: p.deaths,
    damageDealt: p.damageDealt,
    boostUntil: p.boostUntil,
    team: p.team,
    x: spawn.x,
    y: spawn.y,
    invuln: P.respawnInvulnSeconds,
    respawn: 0,
  });
  events.push({ type: "respawn", target: p.id });
}

function checkMatchEnd(state: SimState, events: SimEvent[]): void {
  if (state.players.length < 2) return;
  if (state.practice) return; // 訓練場（裁定35）: 試合終了なし
  let result: MatchResult | null = null;
  if (state.mode === "teams") {
    const aliveTeams = new Set(state.players.filter((p) => p.lives > 0).map((p) => p.team));
    if (aliveTeams.size <= 1) {
      const team = [...aliveTeams][0] ?? null;
      const rep = team !== null ? state.players.find((p) => p.team === team) : undefined;
      result = { winner: rep?.id ?? null, winnerTeam: team, reason: rep ? "lives" : "draw" };
    } else if (state.timeLeft <= 0) {
      result = judgeTimeout(state);
    }
  } else {
    const survivors = state.players.filter((p) => p.lives > 0);
    if (survivors.length <= 1) {
      result = { winner: survivors[0]?.id ?? null, winnerTeam: survivors[0]?.team ?? null, reason: survivors[0] ? "lives" : "draw" };
    } else if (state.timeLeft <= 0) {
      result = judgeTimeout(state);
    }
  }
  if (result) {
    state.phase = "ended";
    state.result = result;
    state.bullets = [];
    events.push({ type: "matchEnd", result });
  }
}

// ---------------- メインループ ----------------
export function step(prev: SimState, inputs: Readonly<Record<PlayerId, PlayerInput>>, dt: number): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  if (prev.phase === "ended") return { state: prev, events };

  // 開始カウントダウン中（裁定16）は時間も含めて一切進めない
  if (prev.countdown > 0) {
    const left = Math.max(0, prev.countdown - dt);
    if (Math.ceil(left) !== Math.ceil(prev.countdown)) events.push({ type: "countdown", left: Math.ceil(left) });
    return { state: { ...prev, countdown: left }, events };
  }

  const state: SimState = {
    ...prev,
    t: prev.t + dt,
    tick: prev.tick + 1,
    timeLeft: prev.practice ? prev.timeLeft : Math.max(0, prev.timeLeft - dt),
    players: prev.players.map((p) => ({ ...p, skillCd: [...p.skillCd] as [number, number, number], skillLock: [...p.skillLock] as [number, number, number], marks: p.marks ? { ...p.marks } : null })),
    bullets: prev.bullets.map((b) => ({ ...b })),
    walls: prev.walls.map((w) => ({ ...w })),
    smokes: prev.smokes.map((s) => ({ ...s })),
    // 裁定28の受付枠。複製しないと前フレームの状態を書き換えてしまい、
    // 破棄しないと無限に伸びてスナップショットが肥大化する
    slamZones: prev.slamZones.filter((z) => prev.t <= z.until).map((z) => ({ ...z })),
    recentSkills: [...prev.recentSkills],
    pendingLinks: [...prev.pendingLinks],
    linkWindows: prev.linkWindows.map((w) => ({ ...w })),
  };
  const byId = new Map(state.players.map((p) => [p.id, p]));

  // 生成物の期限
  state.walls = state.walls.filter((w) => state.t < w.expire && w.hp > 0);
  state.smokes = state.smokes.filter((s) => state.t < s.expire);

  // 層2: 構え0.3秒後のボーナス適用・古い記録の掃除
  applyPendingLinks(state, events);
  state.recentSkills = state.recentSkills.filter((r) => state.t - r.t <= BALANCE.link.windowSeconds + 0.05);
  state.linkWindows = state.linkWindows.filter((w) => state.t <= w.until);

  for (const p of state.players) {
    const input = inputs[p.id] ?? NULL_INPUT;

    // タイマー
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.guardBreak = Math.max(0, p.guardBreak - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.bulletproofT = Math.max(0, Math.min(p.bulletproofT - dt, p.invuln)); // 無敵が攻撃で解除されたら表示も消す
    p.eraseCd = Math.max(0, p.eraseCd - dt);
    p.cc = Math.max(0, p.cc - dt);
    p.shell = Math.max(0, p.shell - dt);
    p.turnLock = Math.max(0, p.turnLock - dt);
    const boostRate = state.t < p.boostUntil ? BALANCE.teams.mourningRate : 1;
    p.skillCd = p.skillCd.map((c) => Math.max(0, c - dt * boostRate)) as [number, number, number];
    p.skillLock = p.skillLock.map((c) => Math.max(0, c - dt)) as [number, number, number];
    if (p.marks && state.t >= p.marks.expire) p.marks = null;
    if (p.reload > 0) {
      p.reload -= dt;
      if (p.reload <= 0) {
        p.reload = 0;
        p.magazine = p.cls === "heavy" ? BALANCE.hmg.magazine : BALANCE.pistol.magazine;
      }
    }
    // HMGスピン維持・拡散リセット
    if (!(input.fire && p.cls === "heavy")) {
      p.hmgSinceStop += dt;
      if (p.hmgSinceStop > BALANCE.hmg.spinKeepSeconds) {
        p.hmgSpin = 0;
        if (p.hmgSinceStop > BALANCE.hmg.spinKeepSeconds + BALANCE.hmg.spreadResetSeconds) p.hmgFireHeld = 0;
      }
    }

    if (p.lives <= 0) continue;
    if (p.respawn > 0) {
      p.respawn -= dt;
      if (p.respawn <= 0) respawnPlayer(state, p, events);
      p.prevFire = input.fire;
      p.prevFire2 = input.fire2;
      continue;
    }

    const locked = p.guardBreak > 0 || p.cc > 0;
    if (!locked) {
      p.aim = input.aim;

      // 移動（クラス速度・スナイパー溜め中85%）
      let mx = input.mx, my = input.my;
      const len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      let speed = moveSpeedOf(p.cls);
      if (p.cls === "support" && p.chargeT > 0) speed *= BALANCE.sniper.moveMultiplierWhileCharging;
      if (p.cls === "speed") {
        const T = BALANCE.turnLock;
        if (len > 0.01) {
          const desired = Math.atan2(my, mx);
          if (p.lastMoveDir !== null && state.t >= p.dashFreeUntil && p.turnLock <= 0) {
            let da = Math.abs(desired - p.lastMoveDir);
            while (da > Math.PI) da = Math.abs(da - Math.PI * 2);
            if (da >= T.minAngleRad) {
              const deg45 = Math.PI / 4;
              const u = Math.min(1, Math.max(0, (da - deg45) / (Math.PI - deg45)));
              p.turnLock = T.at45 + (T.at180 - T.at45) * u;
            }
          }
          p.lastMoveDir = desired;
        } else {
          p.lastMoveDir = null; // 停止からの動き出しは硬直なし
        }
        if (p.turnLock > 0) speed = 0; // 硬直中は移動のみ停止（攻撃・照準は通常どおり）
      }
      p.x += mx * speed * dt;
      p.y += my * speed * dt;

      // ガード（近接スイング中は不可）
      const canGuard = p.swingT <= 0 && (p.cls === "heavy" ? p.unifiedGauge > 0 : p.guardGauge > 0);
      const wasGuarding = p.guarding;
      p.guarding = input.guard && canGuard;
      if (p.guarding && !wasGuarding) p.guardStartedAt = state.t;

      // スキル
      if (input.skill1) useSkill(state, p, 0, input, events);
      if (input.skill2) useSkill(state, p, 1, input, events);
      if (input.skill3) useSkill(state, p, 2, input, events);

      // バレットプルーフの構え（裁定26）: 単押し=自分／長押し=選んだ味方へ追尾投擲
      if (p.bellAiming) {
        p.bellHoldT += dt;
        const SB = BALANCE.supportSkills.bell;
        if (input.fire2 || input.cancel) {
          p.bellAiming = false; // 右クリックでキャンセル（CDは消費しない）
        } else if (!input.skill1Held) {
          p.bellAiming = false;
          if (p.bellHoldT < SB.tapSeconds) {
            applyBulletproof(p, p.id, events);
            p.skillCd[0] = SB.cooldown;
          } else {
            const ally = input.aimAllyId ? state.players.find((q) => q.id === input.aimAllyId && q.team === p.team && isAlive(q)) : undefined;
            if (ally) {
              const ang = Math.atan2(ally.y - p.y, ally.x - p.x);
              const b = spawnBullet(state, p, "bell", ang, SB.bulletSpeed, 0, SB.bulletRadius, false, 0);
              b.homingId = ally.id;
              p.skillCd[0] = SB.cooldown;
            }
            // 対象がいなければ不発（CDも消費しない）
          }
        }
      }

      // ポーションの構え（裁定26）
      if (p.potionAiming) {
        const SP = BALANCE.supportSkills.areaHeal;
        if (input.fire2 || input.cancel) {
          p.potionAiming = false;
        } else if (!input.skill2Held) {
          p.potionAiming = false;
          const maxD = SP.throwMaxPlayers * P.radius * 2;
          const d = Math.min(Math.max(0, input.aimDist), maxD);
          const tx = Math.min(Math.max(P.radius, p.x + Math.cos(p.aim) * d), F.width - P.radius);
          const ty = Math.min(Math.max(P.radius, p.y + Math.sin(p.aim) * d), F.height - P.radius);
          const b = spawnBullet(state, p, "potion", p.aim, SP.bulletSpeed, 0, SP.bulletRadius, false, 0);
          b.tx = tx;
          b.ty = ty;
          p.skillCd[1] = SP.cooldown;
          recordSkill(state, p, "areaHeal", b.id); // リンク判定は投げた瞬間に記録
        }
      }

      // ビルドウォールの構え（裁定21）: 右クリックでキャンセル（ゲージは返らない）／離すと設置
      if (p.wallAiming) {
        if (input.fire2 || input.cancel) {
          p.wallAiming = false;
          events.push({ type: "wallAim", owner: p.id, cancelled: true });
        } else if (!input.skill2Held) {
          p.wallAiming = false;
          placeWall(state, p, input, events);
        }
      }

      // 攻撃（裁定10: 左クリック=主武器 / 右クリック=副武器。武器切替という操作は廃止）
      if (!p.guarding) {
        const list = WEAPONS[p.cls];
        useWeapon(state, p, list[0]!, false, input.fire, p.prevFire, input, dt, events);
        // ビルドウォール構え中の右クリックはキャンセル専用（裁定21）
        if (!p.wallAiming) useWeapon(state, p, list[1]!, true, input.fire2, p.prevFire2, input, dt, events);
      }
    } else {
      p.guarding = false;
    }

    // グラウンドスラムの溜め進行（裁定21）
    if (p.slamT > 0) {
      p.slamT = Math.max(0, p.slamT - dt);
      if (p.slamT <= 0) detonateSlam(state, p, events);
    }

    // 近接スイング進行（CC中は startSwing 側で止まる。進行中は継続）
    if (p.swingT > 0) {
      const spec = meleeSpec(p.cls);
      p.swingT = Math.max(0, p.swingT - dt);
      const elapsed = spec.total - p.swingT;
      // 棒の掃き（裁定13）: 前tickの角度から今tickの角度まで動く間に横切った相手へヒット
      const curPass = stickPassAt(spec, elapsed);
      if (curPass !== null && curPass !== p.swingPass) {
        p.swingPass = curPass;
        p.swingHitIds = [];
      }
      const curAngle = stickAngleAt(spec, elapsed);
      if (curAngle !== null) {
        const prevAngle = p.swingAngle ?? curAngle;
        meleeSweepHit(state, p, prevAngle, curAngle, events);
      }
      p.swingAngle = curAngle;
      if (p.swingT <= 0) p.swingAngle = null;
      // セイバー弾消し: 0.2〜0.35秒・通常弾のみ・内部CD1.5秒
      if (p.cls === "speed" && p.eraseCd <= 0 && !p.eraseUsedThisSwing) {
        const E = BALANCE.saber.erase;
        if (elapsed >= E.start && elapsed <= E.start + E.duration) {
          const before = state.bullets.length;
          state.bullets = state.bullets.filter((b) => !(b.normal && b.ownerTeam !== p.team && Math.hypot(b.x - p.x, b.y - p.y) <= BALANCE.saber.reach + 20));
          const count = before - state.bullets.length;
          if (count > 0) {
            p.eraseCd = E.cooldown;
            p.eraseUsedThisSwing = true;
            events.push({ type: "erase", owner: p.id, count });
          }
        }
      }
    }

    // 回復
    if (!p.guarding) {
      if (p.cls === "heavy") p.unifiedGauge = Math.min(BALANCE.unifiedGauge.max, p.unifiedGauge + BALANCE.unifiedGauge.regenPerSecond * dt * boostRate);
      else p.guardGauge = Math.min(G.max, p.guardGauge + G.regenPerSecond * dt);
    }
    if (p.cls === "speed") p.escapeGauge = Math.min(BALANCE.speedSkills.gaugeMax, p.escapeGauge + BALANCE.speedSkills.gaugeRegenPerSecond * dt * boostRate);
    if (BALANCE.classes[p.cls].shieldTimeRegen && state.t - p.lastDamagedAt >= SH.regenDelaySeconds) {
      gainShield(p, SH.regenPerSecond * dt);
    }

    // 壁との衝突（押し出し）・外壁
    for (const w of state.walls) {
      if (w.breach && w.ownerTeam === p.team) continue; // ブリーチ壁は味方すり抜け可
      const c = closestPointOnSegment(w.x1, w.y1, w.x2, w.y2, p.x, p.y);
      const minDist = BALANCE.heavySkills.wall.thickness / 2 + P.radius;
      if (c.d < minDist && c.d > 1e-6) {
        const push = (minDist - c.d) / c.d;
        p.x += (p.x - c.x) * push;
        p.y += (p.y - c.y) * push;
      }
    }
    p.x = Math.min(F.width - P.radius, Math.max(P.radius, p.x));
    p.y = Math.min(F.height - P.radius, Math.max(P.radius, p.y));

    p.prevFire = input.fire;
    p.prevFire2 = input.fire2;
  }

  // 静穏オーラ（裁定9）: 支援型の周囲の「落ち着いた」味方HPを静かに回復
  {
    const healed = new Set<PlayerId>();
    for (const sup of state.players) {
      if (sup.cls !== "support" || !isAlive(sup)) continue; // ダウン・リスポーン待ち中は消える
      for (const q of state.players) {
        if (q.team !== sup.team || !isAlive(q) || healed.has(q.id)) continue; // 非スタック
        if (q.hp >= P.hp) continue;
        if (state.t - q.lastDamagedAt < BALANCE.calmAura.calmSeconds) continue; // 戦闘中は効かない
        if (Math.hypot(q.x - sup.x, q.y - sup.y) > BALANCE.calmAura.radius) continue;
        q.hp = Math.min(P.hp, q.hp + BALANCE.calmAura.healPerSecond * dt); // シールドは対象外
        healed.add(q.id);
      }
    }
  }

  // 弾更新
  const aliveBullets: BulletState[] = [];
  for (const b of state.bullets) {
    // 回復弾ホーミング（味方のみ・HP満タンには吸着しない）
    if (b.kind === "heal") {
      let best: PlayerState | null = null;
      let bestD = Infinity;
      for (const t of state.players) {
        if (t.id === b.owner || t.team !== b.ownerTeam || !isAlive(t) || t.hp >= P.hp) continue;
        const d = Math.hypot(t.x - b.x, t.y - b.y);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best) {
        const want = Math.atan2(best.y - b.y, best.x - b.x);
        const cur = Math.atan2(b.vy, b.vx);
        let da = want - cur;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const turn = Math.max(-BALANCE.healShot.homingRadPerSecond * dt, Math.min(BALANCE.healShot.homingRadPerSecond * dt, da));
        const speed = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(cur + turn) * speed;
        b.vy = Math.sin(cur + turn) * speed;
      }
    }

    // バレットプルーフ: 指定した味方を追尾（裁定26）
    if (b.kind === "bell" && b.homingId) {
      const t = state.players.find((q) => q.id === b.homingId && isAlive(q));
      if (t) {
        const want = Math.atan2(t.y - b.y, t.x - b.x);
        const cur = Math.atan2(b.vy, b.vx);
        let da = want - cur;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const lim = BALANCE.supportSkills.bell.homingRadPerSecond * dt;
        const turn = Math.max(-lim, Math.min(lim, da));
        const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(cur + turn) * sp;
        b.vy = Math.sin(cur + turn) * sp;
      }
    }

    const px = b.x, py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // ポーション: 指定地点に到達したら炸裂（裁定26）。途中の敵や壁は貫通する
    if (b.kind === "potion" && b.tx !== undefined && b.ty !== undefined) {
      const owner = state.players.find((q) => q.id === b.owner);
      const before = Math.hypot(px - b.tx, py - b.ty);
      const now = Math.hypot(b.x - b.tx, b.y - b.ty);
      if (owner && (now <= b.radius + 4 || now > before)) {
        detonatePotion(state, owner, b.tx, b.ty, events);
        continue;
      }
      aliveBullets.push(b);
      continue;
    }
    // バレットプルーフ: 対象の味方に届いたら無敵付与（裁定26）
    if (b.kind === "bell") {
      const t = b.homingId ? state.players.find((q) => q.id === b.homingId) : undefined;
      if (!t || !isAlive(t)) continue; // 対象が消えたら弾も消える
      if (Math.hypot(b.x - t.x, b.y - t.y) <= P.radius + b.radius) {
        applyBulletproof(t, b.owner, events);
        continue;
      }
      aliveBullets.push(b);
      continue;
    }

    // スラム×スタン（裁定28）: のけぞりが切れる前にスタン弾がスラム範囲へ入ると感電が広がる
    if (b.kind === "stun" && trySlamLink(state, b.ownerTeam, "slamStun", b.x, b.y, b.owner, events)) continue;

    // ライトニング: 対象スタン弾が対象クラウド内に入ると炸裂（SPEC 7.2）
    if (b.mist && b.kind === "stun") {
      const smoke = state.smokes.find((sm) => sm.mist && sm.ownerTeam === b.ownerTeam && Math.hypot(b.x - sm.x, b.y - sm.y) <= sm.radius);
      if (smoke) {
        for (const t of state.players) {
          if (t.team === b.ownerTeam || !isAlive(t) || t.invuln > 0) continue;
          if (Math.hypot(t.x - smoke.x, t.y - smoke.y) <= smoke.radius) {
            applyCC(t, BALANCE.link.lightning.stunSeconds);
            events.push({ type: "hit", target: t.id, attacker: b.owner, x: t.x, y: t.y, damage: 0, center: false, guarded: false, melee: false, weapon: "link" });
          }
        }
        continue; // 弾は消滅
      }
    }

    // 生成壁: 反射弾は反射（耐久を削らない）。それ以外は直撃でダメージ分の耐久減
    let consumed = false;
    let earliest: { s: number; kind: "wall" | "player"; wall?: WallState; player?: PlayerState; x: number; y: number; perp: number } | null = null;
    for (const w of state.walls) {
      const hit = segSegClosest(px, py, b.x, b.y, w.x1, w.y1, w.x2, w.y2);
      if (hit.d <= BALANCE.heavySkills.wall.thickness / 2 + b.radius) {
        if (!earliest || hit.s < earliest.s) earliest = { s: hit.s, kind: "wall", wall: w, x: px + (b.x - px) * hit.s, y: py + (b.y - py) * hit.s, perp: 0 };
      }
    }
    for (const target of state.players) {
      if (target.id === b.owner || !isAlive(target)) continue;
      if (b.kind !== "heal" && target.team === b.ownerTeam) continue; // フレンドリーファイアなし
      if (b.kind === "heal" && target.team === b.ownerTeam && target.hp >= P.hp) continue; // 満タンには吸着も命中もしない
      const c = closestPointOnSegment(px, py, b.x, b.y, target.x, target.y);
      if (c.d <= P.radius + b.radius) {
        const speed = Math.hypot(b.vx, b.vy) || 1;
        const perp = Math.abs((target.x - px) * b.vy - (target.y - py) * b.vx) / speed;
        if (!earliest || c.t < earliest.s) earliest = { s: c.t, kind: "player", player: target, x: c.x, y: c.y, perp };
      }
    }
    if (earliest) {
      if (earliest.kind === "wall" && earliest.wall) {
        const w = earliest.wall;
        if (b.reflectsLeft > 0) {
          // 反射（壁法線で速度を反転）。反射弾は耐久を削らない
          const wx = w.x2 - w.x1, wy = w.y2 - w.y1;
          const wl = Math.hypot(wx, wy) || 1;
          const nx = -wy / wl, ny = wx / wl;
          const dot = b.vx * nx + b.vy * ny;
          b.vx -= 2 * dot * nx;
          b.vy -= 2 * dot * ny;
          b.reflectsLeft -= 1;

          const sp = Math.hypot(b.vx, b.vy) || 1;
          const off = BALANCE.heavySkills.wall.thickness / 2 + b.radius + 2;
          b.x = earliest.x + (b.vx / sp) * off;
          b.y = earliest.y + (b.vy / sp) * off;
          b.ox = b.x; b.oy = b.y; // 減衰は反射後の距離で再計算
        } else {
          w.hp -= Math.max(1, b.damage);
          if (w.hp <= 0) events.push({ type: "wallBreak", id: w.id });
          consumed = true;
        }
      } else if (earliest.player) {
        resolveBulletPlayerHit(state, b, earliest.player, byId.get(b.owner), earliest.x, earliest.y, earliest.perp, events);
        consumed = true;
      }
    }
    if (consumed) continue;

    // 外壁: 支援の反射弾は1回反射、他は消滅
    if (b.x < b.radius || b.x > F.width - b.radius || b.y < b.radius || b.y > F.height - b.radius) {
      if (b.reflectsLeft > 0) {
        if (b.x < b.radius || b.x > F.width - b.radius) b.vx = -b.vx;
        if (b.y < b.radius || b.y > F.height - b.radius) b.vy = -b.vy;
        b.x = Math.min(F.width - b.radius, Math.max(b.radius, b.x));
        b.y = Math.min(F.height - b.radius, Math.max(b.radius, b.y));
        b.reflectsLeft -= 1;
        b.ox = b.x; b.oy = b.y;
      } else {
        continue;
      }
    }
    aliveBullets.push(b);
  }
  state.bullets = aliveBullets;
  state.walls = state.walls.filter((w) => w.hp > 0);

  checkMatchEnd(state, events);
  return { state, events };
}
