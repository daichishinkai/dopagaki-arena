/**
 * ビルド印（裁定50）。値は vite.config.ts が docs/DECISIONS.md から自動生成して埋め込む。
 * タイトル画面の右下に出るので、デプロイ後にShift+リロードして番号が進んでいるかを確認する。
 * 番号が戻っていたら「古いzipを上げてしまった」ということ。
 */
declare const __BUILD_ID__: string;

export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
