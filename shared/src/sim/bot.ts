/**
 * CPU bot（SPEC 12章）。ホスト機で実行し、毎tick PlayerInput を返す。
 * Lv1「動く的」/ Lv2「戦える」/ Lv3「チームで動く」。
 * 難易度差は3パラメータ（エイム誤差・反応遅延・スキル使用頻度）のみ。専用ロジックは作らない。
 */
import { BALANCE, type CharClass } from "../balance";
import type { PlayerId, PlayerInput, PlayerState, SimState } from "./types";
import { NULL_INPUT } from "./types";
import { isAlive, WEAPONS } from "./step";
import { canSee } from "./vision";

export type BotLevel = 1 | 2 | 3;

export interface BotMemory {
  lastThink: number;
  aim: number;
  targetId: PlayerId | null;
  strafeDir: 1 | -1;
  strafeFlipAt: number;
  desiredWeapon: number;
  fire: boolean;
  retreat: boolean;
  healAllyId: PlayerId | null;
  /** ボス（裁定49）: 次に狙いを引き直す時刻 */
  retargetAt: number;
  /** 裁定61: 敵が全員クラウドに消えたときに向かう「最後に見た位置」 */
  lastSeen: { x: number; y: number } | null;
}

export function createBotMemory(): BotMemory {
  return { lastThink: -Infinity, aim: 0, targetId: null, strafeDir: 1, strafeFlipAt: 0, desiredWeapon: 0, fire: false, retreat: false, healAllyId: null, retargetAt: 0, lastSeen: null };
}

const RANGE: Record<CharClass, number[]> = {
  // 武器スロットごとの得意距離
  speed: [55, 320],
  heavy: [340, 55],
  support: [520, 45], // 裁定10: 0=狙撃/ヒール（左）, 1=ジャブ（右）
};

function losBlocked(state: SimState, x1: number, y1: number, x2: number, y2: number): boolean {
  for (const w of state.walls) {
    // 粗い線分交差（bot用途なので厳密さより軽さ）
    const d1 = side(w.x1, w.y1, w.x2, w.y2, x1, y1);
    const d2 = side(w.x1, w.y1, w.x2, w.y2, x2, y2);
    const d3 = side(x1, y1, x2, y2, w.x1, w.y1);
    const d4 = side(x1, y1, x2, y2, w.x2, w.y2);
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  }
  return false;
}
function side(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

function pickTarget(state: SimState, me: PlayerState, level: BotLevel, mem?: BotMemory, rng: () => number = Math.random, t = 0): PlayerState | null {
  // 裁定61: クラウドに隠れた敵は狙わない（プレイヤーと同じ可視判定）
  const enemies = state.players.filter((p) => p.team !== me.team && isAlive(p) && canSee(state, me, p));
  if (enemies.length === 0) return null;
  if (me.boss && mem) {
    // 裁定49: ボスは一定時間ごとに「最も近い人」か「最もダメージを出している人」のどちらかを引き直す。
    // 常に同じ基準だと対策が固定化するため、どちらを見ているか読ませないのが狙い。
    const cur = mem.targetId ? enemies.find((p) => p.id === mem.targetId) : null;
    if (cur && t < mem.retargetAt) return cur;
    mem.retargetAt = t + BALANCE.boss.retargetSeconds;
    if (rng() < 0.5) return enemies.reduce((a, b) => (dist(me, a) <= dist(me, b) ? a : b));
    return enemies.reduce((a, b) => (a.damageDealt >= b.damageDealt ? a : b));
  }
  if (level >= 3) {
    // Lv3: 集中砲火（実質耐久が最も低い敵）
    return enemies.reduce((a, b) => (a.hp + a.shield <= b.hp + b.shield ? a : b));
  }
  return enemies.reduce((a, b) => (dist(me, a) <= dist(me, b) ? a : b));
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 思考（反応遅延ごとに更新）。エイム誤差はここで乗せる */
function think(state: SimState, me: PlayerState, mem: BotMemory, level: BotLevel, rng: () => number): void {
  const params = BALANCE.bot.levels[level];
  const target = pickTarget(state, me, level, mem, rng, state.t);
  mem.targetId = target?.id ?? null;
  mem.healAllyId = null;
  if (!target) {
    mem.fire = false;
    return;
  }
  mem.lastSeen = { x: target.x, y: target.y };

  // Lv3 支援: 負傷味方がいれば回復弾を優先
  if (level >= 3 && me.cls === "support") {
    const ally = state.players
      .filter((p) => p.id !== me.id && p.team === me.team && isAlive(p) && p.hp < BALANCE.player.hp * 0.6)
      .sort((a, b) => a.hp - b.hp)[0];
    if (ally) mem.healAllyId = ally.id;
  }

  const aimAt = mem.healAllyId ? state.players.find((p) => p.id === mem.healAllyId)! : target;
  const base = Math.atan2(aimAt.y - me.y, aimAt.x - me.x);
  mem.aim = base + (rng() * 2 - 1) * params.aimError;

  mem.retreat = me.boss ? false : me.hp < 30; // 裁定49: ボスは引かない
  // Lv3: 弔い合戦中は攻め上がる
  if (level >= 3 && state.t < me.boostUntil) mem.retreat = false;

  // 武器選択（Lv2+）
  if (level >= 2) {
    if (mem.healAllyId) {
      mem.desiredWeapon = 0; // 支援: ヒールは左クリックの単クリック
    } else {
      const d = dist(me, target);
      const ranges = RANGE[me.cls];
      let best = 0;
      let bestScore = Infinity;
      ranges.forEach((r, i) => {
        const score = Math.abs(d - r);
        if (score < bestScore) { bestScore = score; best = i; }
      });
      mem.desiredWeapon = best;
    }
  } else {
    mem.desiredWeapon = me.weapon;
  }

  const engageTarget = mem.healAllyId ? null : target;
  mem.fire = engageTarget ? !losBlocked(state, me.x, me.y, engageTarget.x, engageTarget.y) : true;

  if (state.t >= mem.strafeFlipAt) {
    mem.strafeDir = rng() < 0.5 ? 1 : -1;
    mem.strafeFlipAt = state.t + 0.8 + rng() * 0.8;
  }
}

/** スキルの条件反射（Lv2+）。skillFreq で使用確率を間引く */
function skills(state: SimState, me: PlayerState, mem: BotMemory, level: BotLevel, rng: () => number): Pick<PlayerInput, "skill1" | "skill2" | "skill3"> {
  const out = { skill1: false, skill2: false, skill3: false };
  if (level < 2) return out;
  const freq = BALANCE.bot.levels[level].skillFreq;
  const roll = () => rng() < freq;
  const target = mem.targetId ? state.players.find((p) => p.id === mem.targetId) : null;
  const d = target ? dist(me, target) : Infinity;
  const recentlyHit = state.t - me.lastDamagedAt < 0.5;

  if (me.cls === "speed") {
    if (me.escapeGauge >= BALANCE.speedSkills.gaugeMax * 0.95 && (mem.retreat || d > 450) && roll()) out.skill1 = true; // 逃げ/詰めの高速移動
    else if (mem.retreat && me.escapeGauge >= BALANCE.speedSkills.dash.cost + BALANCE.speedSkills.smoke.cost && roll()) out.skill2 = true;
    else if (me.skillCd[2] <= 0 && me.weapon === 1 && d < 420 && roll()) out.skill3 = true; // 過装填
  } else if (me.cls === "heavy") {
    if (recentlyHit && d < 130 && me.unifiedGauge >= BALANCE.heavySkills.slam.cost && roll()) out.skill1 = true; // 被弾→スラム
    else if ((me.reload > 0 || me.hp < 40) && me.unifiedGauge >= BALANCE.heavySkills.wall.cost && roll()) out.skill2 = true;
    else if (level >= 3 && state.mode === "teams" && me.unifiedGauge >= BALANCE.heavySkills.cover.cost && roll()) {
      // Lv3: かばう対象判断（近くの瀕死味方）
      const ally = state.players.find((p) => p.id !== me.id && p.team === me.team && isAlive(p) && p.hp < 35 && dist(me, p) < 420);
      if (ally) {
        mem.aim = Math.atan2(ally.y - me.y, ally.x - me.x);
        out.skill3 = true;
      }
    }
  } else {
    if (me.hp < 25 && me.skillCd[0] <= 0 && roll()) out.skill1 = true; // 鈴
    else if (state.mode === "teams" && me.skillCd[1] <= 0 && roll()) {
      const near = state.players.some((p) => p.id !== me.id && p.team === me.team && isAlive(p) && p.hp < 70 && dist(me, p) <= BALANCE.supportSkills.areaHeal.radius);
      if (near) out.skill2 = true;
    } else if (me.skillCd[2] <= 0 && target && d < 620 && mem.fire && roll()) out.skill3 = true; // スタン弾
  }
  return out;
}

export function botInput(state: SimState, botId: PlayerId, level: BotLevel, mem: BotMemory, rng: () => number = Math.random): PlayerInput {
  const me = state.players.find((p) => p.id === botId);
  if (!me || !isAlive(me)) return { ...NULL_INPUT };

  const params = BALANCE.bot.levels[level];
  if (state.t - mem.lastThink >= params.reaction) {
    mem.lastThink = state.t;
    think(state, me, mem, level, rng);
  }

  const aimAtId = mem.healAllyId ?? mem.targetId;
  const target = aimAtId ? state.players.find((p) => p.id === aimAtId) : null;
  if (!target) {
    // 裁定61: 見える敵がいない（クラウドに隠れた）なら、最後に見た位置へ歩いて暴きに行く。撃たない
    const ls = mem.lastSeen;
    if (ls && Math.hypot(ls.x - me.x, ls.y - me.y) > 24) {
      const a = Math.atan2(ls.y - me.y, ls.x - me.x);
      return { ...NULL_INPUT, aim: a, mx: Math.cos(a), my: Math.sin(a) };
    }
    return { ...NULL_INPUT, aim: mem.aim };
  }

  // 距離管理: 得意距離へ寄せる。retreat中は離れる
  const ranges = RANGE[me.cls];
  const want = mem.healAllyId ? 300 : ranges[Math.min(me.weapon, ranges.length - 1)]!;
  const d = dist(me, target);
  const toward = Math.atan2(target.y - me.y, target.x - me.x);
  let moveA: number | null = null;
  if (mem.retreat) moveA = toward + Math.PI;
  else if (d > want * 1.15) moveA = toward;
  else if (d < want * 0.7) moveA = toward + Math.PI;
  let mx = 0;
  let my = 0;
  if (moveA !== null) {
    mx = Math.cos(moveA);
    my = Math.sin(moveA);
  }
  // ストレイフ（Lv2+）
  if (level >= 2 && !mem.retreat) {
    const s = toward + (Math.PI / 2) * mem.strafeDir;
    mx += Math.cos(s) * 0.7;
    my += Math.sin(s) * 0.7;
  }
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }

  // 武器の使い分け（裁定10: 左=主武器 / 右=副武器。切替操作は廃止）
  const shoot = mem.fire && !mem.retreat;
  // Lv1は武器を選ばないので、遠距離側スロット（射撃武器）で固定する
  const defaultSlot = ranges.indexOf(Math.max(...ranges));
  const slot = level >= 2 ? mem.desiredWeapon % WEAPONS[me.cls].length : defaultSlot;
  let fire = false;
  let fire2 = false;
  if (me.cls === "support") {
    if (mem.healAllyId) {
      // ヒールは単クリック。1tickだけ押して離すことで tapSeconds 未満に収める
      fire = me.chargeT === 0;
    } else if (slot === 1) {
      fire2 = shoot; // ジャブ
    } else if (shoot || me.chargeT > 0) {
      const targetCharge = level >= 2 ? 1.1 : 0.6;
      fire = me.chargeT < targetCharge; // 溜め切ったら離して発射
    }
  } else if (slot === 1) {
    fire2 = shoot;
  } else {
    fire = shoot;
  }

  const sk = skills(state, me, mem, level, rng);
  // botはビルドウォールを「押しっぱなし」にせず、構えた次のtickで離して設置する（裁定21）
  const skill2Held = me.wallAiming ? false : sk.skill2;
  const aimDist = target ? dist(me, target) : 0;
  // botはバレットプルーフを単押し（自分に使用）で扱う
  const skill1Held = me.bellAiming ? false : sk.skill1;
  const aimAllyId = mem.healAllyId ?? null;
  return { mx, my, aim: mem.aim, fire, fire2, aimDist, skill1Held, skill2Held, aimAllyId, guard: false, ...sk };
}
