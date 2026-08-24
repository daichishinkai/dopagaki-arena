# ドパガキアリーナ（3日目標ビルド）

友達とルームコードで集まる俯瞰2D対戦アクション。仕様は `SPEC.md`、開発ルールは `CLAUDE.md`。

## 動かす

```
npm install
npm run dev
```
- クライアント: http://localhost:5173
- 中継サーバー: ws://localhost:8080（`client/.env` に `VITE_RELAY_URL` を書くと変更できる）

## 確認する
```
npm test          # shared + relay の自動テスト
npm run typecheck
npm run build     # client/dist（静的配信用）と relay/dist/index.js（node で起動）
```

## 構成
- `shared/` ホストと非ホストで共通のシミュレーション（Phaser非依存の純関数）と数値（`balance.ts`）
- `relay/` ステートレス中継（ルーム表のみ。ゲームルールを知らない）
- `client/` Phaser（描画・入力・ネット）。ルーム作成者がホストとして当たり判定・HPをすべて計算する

## 公開するとき（2週間目標）
- `client/dist` を Cloudflare Pages 等へ。ビルド時に `VITE_RELAY_URL=wss://<中継のURL>` を指定
- `relay/dist/index.js` を Render / Fly.io 等で `node dist/index.js`（`PORT` 環境変数対応）


## 公開手順（v1）

ゲーム本体（client）とルームの取次役（relay）を別々に公開する。

### 1. 中継サーバー → Render（無料枠）
1. このリポジトリをGitHubへpush
2. https://render.com で New → Blueprint → リポジトリを選択（render.yaml を自動で読む）
3. デプロイ完了後のURL（例 `https://dopagaki-arena-relay.onrender.com`）を控える
   - WebSocket接続先は `wss://dopagaki-arena-relay.onrender.com`
   - 無料枠は15分アイドルでスリープする。初回接続が数十秒待ちになるのは仕様

### 2. ゲーム本体 → Cloudflare Pages（無料）
1. https://pages.cloudflare.com で Create a project → リポジトリを選択
2. Build command: `npm install && npm run build -w client`
3. Build output directory: `client/dist`
4. 環境変数に `VITE_RELAY_URL = wss://（1で控えたURLのホスト名）` を設定
5. Deploy。発行されたURLを友達に送れば遊べる

### ローカルで通しで試す
```bash
npm install
npm run dev        # client（Vite） http://localhost:5173
npm run dev -w relay  # 別ターミナルで中継 ws://localhost:8080
```
