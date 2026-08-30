import { BALANCE } from "../balance";
import type { PlayerState, SimState } from "./types";

/**
 * クラウド（草むら方式・裁定59）の可視判定。裁定61でクライアント描画から共有へ移し、botも同じ判定を使う。
 *
 * ルール:
 * - 味方と自分は常に見える
 * - 攻撃した直後（revealMs）は見える（撃ちながら完全に消えるのは理不尽なため）
 * - 敵がクラウドの中にいると見えない
 * - 同じクラウドに自分も入っていれば見える（踏み込んで暴くのが対処法）
 *
 * 注意: 中継サーバーは全員に同じ状態を配っているので、クライアントを改造すれば透視できる（裁定59の割り切り）。
 */
export function canSee(state: SimState, viewer: PlayerState, target: PlayerState): boolean {
  if (viewer.id === target.id || viewer.team === target.team) return true;
  if (state.t - target.lastAttackAt < BALANCE.speedSkills.smoke.revealMs / 1000) return true;
  let inSmoke = false;
  for (const sm of state.smokes) {
    if (Math.hypot(target.x - sm.x, target.y - sm.y) > sm.radius) continue;
    inSmoke = true;
    if (Math.hypot(viewer.x - sm.x, viewer.y - sm.y) <= sm.radius) return true;
  }
  return !inSmoke;
}
