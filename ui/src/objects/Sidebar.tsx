// 録音が主役の画面の左の一覧: 「＋ 新しい録音」・録音（処理中・順番待ち・履歴）・「AI モデルと動作条件」。
// 行は録音1つ。名前・日付・長さ・話者（名前を付けていれば「松本・田中ほか2人」）と、状態の印を1つ、元のファイルに問題があれば一言。
// 前に文字起こしした録音の行には、右上に「…」（選んでいる行はいつも、ほかの行は指したときに出す）。中は「Finder で表示」（保存したファイル）と
// 「削除…」（2026-09-29 の2回目。前はごみ箱だけ。押すと今までと同じ確かめの画面。元の録音と保存したファイルは削除しない）。objects/RowMenu
import { useState } from "react";
import { useT } from "../i18n";
import { formatClock, formatMonthDay } from "../lib/format";
import { useApp } from "../store/state";
import { PlusIcon, SidebarIcon, SlidersIcon } from "./icons";
import { namedOf, peopleOf, shownPeople, sourceOf, statusOf, toneOf, type Entry } from "./model";
import { RowMenu } from "./RowMenu";
import { useEntries, useLive, useSelectedKey } from "./selection";
import { selectEntry, selectNew, selectSettings, toggleCollapsed, useObjects } from "./store";
import { StatusChip } from "./StatusChip";

function EntryRow({ entry, selected }: { entry: Entry; selected: boolean }) {
  const t = useT();
  const o = t.objects;
  const { live, playable } = useLive(entry);
  const fresh = useObjects((s) => entry.kind === "history" && s.fresh.includes(entry.item.jobId));
  const [menuOpen, setMenuOpen] = useState(false);
  const status = statusOf(entry, live);
  const source = sourceOf(entry, playable);
  let name: string;
  let meta: string[];
  if (entry.kind === "running") {
    name = entry.name;
    meta = [t.engine.stage(entry.job.stage), entry.durationSec > 0 ? formatClock(entry.durationSec) : ""];
  } else if (entry.kind === "queued") {
    name = entry.item.name;
    meta = [entry.item.durationSec > 0 ? formatClock(entry.item.durationSec) : ""];
  } else {
    const it = entry.item;
    const people = peopleOf(entry, live);
    const who = people ? shownPeople(people) : null;
    name = it.name;
    meta = [
      formatMonthDay(it.processedAt) ?? "",
      it.durationSec > 0 ? formatClock(it.durationSec) : "",
      // 名前を付けていれば「松本・田中ほか2人」（約束 版9。2026-09-27 決定）、無ければ「話者 4・名前なし」
      who ? o.people(who.shown, who.rest) : it.speakers != null ? o.speakers(it.speakers, namedOf(entry, live)) : "",
    ];
  }
  const warn = entry.kind === "history" && source !== "ok" ? (source === "changed" ? o.source.changed : o.source.missing) : null;
  const hasMenu = entry.kind === "history";
  return (
    <div className={`objects-row${selected ? " selected" : ""}${hasMenu ? " has-menu" : ""}${menuOpen ? " menu-open" : ""}`}>
      <button
        type="button"
        className={`objects-item${selected ? " selected" : ""}`}
        data-entry={entry.key}
        aria-current={selected ? "true" : undefined}
        onClick={() => void selectEntry(entry)}
      >
        <span className="objects-item-title">
          {fresh ? <span className="objects-fresh" role="img" aria-label={o.fresh} title={o.fresh} /> : null}
          <span className="objects-item-name ellipsis" title={name}>
            {name}
          </span>
        </span>
        <span className="objects-item-meta num ellipsis">{o.meta(meta.filter(Boolean))}</span>
        <StatusChip status={status} tone={toneOf(status)} />
        {entry.kind === "running" && entry.job.stage === "transcribe" ? (
          <span className="objects-progress" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(0, entry.job.percent))}%` }} />
          </span>
        ) : null}
        {warn ? <span className="objects-item-warn">{warn}</span> : null}
      </button>
      {entry.kind === "history" ? <RowMenu entry={entry} name={name} onOpenChange={setMenuOpen} /> : null}
    </div>
  );
}

export function Sidebar({ overlay }: { overlay: boolean }) {
  const t = useT();
  const o = t.objects;
  const history = useApp((s) => s.history);
  const entries = useEntries();
  const selected = useSelectedKey();

  const count = entries.length;

  return (
    <nav className={`objects-sidebar${overlay ? " overlay" : ""}`} aria-label={o.listAria}>
      <div className="objects-side-head">
        <span className="objects-brand">{o.brand}</span>
        {!overlay ? (
          <button type="button" className="objects-icon-btn" title={o.collapse} aria-label={o.collapse} onClick={toggleCollapsed}>
            <SidebarIcon />
          </button>
        ) : null}
      </div>
      <button type="button" className={`objects-new${selected === "new" ? " selected" : ""}`} onClick={selectNew}>
        <PlusIcon />
        {o.newRecording}
      </button>
      <div className="objects-section">
        <span>{o.listTitle}</span>
        {count ? <span className="num">{o.listCount(count)}</span> : null}
      </div>
      <div className="objects-list">
        {history && !count ? <p className="objects-empty">{o.empty}</p> : null}
        {entries.map((e) => (
          <EntryRow key={e.key} entry={e} selected={selected === e.key} />
        ))}
      </div>
      <div className="objects-side-foot">
        <button type="button" className={`objects-foot-btn${selected === "settings" ? " selected" : ""}`} onClick={() => void selectSettings()}>
          <SlidersIcon />
          {o.settings}
        </button>
      </div>
    </nav>
  );
}
