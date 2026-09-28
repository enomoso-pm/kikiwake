// 操作役の記録係（開発用のビルドだけ）。画面の読み込みの初めに入り、安全の設定（CSP）の違反・エラー・音の再生を window.__kk に貯める
(() => {
  if (window.top !== window) return;
  const kk = (window.__kk = window.__kk || { csp: [], errors: [], media: [] });
  // 画面の言語は前に選んだものを覚えている（localStorage）。操作役は毎回この Mac の言語から始める
  // （筋書き en は scripts/e2e_mac.sh が -AppleLanguages (en-US) で起動して、英語の Mac のまねをする）
  try {
    localStorage.removeItem("kikiwake.locale");
    // 前の筋書きの記録（「この版は知らせない」にした版・見ていない間に終わった録音の「●」・保存の窓で選んだもの）も忘れさせる。
    // 閉じて開き直す筋書き history2 だけは、history1 の記録を残す（閉じても覚えているかを見るため）
    if (window.__kkScenarioName !== "history2") {
      localStorage.removeItem("kikiwake.update.dismissed");
      localStorage.removeItem("kikiwake.update.check");
      localStorage.removeItem("kikiwake.fresh");
      // 「保存…」の窓で選んだ形式と保存先（2026-09-29）。毎回、初めの値（.md・元のファイルと同じフォルダ）から
      localStorage.removeItem("kikiwake.save");
    }
  } catch {
    // 読めない所では何もしない
  }
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
