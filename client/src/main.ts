import Phaser from "phaser";
import { BALANCE } from "@pvp/shared";
import { COLORS } from "./session";
import { SettingsScene } from "./scenes/SettingsScene";
import { TitleScene } from "./scenes/TitleScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { GameScene } from "./scenes/GameScene";
import { ResultScene } from "./scenes/ResultScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: BALANCE.field.width,
  height: BALANCE.field.height,
  backgroundColor: COLORS.bg,
  dom: { createContainer: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [TitleScene, LobbyScene, GameScene, ResultScene, SettingsScene],
});
