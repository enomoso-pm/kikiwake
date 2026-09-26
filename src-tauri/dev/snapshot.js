// 見た目の記録（開発用。手順5-3）: 画面の要素ごとの位置・大きさ・文字の設定を並べる。
// アプリの中（WebKit）では操作役が呼び、ブラウザの見本では同じ関数を貼って呼ぶ。同じ作りの要素は同じ sig になる。
window.__kkSnapshot = function () {
  const root = document.querySelector(".app") || document.body;
  const out = [];
  const round = (v) => Math.round(v * 10) / 10;
  const walk = (el, path) => {
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).join(".");
    const sig = `${path}>${tag}${cls ? "." + cls : ""}`;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width > 0 && r.height > 0 && cs.visibility !== "hidden") {
      let own = "";
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) own += n.textContent;
      });
      out.push({
        sig,
        x: round(r.left),
        y: round(r.top),
        w: round(r.width),
        h: round(r.height),
        fs: cs.fontSize,
        fw: cs.fontWeight,
        lh: cs.lineHeight,
        color: cs.color,
        bg: cs.backgroundColor,
        text: own.replace(/\s+/g, " ").trim().slice(0, 40),
      });
    }
    let i = 0;
    for (const c of el.children) walk(c, `${sig}:${i++}`);
  };
  walk(root, "");
  return { viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }, items: out };
};

// 書体の直し方の候補（手順5-3。ui/ はまだ変えていない。操作役が試しに入れて測る）:
// 日本語の文字だけヒラギノ角ゴシック（ブラウザ＝Chrome 系と同じ字形・行の高さ）、英数字は今のまま Mac の標準の書体。
// WebKit（アプリの中）では -apple-system が日本語まで Mac の画面用の書体で描き、幅が約 8% 狭く行も低くなる
window.__kkFontFaces = function () {
  if (document.getElementById("kk-font-faces")) return;
  const ja = "U+3000-303F, U+3040-30FF, U+31F0-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF";
  const face = (w, ps, weights) =>
    `@font-face { font-family: "Kikiwake JA"; src: local("${ps}"), local("Hiragino Sans ${w}"); font-weight: ${weights}; unicode-range: ${ja}; }`;
  const st = document.createElement("style");
  st.id = "kk-font-faces";
  st.textContent = [face("W3", "HiraginoSans-W3", "100 500"), face("W6", "HiraginoSans-W6", "600 900")].join("\n");
  document.head.appendChild(st);
};
window.__kkFontFix = function () {
  window.__kkFontFaces();
  document.documentElement.style.setProperty(
    "--font",
    '"Kikiwake JA", -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif',
  );
};

// 書体の確かめ: 同じ文字を書体の指定ごとに並べ、幅と高さ（行の高さ normal）を測る。どの書体で描かれているかを見分ける
window.__kkFontProbe = function () {
  window.__kkFontFaces();
  const fams = ["var(--font)", "-apple-system", "system-ui", '"Hiragino Sans"', '"Hiragino Kaku Gothic ProN"', "sans-serif", '"Kikiwake JA", -apple-system, sans-serif'];
  return fams.map((f) => {
    const size = (text, weight) => {
      const s = document.createElement("span");
      s.textContent = text;
      s.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:18px;font-weight:${weight};font-family:${f}`;
      document.body.appendChild(s);
      const r = s.getBoundingClientRect();
      s.remove();
      return `${r.width.toFixed(1)}×${r.height.toFixed(1)}`;
    };
    return `${f}: 日本語 ${size("録音をここにドラッグ", 600)}・かな ${size("ていますのでしょう", 400)}・英数 ${size("Kikiwake 12:34", 400)}・混ざり ${size("対応形式：mp4・m4a（ボイスメモ）", 400)}`;
  });
};
