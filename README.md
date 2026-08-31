# DOPAGAKI ARENA（ドパガキアリーナ）

**非エンジニアが、AI（Claude）に実装を委任して1人で企画・設計・公開まで行ったブラウザ対戦ゲームです。**
コードは1行も自分では書いていません。その代わり、「何を作るか」「どう決めるか」「できたものをどう検証するか」をすべて自分で担いました。このリポジトリは、その進め方の記録も含めて公開しています。

🎮 **遊ぶ:** https://dopagaki-arena.pages.dev （PC・スマホ対応、インストール不要）

[English follows Japanese.](#english)

---

## これは何か

トップダウン視点の2Dアクションゲームです。ブラウザを開いてルームコードを共有するだけで友人と対戦できます。

- **3キャラクター**（スピード／タンク／支援）と、2人で条件を満たすと発動する**合体技（スキルリンク）**
- **積極的なプレイを強制する経済システム**：攻撃を当てるとシールドが回復し、守っているだけでは削られる。膠着しない対戦になるよう設計
- **モード**：1対1・乱闘・2vs2・3vs3・CPU戦（3段階）・ボス戦・ソロの弾幕モード（3難易度）
- スマホはタッチ操作（仮想スティック）に対応

## 私がやったこと・AIがやったこと

| 私（企画・意思決定・検証） | AI（Claude） |
|---|---|
| ゲームの核となるルール・キャラ・経済システムの設計 | TypeScriptでの実装（約7,300行） |
| 提案されたリスクを読み、採用・棄却を決める | 実装前に構造的リスクを指摘する |
| 実機（PC・スマホ2台）で遊んで手触りを報告する | 自動テストの作成と実行（109本） |
| 公開・デプロイ作業、バージョン管理 | ビルド・パッケージング |

### 進め方の工夫：「裁定システム」

意思決定はすべて **番号付きの「裁定」** として [`docs/DECISIONS.md`](docs/DECISIONS.md) に記録しました（現在**73件**）。各裁定には「決めたこと」「根拠」「AIが指摘したリスク」「実機で確認すべき点」を残しています。棄却した案も残し、同じ提案を繰り返さないようにしました。

これにより、
- チャットが変わっても（AIの記憶がリセットされても）文脈を引き継げる
- 「なぜこの数値なのか」を後から追える
- AIに「事後ではなく事前に批判する」よう求める型ができた

作業ルールは [`docs/CLAUDE.md`](docs/CLAUDE.md) にまとめています。AIへの指示書であると同時に、私自身の作業手順書です。

### 学んだこと

- **AIに任せると壊れるのは、コードではなく「版の管理」だった。** 古いファイルを一度アップロードしただけで、それ以降の変更が静かに消える事故を経験しました。以降、画面右下にビルド番号を出し、公開のたびに目視で確認する運用にしました
- **数値より構造を先に決める。** 「弾は何発」「HPはいくつ」は後から何度でも変えられるので、まず「壊れるか／ダウンするか」のような構造を決め、数値はプレイして締める
- **批判は前に出してもらう。** 実装後に「実はリスクがあった」と言われるより、着手前に3行でリスクを出してもらう方が、非エンジニアでも判断できる

## 技術構成（AIが選定、私が承認）

| 役割 | 使用技術 |
|---|---|
| ゲーム画面 | [Phaser 3](https://phaser.io/) + TypeScript + Vite |
| シミュレーション・数値・CPU | `shared` パッケージ（画面とサーバーで共通） |
| 通信 | WebSocket中継サーバー（ホスト権威型・60Hz入力／20Hz同期） |
| 公開 | Cloudflare Pages（画面）＋ Render（中継） |
| テスト | Vitest 109本 |

```
shared/   ルール・当たり判定・数値（balance.ts）・CPUの思考。すべての判定はここ
client/   Phaserによる描画・入力・音（WebAudio合成、音源ファイルなし）
relay/    WebSocket中継（ルーム作成・参加・転送）
docs/     裁定の記録（DECISIONS.md）・作業ルール（CLAUDE.md）・残タスク（PLAN.md）
```

設計上の約束（`docs/CLAUDE.md`より）：数値は `shared/src/balance.ts` にだけ書く／判定はシミュレーション側に置き、描画側に複製しない／新しい種類のプレイヤーはフラグで表す。これらはAIが提案し、私が「守るルール」として採用したものです。

## ローカルで動かす

```bash
npm install
npm run dev -w relay     # 中継サーバー（ポート8080）
npm run dev -w client    # http://localhost:5173
```

テストと型チェック：

```bash
npm run test -w shared
npm run typecheck -w shared && npm run typecheck -w client
```

## 既知の割り切り

- 草むら（クラウド）の非表示は画面側の処理で、通信上は全員に全状態が届きます。友人同士で遊ぶ前提のため受容しています。ランク戦をやるなら視界をサーバー側で絞る設計が必要（v2候補）
- 中継サーバーは無料枠のため、15分放置でスリープします。最初の接続に30秒〜1分かかることがあります

## ライセンス

[MIT](LICENSE)

---

<a name="english"></a>
## English

**A browser-based top-down PvP action game, built solo by a non-engineer by delegating all implementation to an AI (Claude).**
I did not write a single line of code myself. What I did was decide what to build, how to decide, and how to verify what came back. This repository is published together with the record of that process.

🎮 **Play:** https://dopagaki-arena.pages.dev (desktop & mobile, no install)

### What it is

- 3 classes (Speed / Tank / Support) and **Skill Links**: combo moves that trigger when two players meet a condition together
- An **economy that forces aggression**: landing hits restores your shield; turtling gets you worn down
- Modes: 1v1, FFA, 2v2, 3v3, CPU bots (3 levels), boss fight, solo bullet-hell mode (3 difficulties)
- Touch controls on mobile

### How I worked with the AI

Every decision is logged as a numbered **"ruling"** in [`docs/DECISIONS.md`](docs/DECISIONS.md) (73 so far), each with the decision, the reasoning, the risks the AI flagged **before** implementing, and what to check in real play. Rejected ideas are logged too. The working rules for both me and the AI live in [`docs/CLAUDE.md`](docs/CLAUDE.md).

Split of responsibilities: I owned game design, decisions, real-device playtesting (PC + two phones), deployment and versioning. The AI owned the TypeScript implementation (~7,300 lines), automated tests (109), and packaging.

Biggest lesson: the thing that breaks when you delegate to AI is not the code, it's **version control**. One stale upload silently erased later changes. Since then the title screen shows a build stamp that I check by eye after every deploy.

### Stack

Phaser 3 + TypeScript + Vite (client) / shared simulation package with all rules and tuning values / host-authoritative WebSocket relay (60 Hz input, 20 Hz snapshots) / Cloudflare Pages + Render / Vitest.

```bash
npm install
npm run dev -w relay   # port 8080
npm run dev -w client  # http://localhost:5173
npm run test -w shared
```

MIT License.
