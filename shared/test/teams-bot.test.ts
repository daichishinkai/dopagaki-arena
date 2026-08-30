import { describe, expect, it } from "vitest";
import { BALANCE, danmakuPhaseAt } from "../src/balance";
import { radiusOf } from "../src/balance";
import { botInput, createBotMemory } from "../src/sim/bot";
import { canSee } from "../src/sim/vision";
import { bulletHitRadiusOf, createMatch as createMatchRaw, isAlive, step } from "../src/sim/step";
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
    boss.bossPhase = 3; // 裁定62: HP1は最終形態相当。手で下げたので形態移行（無敵）を先に済ませておく
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
  it("ボスは扇状に弾を撒き、CDが明けるまで撃ち直さない（裁定53）", () => {
    const s = bossMatch();
    const FAN = BALANCE.boss.fan;
    // 弾が壁や敵に当たらないよう、挑戦者は遠くへ離しておく
    for (const p of s.players.filter((q) => q.team === 0)) { p.x = 60; p.y = 60; }
    const boss = s.players.find((p) => p.id === "boss")!;
    boss.aim = 0;
    const r1 = run(s, {}, 1 / 60);
    expect(r1.state.bullets).toHaveLength(FAN.count);
    // 端から端まで spreadRad ぶんに広がっている
    const angles = r1.state.bullets.map((b) => Math.atan2(b.vy, b.vx)).sort((a, b) => a - b);
    expect(angles[angles.length - 1]! - angles[0]!).toBeCloseTo(FAN.spreadRad, 5);
    // 通常弾（剣で消せる）で、低ダメージ
    expect(r1.state.bullets.every((b) => b.normal)).toBe(true);
    expect(r1.state.bullets[0]!.damage).toBe(FAN.damage);
    // CD中は撃たない
    const before = r1.state.bullets.length;
    const r2 = run(r1.state, {}, FAN.cooldown - 0.2);
    expect(r2.state.bullets.filter((b) => b.owner === "boss").length).toBeLessThanOrEqual(before);
  });

  it("ボス戦以外では扇状射撃は起きない（裁定53）", () => {
    const s = teamsMatch();
    const r = run(s, {}, 3);
    expect(r.state.bullets).toHaveLength(0);
  });

  it("ボスは体が大きく、その半径で弾が当たる（裁定53）", () => {
    const s = bossMatch();
    const boss = s.players.find((p) => p.id === "boss")!;
    expect(radiusOf(boss)).toBeCloseTo(BALANCE.player.radius * BALANCE.boss.radiusMultiplier);
    expect(radiusOf(s.players[0]!)).toBeCloseTo(BALANCE.player.radius);

    // 普通のキャラの半径より外、ボスの半径より内を通る弾は当たる（見た目と判定が一致する）
    const offset = (BALANCE.player.radius + radiusOf(boss)) / 2;
    s.bullets.push({
      id: 9001, kind: "pistol", owner: "p1", ownerTeam: 0,
      x: boss.x - 60, y: boss.y + offset,
      vx: 600, vy: 0, ox: boss.x - 60, oy: boss.y + offset,
      damage: 10, radius: 1, normal: true, reflectsLeft: 0, boost: 1, mist: false,
    });
    const hpBefore = boss.hp;
    const r = run(s, {}, 0.4);
    const after = r.state.players.find((p) => p.id === "boss")!;
    expect(after.hp).toBeLessThan(hpBefore);
  });
});

describe("ボスの形態（裁定62）", () => {
  function bossMatch(): SimState {
    return createMatch(
      [
        { id: "p1", name: "P1", cls: "speed", team: 0 },
        { id: "p2", name: "P2", cls: "heavy", team: 0 },
        { id: "boss", name: "強敵", cls: "heavy", team: 1 },
      ],
      "boss",
    );
  }

  it("HPが閾値を割ると形態が上がり、無敵とノックバック溜めが入る", () => {
    const s = bossMatch();
    const boss = s.players.find((p) => p.id === "boss")!;
    const max = BALANCE.player.hp * BALANCE.boss.hpMultiplier;
    // 誰もボスの近くにいない（通常ならノックバックの溜めは始まらない）
    for (const p of s.players) if (!p.boss) { p.x = 60; p.y = 60; }
    boss.hp = max * (BALANCE.boss.phases[0]!.hpBelow - 0.01);
    const r = run(s, {}, DT);
    const b = r.state.players.find((p) => p.id === "boss")!;
    expect(b.bossPhase).toBe(2);
    expect(b.invuln).toBeGreaterThan(0);
    expect(r.events.some((e) => e.type === "bossPhase" && e.phase === 2)).toBe(true);
    expect(r.events.some((e) => e.type === "knockbackWindup")).toBe(true);
    expect(b.knockbackT).toBeGreaterThan(0);
  });

  it("形態は戻らず、第3形態では扇の発数が増える", () => {
    const s = bossMatch();
    const boss = s.players.find((p) => p.id === "boss")!;
    const max = BALANCE.player.hp * BALANCE.boss.hpMultiplier;
    boss.hp = max * (BALANCE.boss.phases[1]!.hpBelow - 0.01);
    let r = run(s, {}, DT);
    expect(r.state.players.find((p) => p.id === "boss")!.bossPhase).toBe(3);
    // 溜め・無敵が明けてから扇が飛ぶまで回す
    r = run(r.state, {}, 3.0);
    const shots = r.events.filter((e) => e.type === "shoot" && e.owner === "boss").length;
    expect(shots).toBeGreaterThanOrEqual(BALANCE.boss.phases[1]!.fan.count);
    expect(shots % 1).toBe(0);
    // 回復しても（手で戻しても）形態は下がらない
    const st = r.state;
    st.players.find((p) => p.id === "boss")!.hp = max;
    const r2 = run(st, {}, DT);
    expect(r2.state.players.find((p) => p.id === "boss")!.bossPhase).toBe(3);
  });
});

describe("クラウドの可視判定をbotにも適用（裁定61）", () => {
  function duel(): SimState {
    return createMatch(
      [
        { id: "me", name: "Me", cls: "speed" },
        { id: "bot", name: "Bot", cls: "heavy" },
      ],
      "ffa",
    );
  }

  it("クラウドの中の敵は見えず、攻撃直後と同じクラウド内なら見える", () => {
    const s = duel();
    const me = s.players.find((p) => p.id === "me")!;
    const bot = s.players.find((p) => p.id === "bot")!;
    me.x = 400; me.y = 360; bot.x = 800; bot.y = 360;
    s.smokes.push({ id: 99, owner: "me", ownerTeam: me.team, x: me.x, y: me.y, radius: 180, expire: s.t + 4, mist: false });
    expect(canSee(s, bot, me)).toBe(false);
    expect(canSee(s, me, bot)).toBe(true); // 自分から相手は見える
    me.lastAttackAt = s.t; // 攻撃直後
    expect(canSee(s, bot, me)).toBe(true);
    me.lastAttackAt = -Infinity;
    bot.x = me.x + 50; // 同じクラウドに踏み込んだ
    expect(canSee(s, bot, me)).toBe(true);
  });

  it("攻撃するとシミュレーションが lastAttackAt を記録する", () => {
    const s = duel();
    const r = run(s, { me: { ...NULL_INPUT, aim: 0, fire: true } }, 0.2);
    const me = r.state.players.find((p) => p.id === "me")!;
    expect(me.lastAttackAt).toBeGreaterThanOrEqual(0);
  });

  it("botは隠れた敵を撃たず、最後に見た位置へ歩く", () => {
    const s = duel();
    const me = s.players.find((p) => p.id === "me")!;
    const bot = s.players.find((p) => p.id === "bot")!;
    me.x = 400; me.y = 360; bot.x = 800; bot.y = 360;
    const mem = createBotMemory();
    const rng = () => 0.5;
    // まず見えている状態で1回思考させ、位置を覚えさせる
    botInput(s, "bot", 2, mem, rng);
    expect(mem.targetId).toBe("me");
    // クラウドに隠れる
    s.smokes.push({ id: 99, owner: "me", ownerTeam: me.team, x: me.x, y: me.y, radius: 180, expire: s.t + 4, mist: false });
    s.t += 1; // 反応遅延を越える
    const input = botInput(s, "bot", 2, mem, rng);
    expect(mem.targetId).toBeNull();
    expect(input.fire).toBe(false);
    expect(input.fire2).toBe(false);
    expect(input.mx).toBeLessThan(0); // 左（最後に見た位置）へ向かう
  });
});

describe("弾幕モード（裁定64）", () => {
  function danmaku(): SimState {
    return createMatch(
      [
        { id: "me", name: "Me", cls: "heavy", team: 0 }, // heavy を渡してもスピードに固定される
        { id: "turret", name: "砲台", cls: "heavy", team: 1 },
      ],
      "danmaku",
    );
  }

  it("砲台は中央・ボス扱い・残機1、挑戦者はスピード固定で個人残機", () => {
    const s = danmaku();
    const t = s.players.find((p) => p.id === "turret")!;
    const me = s.players.find((p) => p.id === "me")!;
    expect(t.boss).toBe(true);
    expect(t.hp).toBe(BALANCE.player.hp * BALANCE.danmaku.hpMultiplier);
    expect(t.lives).toBe(1);
    expect(me.cls).toBe("speed");
    expect(me.lives).toBe(BALANCE.danmaku.playerLives);
    expect(s.timeLeft).toBe(BALANCE.danmaku.seconds);
    expect(s.danmaku).not.toBeNull();
    expect(s.zone).toBeNull();
  });

  it("砲台は自動でリングと自機狙いを撃ち、弾は挑戦者の小さい判定にだけ当たる", () => {
    const s = danmaku();
    const r = run(s, {}, 2.0);
    const turretBullets = r.state.bullets.filter((b) => b.owner === "turret");
    expect(turretBullets.length).toBeGreaterThan(BALANCE.danmaku.phases[0]!.ring.count);
    // 当たり判定: 弾幕モードの挑戦者は小さい、砲台は大きい
    const me = r.state.players.find((p) => p.id === "me")!;
    const t = r.state.players.find((p) => p.id === "turret")!;
    expect(bulletHitRadiusOf(r.state, me)).toBe(BALANCE.danmaku.hitRadius);
    expect(bulletHitRadiusOf(r.state, t)).toBe(radiusOf(t));
  });

  it("形態移行で砲台の弾が消え、無敵が入る", () => {
    const s = danmaku();
    let r = run(s, {}, 2.0);
    expect(r.state.bullets.some((b) => b.owner === "turret")).toBe(true);
    const t = r.state.players.find((p) => p.id === "turret")!;
    t.hp = BALANCE.player.hp * BALANCE.danmaku.hpMultiplier * (BALANCE.danmaku.phases[1]!.hpBelow - 0.01);
    r = run(r.state, {}, DT);
    const t2 = r.state.players.find((p) => p.id === "turret")!;
    expect(t2.bossPhase).toBe(2);
    expect(t2.invuln).toBeGreaterThan(0);
    expect(r.state.bullets.some((b) => b.owner === "turret")).toBe(false);
    expect(r.events.some((e) => e.type === "bossPhase" && e.phase === 2)).toBe(true);
  });

  it("砲台を削り切れば勝ち、時間切れは砲台の勝ち", () => {
    const s = danmaku();
    const t = s.players.find((p) => p.id === "turret")!;
    t.hp = 1;
    t.bossPhase = 3;
    const me = s.players.find((p) => p.id === "me")!;
    me.x = t.x - 60; me.y = t.y; me.aim = 0;
    const r = run(s, { me: { ...NULL_INPUT, aim: 0, fire: true } }, 1.0);
    expect(r.state.result?.winnerTeam).toBe(0);

    const s2 = danmaku();
    s2.timeLeft = DT;
    const r2 = run(s2, {}, DT * 2);
    expect(r2.state.result?.winnerTeam).toBe(1);
  });

  it("切り返し硬直が付かない", () => {
    const s = danmaku();
    const me = s.players.find((p) => p.id === "me")!;
    me.x = 200; me.y = 200;
    let r = run(s, { me: { ...NULL_INPUT, mx: 1, my: 0 } }, 0.2);
    r = run(r.state, { me: { ...NULL_INPUT, mx: -1, my: 0 } }, DT);
    expect(r.state.players.find((p) => p.id === "me")!.turnLock).toBe(0);
  });
});

describe("弾幕モードの難易度（裁定66）", () => {
  it("難易度が上がるほど発数・回転・弾速が上がり、残機は変わらない", () => {
    const n = danmakuPhaseAt(1, 0);
    const h = danmakuPhaseAt(1, 2);
    expect(h.ring.count).toBeGreaterThan(n.ring.count);
    expect(h.ring.cooldown).toBeLessThan(n.ring.cooldown);
    expect(h.aimed.speed).toBeGreaterThan(n.aimed.speed);
    const s = createMatch([{ id: "me", name: "Me", cls: "speed" }, { id: "turret", name: "砲台", cls: "heavy" }], "danmaku", { danmakuDifficulty: 2 });
    expect(s.danmaku?.difficulty).toBe(2);
    expect(s.players.find((p) => p.id === "me")!.lives).toBe(BALANCE.danmaku.playerLives);
    const r = run(s, {}, 2.0);
    const s0 = createMatch([{ id: "me", name: "Me", cls: "speed" }, { id: "turret", name: "砲台", cls: "heavy" }], "danmaku");
    const r0 = run(s0, {}, 2.0);
    expect(r.state.bullets.length).toBeGreaterThan(r0.state.bullets.length);
  });
});

describe("弾幕モードの締め（裁定67）", () => {
  function dm(diff = 2): SimState {
    return createMatch([{ id: "me", name: "Me", cls: "speed" }, { id: "turret", name: "砲台", cls: "heavy" }], "danmaku", { danmakuDifficulty: diff });
  }

  it("難易度で砲台の弾ダメージが上がり、当てて回復が絞られる", () => {
    const hard = danmakuPhaseAt(1, 2);
    const normal = danmakuPhaseAt(1, 0);
    expect(hard.ring.damage).toBeGreaterThan(normal.ring.damage);
    // 回復: 砲台にピストルを当ててシールドの伸びを比べる
    const shieldGain = (diff: number) => {
      const s = dm(diff);
      const me = s.players.find((p) => p.id === "me")!;
      const t = s.players.find((p) => p.id === "turret")!;
      me.x = t.x - 200; me.y = t.y; me.aim = 0; me.shield = 0;
      s.danmaku!.ringCd = 999; s.danmaku!.aimedCd = 999; // 砲台を黙らせて回復量だけ測る
      me.lastDamagedAt = s.t; // 時間経過の回復を止め、当てて回復だけを測る
      const r = run(s, { me: { ...NULL_INPUT, aim: 0, fire2: true } }, 1.0); // スピードのピストルは副武器（右）
      return r.state.players.find((p) => p.id === "me")!.shield;
    };
    const g0 = shieldGain(0), g2 = shieldGain(2);
    expect(g0).toBeGreaterThan(0);
    expect(g2).toBeLessThan(g0);
  });

  it("第2形態で固定砲台が4基現れ、順番に自機を狙って撃つ", () => {
    const s = dm(0);
    const t = s.players.find((p) => p.id === "turret")!;
    t.hp = BALANCE.player.hp * BALANCE.danmaku.hpMultiplier * (BALANCE.danmaku.phases[1]!.hpBelow - 0.01);
    let r = run(s, {}, DT);
    expect(r.events.some((e) => e.type === "danmakuSummon")).toBe(true);
    expect(r.state.danmaku!.subTurrets).toHaveLength(BALANCE.danmaku.subTurrets.positions.length);
    // 召喚直後は形態移行の弾消しで空。しばらく回すと4隅から弾が出る
    r = run(r.state, {}, BALANCE.danmaku.subTurrets.cooldown * 4 + 1.0);
    const far = r.events.filter((e) => e.type === "shoot" && e.owner === "turret" && Math.hypot(e.x - t.x, e.y - t.y) > 200);
    expect(far.length).toBeGreaterThanOrEqual(4);
  });
});
