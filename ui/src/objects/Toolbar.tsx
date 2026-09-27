// 録音が主役の画面: 右の一番上の帯。開いている録音の名前と状態の印。一覧をしまったとき・狭い窓では、一覧を出すボタン。
// 右端には言語の切り替え（製品にもある）が重なるので、そのぶん空ける（見本では開発用のボタンも重なる）
import { useT } from "../i18n";
import { basename } from "../lib/format";
import { useApp } from "../store/state";
import { SidebarIcon } from "./icons";
import { statusOf, toneOf } from "./model";
import { useCurrentEntry, useLive } from "./selection";
import { setOverlay, toggleCollapsed, useObjects } from "./store";
import { StatusChip } from "./StatusChip";

export function Toolbar({ wide, dev }: { wide: boolean; dev: boolean }) {
  const t = useT();
  const collapsed = useObjects((s) => s.collapsed);
  const peek = useObjects((s) => s.peek);
  const opening = useObjects((s) => s.opening);
  const openError = useObjects((s) => s.openError);
  const screen = useApp((s) => s.screen);
  const job = useApp((s) => s.job);
  const entry = useCurrentEntry();
  const { live } = useLive(entry);
  const showToggle = !wide || collapsed;
  const recording = Boolean(peek || opening || openError || ((screen === "processing" || screen === "naming" || screen === "result") && job));

  let name = "";
  if (entry?.kind === "history") name = entry.item.name;
  else if (entry?.kind === "running") name = entry.name;
  else if (entry?.kind === "queued") name = entry.item.name;
  else if (job) name = basename(job.path);

  return (
    <div className={`objects-toolbar${showToggle ? " with-toggle" : ""}${dev ? " dev" : ""}`}>
      {showToggle ? (
        <button
          type="button"
          className="objects-icon-btn"
          title={t.objects.expand}
          aria-label={t.objects.expand}
          onClick={() => (wide ? toggleCollapsed() : setOverlay(true))}
        >
          <SidebarIcon />
        </button>
      ) : null}
      {recording && name ? (
        <>
          <span className="objects-title" title={name}>
            {name}
          </span>
          {entry ? <StatusChip status={statusOf(entry, live)} tone={toneOf(statusOf(entry, live))} /> : null}
        </>
      ) : null}
    </div>
  );
}
