import { describe, expect, it } from "vitest";
import { BALANCE, moveSpeedOf } from "../src/balance";
import { createMatch as createMatchRaw, step } from "../src/sim/step";
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

function match3v3(): SimState {
  return createMatch(
    [
      { id: "a1", name: "A1", cls: "speed", team: 0 },
      { id: "a2", name: "A2", cls: "heavy", team: 0 },
      { id: "a3", name: "A3", cls: "support", team: 0 },
      { id: "b1", name: "B1", cls: "speed", team: 1 },
      { id: "b2", name: "B2", cls: "heavy", team: 1 },
      { id: "b3", name: "B3", cls: "support", team: 1 },
    ],
    "teams",
  );
}

describe("3v3（裁定8）", () => {
  it("チーム残機は7・2vs2は5のまま", () => {
    const s3 = match3v3();
    expect(s3.teamLives[0]).toBe(7);
    expect(s3.teamLives[1]).toBe(7);
    const s2 = createMatch(
      [
        { id: "a1", name: "A1", cls: "speed", team: 0 },
        { id: "a2", name: "A2", cls: "heavy", team: 0 },
        { id: "b1", name: "B1", cls: "speed", team: 1 },
        { id: "b2", name: "B2", cls: "heavy", team: 1 },
      ],
      "teams",
    );
    expect(s2.teamLives[0]).toBe(5);
  });
  it("チーム戦のスポーンは味方が同じ側（チーム0=左列・チーム1=右列）", () => {
    const s = match3v3();
    for (const p of s.players) {
      if (p.team === 0) expect(p.x).toBeLessThan(BALANCE.field.width / 2);
      else expect(p.x).toBeGreaterThan(BALANCE.field.width / 2);
    }
    // 同チーム内で位置が重ならない
    const ys = s.players.filter((p) => p.team === 0).map((p) => p.y);
    expect(new Set(ys).size).toBe(3);
  });
});

describe("スピード型の切り返し硬直（SPEC 6.1）", () => {
  it("180°切り返しで約0.1秒移動が止まる。支援型は止まらない", () => {
    const mk = (cls: "speed" | "support") => {
      const s = createMatch([
        { id: "a", name: "A", cls },
        { id: "b", name: "B", cls: "support" },
      ]);
      s.players[0]!.x = 400;
      s.players[1]!.x = 1200;
      return s;
    };
    for (const cls of ["speed", "support"] as const) {
      const s = mk(cls);
      // 右に0.5秒 → 左に切り返し
      const r1 = run(s, { a: { ...NULL_INPUT, mx: 1 } }, 0.5);
      const x1 = r1.state.players[0]!.x;
      const r2 = run(r1.state, { a: { ...NULL_INPUT, mx: -1 } }, 0.1);
      const moved = Math.abs(r2.state.players[0]!.x - x1);
      if (cls === "speed") {
        expect(r2.state.players[0]!.turnLock).toBeGreaterThan(0); // 直後は硬直が残っている程度の精度で見る
        expect(moved).toBeLessThan(moveSpeedOf("speed") * 0.1 * 0.25); // ほぼ止まる
      } else {
        expect(moved).toBeGreaterThan(moveSpeedOf("support") * 0.1 * 0.9); // 支援型は即座に動ける
      }
    }
  });
  it("高速移動の直後0.2秒は切り返し硬直が免除される", () => {
    const s = createMatch([
      { id: "a", name: "A", cls: "speed" },
      { id: "b", name: "B", cls: "support" },
    ]);
    s.players[0]!.x = 300;
    s.players[1]!.x = 1200;
    const r1 = run(s, { a: { ...NULL_INPUT, mx: 1 } }, 0.3);
    // ダッシュ（移動方向=右のまま）→ 直後に左へ切り返し
    const r2 = run(r1.state, { a: { ...NULL_INPUT, mx: 1, skill1: true } }, DT * 2);
    const x2 = r2.state.players[0]!.x;
    const r3 = run(r2.state, { a: { ...NULL_INPUT, mx: -1 } }, 0.1);
    expect(r3.state.players[0]!.turnLock).toBe(0);
    // 免除で即座に戻れる（移動速度に追従させる）
    expect(x2 - r3.state.players[0]!.x).toBeGreaterThan(moveSpeedOf("speed") * 0.1 * 0.9);
  });
});

describe("最大連携ダメージ（SPEC 7.2）", () => {
  it("LINK成立後3秒間の参加者与ダメが集計され、最大値が残る", () => {
    const s = createMatch(
      [
        { id: "hv", name: "H", cls: "heavy", team: 0 },
        { id: "sp", name: "S", cls: "speed", team: 0 },
        { id: "e1", name: "E1", cls: "support", team: 1 },
        { id: "e2", name: "E2", cls: "support", team: 1 },
      ],
      "teams",
    );
    const hv = s.players.find((p) => p.id === "hv")!;
    const sp = s.players.find((p) => p.id === "sp")!;
    const e1 = s.players.find((p) => p.id === "e1")!;
    hv.x = 400; hv.y = 300; hv.aim = Math.PI / 2; // 壁は下向きに置いて弾道を塞がない
    sp.x = 420; sp.y = 300;
    e1.x = 700; e1.y = 300;
    // ブリーチ成立（発動後は移動入力を止めて位置を固定）
    const r0 = run(s, { hv: { ...NULL_INPUT, aim: Math.PI / 2, aimDist: 60, skill2: true }, sp: { ...NULL_INPUT, mx: 1, skill1: true } }, DT * 2);
    const r1 = run(r0.state, {}, 0.35);
    expect(r1.state.linkWindows.length).toBe(1);
    // 参加者spが撃つ → maxLinkDamage に載る
    const r2 = run(r1.state, { sp: { ...NULL_INPUT, aim: 0, fire2: true } }, 1.0); // ピストル=右クリック
    expect(r2.state.maxLinkDamage).toBeGreaterThan(0);
    const recorded = r2.state.maxLinkDamage;
    // 窓が閉じた後のダメージは加算されない
    const r3 = run(r2.state, {}, 2.5);
    const r4 = run(r3.state, { sp: { ...NULL_INPUT, aim: 0, fire2: true } }, 0.6);
    expect(r4.state.maxLinkDamage).toBe(recorded);
  });
});

describe("スキルリンク（SPEC 7.2）", () => {
  function teamPair(): SimState {
    return createMatch(
      [
        { id: "hv", name: "H", cls: "heavy", team: 0 },
        { id: "sp", name: "S", cls: "speed", team: 0 },
        { id: "su", name: "U", cls: "support", team: 0 },
        { id: "e1", name: "E1", cls: "support", team: 1 },
      ],
      "teams",
    );
  }
  it("ブリーチ: 壁+高速移動が0.5秒以内・25%以内で成立→0.3秒後に壁が味方すり抜け可", () => {
    const s = teamPair();
    const hv = s.players.find((p) => p.id === "hv")!;
    const sp = s.players.find((p) => p.id === "sp")!;
    hv.x = 400; hv.y = 360; hv.aim = 0;
    sp.x = 420; sp.y = 360;
    sp.escapeGauge = 100;
    const r1 = run(s, { hv: { ...NULL_INPUT, aim: 0, aimDist: 60, skill2: true }, sp: { ...NULL_INPUT, mx: 1, skill1: true } }, DT * 3);
    expect(r1.state.pendingLinks.length + r1.events.filter((e) => e.type === "link").length).toBeGreaterThan(0);
    const r2 = run(r1.state, {}, 0.35);
    const linkEv = [...r1.events, ...r2.events].find((e) => e.type === "link");
    expect(linkEv && linkEv.type === "link" && linkEv.pair).toBe("breach");
    expect(r2.state.walls[0]!.breach).toBe(true);
    expect(r2.state.linkCount).toBe(1);
    // 敵チームは抜けられない: pathBlockedは内部関数なので押し出しで確認
    const e1 = r2.state.players.find((p) => p.id === "e1")!;
    const w = r2.state.walls[0]!;
    e1.x = (w.x1 + w.x2) / 2 + 1;
    e1.y = (w.y1 + w.y2) / 2;
    const r3 = run(r2.state, {}, DT * 2);
    const pushed = r3.state.players.find((p) => p.id === "e1")!;
    expect(Math.abs(pushed.x - e1.x)).toBeGreaterThan(5); // 押し出される
  });
  it("成立しない: 距離が画面幅25%超", () => {
    const s = teamPair();
    const hv = s.players.find((p) => p.id === "hv")!;
    const sp = s.players.find((p) => p.id === "sp")!;
    hv.x = 200; hv.y = 360; hv.aim = 0;
    sp.x = 200 + BALANCE.field.width * 0.3; sp.y = 360;
    const r = run(s, { hv: { ...NULL_INPUT, aim: 0, aimDist: 60, skill2: true }, sp: { ...NULL_INPUT, mx: 1, skill1: true } }, 0.5);
    expect(r.state.linkCount).toBe(0);
  });
  it("スラム×スタン（裁定28）: のけぞり中にスタン弾がスラム範囲へ着弾→範囲の敵を0.5秒スタン", () => {
    const s = createMatch(
      [
        { id: "hv", name: "HV", cls: "heavy", team: 0 },
        { id: "su", name: "SU", cls: "support", team: 0 },
        { id: "e1", name: "E1", cls: "speed", team: 1 },
      ],
      "teams",
    );
    const hv = s.players.find((p) => p.id === "hv")!;
    const su = s.players.find((p) => p.id === "su")!;
    const e1 = s.players.find((p) => p.id === "e1")!;
    hv.x = 600; hv.y = 360;
    su.x = 300; su.y = 360; su.aim = 0;
    e1.x = 640; e1.y = 360; // スラム範囲内
    const r0 = run(s, { hv: { ...NULL_INPUT, skill1: true }, su: { ...NULL_INPUT, aim: 0, skill3: true } }, DT * 2);
    const r1 = run(r0.state, {}, 0.8); // 溜め0.35秒→発動→スタン弾が到達
    const ev = [...r0.events, ...r1.events].find((e) => e.type === "link");
    expect(ev && ev.type === "link" && ev.pair).toBe("slamStun");
    expect(r1.state.players.find((p) => p.id === "e1")!.cc).toBeGreaterThan(0);
  });

  it("ライトニング（旧ミストシグナル）: スモーク+スタン弾→スモーク内の全敵に0.4秒スタン（弾道外の敵にも入る）", () => {
    const s = teamPair();
    const sp = s.players.find((p) => p.id === "sp")!;
    const su = s.players.find((p) => p.id === "su")!;
    const e1 = s.players.find((p) => p.id === "e1")!;
    sp.x = 600; sp.y = 360; // スモーク中心
    su.x = 600 - BALANCE.field.width * BALANCE.link.maxDistanceRatio * 0.8; su.y = 360; su.aim = 0;
    e1.x = 600 + BALANCE.speedSkills.smoke.radius * 0.5;
    e1.y = 360 + BALANCE.speedSkills.smoke.radius * 0.5; // スモーク内・弾道(y=360)からは外れている
    // 速がスモーク → 0.35秒後（0.5秒以内）に支がスタン弾を撃ち込む
    const r1 = run(s, { sp: { ...NULL_INPUT, skill2: true } }, 0.35);
    const r2 = run(r1.state, { su: { ...NULL_INPUT, aim: 0, skill3: true } }, DT * 2);
    const linkEv = [...r1.events, ...r2.events].find((e) => e.type === "link");
    const r3 = run(r2.state, {}, 0.6);
    const linkEv2 = linkEv ?? r3.events.find((e) => e.type === "link");
    expect(linkEv2 && linkEv2.type === "link" && linkEv2.pair).toBe("lightning");
    const enemy = r3.state.players.find((p) => p.id === "e1")!;
    expect(enemy.cc).toBeGreaterThan(0.05); // 弾道外でも炸裂スタンを受けた
  });
});


describe("静穏オーラ（裁定9）", () => {
  function auraMatch() {
    const s = createMatch(
      [
        { id: "su", name: "S", cls: "support", team: 0 },
        { id: "al", name: "A", cls: "speed", team: 0 },
        { id: "su2", name: "S2", cls: "support", team: 0 },
        { id: "en", name: "E", cls: "heavy", team: 1 },
      ],
      "teams",
    );
    const [su, al, su2, en] = s.players as [any, any, any, any];
    su.x = 400; su.y = 360;
    al.x = 450; al.y = 360; // 半径96以内
    su2.x = 430; su2.y = 360;
    en.x = 1100; en.y = 600;
    return s;
  }
  it("最終被弾から4秒経過した味方のHPが毎秒2回復。シールドは回復しない", () => {
    const s = auraMatch();
    const al = s.players[1]!;
    al.hp = 50;
    al.shield = 10;
    al.lastDamagedAt = -10; // とっくに落ち着いている
    const r = run(s, {}, 2);
    // 支援2人いても非スタック＝2秒で+4（±1tick誤差）
    expect(r.state.players[1]!.hp).toBeGreaterThan(53.5);
    expect(r.state.players[1]!.hp).toBeLessThan(54.5);
  });
  it("被弾4秒未満（戦闘中）は効かない", () => {
    const s = auraMatch();
    const al = s.players[1]!;
    al.hp = 50;
    al.lastDamagedAt = 0; // 直前に被弾
    const r = run(s, {}, 3);
    expect(r.state.players[1]!.hp).toBe(50);
  });
  it("支援型自身も対象（自己回復あり）", () => {
    const s = auraMatch();
    const su = s.players[0]!;
    su.hp = 50;
    su.lastDamagedAt = -10;
    const r = run(s, {}, 1);
    expect(r.state.players[0]!.hp).toBeCloseTo(52, 0);
  });
  it("支援型がダウン中はオーラが消える", () => {
    const s = auraMatch();
    const al = s.players[1]!;
    al.hp = 50;
    al.lastDamagedAt = -10;
    s.players[0]!.respawn = 3; // ダウン中
    s.players[2]!.respawn = 3; // もう1人も
    const r = run(s, {}, 1);
    expect(r.state.players[1]!.hp).toBe(50);
  });
  it("半径96の外には届かない", () => {
    const s = auraMatch();
    const al = s.players[1]!;
    al.x = 400 + 200; // 圏外
    al.hp = 50;
    al.lastDamagedAt = -10;
    s.players[2]!.x = 1000; // su2も遠ざける
    const r = run(s, {}, 1);
    expect(r.state.players[1]!.hp).toBe(50);
  });
});

describe("訓練場（裁定35）: 時間切れなし・残機減少なし・自動復活", () => {
  it("2分を超えても試合が終わらず、timeLeftも減らない", () => {
    let s = createMatch([{ id: "a", name: "a", cls: "speed" }, { id: "b", name: "b", cls: "support" }], "ffa", { practice: true });
    s = { ...s, countdown: 0 };
    const before = s.timeLeft;
    for (let i = 0; i < 60 * 130; i++) s = step(s, {}, 1 / 60).state;
    expect(s.phase).toBe("playing");
    expect(s.timeLeft).toBe(before);
  });
  it("撃破されても残機は減らず、復活時間後に自動復活する", () => {
    let s = createMatch([{ id: "a", name: "a", cls: "speed" }, { id: "b", name: "b", cls: "support" }], "ffa", { practice: true });
    s = { ...s, countdown: 0 };
    const b = s.players[1]!;
    b.hp = 1; b.shield = 0; b.x = s.players[0]!.x + 40; b.y = s.players[0]!.y;
    let killed = false;
    for (let i = 0; i < 60 * 2 && !killed; i++) {
      const r = step(s, { a: { ...NULL_INPUT, aim: 0, fire: true } }, 1 / 60);
      s = r.state;
      if (r.events.some((e) => e.type === "kill")) killed = true;
    }
    expect(killed).toBe(true);
    expect(s.players[1]!.lives).toBe(BALANCE.player.lives);
    for (let i = 0; i < 60 * (BALANCE.player.respawnSeconds + 0.5); i++) s = step(s, {}, 1 / 60).state;
    expect(s.players[1]!.hp).toBeGreaterThan(0);
    expect(s.phase).toBe("playing");
  });
  it("通常戦は従来どおり時間切れで終わる", () => {
    let s = createMatch([{ id: "a", name: "a", cls: "speed" }, { id: "b", name: "b", cls: "support" }], "ffa");
    s = { ...s, countdown: 0 };
    for (let i = 0; i < 60 * (BALANCE.matchSeconds + 1); i++) s = step(s, {}, 1 / 60).state;
    expect(s.phase).toBe("ended");
  });
});

describe("ヒットイベントの武器情報（裁定37）", () => {
  it("スピードの刀ヒットは weapon: saber、サポートのジャブは jab を持つ", () => {
    let s = createMatch([{ id: "a", name: "a", cls: "speed" }, { id: "b", name: "b", cls: "support" }], "ffa");
    s.players[1]!.x = s.players[0]!.x + 40; s.players[1]!.y = s.players[0]!.y;
    const weapons = new Set<string>();
    for (let i = 0; i < 60 * 2; i++) {
      const r = step(s, { a: { ...NULL_INPUT, aim: 0, fire: true }, b: { ...NULL_INPUT, aim: Math.PI, fire2: true } }, 1 / 60);
      s = r.state;
      for (const e of r.events) if (e.type === "hit" && e.damage > 0) weapons.add(e.weapon);
    }
    expect(weapons.has("saber")).toBe(true);
    expect(weapons.has("jab")).toBe(true);
  });
});
