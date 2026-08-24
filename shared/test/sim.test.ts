import { describe, expect, it } from "vitest";
import { BALANCE, MOVE_SPEED, shieldMaxOf } from "../src/balance";
import { applyDamage, createMatch as createMatchRaw, createPlayer, falloffMultiplier, judgeTimeout, step } from "../src/sim/step";
import type { PlayerInput, SimState } from "../src/sim/types";
import { NULL_INPUT } from "../src/sim/types";

/** テストは開始カウントダウン（裁定16）をスキップして本編だけを検証する */
const createMatch: typeof createMatchRaw = (...args) => {
  const s = createMatchRaw(...args);
  s.countdown = 0;
  return s;
};


const DT = 1 / BALANCE.tickRate;

function run(state: SimState, inputs: Record<string, PlayerInput>, seconds: number) {
  let s = state;
  const events = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const r = step(s, inputs, DT);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

function twoPlayers(): SimState {
  const s = createMatch([
    { id: "a", name: "A", cls: "speed" },
    { id: "b", name: "B", cls: "support" },
  ]);
  return s;
}

describe("balance.ts は SPEC.md 16章と一致する", () => {
  it("HP100 / シールド50 / 残機3 / リスポーン3秒 / 無敵1秒", () => {
    expect(BALANCE.player.hp).toBe(100);
    expect(shieldMaxOf("speed")).toBe(50);
    expect(shieldMaxOf("support")).toBe(50);
    expect(shieldMaxOf("heavy")).toBe(100);
    expect(BALANCE.player.lives).toBe(3);
    expect(BALANCE.player.respawnSeconds).toBe(3);
    expect(BALANCE.player.respawnInvulnSeconds).toBe(1);
  });
  it("防御ゲージ100 / 射撃25 / 近接10 / 回復15 / ブレイク0.6秒", () => {
    expect(BALANCE.guard.max).toBe(100);
    expect(BALANCE.guard.shotCost).toBe(25);
    expect(BALANCE.guard.meleeCost).toBe(10);
    expect(BALANCE.guard.regenPerSecond).toBe(15);
    expect(BALANCE.guard.breakStunSeconds).toBe(0.6);
  });
  it("ピストル 毎秒3発 / ダメ6 / マガジン8 / リロード1.2秒", () => {
    expect(BALANCE.pistol.shotsPerSecond).toBe(3);
    expect(BALANCE.pistol.damage).toBe(6);
    expect(BALANCE.pistol.magazine).toBe(8);
    expect(BALANCE.pistol.reloadSeconds).toBe(1.2);
  });
  it("試合2分 / 中心ヒット1.5倍・半径30% / 撃破回復+10", () => {
    expect(BALANCE.matchSeconds).toBe(120);
    expect(BALANCE.player.centerHitMultiplier).toBe(1.5);
    expect(BALANCE.player.centerHitRatio).toBe(0.3);
    expect(BALANCE.player.killHealHp).toBe(10);
  });
});

describe("移動", () => {
  it("1秒で横断秒ぶんの距離を進む（支援型: 画面幅/crossSeconds）", () => {
    const s0 = createMatch([{ id: "a", name: "A", cls: "support" }]);
    const p0 = s0.players[0]!;
    const { state } = run(s0, { a: { ...NULL_INPUT, mx: 1 } }, 1);
    const moved = state.players[0]!.x - p0.x;
    expect(moved).toBeCloseTo(BALANCE.field.width / BALANCE.classes.support.crossSeconds, 0);
    expect(MOVE_SPEED).toBeCloseTo(BALANCE.field.width / BALANCE.classes.support.crossSeconds);
  });
  it("斜め入力でも速度は同じ", () => {
    const s0 = createMatch([{ id: "a", name: "A", cls: "support" }]);
    const p0 = s0.players[0]!;
    const { state } = run(s0, { a: { ...NULL_INPUT, mx: 1, my: 1 } }, 0.5);
    const p = state.players[0]!;
    expect(Math.hypot(p.x - p0.x, p.y - p0.y)).toBeCloseTo(MOVE_SPEED * 0.5, 0);
  });
  it("壁を抜けない", () => {
    const s0 = createMatch([{ id: "a", name: "A", cls: "support" }]);
    const { state } = run(s0, { a: { ...NULL_INPUT, mx: 1, my: -1 } }, 5);
    const p = state.players[0]!;
    expect(p.x).toBe(BALANCE.field.width - BALANCE.player.radius);
    expect(p.y).toBe(BALANCE.player.radius);
  });
});

describe("ピストル", () => {
  it("1秒間に3発しか撃てない", () => {
    const s0 = createMatch([{ id: "a", name: "A", cls: "speed" }]);
    const { events } = run(s0, { a: { ...NULL_INPUT, fire2: true } }, 1 - DT / 2);
    expect(events.filter((e) => e.type === "shoot")).toHaveLength(3);
  });
  it("8発撃つとリロード（1.2秒）に入り、その間は撃てない", () => {
    const s0 = createMatch([{ id: "a", name: "A", cls: "speed" }]);
    // 8発目は 7/3 秒後に出る。少し余裕を持って回す
    const r1 = run(s0, { a: { ...NULL_INPUT, fire2: true } }, 8 / 3 - 0.05);
    expect(r1.events.filter((e) => e.type === "shoot")).toHaveLength(8);
    const p = r1.state.players[0]!;
    expect(p.magazine).toBe(0);
    expect(p.reload).toBeGreaterThan(0);
    expect(p.reload).toBeLessThanOrEqual(1.2);
    const r2 = run(r1.state, { a: { ...NULL_INPUT, fire2: true } }, 1.0);
    expect(r2.events.filter((e) => e.type === "shoot")).toHaveLength(0);
    const r3 = run(r2.state, { a: { ...NULL_INPUT, fire2: true } }, 0.4);
    expect(r3.events.filter((e) => e.type === "shoot").length).toBeGreaterThanOrEqual(1);
    expect(r3.state.players[0]!.magazine).toBeLessThanOrEqual(7);
  });
});

describe("距離減衰3段（SPEC 6.1）", () => {
  const w = BALANCE.field.width;
  it("3段の境界が falloff 定義と一致する（世界スケール追従）", () => {
    const [near, mid] = BALANCE.pistol.falloff;
    expect(falloffMultiplier(0)).toBe(1.0);
    expect(falloffMultiplier(w * near!.maxRatio)).toBe(1.0);
    expect(falloffMultiplier(w * (near!.maxRatio + mid!.maxRatio) / 2)).toBe(0.75);
    expect(falloffMultiplier(w * mid!.maxRatio)).toBe(0.75);
    expect(falloffMultiplier(w * mid!.maxRatio + 1)).toBe(0.5);
  });
});

describe("ダメージ・シールド", () => {
  it("シールドが先に減り、余りがHPに入る（支援=倍率1.0）", () => {
    const p = createPlayer("a", "A", "support", 0);
    p.shield = 4;
    const r = applyDamage(p, 6);
    expect(r.shieldDamage).toBe(4);
    expect(r.hpDamage).toBe(2);
    expect(p.shield).toBe(0);
    expect(p.hp).toBe(98);
  });
  it("スピード型は被ダメ1.3倍", () => {
    const p = createPlayer("a", "A", "speed", 0);
    p.shield = 0;
    const r = applyDamage(p, 10);
    expect(r.total).toBeCloseTo(13);
  });
  it("密着ヒットでダメ6・中心なら9、命中側のシールドは与ダメ50%回復", () => {
    const s0 = twoPlayers();
    // a を b の直近（弾1発ですぐ当たる距離）に置く。y を少しずらして中心を外す
    const a = s0.players[0]!;
    const b = s0.players[1]!;
    a.x = b.x - 80;
    a.y = b.y + BALANCE.player.radius * 0.6; // 中心判定(7.2)の外、当たり判定(29)の内
    a.aim = 0;
    a.shield = 0;
    a.lastDamagedAt = 0; // 回復遅延中にして自然回復を除外
    const { state, events } = run(s0, { a: { ...NULL_INPUT, aim: 0, fire2: true } }, 0.2);
    const hits = events.filter((e) => e.type === "hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.type === "hit" && hits[0]!.damage).toBe(6);
    expect(hits[0]!.type === "hit" && hits[0]!.center).toBe(false);
    expect(state.players[1]!.shield).toBe(44);
    expect(state.players[0]!.shield).toBe(3);
  });
  it("中心ヒットは1.5倍（6→9）", () => {
    const s0 = twoPlayers();
    const a = s0.players[0]!;
    const b = s0.players[1]!;
    a.x = b.x - 80;
    a.y = b.y;
    const { state, events } = run(s0, { a: { ...NULL_INPUT, aim: 0, fire2: true } }, 0.2);
    const hit = events.find((e) => e.type === "hit");
    expect(hit && hit.type === "hit" && hit.center).toBe(true);
    expect(state.players[1]!.shield).toBe(41);
  });
  it("被弾なし2秒後から毎秒15回復し、上限50で止まる", () => {
    const s0 = twoPlayers();
    const b = s0.players[1]!;
    b.shield = 20;
    b.lastDamagedAt = 0;
    const r1 = run(s0, {}, 2.0);
    expect(r1.state.players[1]!.shield).toBeCloseTo(20, 0);
    const r2 = run(r1.state, {}, 1.0);
    expect(r2.state.players[1]!.shield).toBeCloseTo(35, 0);
    const r3 = run(r2.state, {}, 5.0);
    expect(r3.state.players[1]!.shield).toBe(50);
  });
});

describe("防御（三すくみ: 射撃 > 防御）", () => {
  it("ガード中の被弾はダメージ0でゲージ-25。4発でガードブレイク0.6秒", () => {
    const s0 = twoPlayers();
    const a = s0.players[0]!;
    const b = s0.players[1]!;
    a.x = b.x - 80;
    a.y = b.y;
    s0.players[1]!.guarding = true;
    s0.players[1]!.guardStartedAt = -1; // ジャスガ猶予(0.1秒)を過ぎた通常ガード
    const inputs = { a: { ...NULL_INPUT, aim: 0, fire2: true }, b: { ...NULL_INPUT, guard: true } };
    const r = run(s0, inputs, 1.15); // 4発（0, 1/3, 2/3, 1秒）＋弾の到達分
    const hits = r.events.filter((e) => e.type === "hit");
    expect(hits.length).toBe(4);
    expect(hits.every((e) => e.type === "hit" && e.guarded && e.damage === 0)).toBe(true);
    expect(r.state.players[1]!.shield).toBe(50);
    expect(r.state.players[1]!.hp).toBe(100);
    expect(r.events.some((e) => e.type === "guardBreak")).toBe(true);
    const bb = r.state.players[1]!;
    expect(bb.guarding).toBe(false);
    expect(bb.guardBreak).toBeGreaterThan(0);
    expect(bb.guardBreak).toBeLessThanOrEqual(0.6);
  });
  it("ガードブレイク中は動けない", () => {
    const s0 = twoPlayers();
    const b = s0.players[1]!;
    b.guardBreak = 0.6;
    const x0 = b.x;
    const r = run(s0, { b: { ...NULL_INPUT, mx: -1 } }, 0.5);
    expect(r.state.players[1]!.x).toBe(x0);
    const r2 = run(r.state, { b: { ...NULL_INPUT, mx: -1 } }, 0.5);
    expect(r2.state.players[1]!.x).toBeLessThan(x0);
  });
  it("非使用時はゲージが毎秒15回復する", () => {
    const s0 = twoPlayers();
    s0.players[1]!.guardGauge = 10;
    const r = run(s0, {}, 2);
    expect(r.state.players[1]!.guardGauge).toBeCloseTo(40, 0);
  });
});

describe("残機・リスポーン・勝敗", () => {
  /** a が b を撃ち続け、最初の撃破イベントが出た直後の状態を返す */
  function killOnce(s0: SimState) {
    let s = s0;
    s.players[0]!.x = s.players[1]!.x - 80;
    s.players[0]!.y = s.players[1]!.y;
    const events = [];
    for (let i = 0; i < 60 * 30; i++) {
      const rr = step(s, { a: { ...NULL_INPUT, aim: 0, fire2: true } }, DT);
      s = rr.state;
      events.push(...rr.events);
      if (rr.events.some((e) => e.type === "kill")) return { state: s, events };
    }
    throw new Error("no kill");
  }
  it("HP0で残機-1、3秒後に復帰して1秒無敵。撃破側はHP+10（上限まで）", () => {
    const s0 = twoPlayers();
    s0.players[0]!.hp = 85;
    const r = killOnce(s0);
    expect(r.state.players[1]!.lives).toBe(2);
    expect(r.state.players[1]!.respawn).toBeCloseTo(3, 1);
    expect(r.state.players[0]!.kills).toBe(1);
    expect(r.state.players[0]!.hp).toBe(95);
    const after = run(r.state, {}, 3.05);
    expect(after.events.some((e) => e.type === "respawn")).toBe(true);
    expect(after.state.players[1]!.hp).toBe(100);
    expect(after.state.players[1]!.shield).toBe(50);
    expect(after.state.players[1]!.invuln).toBeGreaterThan(0.9);
  });
  it("撃破回復は上限100を超えない", () => {
    const r = killOnce(twoPlayers());
    expect(r.state.players[0]!.hp).toBe(100);
  });
  it("復帰無敵中は被弾しないが、自分が撃つと解除される", () => {
    const s0 = twoPlayers();
    const b = s0.players[1]!;
    b.invuln = 1;
    s0.players[0]!.x = b.x - 80;
    s0.players[0]!.y = b.y;
    const r = run(s0, { a: { ...NULL_INPUT, aim: 0, fire2: true } }, 0.3);
    expect(r.state.players[1]!.shield).toBe(50);
    const r2 = run(r.state, { b: { ...NULL_INPUT, aim: Math.PI, fire2: true } }, 0.05); // ジャブ（発生最速）
    expect(r2.state.players[1]!.invuln).toBe(0);
  });
  it("残機を使い切ると試合終了、勝者は相手", () => {
    let s = twoPlayers();
    const a = s.players[0]!;
    a.x = s.players[1]!.x - 80;
    a.y = s.players[1]!.y;
    // リスポーン位置に追従して撃ち続ける
    let ended = false;
    for (let i = 0; i < 60 * 110 && !ended; i++) {
      const b = s.players[1]!;
      const aa = s.players[0]!;
      const aim = Math.atan2(b.y - aa.y, b.x - aa.x);
      const rr = step(s, { a: { ...NULL_INPUT, aim, fire2: true } }, DT);
      s = rr.state;
      if (rr.events.some((e) => e.type === "matchEnd")) ended = true;
    }
    expect(ended).toBe(true);
    expect(s.phase).toBe("ended");
    expect(s.result?.winner).toBe("a");
    expect(s.result?.reason).toBe("lives");
    expect(s.players[1]!.lives).toBe(0);
  });
  it("時間切れ: 残機→残HP（シールド除外）→引き分け", () => {
    const mk = (la: number, ha: number, sa: number, lb: number, hb: number, sb: number) => {
      const s = twoPlayers();
      Object.assign(s.players[0]!, { lives: la, hp: ha, shield: sa });
      Object.assign(s.players[1]!, { lives: lb, hp: hb, shield: sb });
      return s;
    };
    expect(judgeTimeout(mk(3, 10, 0, 2, 100, 50))).toMatchObject({ winner: "a", reason: "timeout-lives" });
    expect(judgeTimeout(mk(2, 30, 50, 2, 40, 0))).toMatchObject({ winner: "b", reason: "timeout-hp" });
    expect(judgeTimeout(mk(2, 40, 50, 2, 40, 0))).toMatchObject({ winner: null, reason: "draw" });
  });
  it("2分経過で phase が ended になる", () => {
    const s0 = twoPlayers();
    s0.timeLeft = 0.1;
    const r = run(s0, {}, 0.2);
    expect(r.state.phase).toBe("ended");
    expect(r.events.some((e) => e.type === "matchEnd")).toBe(true);
  });
});
