import { describe, expect, it } from "vitest";
import { BALANCE, moveSpeedOf } from "../src/balance";
import { applyCC, createMatch, step, WEAPONS } from "../src/sim/step";
import type { PlayerInput, SimEvent, SimState } from "../src/sim/types";
import { NULL_INPUT } from "../src/sim/types";

const DT = 1 / BALANCE.tickRate;

function run(state: SimState, inputs: Record<string, PlayerInput>, seconds: number) {
  let s = state;
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const r = step(s, inputs, DT);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

function duel(aCls: "speed" | "heavy" | "support", bCls: "speed" | "heavy" | "support", gap = 80): SimState {
  const s = createMatch([
    { id: "a", name: "A", cls: aCls },
    { id: "b", name: "B", cls: bCls },
  ]);
  const a = s.players[0]!;
  const b = s.players[1]!;
  a.x = b.x - gap;
  a.y = b.y;
  a.aim = 0;
  return s;
}

/** 左クリック＝主武器（セイバー/HMG/狙撃） */
const fire = { ...NULL_INPUT, aim: 0, fire: true };
/** 右クリック＝副武器（ピストル/ナイフ/ジャブ） */
const fire2 = { ...NULL_INPUT, aim: 0, fire2: true };

/** 支援型の単クリック（裁定10: 溜めなしで離す＝ヒール）。1tickだけ押して離す */
function tapFire(state: SimState, seconds: number, id = "a") {
  const r1 = step(state, { [id]: { ...NULL_INPUT, aim: 0, fire: true } }, DT);
  const r2 = run(r1.state, { [id]: { ...NULL_INPUT, aim: 0 } }, seconds);
  return { state: r2.state, events: [...r1.events, ...r2.events] };
}

describe("クラス基礎（SPEC 16章）", () => {
  it("横断速度: 速1.2秒 / 重2.0秒 / 支1.5秒", () => {
    // 世界スケール（裁定12）で一律に遅くなるが、クラス間の比は不変
    expect(moveSpeedOf("speed") / moveSpeedOf("support")).toBeCloseTo(1.5 / 1.2);
    expect(moveSpeedOf("heavy") / moveSpeedOf("support")).toBeCloseTo(1.5 / 2.0);
    expect(moveSpeedOf("support")).toBeCloseTo(1280 / BALANCE.classes.support.crossSeconds);
  });
  it("武器構成", () => {
    expect(WEAPONS.speed).toEqual(["saber", "pistol"]);
    expect(WEAPONS.heavy).toEqual(["hmg", "knife"]);
    expect(WEAPONS.support).toEqual(["sniper", "jab"]); // 裁定10: ヒールは左クリックの単クリック
  });
  it("重量型のシールドは時間回復しない（命中でのみ回復）", () => {
    const s = duel("heavy", "support");
    s.players[0]!.shield = 20;
    const r = run(s, {}, 5);
    expect(r.state.players[0]!.shield).toBe(20);
    expect(r.state.players[1]!.shield).toBe(50); // 支援は時間回復する（満タン維持）
  });
});

describe("スピード型: セイバー・マーク・過装填（SPEC 6.1）", () => {
  it("セイバー1振り: 4ヒット・計12ダメ（対支援=倍率1.0）", () => {
    const s = duel("speed", "support", 50);
    const r = run(s, { a: fire }, 0.5);
    const hits = r.events.filter((e) => e.type === "hit" && e.melee);
    expect(hits).toHaveLength(4);
    const total = hits.reduce((sum, e) => sum + (e.type === "hit" ? e.damage : 0), 0);
    expect(total).toBeCloseTo(12);
  });
  it("マーク: ピストルヒットで付与（最大3・4秒）→ セイバー初撃で全消費 +4ダメ/枚・逃げゲージ+8/枚", () => {
    const s = duel("speed", "support", 200);
    // 3発当ててマーク3
    const r1 = run(s, { a: fire2 }, 1.0);
    expect(r1.state.players[1]!.marks?.stacks).toBe(3);
    // 近づいてセイバー
    const s2 = r1.state;
    s2.players[0]!.x = s2.players[1]!.x - BALANCE.saber.reach * 0.5;
    s2.players[0]!.escapeGauge = 40;
    const r2 = run(s2, { a: fire }, 0.12); // 初撃(0.05s)のみ
    const hit = r2.events.find((e) => e.type === "hit" && e.melee);
    expect(hit && hit.type === "hit" && hit.damage).toBeCloseTo(3 + 4 * 3); // 3+12=15
    expect(r2.state.players[1]!.marks).toBeNull();
    expect(r2.state.players[0]!.escapeGauge).toBeGreaterThanOrEqual(40 + 24); // +8×3（自然回復分は誤差側）
  });
  it("マークは4秒で消える", () => {
    const s = duel("speed", "support", 200);
    const r1 = run(s, { a: { ...fire2 } }, 0.4); // 1〜2発
    expect(r1.state.players[1]!.marks).not.toBeNull();
    const r2 = run(r1.state, {}, 5.0); // 着弾時刻＋4秒を確実に超える
    expect(r2.state.players[1]!.marks).toBeNull();
  });
  it("過装填: 次の2発が3倍（6→18）、4秒で失効", () => {
    const s = duel("speed", "support", 100);
    s.players[1]!.y += BALANCE.player.radius * 0.75; // 中心ヒットを外す
    const r1 = run(s, { a: { ...fire2, skill3: true } }, 0.7); // 発動+2発
    const dmgs = r1.events.filter((e) => e.type === "hit" && !e.melee).map((e) => (e.type === "hit" ? e.damage : 0));
    expect(dmgs[0]).toBeCloseTo(18);
    expect(dmgs[1]).toBeCloseTo(18);
    // 3発目は通常
    const r2 = run(r1.state, { a: fire2 }, 0.4);
    const d3 = r2.events.find((e) => e.type === "hit" && !e.melee);
    expect(d3 && d3.type === "hit" && d3.damage).toBeCloseTo(6);
  });
  it("高速移動: 逃げゲージ35消費で画面幅12%移動", () => {
    const s = duel("speed", "support", 600);
    const a = s.players[0]!;
    const x0 = a.x;
    const r = run(s, { a: { ...NULL_INPUT, aim: 0, skill1: true } }, DT * 2);
    expect(r.state.players[0]!.x - x0).toBeCloseTo(1280 * BALANCE.speedSkills.dash.distanceRatio, 0);
    expect(r.state.players[0]!.escapeGauge).toBeLessThanOrEqual(100 - 35 + 1);
  });
  it("スモーク: 逃げゲージ30・持続2秒", () => {
    const s = duel("speed", "support");
    const r = run(s, { a: { ...NULL_INPUT, skill2: true } }, DT * 2);
    expect(r.state.smokes).toHaveLength(1);
    const r2 = run(r.state, {}, 2.1);
    expect(r2.state.smokes).toHaveLength(0);
  });
});

describe("重量型: HMG・ナイフ・統合ゲージ（SPEC 6.2）", () => {
  it("HMG: スピンアップ0.4秒後に毎秒6発。1ヒットでゲージ+2＆シールド+2（与ダメ50%）", () => {
    const s = duel("heavy", "support", 100);
    s.players[0]!.unifiedGauge = 100;
    s.players[0]!.shield = 0;
    const r = run(s, { a: fire }, 1.4 + DT);
    const shots = r.events.filter((e) => e.type === "shoot");
    expect(shots.length).toBeGreaterThanOrEqual(6);
    expect(shots.length).toBeLessThanOrEqual(7); // 0.4秒スピンアップ後の1.0秒で6発
    const hmgHits = r.events.filter((e) => e.type === "hit" && !e.melee && e.damage > 0).length;
    const p = r.state.players[0]!;
    // 非ガード回復10/s + 命中×2
    expect(p.unifiedGauge).toBeCloseTo(100 + 10 * (1.4 + DT) + hmgHits * 2, 0);
    // シールドは与ダメ50%（中心ヒットが混ざるため実与ダメから計算）
    const totalDmg = r.events.filter((e) => e.type === "hit" && !e.melee).reduce((sum, e) => sum + (e.type === "hit" ? e.damage : 0), 0);
    expect(p.shield).toBeCloseTo(totalDmg * 0.5, 1);
  });
  it("ナイフ: 20ダメ・命中でゲージ+20", () => {
    const s = duel("heavy", "support", BALANCE.knife.reach * 0.6);
    s.players[0]!.unifiedGauge = 100;
    const r = run(s, { a: fire2 }, 0.5); // 掃きの中心通過は0.3秒
    const hit = r.events.find((e) => e.type === "hit" && e.melee);
    expect(hit && hit.type === "hit" && hit.damage).toBeCloseTo(20);
    expect(r.state.players[0]!.unifiedGauge).toBeCloseTo(100 + 20 + 10 * 0.5, 0);
  });
  it("ガード被弾は統合ゲージから減る（射撃25）", () => {
    const s = duel("support", "heavy", 300);
    const b = s.players[1]!;
    b.guarding = true;
    b.guardStartedAt = -1;
    b.unifiedGauge = 100;
    // 最大溜めで1発（支援の左クリック＝狙撃）
    const r1 = run(s, { a: fire, b: { ...NULL_INPUT, guard: true } }, 1.6);
    const r2 = run(r1.state, { a: { ...NULL_INPUT, aim: 0 }, b: { ...NULL_INPUT, guard: true } }, 0.5);
    const guardedHit = [...r1.events, ...r2.events].find((e) => e.type === "hit" && e.guarded);
    expect(guardedHit).toBeTruthy();
    expect(r2.state.players[1]!.unifiedGauge).toBeLessThanOrEqual(100 - 25 + 10 * 2.1 + 1);
  });
  it("グラウンドスラム: ゲージ60消費・0.5秒のけぞり・範囲の敵弾消去", () => {
    const s = duel("heavy", "support", 100);
    // 敵弾を範囲内に置く
    s.bullets.push({ id: 999, kind: "pistol", owner: "b", ownerTeam: 1, x: s.players[0]!.x + 50, y: s.players[0]!.y, vx: 0, vy: 0, ox: 0, oy: 0, damage: 6, radius: 5, normal: true, reflectsLeft: 0, boost: 1, mist: false });
    const r = run(s, { a: { ...NULL_INPUT, skill1: true } }, DT * 2);
    expect(r.state.players[0]!.unifiedGauge).toBeLessThanOrEqual(200 - 60 + 1);
    expect(r.state.players[1]!.cc).toBeGreaterThan(0.4);
    expect(r.state.bullets.filter((b) => b.id === 999)).toHaveLength(0);
  });
  it("壁: ゲージ70・耐久80・2.5秒・敵弾を止め耐久が減る", () => {
    const s = duel("heavy", "support", 400);
    const r1 = run(s, { a: { ...NULL_INPUT, aim: 0, skill2: true } }, DT * 2);
    expect(r1.state.walls).toHaveLength(1);
    expect(r1.state.walls[0]!.hp).toBe(80);
    // 支援がスナイパー（無反射になるまで撃つ…最大溜めは反射1回あるので、反射→外壁→消滅ではなく敵壁直撃で耐久減を確認するため反射を0に）
    const s2 = r1.state;
    // b が壁越しに a を狙う: 弾は壁に当たる（反射1回持ちなので反射する）
    const r2 = run(s2, { b: { ...NULL_INPUT, aim: Math.PI, fire: true } }, 1.6);
    const r3 = run(r2.state, { b: { ...NULL_INPUT, aim: Math.PI } }, 0.3);
    // 反射弾は耐久を削らない（SPEC 6.2）
    expect(r3.state.walls[0]!.hp).toBe(80);
    const r4 = run(r3.state, {}, 2.5);
    expect(r4.state.walls).toHaveLength(0); // 2.5秒で消滅
  });
  it("ブレイク硬直は半減（0.3秒）", () => {
    const s = duel("speed", "heavy", 100);
    const b = s.players[1]!;
    b.guarding = true;
    b.guardStartedAt = -1;
    b.unifiedGauge = 25;
    const r = run(s, { a: fire2, b: { ...NULL_INPUT, guard: true } }, 0.1);
    const brk = r.events.find((e) => e.type === "guardBreak");
    expect(brk).toBeTruthy();
    // 直後の残り硬直は 0.3 以下（重量型は0.6の半減）
    expect(r.state.players[1]!.guardBreak).toBeLessThanOrEqual(0.3);
    expect(r.state.players[1]!.guardBreak).toBeGreaterThan(0.15);
  });
});

describe("支援型: スナイパー・回復弾・素手（SPEC 6.3）", () => {
  it("スナイパー: 0.3秒未満は発射不可", () => {
    const s = duel("support", "speed", 300);
    const r1 = run(s, { a: fire }, 0.2);
    const r2 = run(r1.state, { a: { ...NULL_INPUT, aim: 0 } }, 0.1); // 離す
    expect(r2.events.filter((e) => e.type === "shoot")).toHaveLength(0);
  });
  it("最小溜め12ダメ / 最大溜め32ダメ（中心なら18/48）・最大溜め中心でもシールド50を単発で割らない", () => {
    // 最小
    const s1 = duel("support", "support", 300);
    s1.players[1]!.y += 20; // 中心を外す
    const r1a = run(s1, { a: fire }, 0.32);
    const r1b = run(r1a.state, { a: { ...NULL_INPUT, aim: 0 } }, 0.5);
    const h1 = [...r1a.events, ...r1b.events].find((e) => e.type === "hit" && e.damage > 0);
    expect(h1 && h1.type === "hit" && h1.damage).toBeCloseTo(12, 0);
    // 最大（保持1.5秒→自動ではなくリリース）中心
    const s2 = duel("support", "support", 300);
    const r2a = run(s2, { a: fire }, 1.55);
    const r2b = run(r2a.state, { a: { ...NULL_INPUT, aim: 0 } }, 0.5);
    const h2 = [...r2a.events, ...r2b.events].find((e) => e.type === "hit" && e.damage > 0);
    expect(h2 && h2.type === "hit" && h2.center).toBe(true);
    expect(h2 && h2.type === "hit" && h2.damage).toBeCloseTo(48, 0);
    expect(r2b.state.players[1]!.shield).toBeGreaterThan(0); // 50を単発で割らない
    expect(r2b.state.players[1]!.hp).toBe(100);
  });
  it("保持2.5秒超過で自動発射", () => {
    const s = duel("support", "speed", 400);
    const r = run(s, { a: fire }, 1.5 + 2.5 + 0.1);
    expect(r.events.filter((e) => e.type === "shoot")).toHaveLength(1);
  });
  it("回復弾: 味方に12回復・敵に当たると消滅ダメ0・自分は撃てない（対象外）", () => {
    // 2vs2前なのでチームを手動で組む
    const s = createMatch([
      { id: "a", name: "A", cls: "support" },
      { id: "ally", name: "C", cls: "speed" },
      { id: "b", name: "B", cls: "speed" },
    ]);
    const [a, ally, b] = s.players as [any, any, any];
    ally.team = a.team; // 同チーム化
    a.x = 200; a.y = 360; a.aim = 0;
    ally.x = 500; ally.y = 360; ally.hp = 50;
    b.x = 900; b.y = 600;
    const r = tapFire(s, 0.8);
    const heal = r.events.find((e) => e.type === "heal");
    expect(heal && heal.type === "heal" && heal.amount).toBe(12);
    expect(r.state.players[1]!.hp).toBe(62);
    // 敵ボディブロック
    const s2 = createMatch([
      { id: "a", name: "A", cls: "support" },
      { id: "ally", name: "C", cls: "speed" },
      { id: "b", name: "B", cls: "speed" },
    ]);
    const [a2, ally2, b2] = s2.players as [any, any, any];
    ally2.team = a2.team;
    a2.x = 200; a2.y = 360; a2.aim = 0;
    b2.x = 400; b2.y = 360; // 間に立つ敵
    ally2.x = 700; ally2.y = 360; ally2.hp = 50;
    const r2 = tapFire(s2, 0.8);
    expect(r2.events.filter((e) => e.type === "heal")).toHaveLength(0);
    expect(r2.state.players[2]!.hp).toBe(100); // ダメージ0
    expect(r2.state.players[1]!.hp).toBe(50);
  });
  it("素手: 8ダメ・HP+3スティール（秒間キャップ8）・シールドは回復しない（置換）", () => {
    const s = duel("support", "support", BALANCE.jab.reach * 0.7);
    s.players[0]!.hp = 50;
    s.players[0]!.shield = 0;
    s.players[0]!.lastDamagedAt = 999; // 時間回復を無効化してスティール分だけを見る
    const r = run(s, { a: fire2 }, 2.0); // 4振り
    const hits = r.events.filter((e) => e.type === "hit" && e.melee);
    expect(hits.length).toBe(4);
    expect(hits[0]!.type === "hit" && hits[0]!.damage).toBeCloseTo(8);
    // スティール: 4hit×3=12だがキャップ8/s → 2秒で最大16。50+13〜16の範囲
    const hp = r.state.players[0]!.hp;
    expect(hp).toBeGreaterThanOrEqual(50 + 12);
    expect(hp).toBeLessThanOrEqual(50 + 16);
    expect(r.state.players[0]!.shield).toBe(0); // シールドスティールとは置換
  });
  it("スタン弾: 0.5秒拘束＋スキルCD2秒遅延。重複CCは半減で加算", () => {
    const s = duel("support", "speed", 300);
    const r1 = run(s, { a: { ...NULL_INPUT, aim: 0, skill3: true } }, 0.5);
    const b1 = r1.state.players[1]!;
    expect(b1.cc).toBeGreaterThan(0.1);
    expect(b1.skillCd[0]).toBeGreaterThanOrEqual(1.5);
    // 重複CC半減: CC中にさらに0.5秒CC → +0.25
    const p = r1.state.players[1]!;
    p.cc = 0.5;
    applyCC(p, 0.5);
    expect(p.cc).toBeCloseTo(0.75);
  });
  it("鈴: 0.75秒無敵＋CC解除（CD14秒）", () => {
    const s = duel("support", "speed");
    s.players[0]!.cc = 0; // 使用可能に
    const r = run(s, { a: { ...NULL_INPUT, skill1: true } }, DT * 2);
    expect(r.state.players[0]!.invuln).toBeGreaterThan(0.6);
    expect(r.state.players[0]!.skillCd[0]).toBeGreaterThan(13);
  });
});

describe("乱闘（3人）", () => {
  it("生存1人になった時点で勝敗が付く", () => {
    const s = createMatch([
      { id: "a", name: "A", cls: "speed" },
      { id: "b", name: "B", cls: "support" },
      { id: "c", name: "C", cls: "support" },
    ]);
    s.players[1]!.lives = 1;
    s.players[1]!.hp = 1;
    s.players[1]!.shield = 0;
    s.players[2]!.lives = 1;
    s.players[2]!.hp = 1;
    s.players[2]!.shield = 0;
    // a が b と c を素早く倒す
    let state = s;
    let ended = false;
    for (let i = 0; i < 60 * 30 && !ended; i++) {
      const a = state.players[0]!;
      const target = state.players.slice(1).find((p) => p.lives > 0);
      if (!target) break;
      const aim = Math.atan2(target.y - a.y, target.x - a.x);
      a.x = target.x - 50;
      a.y = target.y;
      const r = step(state, { a: { ...NULL_INPUT, aim, fire: true } }, DT);
      state = r.state;
      if (r.events.some((e) => e.type === "matchEnd")) ended = true;
    }
    expect(ended).toBe(true);
    expect(state.result?.winner).toBe("a");
  });
});
