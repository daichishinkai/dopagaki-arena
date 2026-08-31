# ドパガキアリーナ（DOPAGAKI ARENA）

ブラウザで遊ぶトップダウン2D対戦アクション。核は「積極的なプレイを強制する経済システム」と、スピード／タンク／支援の3キャラによる合体技（スキルリンク）。公開済み・実プレイ段階。

## 作業開始時の照合（必須）
1. 私は「引き継ぎメモ」と「最新zip」を添付する
2. `docs/DECISIONS.md` の最新裁定番号を読み、メモの番号と一致するか確認する
3. 食い違っていたら作業に入らず、正しいzipを要求する（古いzipを土台にすると、それ以降の裁定が静かに消える。裁定32のzipで裁定49相当を作り直した事故がある）

## 構成
- npm workspace: `shared`（シミュレーション・数値・bot）／`client`（Phaser + Vite）／`relay`（WebSocket中継）
- 公開: Cloudflare Pages（`client/dist`）、中継: Render無料枠（15分でスリープ。最初の接続は30秒〜1分待つのが仕様）
- 私が受け取るzipには `client` `shared` `docs` の3フォルダだけを入れる。ルートの `package.json` `tsconfig.base.json` `relay` はGitHub側にあり、zipに含めない。手元で検証するときは同等のものを一時的に作ってよいが、zipには入れない

## 裁定システム
- すべての決定を番号付き「裁定NN」として `docs/DECISIONS.md` の末尾に追記する。次の番号は末尾から数える
- 各裁定に書くもの: 決定内容、根拠、**【Claude指摘】**（構造的リスク）、**要観察**（実機で見てほしいこと）
- 棄却した案も記録し、再提案を防ぐ。ただし私が後から覆すのは正当（裁定49で棄却→裁定53で条件付き採用の例がある）
- 残項目は `docs/PLAN.md`

## コードの約束
- **数値は `shared/src/balance.ts` にだけ書く。**マジックナンバーを他のファイルに書かない。難易度・形態のような段階は、値を手書きで複製せず倍率か配列で持つ
- 可視判定・当たり判定・勝敗判定はシミュレーション（`shared`）に置き、クライアントはそれを呼ぶ。描画側に判定を複製しない
- プレイヤーの種類を増やすときは `PlayerState` のフラグ（`boss` `turret` など）で表し、試合途中で `players` を増やさない（描画側の名前・補間がずれる）
- 音は `client/src/sound.ts`、画面の広げ方は `client/src/viewport.ts`、プリセット保存は `client/src/roomPrefs.ts`、エラー表示は `client/src/errors.ts`
- ビルド印（タイトル右下 `裁定NN / YYYY-MM-DD`）は `vite.config.ts` が `docs/DECISIONS.md` から自動生成する。手で書き換えない

## 変更後の手順（毎回）
1. `shared`: `tsc --noEmit` → `vitest run`（テスト本数は減らさない。今は109本）
2. `client`: `tsc --noEmit` → `vite build`。ビルド後に `dist/assets/*.js` へ最新の裁定番号が埋まっているか確認
3. `client` `shared` `docs` を zip にして `/mnt/user-data/outputs/dopagaki-arena.zip` に出す
4. 報告には「実機で何を見てほしいか」を必ず書く。UI・ロビー・弾幕の密度は自動テストが効かない

## 私の反映手順（Claudeは変更しない）
zipを解凍 → GitHubの「Add file → Upload files」で3フォルダをドラッグ&ドロップ → Commit → 2〜3分待つ → Shift+リロード → **タイトル右下のビルド印が進んでいるか確認**。番号が戻っていたら古いzipを上げた事故。

## 既知の割り切り
- クラウド（草むら）の非表示はクライアント描画の話で、中継は全員に全状態を送る。改造すれば透視できる。身内で遊ぶ前提で受容済み。ランク戦をやるなら視界をサーバー側で絞る設計が必要
- スマホ・2台同時の確認は私の実機でしかできない。Claudeの環境ではブラウザが起動できないことがある（その場合は「未確認」と書く）

## テストのコツ
- 訓練場（`practice=true`）は試合が終わらない。決着をテストするときは `practice=false`
- スピードの主武器（`fire`）はセイバー、副武器（`fire2`）がピストル。遠距離からの命中テストは `fire2`
- 撃つと `invuln` が0になる。無敵で守ったまま計測はできない
- 手でHPを下げた直後は形態移行の無敵が入る。撃破テストでは `bossPhase` を先に最終形態にしておく
- タッチ操作の自動テストは CDP `Input.dispatchTouchEvent`（touchStart→touchEnd）。Playwright の `page.tap()` 単独では不十分
- キャンバス座標はビューポートと一致しない。クリック座標は `box.width / W` でスケール換算する
