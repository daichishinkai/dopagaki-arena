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
    if (stats && session.matchMode === "danmaku") {
      // 裁定64: 弾幕モードはタイムと被弾数だけ
      const m = Math.floor(stats.elapsed / 60), sec = stats.elapsed % 60;
      const diff = BALANCE.danmaku.difficulties[session.danmakuDifficulty]?.label ?? "";
      label(this, W / 2, H * 0.66, `難易度 ${diff} ／ ${outcome === "WIN" ? "クリアタイム" : "生存時間"} ${m}:${String(sec).padStart(2, "0")} ／ 与ダメ ${mine?.damageDealt ?? 0} ／ ${mine?.deaths ?? 0}ダウン`, 16, "#94a3b8");
    } else if (stats) {
      label(this, W / 2, H * 0.66, `連携（LINK）${stats.linkCount}回・最大連携ダメージ ${stats.maxLinkDamage} ／ 与ダメ ${mine?.damageDealt ?? 0} ／ ${mine?.kills ?? 0}撃破 ${mine?.deaths ?? 0}ダウン`, 16, "#94a3b8");
    }

    const isHost = session.mode === "solo" || session.net.isHost;
    const contLabel = session.mode === "solo" ? (session.matchMode === "danmaku" ? "もう一度" : "続ける") : isHost ? "再戦" : "ホストの再戦待ち…";
    const rematch = button(this, W / 2 - 260, H * 0.78, contLabel, () => {
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

    // 裁定58: ルームに戻る。卓を組み直したい（bot構成・モード・キャラを変えたい）ときの導線。
    // ソロにはルームが無いのでキャラ選択へ戻す
    const backLabel = session.mode === "solo" ? (session.matchMode === "danmaku" ? "ホームに戻る" : "キャラ選択へ") : "ルームに戻る";
    const back = button(this, W / 2, H * 0.78, backLabel, () => {
      if (session.mode === "solo") {
        this.scene.start(session.matchMode === "danmaku" ? "title" : "character");
        return;
      }
      // ホストがロビーへ戻ると、ロビーが lobby メッセージを撒くのでゲストも追従する（下の購読）
      this.scene.start("lobby");
    });
    // ゲストが勝手に抜けるとホストの再戦に乗れなくなるので、オンラインではホストだけが動かせる
    back.setEnabled(session.mode === "solo" || session.net.isHost);

    button(this, W / 2 + 260, H * 0.78, "ホームに戻る", () => {
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
        // 裁定58: ホストがロビーへ戻ると lobby メッセージが飛んでくるので、ゲストも一緒に戻る。
        // 通信の種類を増やさずに済むよう、既存の lobby メッセージを合図として使う
        net.on<{ payload: GameMessage }>("game:lobby", ({ payload }) => {
          if (payload.type !== "lobby") return;
          this.scene.start("lobby");
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
