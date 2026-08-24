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

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: BALANCE.field.width,
  height: BALANCE.field.height,
  backgroundColor: COLORS.bg,
  dom: { createContainer: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [TitleScene, LobbyScene, GameScene, ResultScene, CharacterScene, SettingsScene],
});
