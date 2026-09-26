// 操作役（開発用のビルドだけ。src-tauri/src/dev.rs が画面の読み込みの初めに入れる。ui/ のファイルは触らない）。
// 画面（製品と同じビルド）のボタンを文言で探して押し、入力し、画面の文と件数を読む。筋書きは scripts/e2e_mac.sh が作る JSON。
//   setup  準備の画面: 足りないモデルを取る（途中で中断して続きから）→ ファイルの画面へ
//   synth  合成会議で5画面: ドロップ → 処理中の閉じる確認・中止とやり直し → 名前付け（サンプルの再生・名前）→
//          結果（行の再生・保存・見本と比べる・手直し・上書きの確認・画面を通さずに保存したものと比べる）→ 別の録音へ → 同じ録音を選び直す
//   real   実録音（quiet: 中身は出さず、時間と件数だけ）
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

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const buttons = () => [...document.querySelectorAll("button")];
  const button = (label) => buttons().find((b) => norm(b.textContent) === label);
  const buttonHas = (part) => buttons().find((b) => norm(b.textContent).includes(part));
  const heading = () => norm(document.querySelector("h1")?.textContent);
  const bodyText = () => document.body.innerText;
  const dialogTitle = () => norm(document.querySelector(".dialog-title")?.textContent);
  const row = (id) => document.querySelector(`[data-row-id="${id}"]`);
  /** 工程バーの並びと状態（「1ファイル:current」など。状態が無ければ「まだ」） */
  const stepStates = () =>
    [...document.querySelectorAll(".stepbar .step")].map((b) => {
      const st = ["current", "done"].find((c) => b.classList.contains(c)) || "まだ";
      return `${norm(b.textContent).replace(/\s+/g, "")}:${st}`;
    });

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
    if (!b) throw new Error(`ボタン「${label}」が出ない（画面は「${heading()}」）`);
    b.click();
    return b;
  }

  async function screen(title, ms = 10000) {
    const ok = await waitFor(() => heading() === title, ms, 200);
    if (!ok) throw new Error(`「${title}」の画面にならない（今は「${heading()}」）`);
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

  /**
   * 結果の画面の右上の「完了」→ 完了の画面（工程の外。2026-09-26 決定）。題・帯・工程バー（4つとも「済んだ」）を確かめる。
   * expect: "saved"（保存した）/"unsaved"（まだ保存していない）/"edits"（保存していない手直しがある）
   */
  async function finishCheck(expect, label) {
    await clickWhen("完了");
    await screen(expect === "saved" ? "文字起こしを保存しました" : "文字起こしを終えました", 5000);
    const band = norm(document.querySelector(".band-warn span, .band-info span")?.textContent);
    const wantBand = { saved: "", unsaved: "まだ保存していません", edits: "保存していない手直しがあります" }[expect];
    const steps = stepStates().join(" ");
    check(
      `完了の画面（${label}）`,
      band === wantBand && steps === "1ファイル:done 2処理:done 3名前付け:done 4結果:done",
      `帯「${band || "なし"}」・工程 ${steps}`,
    );
    return true;
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
  let doneAt = 0;

  // ---- 準備の画面 ------------------------------------------------------------------------

  async function setupScenario() {
    await screen("はじめに準備をします", 20000);
    check("起動して準備の画面", true);
    // 準備は工程に入れない（2026-09-26）。準備の画面では工程バーの4つとも「まだ」
    const before = stepStates().join(" ");
    check("準備の画面では工程バーの4つとも「まだ」", before === "1ファイル:まだ 2処理:まだ 3名前付け:まだ 4結果:まだ", before);
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
    await clickWhen("次へ");
    await screen("録音を選ぶ");
    const after = stepStates().join(" ");
    check("「次へ」でファイルの画面・工程は「1 ファイル」から", after.startsWith("1ファイル:current 2処理:まだ"), after);
  }

  // ---- 5画面を通す -------------------------------------------------------------------------

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
  }

  async function chooseFile(sc) {
    await invoke("dev_drop", { paths: [sc.recording] });
    const start = await waitFor(() => button("文字起こしを始める"), 20000);
    const name = sc.recording.split("/").pop();
    check("ドロップでファイルの確認", start && bodyText().includes(name), start ? "" : norm(bodyText()).slice(0, 120));
    return start;
  }

  async function processing(sc) {
    await screen("文字起こし中", 5000);
    if (sc.name === "synth") {
      // 処理中に閉じる → 確かめる →「処理を続ける」
      await sleep(1500);
      await invoke("dev_close");
      const d = await waitFor(() => dialogTitle() === "処理中です。閉じますか？", 5000);
      check("処理中に閉じようとすると確かめる", d);
      if (d) {
        await clickWhen("処理を続ける");
        await sleep(500);
        check("「処理を続ける」で処理が続く", !dialogTitle() && heading() === "文字起こし中");
      }
      // 書き起こしに入ったら中止 → やり直す（話者の判定を使い回す）
      const tr = await waitFor(() => norm(document.querySelector(".page-scroll .card span")?.textContent) === "書き起こし", 180000, 200);
      check("書き起こしの段階に進む", tr);
      await sleep(2000);
      await clickWhen("中止");
      await waitFor(() => dialogTitle() === "処理を中止しますか？", 5000);
      await clickWhen("中止する");
      await screen("中止しました", 20000);
      check("中止すると話者の判定の結果が残る", bodyText().includes("話者の判定の結果は残っています"));
      await clickWhen("やり直す");
      await screen("文字起こし中", 5000);
      check("やり直すと前回の話者判定を使う", await waitFor(() => bodyText().includes("前回の結果を使用"), 10000));
    }
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
        return heading() === "話者に名前を付ける" || heading() === "途中で止まりました";
      },
      (sc.timeoutMin || 20) * 60000,
      500,
    );
    if (heading() === "途中で止まりました") throw new Error(`処理が止まった: ${norm(document.querySelector('[role="alert"]')?.textContent)}`);
    if (!ok) throw new Error("処理が終わらない");
    check("処理が終わって名前付けの画面", true, `${fmt((Date.now() - t0) / 1000)} 秒・書き起こしの％の表示 ${pcts.size} 通り`);
  }

  async function namingScreen(sc) {
    await snap(sc, "naming");
    const labels = [...new Set(buttons().map((b) => norm(b.textContent).match(/^(話者[A-Z]+)/)?.[1]).filter(Boolean))];
    check("話者カードの数", !sc.expectSpeakers || labels.length === sc.expectSpeakers, `${labels.length} 人（エンジンは ${lastDone?.speakers}）`);
    if (sc.expectHints) check("確認用の名前の手がかりの枠", bodyText().includes("話者を決められなかった部分の名前の手がかり"));
    const play = buttonHas("▶ 再生");
    if (check("サンプルの再生ボタン", play)) {
      await checkPlay("サンプル", play, sc.quiet);
      const stop = button("■ 停止");
      if (stop) stop.click();
    }
    for (const [label, name] of Object.entries(sc.names || {})) {
      const item = buttons().find((b) => norm(b.textContent).startsWith(label));
      if (!item) {
        check(`${label} を選ぶ`, false);
        continue;
      }
      item.click();
      const input = await waitFor(() => document.getElementById(`name-${label}`), 3000);
      if (!check(`${label} の名前の欄`, input)) continue;
      setValue(input, name);
    }
    if (sc.names) {
      await sleep(200);
      const shown = Object.values(sc.names).filter((n) => buttons().some((b) => norm(b.textContent).includes(n))).length;
      check("入れた名前が話者の一覧に出る", shown === Object.keys(sc.names).length, `${shown} 人`);
    }
  }

  async function resultScreen(sc) {
    await clickWhen("文字起こしを見る →");
    await screen("文字起こし", 20000);
    const jobId = lastDone.jobId;
    const view = await invoke("get_transcript", { jobId, named: Boolean(sc.names) });
    const lines = view.utterances.length + view.unresolved.length;
    check("結果の画面の行数がエンジンと同じ", bodyText().includes(`${lines.toLocaleString()}行`), `${lines} 行（本文 ${view.utterances.length}・確認用 ${view.unresolved.length}）`);
    const first = view.utterances[0];
    const r0 = await waitFor(() => row(first.id), 5000);
    check("最初の行の文字がエンジンと同じ", r0 && norm(r0.textContent).includes(norm(first.text).slice(0, 12)));
    await snap(sc, "result");
    const playRow = r0?.querySelector("button");
    if (check("行の再生ボタン", playRow)) {
      await checkPlay("行", playRow, sc.quiet);
      if (norm(playRow.textContent) === "■") playRow.click();
    }
    return { jobId, view };
  }

  async function saveAndWait(expectCount) {
    await clickWhen("保存");
    const r = await waitFor(() => (dialogTitle() === "同じ名前のファイルがあります" ? "dialog" : bodyText().includes("保存しました") ? "saved" : null), 15000);
    return r;
  }

  async function synthResult(sc, jobId) {
    const out = lastDone.outDir;
    const fx = sc.fixtures;
    // 保存しないで「完了」→「まだ保存していません」→「← 文字起こしに戻る」
    await finishCheck("unsaved", "保存しないで");
    await clickWhen("← 文字起こしに戻る");
    await screen("文字起こし", 5000);
    // 1 回目: 手直しなしで .md と .txt → 見本（Python 版と同じ中身）と比べる
    await clickWhen(".txt");
    const r1 = await saveAndWait();
    check("手直しなしの保存（.md・.txt）", r1 === "saved", norm(bodyText().match(/保存しました[^\n]*/)?.[0]));
    await compareFile("保存した .md が見本と同じ（題・元ファイル・処理日を除く）", `${out}/transcript_named.md`, await invoke("dev_read", { path: `${fx}/saved_files/transcript_named.md` }), normalizeMd);
    await compareFile("保存した .txt が見本と同じ", `${out}/transcript_named.txt`, await invoke("dev_read", { path: `${fx}/saved_files/transcript_named.txt` }));

    // 手直し（contract/fixtures/edits_example.json と同じ3つ）を画面で行う
    const edits = JSON.parse(await invoke("dev_read", { path: `${fx}/edits_example.json` }));
    const [tid, text] = Object.entries(edits.texts)[0];
    const span = row(tid)?.querySelector('span[title="ダブルクリックで文字を直す"]');
    if (check(`行 ${tid} の文字を直す欄`, span)) {
      dblclick(span);
      const ta = await waitFor(() => row(tid)?.querySelector("textarea"), 3000);
      if (ta) {
        setValue(ta, text);
        keydown(ta, "Enter", { metaKey: true });
      }
      check(`行 ${tid} の文字を直した（⌘+Enter）`, await waitFor(() => norm(row(tid)?.textContent).includes("直した"), 3000));
    }
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
      await clickWhen("確定して一覧から外す");
      check("確認用の行を確定", await waitFor(() => bodyText().includes(`${edits.confirmed.length}件を確定しました`), 3000));
    }

    // 手直しを残して「完了」→ 注意の帯 →「← 文字起こしに戻る」
    await finishCheck("edits", "手直しを残して");
    await clickWhen("← 文字起こしに戻る");
    await screen("文字起こし", 5000);
    // 版6: 保存していない手直しがあるときに閉じると確かめる（エンジンが setUnsavedChanges(true) を受けて閉じるのを止める）→「やめる」
    await sleep(300);
    await invoke("dev_close");
    const d = await waitFor(() => dialogTitle() === "保存していない手直しがあります。閉じますか？", 5000);
    check("保存していない手直しがあるときに閉じると確かめる（版6）", d);
    if (d) {
      await clickWhen("やめる");
      await sleep(300);
      check("「やめる」で閉じずに結果の画面のまま", !dialogTitle() && heading() === "文字起こし");
    }

    // 2 回目: .json も足して保存 → 同じ名前のファイルがあるので確かめる →「上書きする」
    await clickWhen(".json");
    const r2 = await saveAndWait();
    check("同じ名前のファイルがあると確かめる", r2 === "dialog");
    if (r2 === "dialog") {
      await clickWhen("上書きする");
      check("上書きして保存（3件）", await waitFor(() => bodyText().includes("保存しました（3件）"), 15000));
    }
    // 画面を通さずに、同じ手直しをエンジンで保存したもの（約束の saveOutputs）と一字一句比べる
    const ref = await invoke("save_outputs", { jobId, req: { dir: sc.refDir, formats: ["md", "txt", "json"], edits, overwrite: true } });
    for (const f of ref.files) {
      const base = f.split("/").pop();
      await compareFile(`手直しを当てた ${base} が、同じ手直しをエンジンで保存したものと同じ`, `${out}/${base}`, await invoke("dev_read", { path: f }));
    }
    // 見本は Phase 0 のコマンド版の話者判定から作った。アプリの kikiwake-diar は区間の境目が 4 か所 10ms 違う（決定済み）ので、
    // 手直しで発言時間を数え直す見出しの「長さ・話者」の行は、秒の繰り上がりが見本と分かれることがある（田中 41.99 秒と 42.00 秒）。その行は参考に出す
    const editedMd = await invoke("dev_read", { path: `${fx}/saved_files/edited/transcript_named.md` });
    const talkLine = (md) => md.match(/^- 長さ: .*$/m)?.[0] ?? "";
    await compareFile("手直しを当てた .md の本文が見本と同じ（見出しの題・元ファイル・処理日・発言時間を除く）", `${out}/transcript_named.md`, editedMd, (md) => normalizeMd(md).replace(/^- 長さ: .*$/m, "- 長さ: *"));
    const gotTalk = talkLine(await invoke("dev_read", { path: `${out}/transcript_named.md` }));
    info(`発言時間の行: ${gotTalk === talkLine(editedMd) ? "見本と同じ" : `アプリ「${gotTalk.slice(4, 80)}」／見本「${talkLine(editedMd).slice(4, 80)}」`}`);
    await compareFile("手直しを当てた .json が見本と同じ", `${out}/transcript_named.json`, await invoke("dev_read", { path: `${fx}/saved_files/edited/transcript_named.json` }));
    // 保存してから「完了」→「文字起こしを保存しました」と保存したファイル
    await finishCheck("saved", "保存してから");
    const card = norm(document.querySelector(".card")?.textContent);
    check("完了の画面に保存したファイルが出る", ["transcript_named.md", "transcript_named.txt", "transcript_named.json"].every((f) => card.includes(f)), card.slice(0, 80));
    await snap(sc, "done");
  }

  /** 完了の画面の「別の録音を文字起こしする」で別の録音へ移り、同じ録音を選び直す（結果の画面にいれば、先に右上の「完了」） */
  async function reopen(sc) {
    check("工程バーの「1 ファイル」（別の録音を選ぶ）も押せる", document.querySelector('button[title="別の録音を選ぶ"]'));
    if (heading() === "文字起こし") await finishCheck("unsaved", "保存しないで");
    await clickWhen("別の録音を文字起こしする");
    await screen("録音を選ぶ", 5000);
    check("手直しが無ければ確かめずにファイルの画面へ", !dialogTitle());
    const start = await chooseFile(sc);
    if (!start) return;
    const prevText = norm(document.querySelector(".band-info")?.textContent);
    check("前回の結果を使うと知らせる（版6）", prevText.startsWith("前回の結果を使います"), prevText);
    await snap(sc, "file-reopen");
    const estimate = norm(bodyText().match(/所要時間の目安\s*[^\n]*/)?.[0] || "");
    check("所要時間の目安が「すぐに終わります」（版6）", estimate.includes("すぐに終わります"), estimate);
    const t0 = Date.now();
    start.click();
    await screen("話者に名前を付ける", (sc.timeoutMin || 20) * 60000);
    const sec = (Date.now() - t0) / 1000;
    check("選び直すと書き起こしをやり直さずに名前付けの画面へ（版6）", sec < 5, `${fmt(sec)} 秒（画面が名前付けへ移る前に 0.5 秒おく分を含む）`);
    const want = Object.entries(sc.names || {});
    const filled = want.filter(([l, n]) => buttons().some((b) => norm(b.textContent).startsWith(l) && norm(b.textContent).includes(n))).length;
    check("前回の名前が入っている（版6）", filled === want.length, `${filled}／${want.length} 人${lastDone?.names ? "" : "（エンジンの知らせに names が無い）"}`);
  }

  async function mainScenario(sc) {
    await screen("録音を選ぶ", 30000);
    check("起動してファイルの画面", true);
    info(`安全な文脈 ${window.isSecureContext}・navigator.clipboard ${Boolean(navigator.clipboard?.writeText)}`);
    await snap(sc, "file-empty");
    await dragCheck();
    const start = await chooseFile(sc);
    if (!start) return;
    await snap(sc, "file-selected");
    start.click();
    await processing(sc);
    await namingScreen(sc);
    const { jobId } = await resultScreen(sc);
    if (sc.name === "synth") await synthResult(sc, jobId);
    if (sc.reopen) await reopen(sc);
  }

  let sc = null;

  async function main() {
    await waitFor(() => window.__TAURI__?.core, 20000, 50);
    sc = await invoke("dev_scenario");
    await T().event.listen("job-done", (e) => {
      lastDone = e.payload;
      doneAt = Date.now();
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
    } else if (sc.name === "setup") await setupScenario();
    else await mainScenario(sc);
  }

  main()
    .catch((e) => check("筋書きの途中で止まった", false, String((e && e.message) || e)))
    .finally(async () => {
      const kk = window.__kk || { csp: [], errors: [] };
      check("安全の設定（CSP）で止められた読み込みが無い", kk.csp.length === 0, kk.csp.slice(0, 5).join(" / "));
      check("画面のエラーが無い", kk.errors.length === 0, kk.errors.slice(0, 5).join(" / "));
      const ng = results.filter((r) => !r.ok).length;
      await invoke("dev_done", { ok: ng === 0, summary: `${results.length} 件中 NG ${ng} 件` });
    });
})();
