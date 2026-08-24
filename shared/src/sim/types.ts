import type { CharClass } from "../balance";

export type PlayerId = string;

export interface PlayerInput {
  /** -1..1 */
  mx: number;
  my: number;
  aim: number;
  /** 左クリック＝主武器（裁定10） */
  fire: boolean;
  /** 右クリック＝副武器（裁定10） */
  fire2: boolean;
  guard: boolean;
  skill1: boolean;
  skill2: boolean;
  skill3: boolean;
}

export const NULL_INPUT: PlayerInput = {
  mx: 0,
  my: 0,
  aim: 0,
  fire: false,
  fire2: false,
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
  /** このスイングで既に1回以上当てた相手（マーク回収の初撃判定用） */
  swingHitIds: PlayerId[];
  /** 近接を出したのが副武器（右クリック）か。表示と武器判定に使う */
  swingSub: boolean;
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

export type BulletKind = "pistol" | "hmg" | "sniper" | "heal" | "stun";

export interface BulletState {
  /** エコーウォール反射による強化倍率（ダメ/回復） */
  boost: number;
  /** ミストシグナル対象のスタン弾 */
  mist: boolean;
  id: number;
  kind: BulletKind;
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

export type MatchMode = "ffa" | "teams";

export type LinkPair = "breach" | "echoWall" | "mistSignal";

export interface SkillRecord {
  owner: PlayerId;
  team: number;
  kind: "wall" | "dash" | "areaHeal" | "smoke" | "stun";
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

export interface SimState {
  t: number;
  tick: number;
  phase: MatchPhase;
  mode: MatchMode;
  /** teams のみ: チームID→残機（共有5） */
  teamLives: Record<number, number>;
  timeLeft: number;
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
  | { type: "shoot"; owner: PlayerId; x: number; y: number; kind: BulletKind }
  | { type: "swing"; owner: PlayerId }
  | { type: "hit"; target: PlayerId; attacker: PlayerId; x: number; y: number; damage: number; center: boolean; guarded: boolean; melee: boolean }
  | { type: "heal"; target: PlayerId; from: PlayerId; amount: number; x: number; y: number }
  | { type: "erase"; owner: PlayerId; count: number }
  | { type: "guardBreak"; target: PlayerId }
  | { type: "justGuard"; target: PlayerId; attacker: PlayerId }
  | { type: "skill"; owner: PlayerId; skill: number }
  | { type: "wallBreak"; id: number }
  | { type: "kill"; target: PlayerId; attacker: PlayerId }
  | { type: "respawn"; target: PlayerId }
  | { type: "link"; pair: LinkPair; owners: [PlayerId, PlayerId]; x: number; y: number }
  | { type: "matchEnd"; result: MatchResult };
