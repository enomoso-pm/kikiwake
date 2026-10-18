// 操作役（開発用のビルドだけ。src-tauri/src/dev.rs が画面の読み込みの初めに入れる。ui/ のファイルは触らない）。
// 画面（製品と同じビルド）のボタンを文言で探して押し、入力し、画面の文と件数を読む。筋書きは scripts/e2e_mac.sh が作る JSON。
// 画面は録音が主役の形（左に録音の一覧・右に選んだ録音。2026-09-27 に製品の画面にした）。
//   setup  準備の画面だけ（一覧は出さない）: 足りないモデルを取る（途中で中断して続きから）→「はじめる」で新しい録音の画面・一覧 →「AI モデルと動作条件」で見返す
//   synth  合成会議で通す: ドロップ → 処理中の閉じる確かめ（段階の文）・中止と再開 → 処理中に2本目を順番待ち（閉じる確かめに順番待ちの一文）→
//          1本目が終わると2本目がすぐ始まる（見ていない処理中の録音でも閉じる確かめ）→ 話者のタブ（サンプルの再生・名前・「保存…」の窓から保存）→
//          文字起こしのタブ（行の再生・「詳細」・手直し・上書きの確かめ・見本や画面を通さずに保存したものと比べる）→ 一覧の行の「…」→ 処理中にほかの録音を開き直す
//          （処理は最後まで進む）→ 見ていない間に終わった録音の「●」→ 同じ録音を選び直す → ドラッグ中の案内・窓の幅・はみ出し
//   photo  説明書の写真（新しい録音でファイルを選んだ・話者のタブ・文字起こしのタブ）
//   real   実録音（quiet: 中身は出さず、時間と件数だけ）
//   history1・history2  履歴と閉じたときの状態（約束 版8・版9・版12）。scripts/e2e_mac.sh が同じ作業フォルダで2回起動する
//   en     英語（約束 版7）: 英語の Mac のまねで起動 → メニュー・画面・保存が英語、保存するファイルが「_transcript」→ 日本語に切り替えるとメニューと保存も日本語に。
//          英語がはみ出さないか（1200×800・900×560）
//   screens マニュアルの素材（約束 版13）: 作り物の画面共有の録画（scripts/make_screens_video.sh）で「マニュアル用に、画面の絵も取り出す」→ 処理中の一文 →
//          絵の数 →「保存…」の .zip（毎回外れている・.md と一緒に・zip だけ・上書き）。zip の中身は scripts/e2e_mac.sh が確かめる。
//          終わりに判定の版を 1 つ下げる（判定の版が上がったときのまね）
//   screens2 約束 版14: screens のあと同じ作業フォルダで開き直し、前の版で読み取った録画を一覧から開くと、.zip の行が押せず理由と作り直し方が出る →
//          案内のとおりに「新しい録音」で選び直してチェックを入れると、画面だけ読み取り直して .zip の行が戻る
//   speech 約束 版15: 英語の録音（英語の合成会議）を「自動で見分ける」で通す → 処理中の一文・言語・上の段の「英語」・英語の名前の手がかり →
//          選び直して日本語を選ぶと「言語を変えて文字起こしし直します」→ 一覧の「…」の「日本語で文字起こしし直す…」で確かめてやり直す（名前は残る）
// 保存（2026-09-29 決定・約束 版12）: 保存の帯は「保存…」だけで、押すと窓で形式と保存先を選ぶ（覚えて次からも同じ）。ファイルは録音の名前入り
// 「<元の名前>_文字起こし.<形式>」を、選んだフォルダ（既定は元のファイルと同じフォルダ）にそのまま書く。Finder で表示と削除は一覧の行の「…」から
(() => {
  if (window.top !== window || window.__kkE2E) return;
  window.__kkE2E = true;

  const T = () => window.__TAURI__;
  const invoke = (cmd, args) => T().core.invoke(cmd, args);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const say = (text) => invoke("dev_log", { text }).catch(() => {});
  const info = (text) => say(`   ${text}`);
  const fmt = (v, d = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : String(v));

  function check(name, ok, detail) {
    results.push({ name, ok: Boolean(ok) });
    say(`${ok ? "OK" : "NG"} ${name}${detail !== undefined && detail !== "" ? ` — ${detail}` : ""}`);
    return Boolean(ok);
  }

  async function waitFor(fn, ms = 10000, step = 100) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try {
        v = fn();
      } catch {
        v = null;
      }
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await sleep(step);
    }
  }

  async function waitForAsync(fn, ms = 5000, step = 200) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try {
        v = await fn();
      } catch {
        v = null;
      }
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await sleep(step);
    }
  }

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const buttons = () => [...document.querySelectorAll("button")];
  const button = (label) => buttons().find((b) => norm(b.textContent) === label);
  const buttonHas = (part) => buttons().find((b) => norm(b.textContent).includes(part));
  const heading = () => norm(document.querySelector("main h1")?.textContent);
  const bodyText = () => document.body.innerText;
  const dialogTitle = () => norm(document.querySelector(".dialog-title")?.textContent);
  const dialogBody = () => [...document.querySelectorAll(".dialog-body p")].map((p) => norm(p.textContent));
  const row = (id) => document.querySelector(`[data-row-id="${id}"]`);
  const toast = () => norm(document.querySelector(".toast")?.textContent);
  /** 処理中の画面の段階（「声を文字にする」など） */
  const stageText = () => norm(document.querySelector(".page-scroll .card span")?.textContent);

  // ---- 録音が主役の画面の部品 ----------------------------------------------------------------

  const entryEls = () => [...document.querySelectorAll("[data-entry]")];
  const entryName = (el) => norm(el?.querySelector(".objects-item-name")?.textContent);
  const entryOf = (name) => entryEls().find((el) => entryName(el) === name);
  const entryText = (el) => norm(el?.innerText);
  const chipOf = (el) => norm(el?.querySelector(".objects-chip")?.textContent);
  const freshOf = (el) => Boolean(el?.querySelector(".objects-fresh"));
  const runningEntry = () => document.querySelector('[data-entry="run"]');
  const queued = () => entryEls().filter((el) => (el.getAttribute("data-entry") || "").startsWith("q:"));
  /** 右の一番上の帯: 録音の名前と状態の印 */
  const title = () => norm(document.querySelector(".objects-title")?.textContent);
  const headChip = () => norm(document.querySelector(".objects-toolbar .objects-chip")?.textContent);
  /** 「話者」「文字起こし」のどちらのタブか */
  const tab = () => norm(document.querySelector(".objects-tab.current")?.textContent);

  /** 画面の言葉（筋書きの言語ごと） */
  const JA = {
    newTitle: "新しい録音",
    start: "文字起こしをはじめる",
    enqueue: "順番待ちに入れる",
    speakers: "話者",
    transcript: "文字起こし",
    stopped: "中断しました",
    /** 保存の帯のボタン（押すと窓）と、窓の中の「保存」（2026-09-29） */
    saveOpen: "保存…",
    save: "保存",
    saving: "保存中…",
    overwriteTitle: "同じ名前のファイルがあります",
    overwrite: "上書きする",
    /** 保存するファイルの名前の後ろ（約束 版12） */
    suffix: "文字起こし",
  };
  const EN = {
    newTitle: "New recording",
    start: "Start transcription",
    enqueue: "Add to queue",
    speakers: "Speakers",
    transcript: "Transcript",
    stopped: "Stopped",
    saveOpen: "Save…",
    save: "Save",
    saving: "Saving…",
    overwriteTitle: "Files with the same name exist",
    overwrite: "Replace",
    suffix: "transcript",
  };

  /** 保存するファイルの名前（拡張子なし。約束 版12）: 「<元の名前>_文字起こし」 */
  const savedStem = (recording, L = JA) => `${recording.split("/").pop().replace(/\.[^.]+$/, "")}_${L.suffix}`;
  /** 元のファイルと同じフォルダ（保存先の既定。約束 版12） */
  const folderOf = (path) => path.replace(/\/[^/]+$/, "");

  /** 処理中に閉じるときの確かめの文（2026-09-27 決定。ui/src/i18n/ja.ts の dialog.closeBody と同じ） */
  const CLOSE_TITLE = "文字起こし中です。閉じますか？";
  const CLOSE = {
    beforeSeparation: (name) => `閉じると「${name}」の文字起こしを中断し、ここまでの途中の分は破棄します。再開すると最初からはじめます。`,
    converting: (name) =>
      `閉じると「${name}」の文字起こしを中断します。声の聞き分けの結果は残りますが、声を文字にしている途中の分は破棄し、再開すると声を文字にするところからやり直します（90 分を超える録音は、約1時間ごとの区切りで書き終えた分は残ります）。`,
    finishing: (name) => `閉じると「${name}」の文字起こしを中断します。声の聞き分けと文字にした結果は残り、再開するとすぐに終わります。`,
    queue: (n) => `順番待ちの ${n} 件は破棄します。まだはじめていないので、元のファイルも文字起こしも失いません。`,
  };
  const closeCaseOf = (body0, name) => Object.keys(CLOSE).find((k) => k !== "queue" && CLOSE[k](name) === body0) ?? "（知らない文）";

  /** 一覧を出す（狭い窓では、左上のボタンで重ねて出す） */
  async function showList() {
    if (document.querySelector(".objects-sidebar")) return true;
    document.querySelector(".objects-toolbar .objects-icon-btn")?.click();
    return Boolean(await waitFor(() => document.querySelector(".objects-sidebar"), 2000));
  }
  const hideOverlay = () => document.querySelector(".objects-scrim")?.click();

  /** 一覧の行を押す（書き終えた録音なら、開いて「話者」か「文字起こし」のタブになるまで待つ） */
  async function openEntry(name, { wait = true } = {}) {
    await showList();
    const el = entryOf(name);
    if (!el) throw new Error(`一覧に「${name}」が無い（${entryEls().map(entryName).join(" / ")}）`);
    el.click();
    hideOverlay();
    if (wait && !(await waitFor(() => title() === name && tab() && !document.querySelector(".objects-tab[disabled]"), 15000))) {
      throw new Error(`「${name}」が開かない（今は「${title()}」「${tab()}」）`);
    }
  }

  /** 「＋ 新しい録音」 */
  async function newRecording(L) {
    await showList();
    document.querySelector(".objects-new")?.click();
    hideOverlay();
    await screen(L.newTitle, 5000);
  }

  /** 「話者」「文字起こし」のタブを押して、切り替わるまで待つ（文字起こしのタブは名前を確定してから開く） */
  async function toTab(name, ms = 20000) {
    const b = [...document.querySelectorAll(".objects-tab")].find((x) => norm(x.textContent) === name);
    if (!b) throw new Error(`タブ「${name}」が無い`);
    if (tab() !== name) b.click();
    const ok = await waitFor(() => tab() === name && !document.querySelector(".objects-tab[disabled]") && (name !== JA.transcript && name !== EN.transcript ? true : document.querySelector("[data-row-id]")), ms);
    if (!ok) throw new Error(`「${name}」のタブにならない（今は「${tab()}」）`);
  }

  /** 左の一覧の行の「…」（2026-09-29 の2回目。前はごみ箱。中は「Finder で表示」と「削除…」） */
  const moreButton = (entryEl) => entryEl?.closest(".objects-row")?.querySelector(".objects-row-more") ?? null;
  const escape = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  /** 行の「…」を開いて、中の項目のボタンを返す（開けなければ null）。閉じるのは escape() */
  async function openRowMenu(entryEl) {
    await showList();
    const b = moreButton(entryEl);
    if (!b) return null;
    // マウスで押したのと同じに（detail 1。キーボードで開くと最初の項目に移る）
    b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    const m = await waitFor(() => document.querySelector(".objects-row-menu"), 2000);
    return m ? [...m.querySelectorAll("button")] : null;
  }
  /** メニューの項目の文（押せない項目の下の一言を除く）と、押せるか */
  const menuItemsText = (items) => (items || []).map((b) => `${norm(b.firstChild?.textContent)}${b.disabled ? "（押せない）" : ""}`).join("|");

  /** 保存の帯（「保存…」のボタンの入った帯） */
  const saveBar = () => (button(JA.saveOpen) || button(EN.saveOpen))?.parentElement ?? null;
  const saveDialog = () => document.querySelector(".save-dialog");
  /** 窓の形式の欄: ["md", true] のような並び */
  const dialogFormats = (dlg) =>
    [...dlg.querySelectorAll(".save-format")].map((b) => [norm(b.querySelector(".save-format-ext")?.textContent).replace(/^\./, ""), b.getAttribute("aria-checked") === "true"]);
  /** 窓の保存先の欄（選んでいる値と、選択肢の文） */
  const dialogFolder = (dlg) => {
    const sel = dlg.querySelector("select");
    return { value: sel?.value, options: [...(sel?.options ?? [])].map((o) => o.text), selected: sel?.selectedOptions?.[0]?.text };
  };
  /** 保存の知らせ（2026-09-29: 「「…」を保存しました」「「…」ほか2件を保存しました」／英語「Saved “…”」「Saved “…” and 2 more」）から、保存した数 */
  function savedCount(text) {
    let m = text.match(/^「.+」ほか(\d+)件を保存しました$/) || text.match(/^Saved “.+” and (\d+) more$/);
    if (m) return 1 + Number(m[1]);
    return /^「.+」を保存しました$/.test(text) || /^Saved “.+”$/.test(text) ? 1 : 0;
  }
  /** 「保存…」→ 窓を開いて返す */
  async function openSaveDialog(L = JA) {
    await clickWhen(L.saveOpen);
    return waitFor(saveDialog, 3000);
  }
  /** 窓の形式を formats のとおりにする（["md","txt"] など） */
  async function chooseFormats(dlg, formats) {
    for (const b of dlg.querySelectorAll(".save-format")) {
      const f = norm(b.querySelector(".save-format-ext")?.textContent).replace(/^\./, "");
      if ((b.getAttribute("aria-checked") === "true") !== formats.includes(f)) b.click();
    }
    await sleep(50);
  }
  /** 窓の保存先を選ぶ（"source"＝元のファイルと同じフォルダ・"recent"＝前に選んだフォルダ）。React が読む値を変える */
  async function chooseFolder(dlg, value) {
    const sel = dlg.querySelector("select");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(50);
  }
  /** 最後に読んだ保存の知らせ */
  let lastSaveToast = "";
  /** 窓の「保存」を押す → 保存した（知らせが新しく出る）か、同じ名前のファイルの確かめ */
  async function confirmSave(dlg, L = JA) {
    const before = document.querySelector(".toast");
    [...dlg.querySelectorAll("button")].find((b) => norm(b.textContent) === L.save)?.click();
    return waitForSaved(L, before);
  }
  /** 保存が終わるまで待つ（前の知らせ before とは別の、保存の知らせが出たら "saved"） */
  function waitForSaved(L, before = document.querySelector(".toast")) {
    return waitFor(() => {
      if (dialogTitle() === L.overwriteTitle) return "dialog";
      const el = document.querySelector(".toast");
      if (el && el !== before && savedCount(norm(el.textContent)) && !button(L.saving)) {
        lastSaveToast = norm(el.textContent);
        return "saved";
      }
      return null;
    }, 15000, 50);
  }
  /** 同じ名前のファイルの確かめで「上書きする」→ 保存した */
  async function overwriteAndWait(L = JA) {
    const before = document.querySelector(".toast");
    await clickWhen(L.overwrite);
    return waitForSaved(L, before);
  }

  /** React の入力欄に値を入れる（見た目の値ではなく、React が読む値を変える） */
  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const keydown = (el, key, opts = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
  const dblclick = (el) => el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));

  async function clickWhen(label, ms = 10000) {
    const b = await waitFor(() => {
      const x = button(label);
      return x && !x.disabled ? x : null;
    }, ms);
    if (!b) throw new Error(`ボタン「${label}」が出ない（画面は「${heading() || tab()}」）`);
    b.click();
    return b;
  }

  async function screen(h1, ms = 10000) {
    const ok = await waitFor(() => heading() === h1, ms, 200);
    if (!ok) throw new Error(`「${h1}」の画面にならない（今は「${heading() || tab()}」）`);
  }

  /** 押して鳴らし、音声が読み込まれて進んだかを見る（init.js の記録） */
  async function checkPlay(label, el, quiet) {
    const since = Date.now();
    el.click();
    const rec = await waitFor(() => window.__kk.media.find((m) => m.at >= since && ("readyState" in m || m.rejected)), 8000);
    const ok = rec && !rec.rejected && rec.error == null && rec.readyState >= 2 && rec.duration > 0 && rec.t > 0;
    const src = rec && !quiet ? `・${rec.src.replace(/^.*\/jobs\//, "jobs/")}` : "";
    check(
      `${label}の再生`,
      ok,
      rec
        ? `読み込み ${rec.readyState}・長さ ${fmt(rec.duration)} 秒・${fmt(rec.t, 2)} 秒まで進んだ${rec.rejected ? "・" + rec.rejected : ""}${rec.error != null ? "・エラー " + rec.error : ""}${src}`
        : "再生が始まらない",
    );
    return ok;
  }

  async function snap(sc, name) {
    if (!sc.snapDir) return;
    await sleep(400);
    const s = window.__kkSnapshot();
    await invoke("dev_write", { path: `${sc.snapDir}/${name}.json`, text: JSON.stringify(s) });
    let png = "";
    try {
      await invoke("dev_screenshot", { path: `${sc.snapDir}/${name}.png` });
      png = "・画像あり";
    } catch (e) {
      png = `・画像なし（${e}）`;
    }
    info(`見た目の記録 ${name}（${s.items.length} 要素・${s.viewport.w}×${s.viewport.h}${png}）`);
  }

  /** 保存した .md の見出しのうち、録音ごと・日ごとに変わる所（題・元ファイル・処理日）をそろえる */
  const normalizeMd = (md) =>
    md
      .replace(/^# 話者付き文字起こし: .*$/m, "# 話者付き文字起こし: *")
      .replace(/^- 元ファイル: .*$/m, "- 元ファイル: *")
      .replace(/^(- 処理: .*\/ )\d{4}-\d{2}-\d{2}$/m, "$1*");

  function firstDiff(a, b) {
    const la = a.split("\n");
    const lb = b.split("\n");
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) return `${i + 1} 行目: 「${(la[i] ?? "（無い）").slice(0, 60)}」／見本「${(lb[i] ?? "（無い）").slice(0, 60)}」`;
    }
    return "";
  }

  async function compareFile(label, path, expected, normalize) {
    let got;
    try {
      got = await invoke("dev_read", { path });
    } catch (e) {
      return check(label, false, String(e));
    }
    const a = normalize ? normalize(got) : got;
    const b = normalize ? normalize(expected) : expected;
    return check(label, a === b, a === b ? `${got.length} 字` : firstDiff(a, b));
  }

  // エンジンからの知らせを操作役も受ける（jobId と保存先を知るため）
  let lastDone = null;
  const doneIds = [];

  /** 新しい版の知らせ（約束 版10）: 新しい録音の画面の帯 → 内容と手順の窓 →「あとで」（帯は残る）。skip なら「この版は知らせない」 */
  async function updateCheck(skip) {
    const band = await waitFor(() => document.querySelector("[data-update-band]"), 10000);
    check("新しい版があると、新しい録音の画面に帯（約束 版10）", band && norm(band.textContent).includes("新しい版（9.9.9）があります"), norm(band?.textContent).slice(0, 80));
    if (!band) return;
    if (skip) {
      await clickWhen("この版は知らせない");
      check("「この版は知らせない」で帯が消える", await waitFor(() => !document.querySelector("[data-update-band]"), 2000));
      return;
    }
    await clickWhen("内容と手順を見る");
    const dlg = await waitFor(() => document.querySelector("[data-update-dialog]"), 3000);
    const text = norm(dlg?.textContent);
    const steps = dlg ? dlg.querySelectorAll("ol li").length : 0;
    check(
      "窓に題・更新内容・入れ替えかた（6つの手順と「このまま開く」）",
      text.includes("Kikiwake 9.9.9 があります") && text.includes("（操作役）新しい版の知らせの確かめ") && steps === 6 && text.includes("このまま開く"),
      `手順 ${steps} 個`,
    );
    await snap(sc, "update");
    await clickWhen("あとで");
    check("「あとで」で窓を閉じ、帯は残る", !document.querySelector("[data-update-dialog]") && document.querySelector("[data-update-band]"));
  }

  /** 処理中に閉じようとする → 確かめる窓の文を見る →「文字起こしを続ける」で続ける */
  async function closeCheck(label, want) {
    await invoke("dev_close");
    const d = await waitFor(() => dialogTitle() === CLOSE_TITLE, 5000);
    const body = dialogBody();
    check(`処理中に閉じると確かめる（${label}）`, d && want(body), body.join(" ／ ").slice(0, 240));
    if (d) await clickWhen("文字起こしを続ける");
    await sleep(300);
    check(`「文字起こしを続ける」で続く（${label}）`, !dialogTitle() && runningEntry());
    return body;
  }

  /** ファイルを窓に落として、ファイルの確認が済むまで待つ（label は始めるボタン。処理中なら「順番待ちに入れる」） */
  async function chooseFile(path, L, label = L.start) {
    await invoke("dev_drop", { paths: [path] });
    const name = path.split("/").pop();
    const b = await waitFor(() => {
      const x = button(label);
      return x && bodyText().includes(name) ? x : null;
    }, 20000);
    check(`ドロップでファイルの確認（${name}）`, b, b ? "" : norm(bodyText()).slice(0, 120));
    if (!b) throw new Error(`「${label}」が出ない`);
    return b;
  }

  /** 見ている録音の処理が終わって「話者」のタブになるまで待つ（止まったら例外） */
  async function waitNaming(sc, L) {
    const t0 = Date.now();
    let lastPct = "";
    const pcts = new Set();
    const ok = await waitFor(
      () => {
        const p = norm(document.querySelector(".page-scroll .card .num")?.textContent);
        if (p && p !== lastPct) {
          lastPct = p;
          pcts.add(p);
        }
        return (tab() === L.speakers && document.querySelector('[id^="name-"]')) || heading() === L.stopped;
      },
      (sc.timeoutMin || 20) * 60000,
      500,
    );
    if (heading() === L.stopped) throw new Error(`処理が止まった: ${norm(document.querySelector('[role="alert"]')?.textContent)}`);
    if (!ok) throw new Error("処理が終わらない");
    return { sec: (Date.now() - t0) / 1000, pcts: pcts.size };
  }

  /** 「保存…」→ 窓（formats があれば形式をそのとおりに）→「保存」→ "saved"（保存した）か "dialog"（同じ名前のファイルの確かめ） */
  async function saveAndWait(L = JA, formats = null) {
    const dlg = await openSaveDialog(L);
    if (!dlg) return null;
    if (formats) await chooseFormats(dlg, formats);
    return confirmSave(dlg, L);
  }

  // ---- 準備の画面 ------------------------------------------------------------------------

  async function setupScenario() {
    await screen("はじめに準備をします", 20000);
    // AI モデルがそろうまでは、一覧・上の帯・タブを出さず、準備の画面だけ（2026-09-27 決定）
    check("起動して準備の画面だけ（一覧・タブは出さない）", !document.querySelector(".objects-sidebar") && !document.querySelector(".objects-tab"));
    await snap(sc, "setup");
    const ng = (bodyText().match(/不可/g) || []).length;
    check("動作条件に「不可」が無い", !bodyText().includes("動作条件を満たしていない項目がある"), `「不可」の文字 ${ng} か所`);
    const dl = await waitFor(() => buttonHas("ダウンロードする（合計"), 10000);
    if (!check("足りないモデルのダウンロードのボタン", dl, dl ? norm(dl.textContent) : "")) return;
    dl.click();
    check("ダウンロード中になる", await waitFor(() => bodyText().includes("ダウンロード中"), 30000));
    await sleep(2500);
    await clickWhen("中断");
    const paused = await waitFor(() => bodyText().includes("中断中"), 15000);
    check("中断すると「中断中」（続きから再開できる）", paused, paused ? norm(bodyText().match(/中断中[^\n]*/)?.[0]) : "");
    await clickWhen("続きからダウンロードする");
    const t0 = Date.now();
    const ready = await waitFor(() => (bodyText().match(/ダウンロード済み/g) || []).length >= 2, 15 * 60000, 500);
    check("続きから取り終えて、2つとも「ダウンロード済み」", ready, `${fmt((Date.now() - t0) / 1000)} 秒`);
    await snap(sc, "setup-ready");
    await clickWhen("はじめる");
    await screen("新しい録音");
    check("「はじめる」で新しい録音の画面・録音の一覧が出る（まだ空）", document.querySelector(".objects-sidebar") && bodyText().includes("まだありません"));
    // そろったあとは「AI モデルと動作条件」で見返す（題が違い、「はじめる」は無く「もう一度確かめる」）
    document.querySelector(".objects-foot-btn")?.click();
    await screen("AI モデルと動作条件", 5000);
    check("「AI モデルと動作条件」で見返す（一覧は出したまま・「はじめる」なし・「もう一度確かめる」あり）", document.querySelector(".objects-sidebar") && !button("はじめる") && button("もう一度確かめる"));
    // 新しい版の確認の設定（約束 版10。2026-09-27 決定: 置く・初めは確かめる）
    const setting = document.querySelector("[data-update-setting]");
    check("「起動したときに新しい版を確かめる」があり、初めは入っている", setting && setting.getAttribute("aria-pressed") === "true", norm(setting?.textContent));
    setting?.click();
    check("外すと覚える", await waitFor(() => setting.getAttribute("aria-pressed") === "false" && localStorage.getItem("kikiwake.update.check") === "off", 2000));
    setting?.click();
    check("入れ直すと覚えた「外す」を消す", await waitFor(() => setting.getAttribute("aria-pressed") === "true" && localStorage.getItem("kikiwake.update.check") === null, 2000));
    await snap(sc, "settings");
  }

  // ---- 合成会議で通す ----------------------------------------------------------------------

  /** 版6: ドラッグの位置が枠の中のときだけ、枠の色が変わる（外枠がドラッグで出すのと同じ知らせを dev_drag で送る） */
  async function dragCheck() {
    const zone = document.querySelector("[data-drop-zone]");
    if (!check("ドロップ枠（data-drop-zone）", zone)) return;
    const accent = "rgb(61, 106, 150)"; // #3d6a96（UI 画面仕様書 §5.2）
    const color = () => getComputedStyle(zone).borderTopColor;
    const r = zone.getBoundingClientRect();
    await invoke("dev_drag", { over: true, x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const inside = await waitFor(() => color() === accent, 2000);
    await invoke("dev_drag", { over: true, x: r.left + r.width / 2, y: r.bottom + 40 });
    const outside = await waitFor(() => color() !== accent, 2000);
    await invoke("dev_drag", { over: true, x: r.left + 5, y: r.top + 5 });
    const again = await waitFor(() => color() === accent, 2000);
    await invoke("dev_drag", { over: false, x: 0, y: 0 });
    const left = await waitFor(() => color() !== accent, 2000);
    check("ドラッグが枠の上にある間だけ枠の色が変わる（版6）", inside && outside && again && left, `枠の中 ${Boolean(inside)}・外 ${Boolean(outside)}・端 ${Boolean(again)}・出た ${Boolean(left)}`);
    // 新しい録音の画面では、窓全体の案内は出さない（ドロップ枠の色で知らせる）
    check("新しい録音の画面では窓全体の案内を出さない", !document.querySelector(".objects-drop"));
  }

  /** 話者のタブ: 話者の数・確認用の手がかり・サンプルの再生・名前を入れる */
  async function namingChecks(sc) {
    const labels = [...new Set(buttons().map((b) => norm(b.textContent).match(/^(話者[A-Z]+)/)?.[1]).filter(Boolean))];
    check("話者の数", !sc.expectSpeakers || labels.length === sc.expectSpeakers, `${labels.length} 人（エンジンは ${lastDone?.speakers}）`);
    if (sc.expectHints) check("確認用の名前の手がかりの枠", bodyText().includes("確認用の部分で名乗った名前"));
    const play = buttonHas("▶ 再生");
    if (check("サンプルの再生ボタン", play)) {
      await checkPlay("サンプル", play, sc.quiet);
      const stop = button("■ 停止");
      if (stop) stop.click();
    }
    for (const [label, name] of Object.entries(sc.names || {})) {
      if (!check(`${label} の名前の欄`, await typeName(label, name))) continue;
    }
    if (sc.names) {
      await sleep(200);
      const shown = Object.values(sc.names).filter((n) => buttons().some((b) => norm(b.textContent).includes(n))).length;
      check("入れた名前が話者の一覧に出る", shown === Object.keys(sc.names).length, `${shown} 人`);
    }
  }

  /** 文字起こしのタブ: 最初の行がエンジンと同じ・行の再生 */
  async function transcriptChecks(sc, jobId, named) {
    const view = await invoke("get_transcript", { jobId, named });
    const first = view.utterances[0];
    const r0 = await waitFor(() => row(first.id), 5000);
    check("最初の行の文字がエンジンと同じ", r0 && norm(r0.textContent).includes(norm(first.text).slice(0, 12)));
    const playRow = r0?.querySelector("button");
    if (check("行の再生ボタン", playRow)) {
      await checkPlay("行", playRow, sc.quiet);
      if (norm(playRow.textContent) === "■") playRow.click();
    }
    return view;
  }

  /** 「詳細」の窓（どちらのタブからも開く）。行数を返して閉じる */
  async function detailCheck(label, view) {
    await clickWhen("詳細");
    const m = await waitFor(() => document.querySelector('[aria-label="詳細"]'), 10000);
    const text = norm(m?.textContent);
    const lines = view ? view.utterances.length + view.unresolved.length : null;
    check(
      `「詳細」が${label}から開く${lines !== null ? "・行数がエンジンと同じ" : ""}`,
      m && (lines === null || text.includes(`${lines.toLocaleString()}行`)),
      lines !== null ? `${lines} 行（本文 ${view.utterances.length}・確認用 ${view.unresolved.length}）` : "",
    );
    escape();
    await waitFor(() => !document.querySelector('[aria-label="詳細"]'), 2000);
  }

  async function synthScenario(sc) {
    const L = JA;
    const name1 = sc.recording.split("/").pop();
    const name2 = sc.recording2.split("/").pop();
    await screen(L.newTitle, 30000);
    // 一覧は起動のあとで読み込む（空の一言は読み込めてから出る）ので、少し待つ
    check("起動して新しい録音の画面（一覧はまだ空）", await waitFor(() => bodyText().includes("まだありません"), 3000));
    const m0 = await menuIs(MENU_JA);
    check("Mac のメニューが日本語（版7）", m0.ok && m0.menu[0]?.items?.[0] === "Kikiwake について", m0.menu.map((x) => x.title).join(" "));
    check("窓が広い（1100px 以上）と一覧を横に置く", document.querySelector(".objects-sidebar:not(.overlay)"), `窓の幅 ${innerWidth}px`);
    info(`安全な文脈 ${window.isSecureContext}・navigator.clipboard ${Boolean(navigator.clipboard?.writeText)}`);
    await updateCheck(false);
    await snap(sc, "file-empty");
    await dragCheck();

    // 1本目を始める
    const start = await chooseFile(sc.recording, L);
    await snap(sc, "file-selected");
    start.click();
    await waitFor(() => runningEntry() && title() === name1, 5000);
    check("処理中の録音が一覧の一番上に「文字起こし中」", chipOf(runningEntry()).startsWith("文字起こし中"), entryText(runningEntry()));
    check("処理中は題を出さない（上の帯の印と重なるため）", !heading() && headChip().startsWith("文字起こし中"), `題「${heading()}」・印「${headChip()}」`);
    await sleep(1000);
    // 閉じる確かめ（順番待ちなし）: 段階に合った文だけ
    const b0 = await closeCheck("順番待ちなし", (body) => body.length === 1 && closeCaseOf(body[0], name1) !== "（知らない文）");
    info(`そのときの段階の文: ${closeCaseOf(b0[0], name1)}`);

    // 声を文字にする段階に入ったら、閉じる確かめの文 → 中止 → 再開する（声の聞き分けの結果を使う）
    const tr = await waitFor(() => stageText() === "声を文字にする", 180000, 200);
    check("声を文字にする段階に進む", tr);
    await closeCheck("声を文字にしている間", (body) => body.length === 1 && body[0] === CLOSE.converting(name1));
    await sleep(1500);
    await clickWhen("中止");
    await waitFor(() => dialogTitle() === "文字起こしを中止しますか？", 5000);
    await clickWhen("中止する");
    await screen("中止しました", 20000);
    check("中止すると声の聞き分けの結果が残る", bodyText().includes("声の聞き分けの結果は残っています"));
    check("中止した録音は一覧で「中断」", await waitFor(() => chipOf(entryOf(name1)) === "中断", 5000), entryText(entryOf(name1)));
    await clickWhen("再開する");
    check("再開すると前回の聞き分けを使う", await waitFor(() => bodyText().includes("前回の結果を使用"), 10000));
    check("再開すると一覧は処理中の1行だけ（同じ録音を2行にしない）", await waitFor(() => runningEntry() && !entryOf(name1), 5000) || entryEls().filter((e) => entryName(e) === name1).length === 1);

    // 処理中に2本目を選ぶ → 順番待ち
    await newRecording(L);
    const start2 = await chooseFile(sc.recording2, L, L.enqueue);
    check("処理中に選ぶと「順番待ちに入れる」と、今の文字起こしの名前", bodyText().includes(`今は「${name1}」を文字起こししています`));
    start2.click();
    const q = await waitFor(() => queued()[0], 3000);
    check("順番待ちが一覧に「順番待ち（次）」", q && chipOf(q) === "順番待ち（次）", entryText(q));
    check("順番待ちに入れたと知らせる", await waitFor(() => toast() === "順番待ちに入れました", 2000), toast());
    check(
      "順番待ちを選ぶと説明（閉じると破棄）と「順番待ちから外す」",
      heading() === "順番待ち" && bodyText().includes("順番待ちのままアプリを閉じると、順番待ちは破棄します（まだはじめていないので、元のファイルも文字起こしも失いません）。") && button("順番待ちから外す"),
      heading(),
    );
    await snap(sc, "queued");
    await closeCheck("順番待ちが1件", (body) => body.length === 2 && body[0] === CLOSE.converting(name1) && body[1] === CLOSE.queue(1));
    await overflowCheck("順番待ちの画面");
    // 処理中の録音を開く → 進み具合
    await openEntry(name1, { wait: false });
    check("処理中の録音を選ぶと進み具合", await waitFor(() => stageText() === "声を文字にする" && title() === name1, 5000));

    // 1本目が終わる → 話者のタブ（見ている）。順番待ちの2本目がすぐ始まる
    const w = await waitNaming(sc, L);
    const job1 = lastDone.jobId;
    check("処理が終わって話者のタブ", true, `${fmt(w.sec)} 秒・文字起こしの％の表示 ${w.pcts} 通り`);
    const r2 = await waitFor(() => runningEntry() && entryName(runningEntry()) === name2, 10000);
    check("1本目が終わると、順番待ちの2本目がすぐ始まる（断られない）", r2 && !toast().includes("はじめられませんでした") && queued().length === 0, entryText(runningEntry()) || toast());
    check("見ている1本目は「保存前」・「話者 4・名前なし」", headChip() === "保存前" && entryText(entryOf(name1)).includes("話者 4・名前なし"), `${headChip()}／${entryText(entryOf(name1))}`);
    // 見ていない録音を処理しているときも、閉じるときに確かめる（その録音の名前で）
    await closeCheck("見ていない録音を処理中", (body) => body.length === 1 && body[0].startsWith(`閉じると「${name2}」の文字起こしを`));

    // 話者のタブ
    await snap(sc, "naming");
    await namingChecks(sc);
    // 保存の帯は「保存…」だけ（2026-09-29 決定: 形式・保存先・「保存しました」・「Finder で表示」は帯に出さない）
    const bar = saveBar();
    check(
      "保存の帯は「保存…」だけ（形式・保存先・Finder で表示は出さない）",
      bar && [...bar.querySelectorAll("button")].map((b) => norm(b.textContent)).join("|") === "保存…" && !bar.querySelector(".check-chip") && !button("Finder で表示"),
      bar ? norm(bar.textContent) : "無い",
    );
    await detailCheck("話者のタブ（名前を確定してから）", null);
    // 話者のタブから .md・.txt を保存（名前を確定してから保存する）→ 見本（Python 版と同じ中身）と比べる
    const dlg1 = await openSaveDialog(L);
    const f1 = dlg1 ? dialogFolder(dlg1) : {};
    check(
      "「保存…」で窓: 初めは .md だけ・保存先は元のファイルと同じフォルダ",
      dlg1 && JSON.stringify(dialogFormats(dlg1)) === JSON.stringify([["md", true], ["txt", false], ["json", false]]) && f1.value === "source" && f1.selected === `元のファイルと同じフォルダ（${folderOf(sc.recording).split("/").pop()}）`,
      dlg1 ? `${JSON.stringify(dialogFormats(dlg1))}・${f1.selected}` : "窓が出ない",
    );
    await snap(sc, "save-dialog");
    let s1 = null;
    if (dlg1) {
      await chooseFormats(dlg1, ["md", "txt"]);
      s1 = await confirmSave(dlg1, L);
    }
    check("話者のタブから保存すると、名前を確定して保存（2件・ファイルの名前の知らせ）", s1 === "saved" && tab() === "話者" && savedCount(lastSaveToast) === 2, lastSaveToast);
    const out = lastDone && lastDone.jobId === job1 ? lastDone.outDir : folderOf(sc.recording);
    check("保存先の既定は元のファイルと同じフォルダ（約束 版12）", out === folderOf(sc.recording), out);
    const stem = savedStem(sc.recording);
    check("保存の知らせにファイルの名前（録音の名前入り）", lastSaveToast === `「${stem}.md」ほか1件を保存しました`, lastSaveToast);
    const fx = sc.fixtures;
    await compareFile("保存した .md が見本と同じ（題・元ファイル・処理日を除く）", `${out}/${stem}.md`, await invoke("dev_read", { path: `${fx}/saved_files/transcript_named.md` }), normalizeMd);
    await compareFile("保存した .txt が見本と同じ", `${out}/${stem}.txt`, await invoke("dev_read", { path: `${fx}/saved_files/transcript_named.txt` }));
    check("保存すると印が「保存済み」", headChip() === "保存済み" && (await waitFor(() => chipOf(entryOf(name1)) === "保存済み", 3000)), headChip());
    check("名前を付けた録音の行に「松本・田中ほか2人」（約束 版9）", await waitFor(() => entryText(entryOf(name1)).includes("松本・田中ほか2人"), 3000), entryText(entryOf(name1)));
    let prefs = null;
    try {
      prefs = JSON.parse(localStorage.getItem("kikiwake.save") || "null");
    } catch {
      prefs = null;
    }
    check("選んだ形式と保存先を覚える（.md・.txt／元のファイルと同じフォルダ）", prefs && prefs.formats.join(",") === "md,txt" && prefs.dir === null, JSON.stringify(prefs));

    // 文字起こしのタブ（名前が同じなら「保存済み」のまま）
    await toTab(L.transcript);
    check("話者→文字起こしで「保存済み」が消えない", headChip() === "保存済み", headChip());
    const view = await transcriptChecks(sc, job1, true);
    await snap(sc, "result");
    await detailCheck("文字起こしのタブ", view);

    // 手直し（contract/fixtures/edits_example.json と同じ3つ）→「保存後に手直し」
    const edits = JSON.parse(await invoke("dev_read", { path: `${fx}/edits_example.json` }));
    const [tid, text] = Object.entries(edits.texts)[0];
    check(`行 ${tid} の文字を直した（⌘+Enter）`, await editText(tid, text));
    for (const [id, name] of Object.entries(edits.names)) {
      const nameEl = row(id)?.querySelector("[data-name]");
      if (!check(`行 ${id} の名前`, nameEl)) continue;
      dblclick(nameEl);
      const inp = await waitFor(() => document.querySelector('input[placeholder="ほかの名前を入力"]'), 3000);
      if (inp) {
        setValue(inp, name);
        keydown(inp, "Enter", { metaKey: true });
      }
      check(`行 ${id} を「${name}」に（⌘+Enter）`, await waitFor(() => norm(row(id)?.querySelector("[data-name]")?.textContent).startsWith(name), 3000));
    }
    if (edits.confirmed?.length) {
      await clickWhen("本文に入れる");
      check("確認用の行を本文に入れる", await waitFor(() => bodyText().includes(`${edits.confirmed.length}件を本文に入れました`), 3000));
    }
    check("保存したあとで手直しすると「保存後に手直し」（上の帯と一覧）", headChip() === "保存後に手直し" && (await waitFor(() => chipOf(entryOf(name1)) === "保存後に手直し", 3000)), headChip());

    // もう一度「保存…」→ 窓は前に選んだ .md・.txt のまま（覚えている）→ .json も足して保存 → 同じ名前のファイルがあるので確かめる →「上書きする」
    const dlg2 = await openSaveDialog(L);
    check(
      "窓を開き直すと、前に選んだ形式（.md・.txt）のまま",
      dlg2 && JSON.stringify(dialogFormats(dlg2)) === JSON.stringify([["md", true], ["txt", true], ["json", false]]),
      dlg2 ? JSON.stringify(dialogFormats(dlg2)) : "窓が出ない",
    );
    let s2 = null;
    if (dlg2) {
      await chooseFormats(dlg2, ["md", "txt", "json"]);
      s2 = await confirmSave(dlg2, L);
    }
    const owBody = norm(document.querySelector(".dialog-body")?.textContent);
    check("同じ名前のファイルがあると確かめる（録音の名前入りのファイル）", s2 === "dialog" && owBody.includes(`${stem}.md`), owBody.slice(0, 160));
    if (s2 === "dialog") {
      const over = await overwriteAndWait(L);
      check("上書きして保存（3件）→「保存済み」", over === "saved" && savedCount(lastSaveToast) === 3 && (await waitFor(() => headChip() === "保存済み", 3000)), `${lastSaveToast}・${headChip()}`);
    }
    // 画面を通さずに、同じ手直しをエンジンで保存したもの（約束の saveOutputs）と一字一句比べる
    const ref = await invoke("save_outputs", { jobId: job1, req: { dir: sc.refDir, formats: ["md", "txt", "json"], edits, overwrite: true } });
    for (const f of ref.files) {
      const base = f.split("/").pop();
      await compareFile(`手直しを当てた ${base} が、同じ手直しをエンジンで保存したものと同じ`, `${out}/${base}`, await invoke("dev_read", { path: f }));
    }
    // 見本は Phase 0 のコマンド版の話者判定から作った。アプリの kikiwake-diar は区間の境目が 4 か所 10ms 違う（決定済み）ので、
    // 手直しで発言時間を数え直す見出しの「長さ・話者」の行は、秒の繰り上がりが見本と分かれることがある（田中 41.99 秒と 42.00 秒）。その行は参考に出す
    const editedMd = await invoke("dev_read", { path: `${fx}/saved_files/edited/transcript_named.md` });
    const talkLine = (md) => md.match(/^- 長さ: .*$/m)?.[0] ?? "";
    await compareFile("手直しを当てた .md の本文が見本と同じ（見出しの題・元ファイル・処理日・発言時間を除く）", `${out}/${stem}.md`, editedMd, (md) => normalizeMd(md).replace(/^- 長さ: .*$/m, "- 長さ: *"));
    const gotTalk = talkLine(await invoke("dev_read", { path: `${out}/${stem}.md` }));
    info(`発言時間の行: ${gotTalk === talkLine(editedMd) ? "見本と同じ" : `アプリ「${gotTalk.slice(4, 80)}」／見本「${talkLine(editedMd).slice(4, 80)}」`}`);
    await compareFile("手直しを当てた .json が見本と同じ", `${out}/${stem}.json`, await invoke("dev_read", { path: `${fx}/saved_files/edited/transcript_named.json` }));
    // 上の段の「…」のメニューは外した（2026-09-29）。一覧の行に「…」（選んでいる行はいつも出す）。中は「Finder で表示」と「削除…」。処理中・順番待ちの行には出さない
    check("上の段に「…」のメニューが無い", !document.querySelector('.objects-head [aria-haspopup="menu"]'));
    const more = moreButton(entryOf(name1));
    check(
      "一覧の選んでいる行に「…」が見えている",
      more && more.getAttribute("title") === "その他の操作" && getComputedStyle(more).opacity === "1",
      more ? `${more.getAttribute("title")}・opacity ${getComputedStyle(more).opacity}` : "無い",
    );
    check("処理中の行には「…」が無い", !runningEntry() || !moreButton(runningEntry()));
    const items1 = await openRowMenu(entryOf(name1));
    // 約束 版15: 書き終えた録音には「〈ほかの言語〉で文字起こしし直す…」（日本語の録音なので「英語で…」）
    check("「…」の中は「Finder で表示」（保存したので押せる）・「英語で文字起こしし直す…」・「削除…」", menuItemsText(items1) === "Finder で表示|英語で文字起こしし直す…|削除…", menuItemsText(items1));
    await snap(sc, "row-menu");
    escape();
    check("Esc で「…」のメニューを閉じる", await waitFor(() => !document.querySelector(".objects-row-menu"), 2000));
    // 約束 版12: エンジンの一覧に、最後に保存したファイル（閉じたときの状態の lastSavedFiles）
    const want = ["md", "txt", "json"].map((f) => `${out}/${stem}.${f}`);
    const listed = await waitForAsync(async () => {
      const h = (await invoke("list_history")).find((i) => i.jobId === job1);
      return h && JSON.stringify(h.savedFiles) === JSON.stringify(want) ? h : null;
    }, 5000);
    check("エンジンの一覧に最後に保存したファイル（約束 版12）", listed, listed ? "" : JSON.stringify((await invoke("list_history")).find((i) => i.jobId === job1)?.savedFiles));

    // 処理中に、ほかの録音（書き終えた1本目）を開き直す: 2本目の処理は最後まで進む（エンジンの掃除の直し。約束 版9）
    await newRecording(L);
    check("2本目はまだ処理中", runningEntry() && entryName(runningEntry()) === name2, entryText(runningEntry()));
    await openEntry(name1);
    check("処理中にほかの録音を開ける（閉じたときの文字起こしのタブ・保存済みのまま）", tab() === L.transcript && headChip() === "保存済み", `${tab()}・${headChip()}`);
    const playRow = row(view.utterances[0].id)?.querySelector("button");
    if (check("開き直した録音の行の再生ボタン", playRow && !playRow.disabled)) {
      await checkPlay("開き直した録音の行（2本目の処理中）", playRow, sc.quiet);
      if (norm(playRow.textContent) === "■") playRow.click();
    }
    const done2 = await waitFor(() => doneIds.some((id) => id !== job1), (sc.timeoutMin || 20) * 60000, 500);
    check("見ていない2本目が最後まで終わる（処理中にほかの録音を開いても）", done2);
    check("終わったと知らせる", await waitFor(() => toast() === `「${name2}」の文字起こしが終わりました`, 5000), toast());
    check("見ていない間に終わった録音に「●」", await waitFor(() => freshOf(entryOf(name2)), 5000), entryText(entryOf(name2)));
    check("見ている画面は変わらない", title() === name1 && tab() === L.transcript, `${title()}・${tab()}`);
    await snap(sc, "fresh");
    await openEntry(name2);
    check("開くと「●」が消える・話者のタブ", !freshOf(entryOf(name2)) && tab() === L.speakers, entryText(entryOf(name2)));
    // 一度も保存していない録音の「…」では「Finder で表示」を押せない（下に「まだ保存していません」）。
    // 開いていない1本目は、エンジンの一覧の「最後に保存したファイル」で押せる（約束 版12）
    const items2 = await openRowMenu(entryOf(name2));
    const note = norm(document.querySelector(".objects-row-menu .objects-menu-note")?.textContent);
    check("保存していない録音の「…」は「Finder で表示」を押せない・「まだ保存していません」", menuItemsText(items2) === "Finder で表示（押せない）|英語で文字起こしし直す…|削除…" && note === "まだ保存していません", `${menuItemsText(items2)}・${note}`);
    escape();
    await waitFor(() => !document.querySelector(".objects-row-menu"), 2000);
    const items3 = await openRowMenu(entryOf(name1));
    check("開いていない保存済みの録音の「…」は「Finder で表示」を押せる", menuItemsText(items3) === "Finder で表示|英語で文字起こしし直す…|削除…", menuItemsText(items3));
    escape();
    await waitFor(() => !document.querySelector(".objects-row-menu"), 2000);
    hideOverlay();

    // 同じ録音を新しい録音として選び直す → 前回の文字起こしを使い、閉じたときの画面に手直しのまま戻る（版6・版8）
    await newRecording(L);
    const s3 = await chooseFile(sc.recording, L);
    // 帯は新しい版の知らせ（約束 版10）もあるので、「前回の」で始まる帯を探す
    const prevText = [...document.querySelectorAll(".band-info")].map((e) => norm(e.textContent)).find((x) => x.startsWith("前回の")) ?? "";
    check("前回の文字起こしを使うと知らせる（版6）", prevText.startsWith("前回の文字起こしを使います"), prevText);
    const estimate = norm(bodyText().match(/所要時間の目安\s*[^\n]*/)?.[0] || "");
    check("所要時間の目安が「すぐに終わります」（版6）", estimate.includes("すぐに終わります"), estimate);
    const t0 = Date.now();
    s3.click();
    await waitFor(() => title() === name1 && tab() && !runningEntry(), (sc.timeoutMin || 20) * 60000, 200);
    const sec = (Date.now() - t0) / 1000;
    check("選び直すと文字起こしをやり直さずに、閉じたときの文字起こしのタブへ（版6・版8）", tab() === L.transcript && sec < 5, `${fmt(sec)} 秒・${tab()}`);
    check("手直し（直した文字）が戻っている（版8）", await waitFor(() => norm(row(tid)?.textContent).includes(norm(text).slice(0, 12)), 5000));
    check("選び直しても一覧に同じ録音は1行だけ", entryEls().filter((e) => entryName(e) === name1).length === 1);

    // ドラッグ中の案内（どの画面でも。アプリの中は外枠の知らせ onFileDragOver で出る）
    await invoke("dev_drag", { over: true, x: 600, y: 400 });
    const hint = await waitFor(() => document.querySelector(".objects-drop"), 2000);
    check("ファイルをドラッグしている間、窓全体に「ここに落とすと、新しい録音として追加します」", hint && norm(hint.textContent).includes("ここに落とすと、新しい録音として追加します"));
    await snap(sc, "drop-hint");
    await invoke("dev_drag", { over: false, x: 0, y: 0 });
    check("ドラッグが窓から出ると案内が消える", await waitFor(() => !document.querySelector(".objects-drop"), 2000));
    // 録音の画面に落とすと、新しい録音として確認する
    await invoke("dev_drop", { paths: [sc.recording2] });
    check("録音の画面に落としても、新しい録音として確認", await waitFor(() => heading() === L.newTitle && bodyText().includes(name2) && button(L.start), 10000));

    // 窓の幅: 1100px 未満では一覧をしまい、左上のボタンで重ねて出す
    await invoke("dev_resize", { width: 900, height: 560 });
    const narrow = await waitFor(() => !document.querySelector(".objects-sidebar") && document.querySelector(".objects-toolbar .objects-icon-btn"), 3000);
    check("狭い窓（900px）では一覧をしまい、左上に一覧を出すボタン", narrow, `窓の幅 ${innerWidth}px`);
    await showList();
    check("ボタンで一覧を重ねて出す", document.querySelector(".objects-sidebar.overlay"));
    await snap(sc, "narrow-list");
    hideOverlay();
    await invoke("dev_resize", { width: 1200, height: 800 });
    check("広い窓に戻すと一覧を横に置く", await waitFor(() => document.querySelector(".objects-sidebar:not(.overlay)"), 3000), `窓の幅 ${innerWidth}px`);

    // はみ出し（日本語）
    await overflowCheck("新しい録音の画面（選んだあと）");
    await openEntry(name1);
    await overflowCheck("文字起こしのタブ");
    await toTab(L.speakers);
    await overflowCheck("話者のタブ");
  }

  // ---- 説明書の写真（KIKIWAKE_E2E_REC で録音をユーザー名の入らない場所に置いて撮る） -------------------------

  async function photoScenario(sc) {
    const L = JA;
    await screen(L.newTitle, 30000);
    // 1本目を最後まで: 名前を付けて保存 → 文字起こしのタブ（写真 result）
    const s1 = await chooseFile(sc.recording, L);
    s1.click();
    await waitNaming(sc, L);
    for (const [label, name] of Object.entries(sc.names || {})) await typeName(label, name);
    const first = Object.keys(sc.names || {})[0];
    if (first) buttons().find((b) => norm(b.textContent).startsWith(first))?.click();
    await sleep(300);
    await snap(sc, "naming");
    await toTab(L.transcript);
    check("保存（写真用）", (await saveAndWait()) === "saved");
    // 保存の知らせが消えてから撮る（帯は「保存…」だけ。保存したことは上の印「保存済み」）
    await waitFor(() => !document.querySelector(".toast"), 5000);
    await sleep(300);
    await snap(sc, "result");
    // 新しい録音でファイルを選んだところ（写真 file-selected。一覧に1本目がある）
    await newRecording(L);
    await chooseFile(sc.recording2, L);
    await snap(sc, "file-selected");
  }

  // ---- マニュアルの素材（約束 版13。作り物の画面共有の録画: scripts/make_screens_video.sh） -------------------------

  /** 新しい録音の「マニュアル用に、画面の絵も取り出す」（録画のときだけ） */
  const screensOption = () => document.querySelector(".screens-option");
  /** 「保存…」の窓の .zip の行 */
  const zipRow = (dlg) => [...dlg.querySelectorAll(".save-format")].find((b) => norm(b.querySelector(".save-format-ext")?.textContent) === ".zip");

  async function screensScenario(sc) {
    const L = JA;
    await screen(L.newTitle, 30000);
    const s1 = await chooseFile(sc.recording, L);
    const opt = screensOption();
    check("録画を選ぶと「マニュアル用に、画面の絵も取り出す」が出て、初めは外れている", opt && opt.getAttribute("aria-checked") === "false", norm(opt?.textContent).slice(0, 40));
    const before = norm(document.querySelector(".page-scroll .card strong")?.textContent);
    opt?.click();
    await sleep(100);
    const after = norm(document.querySelector(".page-scroll .card strong")?.textContent);
    // 目安は画面の読み取りのぶん（FileInfo.estimateScreens）。読み取りは文字起こしと同時に進めるので、短い録音では表示は変わらない
    check("チェックを入れられる（所要時間の目安はマニュアル用の値に）", screensOption()?.getAttribute("aria-checked") === "true" && Boolean(after), `${before} → ${after}`);
    await snap(sc, "file-screens");
    s1.click();
    check(
      "処理中に「画面の絵も取り出しています」",
      await waitFor(() => bodyText().includes("マニュアル用に、画面の絵も取り出しています"), 10000),
    );
    const w = await waitNaming(sc, L);
    const got = lastDone?.screens;
    check(
      "終わると画面の絵の数が届く（作り物の録画: 絵 4・場面 3・変化 1・顔 0。スクロールは次の場面にまとめる）",
      got && got.frames === 4 && got.scenes === 3 && got.steps === 1 && got.faces === 0,
      `${fmt(w.sec)} 秒・${JSON.stringify(got)}`,
    );

    // 保存: .md と zip（zip は毎回外れた状態で開く）
    let dlg = await openSaveDialog(L);
    let z = zipRow(dlg);
    check("「保存…」の窓に「マニュアルの素材」の .zip が出て、初めは外れている", z && z.getAttribute("aria-checked") === "false" && !z.disabled, norm(z?.textContent));
    check("zip の説明に絵の枚数", norm(z?.textContent).includes("場面ごとの画面の絵 4 枚"), norm(z?.textContent));
    await chooseFormats(dlg, ["md", "zip"]);
    await snap(sc, "save-dialog-zip");
    check("保存（.md と zip）", (await confirmSave(dlg, L)) === "saved", lastSaveToast);
    const stem = sc.recording.split("/").pop().replace(/\.[^.]+$/, "");
    const folder = folderOf(sc.recording);
    const zipPath = `${folder}/${stem}_マニュアル素材.zip`;
    const mdPath = `${folder}/${savedStem(sc.recording)}.md`;
    check("zip と .md を元のファイルと同じフォルダに保存", (await invoke("dev_exists", { path: zipPath })) && (await invoke("dev_exists", { path: mdPath })), `${lastSaveToast}`);
    check("知らせは 2 件", savedCount(lastSaveToast) === 2, lastSaveToast);

    // zip だけ・同じ名前 → 上書きの確かめ
    dlg = await openSaveDialog(L);
    z = zipRow(dlg);
    check("もう一度開くと zip は外れている（覚えない）・形式は前のまま", z?.getAttribute("aria-checked") === "false" && JSON.stringify(dialogFormats(dlg).filter(([f]) => f !== "zip")) === JSON.stringify([["md", true], ["txt", false], ["json", false]]), JSON.stringify(dialogFormats(dlg)));
    await chooseFormats(dlg, ["zip"]);
    const r = await confirmSave(dlg, L);
    check("zip だけでも保存でき、同じ名前があれば上書きを確かめる", r === "dialog" && bodyText().includes(`${stem}_マニュアル素材.zip`), r);
    check("上書きして保存", (await overwriteAndWait(L)) === "saved" && savedCount(lastSaveToast) === 1, lastSaveToast);
    dlg = await openSaveDialog(L);
    check("zip だけを保存したあとも、覚えている形式は .md のまま", JSON.stringify(dialogFormats(dlg).filter(([f]) => f !== "zip")) === JSON.stringify([["md", true], ["txt", false], ["json", false]]), JSON.stringify(dialogFormats(dlg)));
    escape();
    await sleep(200);
    info(`zip の中身は scripts/e2e_mac.sh が確かめる: ${zipPath}`);

    // 約束 版14: 判定の版が上がったときのまね。作業フォルダの判定と、その数値の控えの版を 1 つ下げる（筋書き screens2 で開き直す）
    const dir = `${sc.cacheDir}/jobs/${lastDone.jobId}`;
    for (const f of ["screens.json", "screens_settings.json"]) {
      const j = JSON.parse(await invoke("dev_read", { path: `${dir}/${f}` }));
      j.version -= 1;
      await invoke("dev_write", { path: `${dir}/${f}`, text: JSON.stringify(j) });
    }
    info("判定の版を 1 つ下げた（次の起動で、前の版で読み取った録画として開く）");
  }

  /** 約束 版14: 前の版で読み取った録画（screens のあと、同じ作業フォルダで開き直す） */
  async function screens2Scenario(sc) {
    const L = JA;
    await screen(L.newTitle, 30000);
    await openEntry(sc.recording.split("/").pop());
    let dlg = await openSaveDialog(L);
    let z = zipRow(dlg);
    check(
      "前の版で読み取った録画: .zip の行は出るが押せず、理由が出る",
      z && z.disabled && norm(z.textContent).includes("前の版で読み取ったので、このままでは作れません"),
      norm(z?.textContent),
    );
    const note = [...dlg.querySelectorAll(".save-note")].map((n) => norm(n.textContent)).join(" / ");
    check(
      "その下に作り直し方（「新しい録音」で選び直し、チェックを入れてはじめる）",
      note.includes("「新しい録音」でこの録画を選び直し") && note.includes("にチェックを入れてはじめてください"),
      note,
    );
    await snap(sc, "save-dialog-zip-outdated");
    escape();
    await sleep(200);
    // 案内のとおりに: 「新しい録音」で選び直し、チェックを入れてはじめる → 文字起こしは使い回し、画面だけ読み取り直す
    await newRecording(L);
    const s1 = await chooseFile(sc.recording, L);
    screensOption()?.click();
    await sleep(100);
    check("選び直して「マニュアル用に、画面の絵も取り出す」にチェック", screensOption()?.getAttribute("aria-checked") === "true");
    lastDone = null;
    const t0 = Date.now();
    s1.click();
    await waitNaming(sc, L);
    const got = lastDone?.screens;
    check(
      "画面だけ読み取り直して、絵の数が戻る（絵 4・場面 3・変化 1）",
      got && got.frames === 4 && got.scenes === 3 && got.steps === 1 && !got.error,
      `${fmt((Date.now() - t0) / 1000)} 秒・${JSON.stringify(got)}`,
    );
    dlg = await openSaveDialog(L);
    z = zipRow(dlg);
    check("「保存…」の .zip の行が戻る", z && !z.disabled && norm(z.textContent).includes("場面ごとの画面の絵 4 枚"), norm(z?.textContent));
    check("作り直し方の文は消える", ![...dlg.querySelectorAll(".save-note")].some((n) => norm(n.textContent).includes("新しい録音")));
    escape();
    await sleep(200);
  }

  // ---- 英語の録音（約束 版15。2026-10-18 決定: 自動で見分ける＋選び直せる。日本語と英語） ------------------------

  const speechSelect = () => document.querySelector(".speech-select");
  /** 録音の言語を選ぶ（React が読む値を変える） */
  async function chooseSpeech(value) {
    const sel = speechSelect();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(100);
  }
  /** 新しい録音の画面の青い帯（前回の文字起こしを使う・言語を変えてやり直す など）の題 */
  const fileBandTitle = () => norm(document.querySelector(".page-scroll .band-info span")?.textContent);
  /** 録音の上の段の情報の行（処理日・長さ・話者の数・録音の言語） */
  const headMeta = () => norm(document.querySelector(".objects-meta .num")?.textContent);

  async function speechScenario(sc) {
    const L = JA;
    const name = sc.recording.split("/").pop();
    await screen(L.newTitle, 30000);
    const start = await chooseFile(sc.recording, L);
    const sel = speechSelect();
    check(
      "新しい録音の画面に「録音の言語」（初めは「自動で見分ける」・日本語・English）",
      sel && sel.value === "auto" && [...sel.options].map((o) => o.text).join("|") === "自動で見分ける|日本語|English",
      sel ? `${sel.value}・${[...sel.options].map((o) => o.text).join("|")}` : "無い",
    );
    check("「自動」の説明の一言", bodyText().includes("話している所を聞いて、日本語か英語かを決めます。"));
    await snap(sc, "speech-file");
    lastDone = null;
    start.click();
    check(
      "処理中に「英語の録音として文字起こししています（自動で見分けました）」",
      await waitFor(() => bodyText().includes("英語の録音として文字起こししています（自動で見分けました）。"), 120000, 200),
    );
    await snap(sc, "speech-processing");
    const w = await waitNaming(sc, L);
    check("終わると、言語は英語・自動で見分けた", lastDone?.language === "en" && lastDone?.languageDetected === true, `${fmt(w.sec)} 秒・${lastDone?.language}・${lastDone?.languageDetected}`);
    // 一覧を読み直すと、録音の上の段に言語が出る（書き終えた録音の HistoryItem.language）
    check("録音の上の段に「英語」（日本語の画面で英語の録音のときだけ）", await waitFor(() => headMeta().endsWith(" ・ 英語"), 5000), headMeta());
    const cards = await invoke("get_speakers", { jobId: lastDone.jobId });
    const hints = cards.map((c) => `${c.label}:${c.hints.map((h) => h.name).join("/")}`).join(" ");
    const hintNames = new Set(cards.flatMap((c) => c.hints.map((h) => h.name)));
    check("英語の名前の手がかり（Matsumoto・Tom・David・Emily）", ["Matsumoto", "Tom", "David", "Emily"].every((n) => hintNames.has(n)), hints);
    check("サンプルの文は英語（単語の間に空白）", cards.some((c) => c.samples.some((s) => / [a-z]+ [a-z]+/.test(s.text))), cards[0]?.samples[0]?.text.slice(0, 60));
    // 名前を 1 つ付けて確定する（文字起こしし直しても残るか、あとで見る）
    const first = cards[0].label;
    const input = await waitFor(() => document.getElementById(`name-${first}`), 3000);
    if (input) setValue(input, "Matsumoto");
    await snap(sc, "speech-naming");
    await toTab(L.transcript);
    const view = await invoke("get_transcript", { jobId: lastDone.jobId, named: true });
    check("文字起こしは英語の文（語の間に空白）", view.utterances.some((u) => u.text.includes("Thank you all for joining today.")), view.utterances[0]?.text.slice(0, 80));
    await snap(sc, "speech-result");
    // 保存: 見出しは画面の言語（日本語）、本文は英語（2026-10-18 決定）
    check("保存（.md）", (await saveAndWait(L, ["md"])) === "saved", lastSaveToast);
    const md = await invoke("dev_read", { path: `${folderOf(sc.recording)}/${savedStem(sc.recording)}.md` });
    check(
      "保存した .md の見出しは日本語（画面の言語）・本文は英語",
      md.startsWith("# 話者付き文字起こし: ") && md.includes("Thank you all for joining today."),
      md.split("\n").slice(0, 2).join(" ／ ").slice(0, 80),
    );

    // 同じファイルを選び直す: 自動なら前回の書き起こしを使い回す。日本語を選ぶと「言語を変えて文字起こしし直します」
    await newRecording(L);
    await chooseFile(sc.recording, L);
    check("選び直すと、自動のままなら「前回の文字起こしを使います」", fileBandTitle() === "前回の文字起こしを使います", fileBandTitle());
    await chooseSpeech("ja");
    check(
      "日本語を選ぶと「言語を変えて文字起こしし直します」（前回は英語・声の聞き分けは使い回す）",
      fileBandTitle() === "言語を変えて文字起こしし直します" && bodyText().includes("前回は英語で文字起こししています。"),
      fileBandTitle(),
    );
    check("所要時間の目安は「すぐに終わります」でなくなる", !bodyText().includes("すぐに終わります"), norm(document.querySelectorAll(".page-scroll .card strong")[0]?.textContent));
    await snap(sc, "speech-file-relang");
    await chooseSpeech("en");
    check("英語（前回と同じ）を選ぶと、前回の文字起こしを使う", fileBandTitle() === "前回の文字起こしを使います", fileBandTitle());

    // 一覧の行の「…」→「日本語で文字起こしし直す…」→ 確かめの窓 → 文字起こしし直す
    const items = await openRowMenu(entryOf(name));
    await snap(sc, "speech-row-menu");
    check("一覧の行の「…」に「日本語で文字起こしし直す…」", items && menuItemsText(items).includes("日本語で文字起こしし直す…") && !items.find((b) => norm(b.firstChild?.textContent) === "日本語で文字起こしし直す…")?.disabled, menuItemsText(items));
    items?.find((b) => norm(b.firstChild?.textContent) === "日本語で文字起こしし直す…")?.click();
    const dt = await waitFor(() => (dialogTitle().includes("を日本語で文字起こしし直しますか？") ? dialogTitle() : null), 3000);
    check("確かめの窓（題に録音の名前）", dt === `「${name}」を日本語で文字起こしし直しますか？`, dt || dialogTitle());
    const est = await waitFor(() => (dialogBody()[0]?.includes("所要時間の目安") ? dialogBody()[0] : null), 5000);
    check("本文: 聞き分けは使い回し、所要時間の目安", Boolean(est) && est.includes("声の聞き分けは前回の結果を使い"), dialogBody().join(" ／ "));
    check("本文: 付けた名前は残り、手直しは消える", dialogBody()[1] === "付けた名前は残ります。文字起こしの画面での手直し（直した文字など）は消えます。保存したファイルは消えません。", dialogBody()[1]);
    check("決めるボタンは青（消す操作ではない）", button("文字起こしし直す")?.classList.contains("btn-primary"));
    await snap(sc, "speech-relang-dialog");
    lastDone = null;
    await clickWhen("文字起こしし直す");
    check("処理中に「日本語の録音として文字起こししています。」（選んだので「自動」の一言は無い）", await waitFor(() => bodyText().includes("日本語の録音として文字起こししています。"), 60000, 200));
    await waitNaming(sc, L);
    check("文字起こしし直すと、言語は日本語・選んだ", lastDone?.language === "ja" && !lastDone?.languageDetected, `${lastDone?.language}・${lastDone?.languageDetected}`);
    check("付けた名前は残る", lastDone?.names?.[first] === "Matsumoto", JSON.stringify(lastDone?.names));
    check("上の段に言語を出さない（日本語の画面で日本語の録音）", await waitFor(() => headMeta() && !headMeta().includes("英語") && !headMeta().includes("日本語"), 5000), headMeta());
    const items2 = await openRowMenu(entryOf(name));
    check("一覧の行の「…」は「英語で文字起こしし直す…」に変わる", menuItemsText(items2).includes("英語で文字起こしし直す…"), menuItemsText(items2));
    escape();
    await sleep(200);
  }

  // ---- 実録音（中身は出さず、時間と件数だけ） ------------------------------------------------

  async function realScenario(sc) {
    const L = JA;
    await screen(L.newTitle, 30000);
    const s1 = await chooseFile(sc.recording, L);
    s1.click();
    const w = await waitNaming(sc, L);
    check("処理が終わって話者のタブ", true, `${fmt(w.sec)} 秒・話者 ${lastDone?.speakers}・確認用 ${lastDone?.unresolvedCount}`);
    await toTab(L.transcript);
    await transcriptChecks(sc, lastDone.jobId, false);
    if (sc.reopen) {
      await newRecording(L);
      const s2 = await chooseFile(sc.recording, L);
      const t0 = Date.now();
      s2.click();
      await waitFor(() => tab() && !runningEntry(), (sc.timeoutMin || 20) * 60000, 200);
      check("選び直すと文字起こしをやり直さない", (Date.now() - t0) / 1000 < 10, `${fmt((Date.now() - t0) / 1000)} 秒`);
    }
  }

  // ---- 英語（約束 版7）。scripts/e2e_mac.sh が -AppleLanguages (en-US) で起動して、英語の Mac のまねをする ----------

  const MENU_EN = ["Kikiwake", "File", "Edit", "View", "Window", "Help"];
  const MENU_JA = ["Kikiwake", "ファイル", "編集", "表示", "ウインドウ", "ヘルプ"];

  /** Mac のメニューが want の並びになるまで待つ（言語を切り替えると外枠が作り直す） */
  async function menuIs(want) {
    let last = [];
    const ok = await waitForAsync(async () => {
      const m = await invoke("dev_menu");
      last = m;
      return m.map((x) => x.title).join("|") === want.join("|");
    }, 5000);
    return { ok: Boolean(ok), menu: last };
  }

  /** 右上の言語の切り替え（select）を操作する */
  async function switchLocale(locale) {
    const sel = document.querySelector("select[data-i18n-switch]");
    if (!sel) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, locale);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return Boolean(await waitFor(() => document.documentElement.lang === locale, 3000));
  }

  /**
   * 横のはみ出し: 文字が窓の右端を越える、または自分の枠から出た文字がほかの文字と重なる。
   * 枠から出ても、ほかの文字と重ならず窓の中に収まっていれば読めるので数えない（「…」で切る所とスクロールする所も除く）
   */
  function overflows() {
    const root = document.querySelector(".app") || document.body;
    const vw = document.documentElement.clientWidth;
    const texts = [];
    for (const el of root.querySelectorAll("*")) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      texts.push({ el, box: r, text: range.getBoundingClientRect() });
    }
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const out = [];
    for (const t of texts) {
      const cs = getComputedStyle(t.el);
      const clipped = /(auto|scroll|hidden|clip)/.test(cs.overflowX) || cs.textOverflow === "ellipsis";
      const label = `${t.el.tagName.toLowerCase()}「${norm(t.el.textContent).slice(0, 24)}」`;
      if (!clipped && t.text.right > vw + 1) {
        out.push(`${label} 右端 ${Math.round(t.text.right)}>${vw}px`);
        continue;
      }
      if (clipped || t.text.right <= t.box.right + 1) continue;
      const other = texts.find((o) => o !== t && !o.el.contains(t.el) && !t.el.contains(o.el) && hit(t.text, o.text));
      if (other) out.push(`${label} が「${norm(other.el.textContent).slice(0, 16)}」に重なる`);
    }
    return out;
  }

  /** 1200×800 と最小の 900×560 で、はみ出しが無いか（終わったら 1200×800 に戻す） */
  async function overflowCheck(label) {
    const found = [];
    for (const [width, height] of [
      [1200, 800],
      [900, 560],
    ]) {
      await invoke("dev_resize", { width, height });
      await sleep(600);
      const o = overflows();
      if (o.length) {
        found.push(`${width}×${height}: ${o.slice(0, 3).join(" / ")}${o.length > 3 ? ` ほか ${o.length - 3}` : ""}`);
        await snap(sc, `overflow-${label.replace(/[^\w\u3040-\u9fff]+/g, "_")}-${width}x${height}`);
      }
    }
    await invoke("dev_resize", { width: 1200, height: 800 });
    await sleep(300);
    return check(`${label}がはみ出さない（1200×800・900×560）`, found.length === 0, found.join(" | "));
  }

  /** 保存した本文の行（[時刻] 名前: 文）の名前 */
  const speakersOf = (text) => text.split("\n").map((l) => l.match(/^\[[\d:]+\] (.+?)\*?: /)?.[1]).filter(Boolean);

  async function enScenario(sc) {
    const L = EN;
    await screen(L.newTitle, 30000);
    check(
      "英語の Mac のまねで起動すると、画面が英語で始まる",
      document.documentElement.lang === "en",
      `navigator.language ${navigator.language}・<html lang> ${document.documentElement.lang}`,
    );
    const m0 = await menuIs(MENU_EN);
    const app0 = m0.menu[0]?.items ?? [];
    check(
      "Mac のメニューが最初から英語",
      m0.ok && app0[0] === "About Kikiwake" && app0.includes("Quit Kikiwake") && (m0.menu[5]?.items ?? []).includes("Licenses (Full Text)"),
      m0.menu.map((x) => `${x.title}（${x.items.slice(0, 2).join("・")}）`).join(" "),
    );
    await snap(sc, "en-file-empty");
    await overflowCheck("新しい録音の画面（英語）");
    const start = await chooseFile(sc.recording, L);
    await overflowCheck("新しい録音の画面・選んだあと（英語）");
    // 約束 版15: 録音の言語を選ぶ所（英語の画面）。前の「日本語の録音だけ」の断りは無くした
    const esel = speechSelect();
    check(
      "英語の画面に「Spoken language」（Detect automatically・日本語・English）・「日本語だけ」の断りは無い",
      esel && [...esel.options].map((o) => o.text).join("|") === "Detect automatically|日本語|English" && bodyText().includes("Spoken language") && !bodyText().includes("Japanese recordings only"),
      esel ? [...esel.options].map((o) => o.text).join("|") : "無い",
    );
    start.click();
    const w = await waitNaming(sc, L);
    check("処理が終わって話者のタブ（英語）", tab() === "Speakers", `${fmt(w.sec)} 秒`);
    check("日本語の録音を「自動」で日本語と見分ける（英語の画面でも）", lastDone?.language === "ja" && lastDone?.languageDetected === true, `${lastDone?.language}・${lastDone?.languageDetected}`);
    check("英語の画面で日本語の録音は、上の段に「Japanese」", await waitFor(() => headMeta().endsWith(" · Japanese"), 5000), headMeta());
    const labels = [...new Set(buttons().map((b) => norm(b.textContent).match(/^(Speaker [A-Z]+)/)?.[1]).filter(Boolean))];
    check("話者が英語のラベル（Speaker A…）", labels.length > 0 && (!sc.expectSpeakers || labels.length === sc.expectSpeakers), labels.join(", "));
    const name = sc.recording.split("/").pop();
    check("一覧の行と印が英語（4 speakers · no names・Not saved yet）", entryText(entryOf(name)).includes("4 speakers · no names") && chipOf(entryOf(name)) === "Not saved yet", entryText(entryOf(name)));
    const enBar = saveBar();
    check("保存の帯は「Save…」だけ（英語）", enBar && [...enBar.querySelectorAll("button")].map((b) => norm(b.textContent)).join("|") === "Save…", enBar ? norm(enBar.textContent) : "無い");
    await snap(sc, "en-naming");
    await overflowCheck("話者のタブ（英語）");

    await toTab(L.transcript);
    const out = lastDone.outDir;
    check("保存先の既定は元のファイルと同じフォルダ（約束 版12）", out === folderOf(sc.recording), out);
    await snap(sc, "en-result");
    await overflowCheck("文字起こしのタブ（英語）");
    const view = await invoke("get_transcript", { jobId: lastDone.jobId, named: false });
    const hasUnresolved = view.unresolved.length > 0;

    // 英語で .md・.txt・.json を保存して、中の言葉を確かめる（ファイルの名前は「〈元の名前〉_transcript」。約束 版12）
    const enDlg = await openSaveDialog(L);
    const enFolder = enDlg ? dialogFolder(enDlg) : {};
    check(
      "英語の「Save…」の窓（Format・Save to・Same folder as the original）",
      enDlg && norm(enDlg.querySelector(".dialog-title")?.textContent) === "Save" && enFolder.selected === `Same folder as the original (${folderOf(sc.recording).split("/").pop()})`,
      enDlg ? `${norm(enDlg.querySelector(".dialog-title")?.textContent)}・${enFolder.selected}` : "窓が出ない",
    );
    await overflowCheck("「Save…」の窓（英語）");
    let enSaved = null;
    if (enDlg) {
      await chooseFormats(saveDialog(), ["md", "txt", "json"]);
      enSaved = await confirmSave(saveDialog(), L);
    }
    const enStem = savedStem(sc.recording, EN);
    check(
      "英語で保存（3件）→「Saved」・ファイルの名前は「〈元の名前〉_transcript」",
      enSaved === "saved" && lastSaveToast === `Saved “${enStem}.md” and 2 more` && (await waitFor(() => headChip() === "Saved", 3000)),
      `${lastSaveToast}・${headChip()}`,
    );
    const read = async (stemOf) => {
      const r = {};
      for (const f of ["md", "txt", "json"]) r[f] = await invoke("dev_read", { path: `${out}/${stemOf}.${f}` });
      return r;
    };
    const en = await read(enStem);
    const head = en.md.split("\n").filter((l) => !l.startsWith("["));
    check(
      "保存した .md の見出しと確認用の欄が英語",
      en.md.startsWith("# Speaker-labeled transcript: synth_meeting\n") &&
        head.some((l) => l.startsWith("- Source file: ")) &&
        head.some((l) => /^- Length: [\d:]+ \/ Speakers: \d+ — Speaker [A-Z]/.test(l)) &&
        head.some((l) => l.startsWith("- Processing: speaker detection by ")) &&
        en.md.includes("## Unassigned: parts without a speaker") === hasUnresolved &&
        !/[話者確認用処理元]/.test(head.join("\n")),
      head.slice(0, 4).join(" ／ ").slice(0, 160),
    );
    const mdWho = [...new Set(speakersOf(en.md))];
    const txtWho = [...new Set(speakersOf(en.txt))];
    check(
      "保存した .md・.txt の話者が「Speaker A」など",
      mdWho.length > 0 && [...mdWho, ...txtWho].every((w) => /^Speaker [A-Z]+$/.test(w)) && en.txt.includes("Unassigned (parts without a speaker)") === hasUnresolved,
      `${mdWho.join(", ")}・確認用 ${view.unresolved.length} 件`,
    );
    const enJson = JSON.parse(en.json);
    const jsonWho = [...new Set(enJson.map((u) => u.speaker))];
    check("保存した .json の話者が「Speaker A」「Unknown」", jsonWho.every((w) => /^Speaker [A-Z]+$/.test(w) || w === "Unknown"), jsonWho.join(", "));

    // 日本語に切り替える → 画面・メニュー・保存が日本語に。本文は英語と同じ（ラベルだけ違う）
    check("言語を日本語に切り替えると画面が日本語", (await switchLocale("ja")) && (await waitFor(() => tab() === "文字起こし", 3000)), tab());
    const m1 = await menuIs(MENU_JA);
    check("Mac のメニューも日本語に作り直す（版7）", m1.ok && m1.menu[0]?.items?.[0] === "Kikiwake について", m1.menu.map((x) => x.title).join(" "));
    // 日本語で保存すると、ファイルの名前は「〈元の名前〉_文字起こし」（英語で保存したファイルとは別の名前なので、上書きの確かめは出ない）
    const jaStem = savedStem(sc.recording, JA);
    const jaSaved = await saveAndWait(JA);
    check(
      "日本語で保存（3件）→ ファイルの名前は「〈元の名前〉_文字起こし」（同じフォルダ）",
      jaSaved === "saved" && lastSaveToast === `「${jaStem}.md」ほか2件を保存しました`,
      `${jaSaved}・${lastSaveToast}`,
    );
    const ja = await read(jaStem);
    check("日本語で保存した .md は日本語の見出し", ja.md.startsWith("# 話者付き文字起こし: synth_meeting\n") && /^- 元ファイル: /m.test(ja.md), ja.md.split("\n")[0]);
    const tr = (s) => s.replace(/話者([A-Z]+)/g, "Speaker $1");
    const body = (text) => text.split("\n").filter((l) => l.startsWith("["));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const jaTxt = tr(ja.txt).replace("確認用（話者を決められなかった部分）", "Unassigned (parts without a speaker)");
    const jaJson = JSON.parse(ja.json).map((u) => ({ ...u, speaker: u.speaker === "不明" ? "Unknown" : tr(u.speaker) }));
    check(
      "英語と日本語の保存は、本文が同じでラベルと見出しだけ違う",
      same(body(ja.md).map(tr), body(en.md)) && jaTxt === en.txt && same(jaJson, enJson),
      `本文 ${body(en.md).length} 行・.json ${enJson.length} 件`,
    );
    check("英語で保存したファイルは残る（言語で名前が違う）", (await invoke("dev_exists", { path: `${out}/${enStem}.md` })) && (await invoke("dev_exists", { path: `${out}/${jaStem}.md` })));

    // 英語に戻す → メニューも英語に
    check("英語に戻すと画面が英語", (await switchLocale("en")) && (await waitFor(() => tab() === "Transcript", 3000)), tab());
    const m2 = await menuIs(MENU_EN);
    check("Mac のメニューも英語に戻る", m2.ok, m2.menu.map((x) => x.title).join(" "));
  }

  // ---- 履歴と閉じたときの状態（約束 版8・版9）。同じ作業フォルダで2回起動する（history1 → 閉じる → history2） ----------

  async function typeName(label, name) {
    const item = buttons().find((b) => norm(b.textContent).startsWith(label));
    if (!item) return null;
    item.click();
    const input = await waitFor(() => document.getElementById(`name-${label}`), 3000);
    if (input && name !== undefined) setValue(input, name);
    return input;
  }

  async function editText(id, text) {
    const span = row(id)?.querySelector('span[title="ダブルクリックで文字を直す"]');
    if (!span) return false;
    dblclick(span);
    const ta = await waitFor(() => row(id)?.querySelector("textarea"), 3000);
    if (!ta) return false;
    setValue(ta, text);
    keydown(ta, "Enter", { metaKey: true });
    return Boolean(await waitFor(() => norm(row(id)?.textContent).includes("直した"), 3000));
  }

  async function readDraft(sc, jobId) {
    try {
      return JSON.parse(await invoke("dev_read", { path: `${sc.cacheDir}/jobs/${jobId}/draft.json` }));
    } catch {
      return null;
    }
  }

  const nameOf = (path) => path.split("/").pop();
  /** 文字起こしのタブの最初の行の再生ボタン */
  const firstPlay = () => document.querySelector("[data-row-id] button");

  async function history1(sc) {
    const L = JA;
    const [n1, n2, n3, n4] = [sc.recording, sc.recording2, sc.recording3, sc.recording4].map(nameOf);
    await screen(L.newTitle, 30000);
    // 新しい版の帯を「この版は知らせない」で消す（開き直しても出ないことを history2 で見る）
    await updateCheck(true);
    // 1本目: 最後まで処理 → 名前 → 文字起こしのタブで保存 → 文字を直す（保存後に手直し）→ 話者のタブで名前を1つ入れかける
    (await chooseFile(sc.recording, L)).click();
    await waitNaming(sc, L);
    const job1 = lastDone.jobId;
    for (const [label, name] of Object.entries(sc.names)) await typeName(label, name);
    await toTab(L.transcript);
    // 前に選んだフォルダがある（Mac のフォルダを選ぶ画面は操作役から押せないので、選んだあとの記録を置く）→ 窓の選択肢に出る。
    // それを選び、.md・.json で保存する → 選んだフォルダに録音の名前入りで書く・覚える（閉じて開き直しても。history2）
    localStorage.setItem("kikiwake.save", JSON.stringify({ formats: ["md"], dir: null, recent: sc.saveDir }));
    const dlg = await openSaveDialog(L);
    const f0 = dlg ? dialogFolder(dlg) : {};
    check(
      "保存先の選択肢: 元のファイルと同じフォルダ・前に選んだフォルダ・ほかのフォルダを選ぶ…",
      dlg && f0.value === "source" && JSON.stringify(f0.options) === JSON.stringify([`元のファイルと同じフォルダ（${folderOf(sc.recording).split("/").pop()}）`, sc.saveDir.split("/").pop(), "ほかのフォルダを選ぶ…"]),
      JSON.stringify(f0.options),
    );
    let s1 = null;
    if (dlg) {
      await chooseFolder(dlg, "recent");
      await chooseFormats(dlg, ["md", "json"]);
      s1 = await confirmSave(dlg, L);
    }
    const stem = savedStem(sc.recording);
    const savedTo = ["md", "json"].map((f) => `${sc.saveDir}/${stem}.${f}`);
    const bothThere = (await invoke("dev_exists", { path: savedTo[0] })) && (await invoke("dev_exists", { path: savedTo[1] }));
    check("1本目を前に選んだフォルダへ保存（.md・.json・録音の名前入り）", s1 === "saved" && bothThere, `${s1}・${lastSaveToast}`);
    const edits = JSON.parse(await invoke("dev_read", { path: `${sc.fixtures}/edits_example.json` }));
    const [tid, text] = Object.entries(edits.texts)[0];
    check(`行 ${tid} の文字を直す →「保存後に手直し」`, (await editText(tid, text)) && headChip() === "保存後に手直し", headChip());
    await toTab(L.speakers);
    const dLabel = Object.keys(sc.names).slice(-1)[0];
    await typeName(dLabel, "入れかけの名前");
    await sleep(600);
    const d1 = await readDraft(sc, job1);
    check(
      "閉じたときの状態を作業フォルダに書く（話者のタブ・入れかけの名前・直した文字・保存したことがある・保存後に変えた・最後に保存したファイル）",
      d1?.draft?.screen === "naming" &&
        d1.draft.names?.[dLabel] === "入れかけの名前" &&
        d1.draft.textHistory?.[tid]?.slice(-1)[0] === text &&
        d1.draft.savedOnce === true &&
        d1.draft.unsaved === true &&
        JSON.stringify(d1.draft.lastSavedFiles) === JSON.stringify(savedTo),
      d1 ? `screen ${d1.draft?.screen}・savedOnce ${d1.draft?.savedOnce}・unsaved ${d1.draft?.unsaved}・lastSavedFiles ${JSON.stringify(d1.draft?.lastSavedFiles)}` : "draft.json が無い",
    );
    let prefs = null;
    try {
      prefs = JSON.parse(localStorage.getItem("kikiwake.save") || "null");
    } catch {
      prefs = null;
    }
    check("選んだ形式と保存先を覚える（.md・.json／前に選んだフォルダ）", prefs && prefs.formats.join(",") === "md,json" && prefs.dir === sc.saveDir, JSON.stringify(prefs));

    // 2本目: 始めてから1本目を開いて見ている間に、裏で最後まで終わる →「●」
    await newRecording(L);
    (await chooseFile(sc.recording2, L)).click();
    await waitFor(() => runningEntry(), 5000);
    await openEntry(n1);
    check("処理中にほかの録音を開いて見る", title() === n1 && tab() === L.speakers, `${title()}・${tab()}`);
    const done2 = await waitFor(() => doneIds.some((id) => id !== job1), sc.timeoutMin * 60000, 500);
    check("見ていない2本目が最後まで終わる", done2);
    check("見ていない間に終わった2本目に「●」", await waitFor(() => freshOf(entryOf(n2)), 5000), entryText(entryOf(n2)));

    // 3本目: 声を文字にする段階で、4本目を順番待ちに入れて閉じる → 確かめる窓（段階の文と順番待ちの一文）→「閉じる」
    await newRecording(L);
    (await chooseFile(sc.recording3, L)).click();
    const tr = await waitFor(() => stageText() === "声を文字にする", 180000, 200);
    check("3本目は声を文字にする段階まで進む", tr);
    await newRecording(L);
    (await chooseFile(sc.recording4, L, L.enqueue)).click();
    check("4本目は順番待ち", await waitFor(() => queued().length === 1, 3000));
    await sleep(800);
    await invoke("dev_close");
    const d = await waitFor(() => dialogTitle() === CLOSE_TITLE, 5000);
    const body = dialogBody();
    check(
      "閉じると確かめる（聞き分けは残り、文字にしている途中の分と、順番待ちの1件は破棄）",
      d && body.length === 2 && body[0] === CLOSE.converting(n3) && body[1] === CLOSE.queue(1),
      body.join(" ／ ").slice(0, 240),
    );
    info(`${n4} は順番待ちのまま閉じる`);
    return d ? "close" : null;
  }

  async function history2(sc) {
    const L = JA;
    const [n1, n2, n3, n4] = [sc.recording, sc.recording2, sc.recording3, sc.recording4].map(nameOf);
    await screen(L.newTitle, 30000);
    await waitFor(() => entryEls().length >= 3, 5000);
    await sleep(1500);
    check("「この版は知らせない」にした版の帯は、開き直しても出ない（約束 版10）", !document.querySelector("[data-update-band]"));
    const names = entryEls().map(entryName);
    check("閉じて開き直すと3本が一覧に出て、順番待ちの4本目は無い（破棄）・途中で閉じた3本目が一番上", names.length === 3 && !names.includes(n4) && names[0] === n3, names.join(" / "));
    check("途中で閉じた3本目は「中断」", chipOf(entryOf(n3)) === "中断", entryText(entryOf(n3)));
    check("見ていない間に終わった2本目の「●」は、閉じても残る", freshOf(entryOf(n2)), entryText(entryOf(n2)));
    check(
      "1本目は「保存後に手直し」で、付けた名前が行に出る（約束 版9）",
      chipOf(entryOf(n1)) === "保存後に手直し" && entryText(entryOf(n1)).includes("松本・田中ほか2人"),
      entryText(entryOf(n1)),
    );
    await snap(sc, "history-list");
    // 約束 版12: 閉じて開き直しても、エンジンの一覧に1本目の最後に保存したファイル（前に選んだフォルダ）。行の「…」の「Finder で表示」を押せる
    const stem = savedStem(sc.recording);
    const savedTo = ["md", "json"].map((f) => `${sc.saveDir}/${stem}.${f}`);
    const h1 = (await invoke("list_history")).find((i) => nameOf(i.path) === n1);
    check("開き直しても、エンジンの一覧に最後に保存したファイル（約束 版12）", h1 && JSON.stringify(h1.savedFiles) === JSON.stringify(savedTo), JSON.stringify(h1?.savedFiles));
    const items1 = await openRowMenu(entryOf(n1));
    check("開いていない1本目の「…」の「Finder で表示」を押せる", menuItemsText(items1) === "Finder で表示|英語で文字起こしし直す…|削除…", menuItemsText(items1));
    escape();
    await waitFor(() => !document.querySelector(".objects-row-menu"), 2000);
    // 1本目を開く → 閉じたときの話者のタブに、入れかけの名前のまま
    await openEntry(n1);
    const dLabel = Object.keys(sc.names).slice(-1)[0];
    const input = await typeName(dLabel);
    check("開き直すと、閉じたときの話者のタブで、入れかけの名前が戻る（版8）", tab() === L.speakers && input?.value === "入れかけの名前", `${tab()}・${input?.value}`);
    if (input) setValue(input, sc.names[dLabel]);
    // 「保存…」の窓は、閉じる前に選んだ形式と保存先のまま（覚えている）
    const dlg = await openSaveDialog(L);
    const f1 = dlg ? dialogFolder(dlg) : {};
    check(
      "閉じて開き直しても「保存…」の窓は前に選んだまま（.md・.json・前に選んだフォルダ）",
      dlg && JSON.stringify(dialogFormats(dlg)) === JSON.stringify([["md", true], ["txt", false], ["json", true]]) && f1.value === "recent" && f1.selected === sc.saveDir.split("/").pop(),
      dlg ? `${JSON.stringify(dialogFormats(dlg))}・${f1.selected}` : "窓が出ない",
    );
    if (dlg) [...dlg.querySelectorAll("button")].find((b) => norm(b.textContent) === "キャンセル")?.click();
    check("「キャンセル」で窓を閉じる（保存しない）", await waitFor(() => !saveDialog(), 2000) && headChip() === "保存後に手直し", headChip());
    await toTab(L.transcript);
    const edits = JSON.parse(await invoke("dev_read", { path: `${sc.fixtures}/edits_example.json` }));
    const [tid, text] = Object.entries(edits.texts)[0];
    check("直した文字が戻る（版8）", norm(row(tid)?.textContent).includes(norm(text).slice(0, 12)));
    check("元の録音があれば行を再生できる", firstPlay() && !firstPlay().disabled);
    // 2本目を開くと「●」が消える
    await openEntry(n2);
    check("開くと「●」が消える", !freshOf(entryOf(n2)));

    // 保存したファイルを移した: 開いていない1本目の「…」の「Finder で表示」→ その録音を開いて帯「保存したファイルが見つかりません」
    // （見つからないので Finder は開かない）
    await invoke("dev_rename", { from: savedTo[0], to: `${savedTo[0]}.moved` });
    const items2 = await openRowMenu(entryOf(n1));
    items2?.find((b) => norm(b.firstChild?.textContent) === "Finder で表示")?.click();
    check(
      "保存したファイルが見つからないと、その録音を開いて帯（もう一度保存すると作り直せる）",
      await waitFor(() => title() === n1 && bodyText().includes("保存したファイルが見つかりません") && bodyText().includes("もう一度保存すると作り直せます"), 10000),
      `${title()}`,
    );
    await snap(sc, "saved-missing");
    await invoke("dev_rename", { from: `${savedTo[0]}.moved`, to: savedTo[0] });

    // 元のファイルが見つからない（移した）: 一覧の行に一言。開くと帯と「ファイルを選び直す」、行の再生はできない
    await invoke("dev_rename", { from: sc.recording, to: `${sc.recording}.moved` });
    await newRecording(L);
    check("元の録音を移すと、一覧の行に「元のファイルが見つかりません」", await waitFor(() => entryText(entryOf(n1)).includes("元のファイルが見つかりません"), 5000), entryText(entryOf(n1)));
    await openEntry(n1);
    await toTab(L.transcript);
    check(
      "元のファイルが無くても開ける。帯（残っているもの・再生だけできない）と「ファイルを選び直す」、行は再生できない",
      bodyText().includes("元のファイルが見つかりません") && bodyText().includes("発言の再生だけできません") && button("ファイルを選び直す") && firstPlay()?.disabled === true,
    );
    await snap(sc, "result-missing");
    await invoke("dev_rename", { from: `${sc.recording}.moved`, to: sc.recording });

    // 元のファイルが変わった（更新日時だけ変わった）: 新しい録音として落とすと「この場所の録音は、前に文字起こししています」
    await invoke("dev_touch", { path: sc.recording });
    await newRecording(L);
    await invoke("dev_drop", { paths: [sc.recording] });
    check("変わったファイルを選ぶと「この場所の録音は、前に文字起こししています」（約束 版9）", await waitFor(() => bodyText().includes("この場所の録音は、前に文字起こししています"), 10000));
    check("一覧の1本目に「元のファイルが変わっています」（約束 版9）", await waitFor(() => entryText(entryOf(n1)).includes("元のファイルが変わっています"), 5000), entryText(entryOf(n1)));
    const pos = entryEls().indexOf(entryOf(n1));
    await openEntry(n1);
    await toTab(L.transcript);
    check("開くと帯「元のファイルが変わっています」と「このファイルで結び直す」", bodyText().includes("元のファイルが変わっています") && button("このファイルで結び直す"));
    await snap(sc, "result-changed");
    await clickWhen("このファイルで結び直す");
    check("結び直すと帯が消えて、行を再生できる", await waitFor(() => !bodyText().includes("元のファイルが変わっています") && firstPlay() && !firstPlay().disabled, 10000));
    check("結び直しても一覧の場所は変わらない（録音の ID は変わる）", await waitFor(() => entryEls().indexOf(entryOf(n1)) === pos && !entryText(entryOf(n1)).includes("元のファイル"), 5000), `${pos} → ${entryEls().indexOf(entryOf(n1))}`);

    // 行の「…」の「削除…」（2026-09-29 の2回目。前は「一覧から消す…」のごみ箱）→ 確かめる → 消える。元の録音と保存したファイルは残り、作業フォルダは消える
    const job1 = (entryOf(n1)?.getAttribute("data-entry") || "").replace(/^h:/, "");
    const items3 = await openRowMenu(entryOf(n1));
    items3?.find((b) => norm(b.textContent) === "削除…")?.click();
    const del = await waitFor(() => dialogTitle() === `「${n1}」を削除しますか？`, 3000);
    const delBody = dialogBody();
    check(
      "削除する前に確かめる（題に録音の名前。消えるもの・元に戻せない／元のファイルと保存したファイルは削除しない）",
      del &&
        delBody[0] === "この Mac に残っている文字起こし・名前・手直しを削除します。元に戻せません。" &&
        delBody[1] === "元のファイルと、保存したファイルは削除しません。" &&
        button("やめる") &&
        document.querySelector(".dialog .btn-danger") &&
        norm(document.querySelector(".dialog .btn-danger").textContent) === "削除",
      `${dialogTitle()}・${delBody.join(" ／ ")}`,
    );
    await snap(sc, "delete-dialog");
    if (del) document.querySelector(".dialog .btn-danger")?.click();
    check("削除したと知らせる", await waitFor(() => toast() === "削除しました", 3000), toast());
    await waitFor(() => !entryOf(n1), 5000);
    const recKept = await invoke("dev_exists", { path: sc.recording });
    const savedKept = (await invoke("dev_exists", { path: savedTo[0] })) && (await invoke("dev_exists", { path: savedTo[1] }));
    const jobGone = !(await invoke("dev_exists", { path: `${sc.cacheDir}/jobs/${job1}` }));
    check("削除すると一覧から消え、作業フォルダも消える。元の録音と保存したファイルは残る", !entryOf(n1) && recKept && savedKept && jobGone, `元の録音 ${recKept}・保存したファイル ${savedKept}・作業フォルダが消えた ${jobGone}`);

    // 3本目を再開（声の聞き分けの結果を使い、声を文字にするところから）
    await openEntry(n3, { wait: false });
    check("中断した録音を選ぶと「中断しています」と「再開する」", await waitFor(() => heading() === "中断しています" && button("再開する"), 5000), heading());
    await clickWhen("再開する");
    check("再開は、前回の聞き分けを使う", await waitFor(() => bodyText().includes("前回の結果を使用"), 10000));
    await waitNaming(sc, L);
    check("3本目を最後まで処理して話者のタブ", tab() === L.speakers && title() === n3, `${title()}・${tab()}`);
  }

  let sc = null;

  async function main() {
    await waitFor(() => window.__TAURI__?.core, 20000, 50);
    sc = await invoke("dev_scenario");
    await T().event.listen("job-done", (e) => {
      lastDone = e.payload;
      doneIds.push(e.payload.jobId);
    });
    say(`筋書き ${sc.name} を始める（${location.origin}）`);
    if (sc.fontFix) {
      // 手順5-3 の書体の直し方の候補を、画面の中だけで試す（ui/ は変えない）
      await waitFor(() => document.head, 5000, 20);
      window.__kkFontFix();
      info("書体の直し方の候補（日本語だけヒラギノ角ゴシック）を入れた");
    }
    if (sc.name === "boot") {
      // 起動だけ（tauri dev で開発サーバの画面を読むときの確かめ）
      const h = await waitFor(() => heading(), 20000);
      check("起動して最初の画面が出る", h, h || norm(bodyText()).slice(0, 80));
      await sleep(1000);
      if (sc.fontProbe) window.__kkFontProbe().forEach((l) => info(`書体 ${l}`));
      // Mac が実際に出しているメニュー（macOS が足す項目も入る。Mac が用意する部品の言語の確かめ）
      for (const l of await invoke("dev_native_menu")) info(`メニュー ${l}`);
    } else if (sc.name === "setup") await setupScenario();
    else if (sc.name === "en") await enScenario(sc);
    else if (sc.name === "photo") await photoScenario(sc);
    else if (sc.name === "screens") await screensScenario(sc);
    else if (sc.name === "screens2") await screens2Scenario(sc);
    else if (sc.name === "speech") await speechScenario(sc);
    else if (sc.name === "real") await realScenario(sc);
    else if (sc.name === "history1") return await history1(sc);
    else if (sc.name === "history2") await history2(sc);
    else await synthScenario(sc);
    return null;
  }

  main()
    .catch((e) => {
      check("筋書きの途中で止まった", false, String((e && e.message) || e));
      return null;
    })
    .then(async (next) => {
      const kk = window.__kk || { csp: [], errors: [] };
      check("安全の設定（CSP）で止められた読み込みが無い", kk.csp.length === 0, kk.csp.slice(0, 5).join(" / "));
      check("画面のエラーが無い", kk.errors.length === 0, kk.errors.slice(0, 5).join(" / "));
      const ng = results.filter((r) => !r.ok).length;
      const summary = `${results.length} 件中 NG ${ng} 件`;
      // history1 は、処理中の確かめで「閉じる」を押して終わる（利用者と同じ閉じ方。NG があれば押さずに終える）
      if (next === "close" && ng === 0) {
        await say(`おわり ${summary}（「閉じる」で閉じる）`);
        await clickWhen("閉じる");
        return;
      }
      await invoke("dev_done", { ok: ng === 0, summary });
    });
})();
