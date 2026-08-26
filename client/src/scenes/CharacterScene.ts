import Phaser from "phaser";
import { BALANCE, crossSecondsOf, moveSpeedOf, shieldMaxOf, type CharClass } from "@pvp/shared";
import { session } from "../session";
import { button, FONT, title } from "../ui";
import { applyView, VIEW } from "../viewport";

const F = BALANCE.field;
const ORDER: CharClass[] = ["speed", "heavy", "support"];
const CLASS_NAME: Record<CharClass, string> = { speed: "スピード", heavy: "タンク", support: "サポート" };
const CLASS_COLOR: Record<CharClass, number> = { speed: 0x22d3ee, heavy: 0xfb923c, support: 0xa3e635 };

/** 数値の丸め（小数第1位まで、整数なら整数表示） */
function n(v: number, digits = 1): string {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return Number.isInteger(r) ? String(r) : r.toFixed(digits);
}

interface Row {
  label: string;
  value: string;
}

/**
 * 数値は balance.ts から自動生成し、文章（役割・立ち回り）だけ手書きする。
 * これにより数値調整をしても説明文が古くならない。
 */
function buildInfo(cls: CharClass): { role: string; tips: string[]; stats: Row[]; weapons: Row[]; skills: Row[]; passive: Row[]; links: string[] } {
  const C = BALANCE.classes[cls];
  const stats: Row[] = [
    { label: "移動速度", value: `画面を${n(crossSecondsOf(cls))}秒で横断` },
    { label: "被ダメージ", value: `×${n(C.damageTaken, 2)}` },
    { label: "シールド", value: `${shieldMaxOf(cls)}（${C.shieldTimeRegen ? "被弾なし2秒で自然回復" : `時間回復なし・与ダメージの${n((BALANCE.shield.heavyLifestealRatio) * 100, 0)}%を回収`}）` },
    { label: "HP", value: String(BALANCE.player.hp) },
  ];

  if (cls === "speed") {
    const S = BALANCE.saber;
    const Pl = BALANCE.pistol;
    const K = BALANCE.speedSkills;
    return {
      role: "紙耐久と引き換えに、全キャラ最速で間合いを支配する近接アタッカー。ピストルでマークを刻み、セイバーの初撃で回収して一気に削り切るのが本命の勝ち筋。",
      tips: [
        "遠距離でマークを付けてから踏み込むと、セイバー初撃の火力が跳ね上がる",
        "被ダメージ1.3倍。撃ち合いを長引かせるほど不利になるので、短時間で出入りする",
        "切り返し硬直があるので、方向転換は大きく振らず弧を描くように動く",
      ],
      stats,
      weapons: [
        { label: "左クリック：剣", value: `${S.hits}ヒット計${S.damagePerHit * S.hits}ダメ・リーチ${n(S.reach, 0)}・1振り${n(S.swingSeconds, 2)}秒。背面から当てるとシールド+${S.lifestealPerHit}/hit。振り中に敵弾を消せる` },
        { label: "右クリック：ピストル", value: `毎秒${Pl.shotsPerSecond}発・${Pl.damage}ダメ・装弾${Pl.magazine}／リロード${n(Pl.reloadSeconds, 1)}秒。命中でマーク付与（最大${Pl.markMax}・${n(Pl.markSeconds, 0)}秒）` },
      ],
      skills: [
        { label: "スキル1：ソニック", value: `逃げゲージ${K.dash.cost}消費・画面幅${n(K.dash.distanceRatio * 100, 1)}%を瞬間移動。直後${n(BALANCE.turnLock.dashExemptSeconds, 1)}秒は切り返し硬直なし` },
        { label: "スキル2：クラウド", value: `逃げゲージ${K.smoke.cost}消費・半径${n(K.smoke.radius, 0)}の煙を${n(K.smoke.seconds, 1)}秒展開。射線を切って仕切り直す` },
        { label: "スキル3：チャージ", value: `CD${n(K.overload.cooldown, 0)}秒。次の${K.overload.shots}発が${K.overload.damageMultiplier}倍（${n(K.overload.expireSeconds, 0)}秒で失効）` },
      ],
      passive: [
        { label: "切り返し硬直", value: `${n((BALANCE.turnLock.minAngleRad * 180) / Math.PI, 0)}度以上の急な方向転換で最大${n(BALANCE.turnLock.at180, 2)}秒だけ足が止まる（照準と攻撃は通常どおり）` },
        { label: "逃げゲージ", value: `最大${K.gaugeMax}・毎秒${K.gaugeRegenPerSecond}回復。マーク回収で+${BALANCE.saber.markGaugeRefund}/枚` },
      ],
      links: [`ブリーチ（タンクの壁と合わせる）：壁を味方だけすり抜け可能にし、マーク火力が${n(BALANCE.link.breach.markBoostMultiplier, 1)}倍に`, "ミストシグナル（サポートのスタン弾と合わせる）：スモーク内の敵全員をスタン"],
    };
  }

  if (cls === "heavy") {
    const H = BALANCE.hmg;
    const K = BALANCE.knife;
    const S = BALANCE.heavySkills;
    const U = BALANCE.unifiedGauge;
    return {
      role: "最も硬く最も遅い、場所を制圧する前衛。シールドが時間で戻らない代わりに、攻撃を当てること自体が回復と資源になる。居座って撃ち続けるほど強い。",
      tips: [
        "シールドは時間で回復しない。ナイフを当てると与ダメージの50%が戻るので、削られたら踏み込む",
        "HMGは撃ち続けるほど弾がまとまる。細かく撃つより長く押す方が当たる",
        "統合ゲージ1本で防御もスキルも賄う。ビルドウォールとスラムの使いどころを決めておく",
      ],
      stats,
      weapons: [
        { label: "左クリック：HMG", value: `毎秒${H.shotsPerSecond}発・${H.damage}ダメ・装弾${H.magazine}／リロード${n(H.reloadSeconds, 1)}秒。回転開始に${n(H.spinupSeconds, 1)}秒、撃ち続けて${n(H.convergeSeconds, 1)}秒で拡散が${n((H.spreadStartRad * 180) / Math.PI, 1)}度→${n((H.spreadEndRad * 180) / Math.PI, 1)}度まで収束` },
        { label: "右クリック：ナイフ", value: `${K.damage}ダメ・リーチ${n(K.reach, 0)}・1振り${n(K.swingSeconds, 2)}秒。命中で統合ゲージ+${U.knifeHitGain}、与ダメージの50%がシールドに戻る` },
      ],
      skills: [
        { label: "スキル1：グラウンドスラム", value: `ゲージ${S.slam.cost}消費・${n(S.slam.windupSeconds, 2)}秒の溜めのあと発動。半径${n(S.slam.radius, 0)}の敵を${n(S.slam.staggerSeconds, 1)}秒のけぞらせ、範囲内の敵弾を消す。溜め中は範囲が敵にも見える` },
        { label: "スキル2：ビルドウォール", value: `ゲージ${S.wall.cost}消費・耐久${S.wall.hp}・${n(S.wall.seconds, 1)}秒。長さはキャラ${n(S.wall.lengthPlayers, 1)}体分。長押しで構え、離すとカーソル位置（最大キャラ${S.wall.placeMaxPlayers}体分）に設置。構え中は右クリックでキャンセル（ゲージは戻らない）。反射弾は耐久を削らない` },
        { label: "スキル3：かばう", value: `ゲージ${S.cover.cost}消費。カーソル方向の味方へ吸着ダッシュし、${n(BALANCE.teams.cover.shellSeconds, 0)}秒のシェルで被ダメージを${n(S.cover.shellDamageCut * 100, 0)}%カット` },
      ],
      passive: [
        { label: "統合ゲージ", value: `最大${U.max}・非ガード時に毎秒${U.regenPerSecond}回復。HMG命中で+${U.hmgHitGain}、ナイフ命中で+${U.knifeHitGain}。防御もここから支払う` },
        { label: "ガードブレイク耐性", value: `ブレイク時の硬直が${n(BALANCE.guard.heavyBreakMultiplier * 100, 0)}%（${n(BALANCE.guard.breakStunSeconds * BALANCE.guard.heavyBreakMultiplier, 2)}秒）に短縮` },
      ],
      links: [
        "ブリーチ（スピードのソニックと合わせる）：自分のビルドウォールを味方だけすり抜け可能にする",
        `ライトニングスラム（サポートのスタン弾と合わせる）：のけぞりが切れる前にスタン弾がスラム範囲へ届くと、範囲の敵全員が${n(BALANCE.link.slamStun.stunSeconds, 1)}秒スタン`,
        `ヒールスラム（サポートのポーションと合わせる）：同じ条件で、スラム範囲の味方全員が追加で${BALANCE.link.slamPotion.heal}回復`,
      ],
    };
  }

  const S = BALANCE.sniper;
  const Hl = BALANCE.healShot;
  const J = BALANCE.jab;
  const K = BALANCE.supportSkills;
  const A = BALANCE.calmAura;
  return {
    role: "後方から味方を支え、一撃で試合を決める狙撃手。左クリック1本で「回復」と「狙撃」を撃ち分けるのが最大の特徴で、押す長さがそのまま役割の切り替えになる。",
    tips: [
      `左クリックは押した長さで変わる。ポンと押せばヒール、${n(S.chargeMin, 1)}秒以上溜めれば狙撃`,
      `${n(S.tapSeconds, 2)}〜${n(S.chargeMin, 1)}秒で離すと何も出ない。わざと溜めて中断すれば、狙撃を警戒させるフェイントになる`,
      "溜め中は移動が遅くなる。撃つ位置を先に決めてから溜め始める",
      "密着されたら右クリックのジャブで剥がす。当てるとHPが少し戻る",
    ],
    stats,
    weapons: [
      { label: "左クリック（単クリック）：ヒール弾", value: `味方のHPを${Hl.heal}回復・${n(Hl.intervalSeconds, 1)}秒間隔。味方に向かって自動で曲がる。敵に当たると消えるだけでダメージなし` },
      { label: "左クリック（溜め）：スナイパー", value: `${n(S.chargeMin, 1)}秒から発射可・最大${n(S.chargeMax, 1)}秒でダメージ${S.damageMin}→${S.damageMax}。溜めるほど弾速が上がり弾が細くなる。壁で${S.wallReflects}回反射。溜め中は移動${n(S.moveMultiplierWhileCharging * 100, 0)}%` },
      { label: "右クリック：ジャブ", value: `${J.damage}ダメ・リーチ${n(J.reach, 0)}（全近接中最短）・1振り${n(J.swingSeconds, 2)}秒。命中でHP+${J.hpStealPerHit}（毎秒${J.hpStealCapPerSecond}まで）` },
    ],
    skills: [
      { label: "スキル1：バレットプルーフ", value: `CD${n(K.bell.cooldown, 0)}秒。単押しで自分に、長押しするとカーソルに近い味方を選んでフラスコを投げつける（高速追尾）。当たった相手は${n(K.bell.invulnSeconds, 2)}秒無敵になり、拘束も解除される。構え中は右クリックでキャンセル` },
      { label: "スキル2：ポーション", value: `CD${n(K.areaHeal.cooldown, 0)}秒。押して離すとカーソル位置（最大キャラ${K.areaHeal.throwMaxPlayers}体分）へ低速で投擲。着弾で半径${n(K.areaHeal.radius, 0)}の味方を${K.areaHeal.heal}回復（自分は${n(K.areaHeal.selfRatio * 100, 0)}%の${n(K.areaHeal.heal * K.areaHeal.selfRatio, 0)}回復）。構え中は右クリックでキャンセル` },
      { label: "スキル3：スタン弾", value: `CD${n(K.stun.cooldown, 0)}秒・命中で${n(K.stun.stunSeconds, 1)}秒拘束＋相手のスキルCDを${n(K.stun.cdDelaySeconds, 0)}秒遅らせる。命中後${n(K.stun.snipeBoostSeconds, 0)}秒以内なら、左クリックの単押しで即最大溜めの狙撃が撃てる（威力は最大溜めの${n(BALANCE.sniper.boostDamageRatio * 100, 0)}%＝${n(BALANCE.sniper.damageMax * BALANCE.sniper.boostDamageRatio, 0)}）` },
    ],
    passive: [
      { label: "静穏オーラ", value: `半径${n(A.radius, 0)}以内の味方（自分含む）を毎秒${A.healPerSecond}回復。最後に被弾してから${n(A.calmSeconds, 0)}秒経った相手だけが対象で、重ねがけはできない` },
    ],
    links: [
      `ライトニング（スピードのクラウドと合わせる）：クラウド内の敵全員に${n(BALANCE.link.lightning.stunSeconds, 1)}秒のスタン`,
      `ライトニングスラム（タンクのグラウンドスラムと合わせる）：スラム範囲の敵全員が${n(BALANCE.link.slamStun.stunSeconds, 1)}秒スタン`,
      `ヒールスラム（タンクのグラウンドスラムと合わせる）：スラム範囲の味方全員が追加で${BALANCE.link.slamPotion.heal}回復`,
    ],
  };
}

export class CharacterScene extends Phaser.Scene {
  private cls: CharClass = "speed";

  constructor() {
    super("character");
  }

  init(data: { cls?: CharClass }): void {
    this.cls = data?.cls ?? session.myCls;
  }

  create(): void {
    // 裁定56: フィールドを画面中央に置く（余白は左右へ均等）
    applyView(this);
    const info = buildInfo(this.cls);
    const accent = CLASS_COLOR[this.cls];

    title(this, F.width / 2, 46, CLASS_NAME[this.cls], 40);

    // 上部のキャラアイコン（開いているものだけ薄暗い）
    ORDER.forEach((c, i) => {
      const x = F.width / 2 + (i - 1) * 120;
      const active = c === this.cls;
      const g = this.add.graphics();
      g.fillStyle(CLASS_COLOR[c], active ? 0.18 : 0.75);
      g.fillCircle(x, 112, 30);
      g.lineStyle(2, CLASS_COLOR[c], active ? 0.5 : 1);
      g.strokeCircle(x, 112, 30);
      this.add
        .text(x, 112, CLASS_NAME[c], {
          fontFamily: FONT,
          fontSize: "12px",
          color: active ? "#64748b" : "#0a1420",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      const zone = this.add.zone(x, 112, 64, 64).setInteractive({ useHandCursor: true });
      zone.on("pointerdown", () => {
        if (c === this.cls) return;
        this.scene.restart({ cls: c });
      });
    });

    // 役割（手書き）
    const roleBox = this.add.graphics();
    roleBox.fillStyle(accent, 0.07);
    roleBox.fillRoundedRect(60, 150, F.width - 120, 62, 10);
    this.add
      .text(F.width / 2, 181, info.role, {
        fontFamily: FONT,
        fontSize: "15px",
        color: "#cbd5e1",
        align: "center",
        wordWrap: { width: F.width - 160 },
      })
      .setOrigin(0.5);

    // 左列: 基礎値＋武器
    this.column(60, 228, 590, "基礎", info.stats);
    this.column(60, 228 + 132, 590, "武器（裁定10: 左クリック＝主武器 / 右クリック＝副武器）", info.weapons);

    // 右列: スキル・パッシブ
    this.column(F.width / 2 + 10, 228, 590, "スキル（E・R・F）", info.skills);
    this.column(F.width / 2 + 10, 228 + 190, 590, "パッシブ", info.passive);

    // 下部: 立ち回りと合体技
    this.column(60, 560, F.width - 120, "立ち回り", info.tips.map((t) => ({ label: "・", value: t })));
    this.column(60, 560 + 100, F.width - 120, "合体技", info.links.map((t) => ({ label: "・", value: t })));

    button(this, F.width / 2, F.height - 34, "戻る", () => this.scene.start("title"), 200, 44);
  }

  private column(x: number, y: number, w: number, heading: string, rows: Row[]): void {
    this.add.text(x, y, heading, { fontFamily: FONT, fontSize: "15px", color: "#7dd3fc", fontStyle: "bold" });
    let cy = y + 24;
    for (const r of rows) {
      const lab = this.add.text(x, cy, r.label, { fontFamily: FONT, fontSize: "13px", color: "#fef08a" });
      const val = this.add.text(x + (r.label === "・" ? 14 : 0), cy + (r.label === "・" ? 0 : 16), r.value, {
        fontFamily: FONT,
        fontSize: "13px",
        color: "#cbd5e1",
        wordWrap: { width: w - (r.label === "・" ? 20 : 0) },
      });
      cy += (r.label === "・" ? 0 : lab.height) + val.height + 8;
    }
  }
}
