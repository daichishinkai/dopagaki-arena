/**
 * 全バランス数値。SPEC.md 16章（初期バランス）と 6章（キャラ）が出典。
 * マジックナンバーはここ以外に書かない。
 */
/**
 * 世界スケール（裁定12）: キャラ・リーチ・範囲・弾速・移動速度を一律 2/3 に縮小。
 * 時間とダメージは不変。フィールド寸法は据え置きなので、キャラ基準ではアリーナが1.5倍広くなる。
 * ここを 1 に戻せば旧スケールに復帰する。
 */
export const WORLD_SCALE = 2 / 3;
/** 長さ・速度（px, px/s）に適用 */
const px = (n: number): number => n * WORLD_SCALE;
/** 画面幅に対する割合に適用 */
const ratio = (n: number): number => n * WORLD_SCALE;
/** 横断秒（速度の逆数）に適用 */
const cross = (n: number): number => n / WORLD_SCALE;

export const BALANCE = {
  /** 論理フィールド寸法。「画面幅」の基準（距離減衰・高速移動の%はこの幅に対する割合） */
  field: { width: 1280, height: 720 },
  tickRate: 60,
  /** 開始カウントダウン（裁定16）: 3→2→1 を表示してから開始 */
  countdownSeconds: 3,
  matchSeconds: 120,

  /** 2vs2（SPEC 5.4 / 6.2） */
  teams: {
    sharedLives: 5,
    /** 3v3のチーム残機（裁定8・暫定値＝調整枠） */
    sharedLives3: 7,
    mourningSeconds: 10,
    /** CD半減＝CD消化2倍。ゲージ制は回復速度2倍で代替 */
    mourningRate: 2,
    cover: { dashMax: px(300), arriveGap: px(10), shellSeconds: 3 },
  },

  player: {
    radius: px(24),
    centerHitRatio: 0.3,
    centerHitMultiplier: 1.5,
    hp: 100,
    lives: 3,
    respawnSeconds: 3,
    respawnInvulnSeconds: 1,
    killHealHp: 10,
  },

  /** クラス別（裁定24: 横断はスピード2.1秒／タンク・支援は2.5秒で統一。被ダメ・シールドは据え置き） */
  classes: {
    speed: { crossSeconds: 2.4 /* 裁定36: 2.1→2.4 */, damageTaken: 1.3, shieldMax: 50, shieldTimeRegen: true },
    heavy: { crossSeconds: 2.8 /* 裁定36: 2.5→2.8 */, damageTaken: 0.85, shieldMax: 100, shieldTimeRegen: false },
    support: { crossSeconds: 2.8 /* 裁定36: 2.5→2.8 */, damageTaken: 1.0, shieldMax: 50, shieldTimeRegen: true },
  },

  shield: {
    regenDelaySeconds: 2,
    regenPerSecond: 15,
    lifestealRatio: 0.5,
    /** 裁定20: 重量型はHMGダメージ半減の副作用を打ち消すため回収率100% */
    heavyLifestealRatio: 1.0,
  },

  guard: {
    max: 100, // スピード・支援。重量型は統合ゲージ200を使う
    shotCost: 25,
    meleeCost: 10,
    regenPerSecond: 15,
    breakStunSeconds: 0.6,
    /** 重量型はブレイク硬直半減 */
    heavyBreakMultiplier: 0.5,
    /** ジャスガ猶予0.1秒: ゲージ消費なし＋相手を軽くのけぞらせる */
    justWindowSeconds: 0.1,
    justStaggerSeconds: 0.25,
  },


  /** 重複CC半減（ガードブレイクは対象外） */
  cc: { stackMultiplier: 0.5 },

  // ---------------- スピード型 ----------------
  pistol: {
    shotsPerSecond: 3,
    damage: 6,
    magazine: 8,
    reloadSeconds: 1.2,
    bulletSpeed: px(1400),
    bulletRadius: px(5),
    falloff: [
      { maxRatio: ratio(0.12), multiplier: 1.0 },
      { maxRatio: ratio(0.35), multiplier: 0.75 },
      { maxRatio: Infinity, multiplier: 0.5 },
    ] as const,
    /** マーク: 全距離有効・最大3・4秒 */
    markMax: 3,
    markSeconds: 4,
  },
  /** 刀（旧セイバー）。裁定25: 2往復をやめ、重厚感のある一振りに */
  saber: {
    swingSeconds: 0.55, // 振り0.3秒＋硬直0.25秒（単発なので硬直を厚めに）
    activeSeconds: 0.3,
    hits: 1,
    /** 1パス。中心通過0.15秒 */
    sweep: { start: 0, passes: 1, passSeconds: 0.3 },
    damagePerHit: 14, // 一振り14（旧: 3×4=12。単発化で当て損ないのリスクが上がるぶん微増）
    lifestealPerHit: 8, // 背面180度限定（旧2×4=8相当を1ヒットに集約）
    lifestealCapPerSecond: 12,
    reach: px(74),
    arcRadians: 1.15, // 片側（約66°）
    /** 弾消し: 振り始め0.2秒後から0.15秒間・通常弾のみ・内部CD1.5秒 */
    erase: { start: 0.2, duration: 0.15, cooldown: 1.5 },
    /** マーク回収: 初撃で全消費。1スタック +4ダメ / 逃げゲージ+8 */
    markBonusDamage: 4,
    markGaugeRefund: 8,
  },
  /** スピード型の切り返し硬直: 角度スケール 45°=0.03秒/180°=0.1秒・入力常時受付・ダッシュ後0.2秒免除（SPEC 6.1） */
  turnLock: { minAngleRad: (40 * Math.PI) / 180, at45: 0.03, at180: 0.1, dashExemptSeconds: 0.2 },

  speedSkills: {
    gaugeMax: 100,
    gaugeRegenPerSecond: 12,
    sameSkillLockSeconds: 0.8,
    /** ソニック（旧・高速移動）。裁定24: 距離をキャラ0.8体分ぶん延長 */
    dash: { cost: 35, distanceRatio: ratio(0.12) + (0.8 * 24 * 2) / 1280 },
    /** クラウド（旧・スモーク）。裁定24: 中で動けるよう半径2倍 */
    smoke: { cost: 30, radius: px(180), seconds: 2 },
    overload: { cooldown: 10, shots: 2, damageMultiplier: 3, expireSeconds: 4 },
  },

  // ---------------- 重量型 ----------------
  unifiedGauge: {
    max: 200,
    regenPerSecond: 10, // 非ガード時
    hmgHitGain: 2,
    knifeHitGain: 20,
  },
  hmg: {
    shotsPerSecond: 6,
    damage: 2, // 裁定20: 当てやすさに対する火力是正（旧4）
    magazine: 30, // 裁定20: 旧40
    reloadSeconds: 2,
    spinupSeconds: 0.4,
    spreadStartRad: (9 * Math.PI) / 180,
    spreadEndRad: (2.5 * Math.PI) / 180,
    convergeSeconds: 1.2,
    /** 射撃停止後1秒スピン維持＋その後1秒で拡散リセット */
    spinKeepSeconds: 1,
    spreadResetSeconds: 1,
    bulletSpeed: px(1300),
    bulletRadius: px(4),
  },
  knife: {
    swingSeconds: 0.9, // 攻撃0.5秒・硬直0.4秒
    /** 1パス。中心通過0.3秒（旧hitTimeと一致） */
    sweep: { start: 0.15, passes: 1, passSeconds: 0.3 },
    damage: 20,
    reach: px(64),
    arcRadians: 0.8,
  },
  heavySkills: {
    sameSkillLockSeconds: 0.8,
    /** 裁定21: 発動前に windupSeconds の溜め（範囲は敵にも見える） */
    slam: { cost: 60, radius: px(150), staggerSeconds: 0.5, windupSeconds: 0.35 },
    /** ビルドウォール（裁定21）: 長押しで構え、離した位置に設置。最大5キャラ分まで */
    wall: { cost: 70, lengthPlayers: 2.5, hp: 80, seconds: 6.5 /* 裁定34: 4.5→6.5 */, thickness: px(12 * 1.3), placeMaxPlayers: 5 },
    cover: { cost: 50, fallbackDashDistance: px(110), fallbackShellSeconds: 1, shellDamageCut: 0.6 },
  },

  // ---------------- 支援型 ----------------
  sniper: {
    /** 裁定10: 左クリックを離した時の溜め時間で3分岐。~tap=ヒール / ~chargeMin=不発（フェイント） / 以上=狙撃 */
    tapSeconds: 0.15,
    chargeMin: 0.3,
    chargeMax: 1.5,
    holdMaxSeconds: 2.5, // 超過で自動発射
    damageMin: 12,
    damageMax: 32,
    radiusMax: px(8), // 弾幅100%
    radiusMin: px(3.2), // 40%
    speedBase: px(1100),
    speedMaxMultiplier: 1.2,
    moveMultiplierWhileCharging: 0.85,
    /** 裁定27: スタン弾ヒット後の即最大溜め弾は通常の最大溜めの60% */
    boostDamageRatio: 0.6,
    wallReflects: 1,
  },
  healShot: {
    heal: 12,
    intervalSeconds: 0.9,
    bulletSpeed: px(520),
    bulletRadius: px(12),
    homingRadPerSecond: 3.5,
    wallReflects: 1,
  },
  jab: {
    swingSeconds: 0.5, // 1発サイクル0.5秒＝DPS16
    /** 1パス。中心通過0.08秒（旧hitTimeと一致） */
    sweep: { start: 0.03, passes: 1, passSeconds: 0.1 },
    damage: 8,
    reach: px(48), // 全近接中最短
    arcRadians: 1.0, // 裁定13: 範囲を見やすくするため厚く（旧0.7）
    hpStealPerHit: 3,
    hpStealCapPerSecond: 8,
  },
  /** 静穏オーラ（裁定9）: 半径2キャラ分・毎秒HP2・最終被弾から4秒経過した味方（自分含む）のみ・シールド対象外・非スタック */
  calmAura: { radius: px(96), healPerSecond: 2, calmSeconds: 4 },

  supportSkills: {
    /** バレットプルーフ（旧・鈴／裁定26）: 単押し=自分／長押し=味方を選んで投擲（追尾・高速） */
    bell: { cooldown: 14, invulnSeconds: 0.75, tapSeconds: 0.15, bulletSpeed: px(1500), bulletRadius: px(9), homingRadPerSecond: 12 },
    /** ポーション（旧・範囲回復／裁定26）: 押す→離すでカーソル位置へ低速投擲。自分は3割回復 */
    areaHeal: { cooldown: 10, radius: px(170), heal: 20, bulletSpeed: px(300), bulletRadius: px(11), selfRatio: 0.3, throwMaxPlayers: 16 /* 裁定38: 8→16 */ },
    /** スタン弾。裁定27: 通常ヒットで「次の狙撃が即最大溜め」を獲得（粘着対策） */
    stun: { cooldown: 12, stunSeconds: 0.5, cdDelaySeconds: 2, bulletSpeed: px(1000), bulletRadius: px(7), snipeBoostSeconds: 6 },
  },

  /** 層2合体技（SPEC 7.2）: 0.5秒以内の相互発動＋距離が画面幅25%以内→0.3秒の構え→LINKボーナス */
  link: {
    windowSeconds: 0.5,
    maxDistanceRatio: ratio(0.25),
    stanceSeconds: 0.3,
    breach: { markBoostSeconds: 2, markBoostMultiplier: 2 },
    /** ライトニング（旧・ミストシグナル）: クラウド×スタン弾 */
    lightning: { stunSeconds: 0.4 },
    /** スラム×スタン弾: スラム範囲の敵を0.5秒スタン（裁定28） */
    slamStun: { stunSeconds: 0.5 },
    /** スラム×ポーション: スラム範囲の味方（支援型自身も含む）に追加20回復（裁定28） */
    slamPotion: { heal: 20 },
    /** 最大連携ダメージの集計窓（成立後3秒・実装判断＝調整枠） */
    damageWindowSeconds: 3,
  },

  /** CPU bot（SPEC 12章）: 難易度はエイム誤差・反応遅延・スキル使用頻度の3パラメータのみ */
  bot: {
    levels: {
      1: { aimError: 0.2, reaction: 0.5, skillFreq: 0 },
      2: { aimError: 0.09, reaction: 0.25, skillFreq: 0.6 },
      3: { aimError: 0.045, reaction: 0.12, skillFreq: 0.9 },
    },
    thinkHz: 10,
  },
} as const;

export type CharClass = keyof typeof BALANCE.classes;

export function moveSpeedOf(cls: CharClass): number {
  return BALANCE.field.width / BALANCE.classes[cls].crossSeconds;
}
export function shieldMaxOf(cls: CharClass): number {
  return BALANCE.classes[cls].shieldMax;
}

/** 後方互換（標準=支援型相当の横断1.5秒） */
export const MOVE_SPEED = BALANCE.field.width / BALANCE.classes.support.crossSeconds;
