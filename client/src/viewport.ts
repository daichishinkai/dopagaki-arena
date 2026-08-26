import type Phaser from "phaser";
import { BALANCE } from "@pvp/shared";

/**
 * 画面いっぱいに広げるためのビューポート（裁定56）。
 *
 * 従来はキャンバスを 1280x720 固定にして FIT で拡大していたため、
 * 16:9 より横長な端末（ほとんどのスマホの横持ち）では左右に黒帯が出て、
 * **そこはキャンバスの外なので触っても一切反応しなかった。**
 *
 * ここではキャンバスの横幅を端末の比率に合わせて広げ、
 * **プレイフィールド 1280x720 は中央に置いたまま、余った左右をUIに使えるようにする。**
 *
 * 重要: フィールドの大きさは変えない。広がるのは「画面」だけで、
 * 見える範囲が広がって有利・不利が生まれることはない。
 */

const F = BALANCE.field;
/** 横長すぎる画面でUIが端に散らばりすぎないよう上限を設ける */
const MAX_ASPECT = 21 / 9;
const BASE_ASPECT = F.width / F.height;

export interface ViewMetrics {
  /** キャンバスの幅（>= フィールド幅） */
  width: number;
  /** キャンバスの高さ（フィールド高さ固定） */
  height: number;
  /** フィールド左端までの余白。カメラをこの分だけずらして中央に置く */
  offsetX: number;
  offsetY: number;
}

function compute(): ViewMetrics {
  const w = window.innerWidth || F.width;
  const h = window.innerHeight || F.height;
  // 16:9 より縦長の画面は従来どおり上下に黒帯（横向きを促しているので実質スマホでは起きない）
  const aspect = Math.min(MAX_ASPECT, Math.max(BASE_ASPECT, w / h));
  const width = Math.round(F.height * aspect);
  return { width, height: F.height, offsetX: Math.round((width - F.width) / 2), offsetY: 0 };
}

export const VIEW: ViewMetrics = compute();

/** 画面サイズが変わったときに測り直す。値は同じオブジェクトを書き換える（参照が生きているため） */
export function recomputeView(): boolean {
  const next = compute();
  if (next.width === VIEW.width && next.height === VIEW.height) return false;
  VIEW.width = next.width;
  VIEW.height = next.height;
  VIEW.offsetX = next.offsetX;
  VIEW.offsetY = next.offsetY;
  return true;
}

/**
 * そのシーンのカメラを「フィールドが中央に来る」位置へずらす。
 * 各シーンは今までどおり 0..1280 / 0..720 の座標で組めばよく、
 * 余白は自動的に左右へ均等に付く。create() の先頭で呼ぶこと。
 */
export function applyView(scene: Phaser.Scene): void {
  scene.cameras.main.setScroll(-VIEW.offsetX, -VIEW.offsetY);
}
