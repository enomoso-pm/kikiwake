// 操作役の記録係（開発用のビルドだけ）。画面の読み込みの初めに入り、安全の設定（CSP）の違反・エラー・音の再生を window.__kk に貯める
(() => {
  if (window.top !== window) return;
  const kk = (window.__kk = window.__kk || { csp: [], errors: [], media: [] });
  document.addEventListener("securitypolicyviolation", (e) => kk.csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  window.addEventListener("error", (e) => kk.errors.push(`error: ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    kk.errors.push(`unhandledrejection: ${(r && (r.message || r.code)) || r}`);
  });
  const consoleError = console.error.bind(console);
  console.error = (...args) => {
    kk.errors.push(`console.error: ${args.map(String).join(" ").slice(0, 300)}`);
    consoleError(...args);
  };
  // 音の再生: 画面の再生は new Audio() の1つを使い回すので、play を包んで、読み込めたか・進んだかを記録する
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const el = this;
    // currentSrc は読み込みが始まるまで前の音声のままなので、入れたばかりの src を先に見る
    const rec = { src: el.getAttribute("src") || el.currentSrc || "", at: Date.now() };
    kk.media.push(rec);
    const p = play.apply(el, args);
    Promise.resolve(p).then(
      () => {
        rec.played = true;
        setTimeout(() => {
          rec.readyState = el.readyState;
          rec.t = el.currentTime;
          rec.duration = el.duration;
          rec.error = el.error ? el.error.code : null;
        }, 700);
      },
      (err) => {
        rec.rejected = String((err && err.message) || err);
        rec.error = el.error ? el.error.code : null;
      },
    );
    return p;
  };
})();
