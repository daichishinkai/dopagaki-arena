import Phaser from "phaser";
import { COLORS } from "./session";
import { SettingsScene } from "./scenes/SettingsScene";
import { TitleScene } from "./scenes/TitleScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { GameScene } from "./scenes/GameScene";
import { ResultScene } from "./scenes/ResultScene";
import { CharacterScene } from "./scenes/CharacterScene";
import { installErrorOverlay } from "./errors";
import { applyView, recomputeView, VIEW } from "./viewport";

// フレーム処理で例外が漏れるとPhaserの描画ループが止まり、
// 「押しても固まったまま」になる。原因を画面に出して必ず抜け出せるようにする（裁定51）
installErrorOverlay();

// 右クリック＝副武器（裁定10）なので、ブラウザのコンテキストメニューを抑止する
window.addEventListener("contextmenu", (e) => e.preventDefault());

// マウスサイドボタン（戻る/進む）でページ遷移しないよう抑止。
// ※OSやマウスユーティリティ側でナビゲーションに固定されている場合はゲーム側では防げない
for (const ev of ["mousedown", "mouseup"] as const) {
  window.addEventListener(ev, (e) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
}

// 動作確認（ブラウザ自動操作）用にゲーム本体を window に公開する。ゲームの挙動には影響しない
declare global {
  interface Window {
    __game?: Phaser.Game;
  }
}

// 実際に見えている高さを CSS 変数に反映する。
// iOS Safari では上下のブラウザバーの分だけ 100vh が実表示領域より大きくなり、
// FIT スケールのキャンバスが画面外にはみ出して下のボタンが切れるため。
function syncViewportHeight(): void {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${Math.round(h)}px`);
  // 裁定56: 端末の比率が変わったらキャンバスの横幅も測り直し、各シーンのカメラをずらし直す
  if (recomputeView() && window.__game) {
    window.__game.scale.setGameSize(VIEW.width, VIEW.height);
    for (const scene of window.__game.scene.getScenes(true)) applyView(scene);
  }
  window.__game?.scale.refresh();
}
syncViewportHeight();
window.addEventListener("resize", syncViewportHeight);
window.addEventListener("orientationchange", () => setTimeout(syncViewportHeight, 200));
window.visualViewport?.addEventListener("resize", syncViewportHeight);
window.visualViewport?.addEventListener("scroll", syncViewportHeight);

window.__game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  // 裁定56: フィールドは1280x720のままだが、キャンバスは端末の比率に合わせて横に広げる
  width: VIEW.width,
  height: VIEW.height,
  backgroundColor: COLORS.bg,
  dom: { createContainer: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [TitleScene, LobbyScene, GameScene, ResultScene, CharacterScene, SettingsScene],
});
