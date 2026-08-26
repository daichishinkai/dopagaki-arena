import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/balance";
import { botInput, createBotMemory } from "../src/sim/bot";
import { createMatch as createMatchRaw, isAlive, step } from "../src/sim/step";
import type { PlayerInput, SimEvent, SimState } from "../src/sim/types";
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
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const r = step(s, inputs, DT);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

function teamsMatch(): SimState {
  return createMatch(
    [
      { id: "a1", name: "A1", cls: "heavy", team: 0 },
      { id: "a2", name: "A2", cls: "support", team: 0 },
      { id: "b1", name: "B1", cls: "speed", team: 1 },
      { id: "b2", name: "B2", cls: "speed", team: 1 },
    ],
    "teams",
  );
}

function killPlayer(state: SimState, id: string): { state: SimState; events: SimEvent[] } {
  const s = structuredClone(state);
  const t = s.players.find((p) => p.id === id)!;
  t.hp = 1;
  t.shield = 0;
  const shooter = s.players.find((p) => p.team !== t.team && isAlive(p))!;
  shooter.x = t.x - 60;
  shooter.y = t.y;
  shooter.magazine = 8;
  shooter.reload = 0;
  // 裁定10: スピード=ピストル(右) / 重量=HMG(左) / 支援=狙撃(左を溜めて離す)
  if (shooter.cls === "support") {
    const hold = run(s, { [shooter.id]: { ...NULL_INPUT, aim: 0, fire: true } }, 0.6);
    const release = run(hold.state, { [shooter.id]: { ...NULL_INPUT, aim: 0 } }, 0.4);
    return { state: release.state, events: [...hold.events, ...release.events] };
  }
  const key = shooter.cls === "speed" ? "fire2" : "fire";
  // HMGはスピンアップ0.4秒＋拡散があるので、確実に当たるまで回す
  return run(s, { [shooter.id]: { ...NULL_INPUT, aim: 0, [key]: true } }, 1.5);
}

describe("2vs2（SPEC 5.4 / 6.2）", () => {
  it("チーム残機5共有: 撃破でプールが減り、残っていればリスポーン", () => {
    const s = teamsMatch();
    expect(s.teamLives[0]).toBe(5);
    expect(s.teamLives[1]).toBe(5);
    const r = killPlayer(s, "b1");
    expect(r.state.teamLives[1]).toBe(4);
    const b1 = r.state.players.find((p) => p.id === "b1")!;
    expect(b1.lives).toBeGreaterThan(0); // 退場ではない
    expect(b1.respawn).toBeGreaterThan(0);
  });
  it("プール0で撃破された側は退場。両名退場でチーム敗北", () => {
    const s = teamsMatch();
    s.teamLives[1] = 1;
    const b2 = s.players.find((p) => p.id === "b2")!;
    b2.lives = 0;
    b2.respawn = Infinity; // 既に退場済みの想定
    const r = killPlayer(s, "b1");
    expect(r.state.teamLives[1]).toBe(0);
    expect(r.state.phase).toBe("ended");
    expect(r.state.result?.winnerTeam).toBe(0);
  });
  it("弔い合戦: 味方撃破後10秒、残メンバーのCD消化2倍・ゲージ回復2倍", () => {
    const s = teamsMatch();
    const r = killPlayer(s, "b1");
    const b2 = r.state.players.find((p) => p.id === "b2")!;
    expect(b2.boostUntil).toBeGreaterThan(r.state.t + 8); // 撃破時刻+10秒
    // CD消化2倍
    b2.skillCd = [8, 0, 0];
    b2.escapeGauge = 0;
    const r2 = run(r.state, {}, 2);
    const after = r2.state.players.find((p) => p.id === "b2")!;
    expect(after.skillCd[0]).toBeCloseTo(8 - 4, 0); // 2秒で4減
    expect(after.escapeGauge).toBeCloseTo(2 * 12 * 2, 0); // 回復2倍
    // 敵側（a1）は等倍
    const a1 = r.state.players.find((p) => p.id === "a1")!;
    expect(a1.boostUntil).toBe(0);
  });
  it("かばう: カーソル方向の味方へ吸着ダッシュ＋3秒シェル", () => {
    const s = teamsMatch();
    const a1 = s.players.find((p) => p.id === "a1")!;
    const a2 = s.players.find((p) => p.id === "a2")!;
    a1.x = 200; a1.y = 360;
    a2.x = 200 + BALANCE.teams.cover.dashMax * 0.85; // 吸着レンジ内に置く
    const r = run(s, { a1: { ...NULL_INPUT, aim: 0, skill3: true } }, DT * 2);
    const moved = r.state.players.find((p) => p.id === "a1")!;
    expect(moved.x).toBeGreaterThan(200 + (a2.x - 200) * 0.5); // 味方の方向へ大きく移動
    expect(moved.x).toBeLessThan(a2.x); // 重ならず手前で停止
    expect(moved.shell).toBeGreaterThan(2.5); // 3秒シェル
  });
  it("時間切れ: チーム残機差→チーム残HP合計差", () => {
    const s = teamsMatch();
    s.timeLeft = DT;
    s.teamLives[0] = 3;
    s.teamLives[1] = 2;
    const r = run(s, {}, DT * 2);
    expect(r.state.result?.winnerTeam).toBe(0);
    expect(r.state.result?.reason).toBe("timeout-lives");
  });
});

describe("CPU bot（SPEC 12章）", () => {
  it("Lv1: 敵に向かって動き、射線が通れば撃つ", () => {
    const s = createMatch([
      { id: "bot-1", name: "CPU", cls: "speed" },
      { id: "b", name: "B", cls: "support" },
    ]);
    const bot = s.players[0]!;
    // 裁定10: Lv1は主武器（左クリック＝セイバー）で戦う。射線が通れば振り続ける
    const mem = createBotMemory();
    let state = s;
    let shots = 0;
    let swings = 0;
    const d0 = Math.hypot(state.players[1]!.x - bot.x, state.players[1]!.y - bot.y);
    for (let i = 0; i < 60 * 3; i++) {
      const input = botInput(state, "bot-1", 1, mem, () => 0.5);
      const r = step(state, { "bot-1": input }, DT);
      state = r.state;
      shots += r.events.filter((e) => e.type === "shoot").length;
      swings += r.events.filter((e) => e.type === "swing").length;
    }
    const d1 = Math.hypot(state.players[1]!.x - state.players[0]!.x, state.players[1]!.y - state.players[0]!.y);
    expect(d1).toBeLessThan(d0); // 接近した
    expect(shots + swings).toBeGreaterThan(3); // 攻撃を出している
  });
  it("Lv2: 距離に応じて武器を切り替える（重量型が近距離でナイフへ）", () => {
    const s = createMatch([
      { id: "bot-1", name: "CPU", cls: "heavy" },
      { id: "b", name: "B", cls: "support" },
    ]);
    s.players[0]!.x = s.players[1]!.x - 70;
    s.players[0]!.y = s.players[1]!.y;
    const mem = createBotMemory();
    let state = s;
    for (let i = 0; i < 60; i++) {
      const input = botInput(state, "bot-1", 2, mem, () => 0.5);
      state = step(state, { "bot-1": input }, DT).state;
    }
    expect(state.players[0]!.weapon).toBe(1); // ナイフ（右クリック枠）
  });
  it("Lv3: 負傷した味方がいると支援botは回復弾に切り替えて味方を狙う", () => {
    const s = createMatch(
      [
        { id: "bot-1", name: "CPU", cls: "support", team: 0 },
        { id: "ally", name: "A", cls: "heavy", team: 0 },
        { id: "b1", name: "B1", cls: "speed", team: 1 },
        { id: "b2", name: "B2", cls: "speed", team: 1 },
      ],
      "teams",
    );
    const ally = s.players.find((p) => p.id === "ally")!;
    ally.hp = 40;
    ally.x = s.players[0]!.x + 250;
    ally.y = s.players[0]!.y;
    const mem = createBotMemory();
    let state = s;
    let healed = false;
    for (let i = 0; i < 60 * 4 && !healed; i++) {
      const input = botInput(state, "bot-1", 3, mem, () => 0.5);
      const r = step(state, { "bot-1": input }, DT);
      state = r.state;
      if (r.events.some((e) => e.type === "heal" && e.target === "ally")) healed = true;
    }
    expect(state.players[0]!.weapon).toBe(0); // 裁定10: ヒールは左クリック枠
    expect(healed).toBe(true);
  });
  it("Lv2: スナイパーbotは溜めてからリリースで撃つ", () => {
    const s = createMatch([
      { id: "bot-1", name: "CPU", cls: "support" },
      { id: "b", name: "B", cls: "heavy" },
    ]);
    s.players[0]!.x = s.players[1]!.x - 520;
    s.players[0]!.y = s.players[1]!.y;
    const mem = createBotMemory();
    let state = s;
    let shot = false;
    for (let i = 0; i < 60 * 4 && !shot; i++) {
      const input = botInput(state, "bot-1", 2, mem, () => 0.5);
      const r = step(state, { "bot-1": input }, DT);
      state = r.state;
      if (r.events.some((e) => e.type === "shoot" && e.kind === "sniper")) shot = true;
    }
    expect(shot).toBe(true);
  });
});

describe("中央エリア（裁定45）", () => {
  /** 全員をエリア外の四隅に置く */
  function apart(s: SimState): SimState {
    const z = s.zone!;
    const far = z.w / 2 + BALANCE.player.radius + 40;
    s.players[0]!.x = z.x - far; s.players[0]!.y = z.y - far / 2;
    s.players[1]!.x = z.x - far; s.players[1]!.y = z.y + far / 2;
    s.players[2]!.x = z.x + far; s.players[2]!.y = z.y - far / 2;
    s.players[3]!.x = z.x + far; s.players[3]!.y = z.y + far / 2;
    return s;
  }

  it("teams では中央に広い四角のエリアがあり、乱闘・訓練場にはない", () => {
    const t = teamsMatch();
    expect(t.zone).not.toBeNull();
    expect(t.zone!.w).toBeCloseTo(BALANCE.field.width * BALANCE.zone.widthRatio);
    expect(t.zone!.h).toBeCloseTo(BALANCE.field.height * BALANCE.zone.heightRatio);
    const ffa = createMatch([{ id: "a", name: "A" }, { id: "b", name: "B" }], "ffa");
    expect(ffa.zone).toBeNull();
    const practice = createMatch([{ id: "a", name: "A", team: 0 }, { id: "b", name: "B", team: 1 }], "teams", { practice: true });
    expect(practice.zone).toBeNull();
  });

  it("人数で勝っているチームだけゲージが溜まり、満タンで相手の残機が1減る", () => {
    const s = apart(teamsMatch());
    const z = s.zone!;
    // A1 だけエリアの中へ
    s.players[0]!.x = z.x; s.players[0]!.y = z.y;
    const before = s.teamLives[1]!;
    const half = run(s, {}, BALANCE.zone.captureSeconds / 2);
    expect(half.state.zone!.gauge[0]).toBeCloseTo(0.5, 1);
    expect(half.state.zone!.gauge[1] ?? 0).toBe(0);
    expect(half.state.teamLives[1]).toBe(before);
    const full = run(half.state, {}, BALANCE.zone.captureSeconds / 2 + 0.2);
    expect(full.state.teamLives[1]).toBe(before - 1);
    expect(full.state.zone!.gauge[0]).toBeLessThan(0.1); // 0に戻って溜め直し
    expect(full.events.some((e) => e.type === "zoneCapture" && e.team === 0 && e.victim === 1)).toBe(true);
  });

  it("同数なら（1対1で拮抗）どちらも溜まらない", () => {
    const s = apart(teamsMatch());
    const z = s.zone!;
    s.players[0]!.x = z.x - 60; s.players[0]!.y = z.y;
    s.players[2]!.x = z.x + 60; s.players[2]!.y = z.y;
    const r = run(s, {}, 3);
    expect(r.state.zone!.gauge[0] ?? 0).toBe(0);
    expect(r.state.zone!.gauge[1] ?? 0).toBe(0);
  });

  it("エリア外に出てもゲージは減らない（減衰なし）", () => {
    const s = apart(teamsMatch());
    const z = s.zone!;
    s.players[0]!.x = z.x; s.players[0]!.y = z.y;
    const r1 = run(s, {}, 2);
    const g = r1.state.zone!.gauge[0]!;
    expect(g).toBeGreaterThan(0.2);
    r1.state.players[0]!.x = z.x - z.w; // 外へ
    const r2 = run(r1.state, {}, 2);
    expect(r2.state.zone!.gauge[0]).toBeCloseTo(g, 5);
  });
});

describe("ボス戦（裁定49）", () => {
  function bossMatch(): SimState {
    return createMatch(
      [
        { id: "p1", name: "P1", cls: "speed", team: 0 },
        { id: "p2", name: "P2", cls: "heavy", team: 0 },
        { id: "p3", name: "P3", cls: "support", team: 0 },
        { id: "boss", name: "強敵", cls: "heavy", team: 1 },
      ],
      "boss",
    );
  }

  it("ボスはHPが倍率ぶん多く、挑戦者は共有残機、中央エリアは出ない", () => {
    const s = bossMatch();
    const boss = s.players.find((p) => p.id === "boss")!;
    expect(boss.boss).toBe(true);
    expect(boss.hp).toBe(BALANCE.player.hp * BALANCE.boss.hpMultiplier);
    expect(s.teamLives[0]).toBe(BALANCE.boss.playerLives);
    expect(s.teamLives[1]).toBe(1); // ボスは1回倒されたら負け
    expect(s.zone).toBeNull();
    expect(s.players.filter((p) => p.team === 0)).toHaveLength(3);
    // ボスは中央から始まる（挑戦者は左の3列）
    expect(boss.x).toBeCloseTo(BALANCE.field.width / 2);
    expect(boss.y).toBeCloseTo(BALANCE.field.height / 2);
    expect(s.players.filter((p) => p.team === 0).every((p) => p.x < BALANCE.field.width / 2)).toBe(true);
  });

  it("ボスを倒すと挑戦者チームの勝ち", () => {
    const s = bossMatch();
    const boss = s.players.find((p) => p.id === "boss")!;
    boss.hp = 1;
    const p1 = s.players.find((p) => p.id === "p1")!;
    p1.x = boss.x - 40; p1.y = boss.y; p1.aim = 0;
    const r = run(s, { p1: { ...NULL_INPUT, aim: 0, fire: true } }, 1.0);
    expect(r.state.result?.winnerTeam).toBe(0);
  });

  it("ボスの与ダメには倍率がかかる", () => {
    const s = bossMatch();
    const boss = s.players.find((p) => p.id === "boss")!;
    const p1 = s.players.find((p) => p.id === "p1")!;
    // ボスの正面に立たせてナイフを振らせる
    p1.x = boss.x + 40; p1.y = boss.y;
    boss.aim = 0;
    const before = p1.hp + p1.shield; // シールドが先に吸うので合計で測る
    const r = run(s, { boss: { ...NULL_INPUT, aim: 0, fire2: true } }, 0.5);
    const after = r.state.players.find((p) => p.id === "p1")!;
    const dealt = before - (after.hp + after.shield);
    const base = BALANCE.knife.damage * BALANCE.classes.speed.damageTaken;
    expect(dealt).toBeGreaterThan(base * 1.2); // 倍率1.4ぶん増えている
  });

  it("範囲ノックバック: 囲まれたら溜めて発動し、挑戦者を吹き飛ばす", () => {
    const s = bossMatch();
    const boss = s.players.find((p) => p.id === "boss")!;
    const K = BALANCE.boss.knockback;
    // 2人をボスに密着させる
    const p1 = s.players.find((p) => p.id === "p1")!;
    const p2 = s.players.find((p) => p.id === "p2")!;
    p1.x = boss.x + 50; p1.y = boss.y;
    p2.x = boss.x - 50; p2.y = boss.y;
    const p3 = s.players.find((p) => p.id === "p3")!;
    p3.x = 60; p3.y = 60; // 範囲外
    const d1before = Math.hypot(p1.x - boss.x, p1.y - boss.y);
    const r1 = run(s, {}, DT * 2);
    expect(r1.events.some((e) => e.type === "knockbackWindup")).toBe(true);
    const r2 = run(r1.state, {}, K.windupSeconds + 0.1);
    expect(r2.events.some((e) => e.type === "knockback")).toBe(true);
    const b2 = r2.state.players.find((p) => p.id === "boss")!;
    const a1 = r2.state.players.find((p) => p.id === "p1")!;
    expect(Math.hypot(a1.x - b2.x, a1.y - b2.y)).toBeGreaterThan(d1before + 100); // 離れた
    expect(a1.cc).toBeGreaterThan(0); // 硬直した
    // CDが明けるまで再発動しない
    const r3 = run(r2.state, {}, 1.0);
    expect(r3.events.some((e) => e.type === "knockback")).toBe(false);
  });

  it("ボス戦以外ではノックバックは起きない", () => {
    const s = teamsMatch();
    const a1 = s.players[0]!;
    s.players[2]!.x = a1.x + 40; s.players[2]!.y = a1.y;
    s.players[3]!.x = a1.x - 40; s.players[3]!.y = a1.y;
    const r = run(s, {}, 2);
    expect(r.events.some((e) => e.type === "knockback" || e.type === "knockbackWindup")).toBe(false);
  });
});
