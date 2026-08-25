import Phaser from "phaser";
import { BALANCE } from "@pvp/shared";
import { COLORS } from "./session";
import { SettingsScene } from "./scenes/SettingsScene";
import { TitleScene } from "./scenes/TitleScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { GameScene } from "./scenes/GameScene";
import { ResultScene } from "./scenes/ResultScene";
import { CharacterScene } from "./scenes/CharacterScene";

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
  width: BALANCE.field.width,
  height: BALANCE.field.height,
  backgroundColor: COLORS.bg,
  dom: { createContainer: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [TitleScene, LobbyScene, GameScene, ResultScene, CharacterScene, SettingsScene],
});
