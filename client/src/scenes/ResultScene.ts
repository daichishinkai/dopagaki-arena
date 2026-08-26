import Phaser from "phaser";
import { BALANCE, type GameMessage } from "@pvp/shared";
import { session } from "../session";
import { button, label, title } from "../ui";
import { applyView, VIEW } from "../viewport";

export class ResultScene extends Phaser.Scene {
  private offs: Array<() => void> = [];

  constructor() {
    super("result");
  }

  create(): void {
    // 裁定56: フィールドを画面中央に置く（余白は左右へ均等）
    applyView(this);
    const { width: W, height: H } = BALANCE.field;
    const r = session.lastResult;
    const me = session.mode === "solo" ? "me" : session.net.you;
    const myTeam = session.players.find((p) => p.id === me)?.team;
    const won = r && r.winner !== null && (session.matchMode === "teams" ? r.winnerTeam === myTeam : r.winner === me);
    const outcome = !r || r.winner === null ? "DRAW" : won ? "WIN" : "LOSE";
    const color = outcome === "WIN" ? "#4ade80" : outcome === "LOSE" ? "#f87171" : "#fef08a";
    const winnerName = r?.winner ? session.players.find((p) => p.id === r.winner)?.name : null;

    this.add
      .text(W / 2, H * 0.3, outcome, { fontFamily: "system-ui, sans-serif", fontSize: "120px", color, fontStyle: "bold" })
      .setOrigin(0.5)
      .setShadow(0, 0, color, 30, true, true);
    const reason: Record<string, string> = {
      lives: "残機を削り切った",
      "timeout-lives": "時間切れ：残機差",
      "timeout-hp": "時間切れ：残HP差（シールド除外）",
      draw: "引き分け",
    };
    label(this, W / 2, H * 0.47, `${winnerName && outcome === "LOSE" ? `勝者: ${winnerName} ／ ` : ""}${r ? reason[r.reason] ?? "" : ""}`, 20, "#94a3b8");
    const stats = session.lastStats;
    const mine = stats?.players.find((p) => p.id === me);
    let honor = "堅実な仕事人";
    if (stats && mine) {
      const topDamage = Math.max(...stats.players.map((p) => p.damageDealt));
      const topKills = Math.max(...stats.players.map((p) => p.kills));
      if (won && mine.damageDealt >= topDamage) honor = "アリーナの主役";
      else if (mine.kills >= topKills && mine.kills > 0) honor = "ネオンの死神";
      else if (stats.linkCount > 0) honor = "シンクロニスト";
      else if (mine.damageDealt >= topDamage) honor = "火力の化身";
      else if (mine.deaths >= Math.max(...stats.players.map((p) => p.deaths)) && !won) honor = "不死身の挑戦者";
    }
    title(this, W / 2, H * 0.58, `称号：${honor}`, 24);
    if (stats) {
      label(this, W / 2, H * 0.66, `連携（LINK）${stats.linkCount}回・最大連携ダメージ ${stats.maxLinkDamage} ／ 与ダメ ${mine?.damageDealt ?? 0} ／ ${mine?.kills ?? 0}撃破 ${mine?.deaths ?? 0}ダウン`, 16, "#94a3b8");
    }

    const isHost = session.mode === "solo" || session.net.isHost;
    const contLabel = session.mode === "solo" ? "続ける" : isHost ? "再戦" : "ホストの再戦待ち…";
    const rematch = button(this, W / 2 - 180, H * 0.78, contLabel, () => {
      if (session.mode === "solo") {
        this.scene.start("game");
        return;
      }
      const prev = new Map(session.players.map((p) => [p.id, p]));
      const humans = session.net.members.map((m) => ({ id: m.id, name: m.name, cls: prev.get(m.id)?.cls ?? ("speed" as const) }));
      const bots = session.bots.map((b) => ({ id: b.id, name: b.name, cls: b.cls }));
      const roster = [...humans, ...bots].slice(0, 6);
      if (roster.length < 2) return;
      const mode = session.matchMode === "teams" && (roster.length === 4 || roster.length === 6) ? "teams" : "ffa";
      const half = Math.ceil(roster.length / 2);
      const players = roster.map((m, i) => ({ ...m, team: mode === "teams" ? (i < half ? 0 : 1) : i }));
      session.players = players;
      session.matchMode = mode;
      session.net.sendGame({ type: "start", players, mode, bots: session.bots });
      this.scene.start("game");
    });
    rematch.setEnabled(isHost);
    button(this, W / 2 + 180, H * 0.78, "ホームに戻る", () => {
      if (session.mode === "online") session.net.disconnect();
      this.scene.start("title");
    });

    if (session.mode === "online") {
      const net = session.net;
      this.offs.push(
        net.on<{ payload: GameMessage }>("game:start", ({ payload }) => {
          if (payload.type !== "start") return;
          session.players = payload.players;
          this.scene.start("game");
        }),
        net.on("hostLeft", () => {
          this.registry.set("message", "ホストが退出しました");
          this.scene.start("title");
        }),
        net.on("closed", () => {
          this.registry.set("message", "中継サーバーとの接続が切れました");
          this.scene.start("title");
        }),
      );
    }
    this.events.once("shutdown", () => this.offs.forEach((f) => f()));
  }
}
