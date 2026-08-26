import { defineConfig } from "vite";
import path from "node:path";
import fs from "node:fs";

/**
 * ビルド印（裁定50）。
 * GitHubの「Upload files」は同じパスを問答無用で上書きするため、古いzipを1回上げるだけで
 * 前の変更が静かに消える（実際にタッチ操作一式が消える事故が起きた）。
 * タイトル画面に「どの版が動いているか」を出して即座に気づけるようにする。
 *
 * 手で書き換えると更新を忘れるので、docs/DECISIONS.md の最新裁定番号から自動生成する。
 */
function buildId(): string {
  let decision = "?";
  try {
    const md = fs.readFileSync(path.resolve(__dirname, "../docs/DECISIONS.md"), "utf8");
    const nums = [...md.matchAll(/裁定(\d+)/g)].map((m) => Number(m[1]));
    if (nums.length > 0) decision = String(Math.max(...nums));
  } catch {
    // docs が無い環境でもビルドは通す（印が「?」になるだけ）
  }
  // 日本時間の日付（Cloudflareのビルド環境はUTCなので +9時間して丸める）
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `裁定${decision} / ${jst}`;
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  resolve: {
    alias: { "@pvp/shared": path.resolve(__dirname, "../shared/src/index.ts") },
  },
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  build: { outDir: "dist", emptyOutDir: true },
});
