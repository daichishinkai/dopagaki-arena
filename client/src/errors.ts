/**
 * エラー表示オーバーレイ（裁定34）。
 *
 * 背景: Phaserはフレーム処理の中で例外が外に漏れると次フレームを予約しないため、
 * 描画ループが二度と回らなくなる。画面には「最後に描いた絵」が残るので、
 * ユーザーからは「ボタンを押したら固まった」ようにしか見えず、原因が分からない。
 *
 * ここでは (1) エラー内容を画面に出す (2) 必ず再読み込みで抜け出せるようにする
 * の2点だけを担う。エラーそのものを握りつぶして続行はしない（原因が隠れるため）。
 */

let shown = false;
let repeats = 0;

function textOf(err: unknown): string {
  if (err instanceof Error) {
    const head = `${err.name}: ${err.message}`;
    const stack = (err.stack ?? "")
      .split("\n")
      .slice(1, 4)
      .map((s) => s.trim())
      .join("\n");
    return stack ? `${head}\n${stack}` : head;
  }
  return String(err);
}

/** エラーを画面に出す。2回目以降は件数だけ更新して重ねない */
export function reportError(err: unknown, where: string): void {
  const body = `[${where}]\n${textOf(err)}`;
  // 開発時に追えるようコンソールにも残す
  console.error(where, err);

  if (shown) {
    repeats += 1;
    const c = document.getElementById("dopagaki-error-count");
    if (c) c.textContent = `（同種のエラーが他に ${repeats} 件）`;
    return;
  }
  shown = true;

  const box = document.createElement("div");
  box.id = "dopagaki-error";
  box.style.cssText = [
    "position:fixed", "left:0", "right:0", "bottom:0", "z-index:99999",
    "background:#2a0b12", "border-top:3px solid #f87171", "color:#fecaca",
    "font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace",
    "padding:14px 16px", "max-height:45vh", "overflow:auto", "white-space:pre-wrap",
  ].join(";");

  const head = document.createElement("div");
  head.textContent = "エラーが発生しました。この内容をそのまま報告してください。";
  head.style.cssText = "color:#fca5a5;font-weight:bold;margin-bottom:8px";

  const pre = document.createElement("div");
  pre.textContent = body;

  const count = document.createElement("div");
  count.id = "dopagaki-error-count";
  count.style.cssText = "color:#f87171;margin-top:6px";

  const reload = document.createElement("button");
  reload.textContent = "再読み込みしてホームに戻る";
  reload.style.cssText = [
    "margin-top:12px", "margin-right:8px", "padding:8px 14px", "cursor:pointer",
    "background:#0b1a26", "color:#e5e7eb", "border:2px solid #22d3ee", "border-radius:8px",
    "font:14px ui-monospace,monospace",
  ].join(";");
  reload.onclick = () => window.location.reload();

  const close = document.createElement("button");
  close.textContent = "閉じる";
  close.style.cssText = [
    "margin-top:12px", "padding:8px 14px", "cursor:pointer",
    "background:transparent", "color:#94a3b8", "border:1px solid #475569", "border-radius:8px",
    "font:14px ui-monospace,monospace",
  ].join(";");
  close.onclick = () => box.remove();

  box.append(head, pre, count, reload, close);
  document.body.appendChild(box);
}

/** グローバルなエラー捕捉を設置する（main.tsから1回だけ呼ぶ） */
export function installErrorOverlay(): void {
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, "window"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "promise"));
}
