import type { CharClass } from "../balance";

export type PlayerId = string;

export interface PlayerInput {
  /** -1..1 */
  mx: number;
  my: number;
  aim: number;
  /** 左クリック＝主武器（裁定10） */
  fire: boolean;
  /** 右クリック＝副武器（裁定10）。ビルドウォール構え中はキャンセル入力になる */
  fire2: boolean;
  /** カーソルまでの距離（ビルドウォールの設置位置に使う） */
  aimDist: number;
  /** スキル1を押し続けているか（バレットプルーフの構え判定・裁定26） */
  skill1Held: boolean;
  /** スキル2を押し続けているか（ビルドウォール／ポーションの構え判定） */
  skill2Held: boolean;
  /** 構え中にカーソルが選んでいる味方（バレットプルーフの追尾先） */
  aimAllyId: PlayerId | null;
  guard: boolean;
  skill1: boolean;
  skill2: boolean;
  skill3: boolean;
  /** 構え中のキャンセル（裁定40: タッチ操作用。右クリックと同じ扱い） */
  cancel?: boolean;
}

export const NULL_INPUT: PlayerInput = {
  mx: 0,
  my: 0,
  aim: 0,
  fire: false,
  fire2: false,
  aimDist: 0,
  skill1Held: false,
  skill2Held: false,
  aimAllyId: null,
  guard: false,
  skill1: false,
  skill2: false,
  skill3: false,
};

export interface MarkState {
  from: PlayerId;
  stacks: number;
  expire: number; // state.t 基準
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  cls: CharClass;
  team: number; // 1vs1・乱闘は全員別チーム
  x: number;
  y: number;
  aim: number;
  hp: number;
  shield: number;
  lastDamagedAt: number;

  guardGauge: number; // 速・支のみ（重は unifiedGauge を使う）
  guarding: boolean;
  guardStartedAt: number; // ジャスガ判定
  guardBreak: number;
  /** この振り（1連）でガード削りを適用済みか: 振りID */
  lastGuardDrainSwing: number;

  /** 直近に使った武器（0=主/左, 1=副/右）。表示・bot判断用（裁定10で切替操作は廃止） */
  weapon: number;

  // 射撃武器
  magazine: number;
  reload: number;
  fireCooldown: number;
  prevFire: boolean;
  prevFire2: boolean;

  // HMG
  hmgSpin: number; // fire押下の継続秒
  hmgFireHeld: number; // 連射継続秒（収束用）
  hmgSinceStop: number;

  // 近接（セイバー/ナイフ/素手）
  swingT: number; // 残り秒（0で非スイング）
  swingId: number;
  swingHitsDone: number;
  /** 掃き判定: 直前tickの棒の角度（p.aim基準の相対角）。非スイング時は null */
  swingAngle: number | null;
  /** 現在のパスで既に当てた相手（1パス1ヒットに制限・裁定23） */
  swingHitIds: PlayerId[];
  /** 現在のパス番号（切り替わったら swingHitIds を空にする） */
  swingPass: number;
  /** ボス（裁定49）。強化倍率と専用スキルの持ち主かどうか */
  boss?: boolean;
  /** 弾幕モードの固定砲台（裁定70）。動かない・壊せる敵。召喚まで lives=0 で隠す */
  turret?: boolean;
  /** ボスの範囲ノックバックの溜め残り秒（>0 で溜め中） */
  knockbackT: number;
  /** ボスの範囲ノックバックのCD残り秒 */
  knockbackCd: number;
  /** ボスの扇状射撃のCD残り秒（裁定53） */
  fanCd: number;
  /** ボスの形態（裁定62）。1から始まり、HPが閾値を割るたびに上がる */
  bossPhase: number;
  /** 最後に攻撃した時刻（state.t基準・裁定61）。クラウドの「攻撃直後は見える」判定に使う */
  lastAttackAt: number;
  /** 近接を出したのが副武器（右クリック）か。表示と武器判定に使う */
  swingSub: boolean;
  /** ビルドウォールを構えている（裁定21）。ゲージは構え開始時に消費済み */
  wallAiming: boolean;
  /** バレットプルーフを構えている（裁定26） */
  bellAiming: boolean;
  bellHoldT: number;
  /** バレットプルーフの残り時間（裁定38: 表示用。無敵の実体は invuln） */
  bulletproofT: number;
  /** ポーションを構えている（裁定26） */
  potionAiming: boolean;
  /** スタン弾の通常ヒットで得た「次の狙撃が即最大溜め」の有効期限（裁定27） */
  snipeBoostUntil: number;
  /** グラウンドスラムの溜め残り秒（裁定21）。0で発動 */
  slamT: number;
  eraseCd: number;
  eraseUsedThisSwing: boolean;

  // スナイパー
  chargeT: number; // 溜め経過（0=非溜め）
  holdT: number;

  // リソース
  escapeGauge: number; // 速
  unifiedGauge: number; // 重
  skillCd: [number, number, number];
  skillLock: [number, number, number]; // 同一スキル再使用0.8秒
  overloadShots: number;
  overloadExpire: number;

  // 切り返し硬直（スピード型）
  turnLock: number;
  lastMoveDir: number | null;
  dashFreeUntil: number;
  /** ブリーチ: マーク付与2倍の終了時刻 */
  markBoostUntil: number;
  /** 与ダメ合計（称号用） */
  damageDealt: number;

  // CC
  cc: number; // スタン/のけぞり残り秒（重複半減の対象）
  shell: number; // かばうシェル残り秒
  marks: MarkState | null;

  // スティール秒間キャップ
  stealWindowStart: number;
  stealWindowAmount: number;

  lives: number;
  /** 弔い合戦ブースト終了時刻（state.t基準） */
  boostUntil: number;
  respawn: number;
  invuln: number;
  kills: number;
  deaths: number;
}

export type BulletKind = "pistol" | "hmg" | "sniper" | "heal" | "stun" | "bell" | "potion";
/** ヒットを出した武器（裁定37: 武器別ヒット音のため）。近接はクラスで一意、弾は BulletKind、link はリンク効果によるスタン */
export type HitWeapon = "saber" | "knife" | "jab" | BulletKind | "link";

export interface BulletState {
  /** エコーウォール反射による強化倍率（ダメ/回復） */
  boost: number;
  /** ミストシグナル対象のスタン弾 */
  mist: boolean;
  id: number;
  kind: BulletKind;
  /** 投擲物の着弾地点（ポーション）。到達で炸裂する */
  tx?: number;
  ty?: number;
  /** 追尾対象（バレットプルーフ） */
  homingId?: PlayerId;
  owner: PlayerId;
  ownerTeam: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ox: number;
  oy: number;
  damage: number;
  radius: number;
  /** 通常弾＝セイバー弾消し可（pistol/hmg/heal。過装填弾も通常弾扱い） */
  normal: boolean;
  reflectsLeft: number;
}

export interface WallState {
  id: number;
  owner: PlayerId;
  ownerTeam: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hp: number;
  expire: number;
  /** 層2ブリーチ: 味方のみすり抜け可 */
  breach: boolean;
  /** 層2エコーウォール: この壁で反射した味方弾のダメ/回復+25% */
  echo: boolean;
}

export interface SmokeState {
  id: number;
  owner: PlayerId;
  ownerTeam: number;
  x: number;
  y: number;
  radius: number;
  expire: number;
  /** 層2ミストシグナル対象 */
  mist: boolean;
}

export type MatchPhase = "playing" | "ended";

export type MatchMode = "ffa" | "teams" | "boss" | "danmaku";

export type LinkPair = "breach" | "lightning" | "slamStun" | "slamPotion";

export interface SkillRecord {
  owner: PlayerId;
  team: number;
  kind: "wall" | "dash" | "areaHeal" | "smoke" | "stun" | "slam";
  t: number;
  x: number;
  y: number;
  refId: number | null; // wallId / smokeId / bulletId
}

export interface LinkWindow {
  until: number;
  owners: [PlayerId, PlayerId];
  damage: number;
}

export interface PendingLink {
  pair: LinkPair;
  applyAt: number;
  team: number;
  owners: [PlayerId, PlayerId];
  refA: number | null;
  refB: number | null;
}

export interface MatchResult {
  winner: PlayerId | null;
  /** 2vs2ではこちらが正。winner はチーム先頭のプレイヤー */
  winnerTeam: number | null;
  reason: "lives" | "timeout-lives" | "timeout-hp" | "draw";
}

/** グラウンドスラムの残り効果域（裁定28: のけぞりが切れるまでスキルリンクを受け付ける） */
export interface SlamZone {
  owner: PlayerId;
  team: number;
  x: number;
  y: number;
  until: number;
}

/** 中央エリア（裁定45） */
export interface ZoneState {
  x: number;
  y: number;
  w: number;
  h: number;
  /** チームID → 0..1。満タンで相手の残機-1 して 0 に戻る */
  gauge: Record<number, number>;
}

/** 弾幕砲台のタイマー（裁定64） */
export interface DanmakuState {
  /** 難易度の添字（裁定66: BALANCE.danmaku.difficulties） */
  difficulty: number;
  ringCd: number;
  ringShots: number;
  aimedCd: number;
  spiralAngle: number;
  spiralAcc: number;
  /** 固定砲台（裁定67）: 召喚済みか。実体は turret フラグ付きのプレイヤー（裁定70） */
  summoned: boolean;
  subCd: number;
  subIndex: number;
}

export interface SimState {
  /** 開始カウントダウンの残り秒（裁定16）。>0 の間は全処理を止める */
  countdown: number;
  slamZones: SlamZone[];
  t: number;
  tick: number;
  phase: MatchPhase;
  mode: MatchMode;
  /** teams のみ: チームID→残機（共有5） */
  teamLives: Record<number, number>;
  /** 中央エリア（裁定45）。teams のみ、それ以外は null */
  zone: ZoneState | null;
  /** 弾幕モードの砲台の内部状態（裁定64）。danmaku 以外は null */
  danmaku: DanmakuState | null;
  timeLeft: number;
  /** 訓練場（裁定35）: 時間を進めず、残機を減らさず、撃破後は自動復活。試合は終わらない */
  practice?: boolean;
  players: PlayerState[];
  bullets: BulletState[];
  walls: WallState[];
  smokes: SmokeState[];
  nextId: number;
  /** 層2: 直近スキル記録と構え中のLINK */
  recentSkills: SkillRecord[];
  pendingLinks: PendingLink[];
  linkWindows: LinkWindow[];
  linkCount: number;
  maxLinkDamage: number;
  result: MatchResult | null;
}

export type SimEvent =
  /** 開始カウントダウンの数字が変わった瞬間（3→2→1→0） */
  | { type: "countdown"; left: number }
  /** グラウンドスラムの溜め開始（裁定21） */
  | { type: "slamWindup"; owner: PlayerId }
  /** ビルドウォールの構え開始／キャンセル（裁定21） */
  | { type: "wallAim"; owner: PlayerId; cancelled: boolean }
  /** スキルリンク: スラム範囲に感電／回復が広がる演出用（裁定28） */
  | { type: "slamLink"; pair: "slamStun" | "slamPotion"; x: number; y: number; ox: number; oy: number; radius: number }
  | { type: "shoot"; owner: PlayerId; x: number; y: number; kind: BulletKind }
  | { type: "swing"; owner: PlayerId }
  | { type: "hit"; target: PlayerId; attacker: PlayerId; x: number; y: number; damage: number; center: boolean; guarded: boolean; melee: boolean; weapon: HitWeapon }
  | { type: "heal"; target: PlayerId; from: PlayerId; amount: number; x: number; y: number }
  /** バレットプルーフ発動（裁定38）: 対象にシールド演出＋専用音 */
  | { type: "bulletproof"; target: PlayerId; from: PlayerId; x: number; y: number }
  /** ポーション炸裂（裁定38）: 着弾点に範囲の円が広がる。回復した相手がいなくても出る */
  | { type: "potion"; owner: PlayerId; x: number; y: number; radius: number }
  | { type: "erase"; owner: PlayerId; count: number }
  | { type: "guardBreak"; target: PlayerId }
  | { type: "justGuard"; target: PlayerId; attacker: PlayerId }
  | { type: "skill"; owner: PlayerId; skill: number }
  /** ソニックの移動（裁定24）: 残像トレイル演出用の始点と終点 */
  | { type: "sonic"; owner: PlayerId; fromX: number; fromY: number; x: number; y: number }
  | { type: "wallBreak"; id: number }
  | { type: "kill"; target: PlayerId; attacker: PlayerId }
  | { type: "respawn"; target: PlayerId }
  /** 裁定47: 縁取り演出のため、成立したオブジェクトの種類とIDも持つ */
  | { type: "link"; pair: LinkPair; owners: [PlayerId, PlayerId]; team: number; x: number; y: number; object: { kind: "wall" | "smoke"; id: number } | null }
  /** 中央エリアを制圧した（裁定45）: team が victim の残機を1つ削った */
  | { type: "zoneCapture"; team: number; victim: number; x: number; y: number }
  /** ボスの範囲ノックバック（裁定49）: 溜め開始と発動 */
  | { type: "knockbackWindup"; owner: PlayerId; x: number; y: number; radius: number }
  | { type: "knockback"; owner: PlayerId; x: number; y: number; radius: number }
  /** ボスの形態移行（裁定62） */
  | { type: "bossPhase"; owner: PlayerId; phase: number; x: number; y: number }
  /** 固定砲台の召喚（裁定67） */
  | { type: "danmakuSummon"; positions: { x: number; y: number }[] }
  | { type: "matchEnd"; result: MatchResult };
