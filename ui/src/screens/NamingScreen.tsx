// 「話者」のタブ: 名前付け（UI 画面仕様書 §7）
// 仕様書に無い「話者を決められなかった部分の名前の手がかり」（約束 版2 の getUnresolvedHints）は、
// 話者カードの下にいつも出す（2026-09-26 決定）
import { useMemo } from "react";
import { formatTimestamp } from "@contract/format";
import type { SpeakerCard, UnresolvedHint } from "@contract/types";
import { api } from "../api";
import { Bar } from "../components/Bar";
import { ErrorBand } from "../components/ErrorBand";
import { PlayProgress, SamplePlayButton } from "../components/PlayButton";
import { useT } from "../i18n";
import { labelColors } from "../lib/colors";
import { percentText, truncate } from "../lib/format";

/**
 * サンプル・確認用の手がかりの文の、画面の側の念のための上限。字数はエンジンが録音の言語でそろえて返す
 * （日本語 70 字・英語 110 字。約束 版15）ので、ここでは切り直さない（前は 70 字で、英語の 110 字を切っていた）
 */
const SAMPLE_TEXT_MAX = 120;
import { cleanName, formatHintSources, formatHints, groupNames, nameKey, type NameGrouping } from "../lib/names";
import { selectLabel, setName, stepLabel } from "../store/naming";
import { useApp } from "../store/state";

/** 候補のボタン（点線）。押すと入力欄をその名前に置き換える */
function CandidateButton({ label, onClick }: { label: string; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      title={t.naming.insertTitle}
      onClick={onClick}
      style={{
        flex: "none",
        font: "inherit",
        fontSize: 13,
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px dashed #b9bbb5",
        background: "#fafaf8",
        color: "var(--ink)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function SpeakerList({
  speakers,
  colors,
  grouping,
  names,
  selected,
}: {
  speakers: SpeakerCard[];
  colors: Record<string, string>;
  grouping: NameGrouping;
  names: Record<string, string>;
  selected: string;
}) {
  const t = useT();
  return (
    <div
      style={{
        minHeight: 0,
        overflow: "auto",
        borderRight: "1px solid var(--line)",
        background: "var(--bg-bar)",
        display: "flex",
        flexDirection: "column",
        padding: "10px 0",
      }}
    >
      {speakers.map((c) => {
        const on = c.label === selected;
        const own = cleanName(names[c.label]);
        const merged = (grouping.byLabel[c.label]?.labels.length ?? 0) > 1;
        return (
          <button
            key={c.label}
            type="button"
            onClick={() => selectLabel(c.label)}
            style={{
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "12px 20px",
              border: "none",
              borderLeft: `3px solid ${on ? "var(--accent)" : "transparent"}`,
              background: on ? "#fff" : "transparent",
              color: "var(--ink)",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="dot" style={{ width: 9, height: 9, background: colors[c.label] }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t.engine.speakerLabel(c.label)}</span>
              <span className="num" style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-3)" }}>
                {percentText(c.share)}
              </span>
            </div>
            <span style={{ fontSize: 13, color: own ? "var(--ink)" : "var(--ink-4)", paddingLeft: 17, overflowWrap: "anywhere" }}>
              {own ? own + (merged ? t.naming.merged : "") : t.naming.noName}
            </span>
            {c.warnings.length ? (
              <span style={{ fontSize: 11, color: "var(--warn-ink)", paddingLeft: 17 }}>{t.naming.hasWarning}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SpeakerDetail({
  card,
  color,
  grouping,
  names,
  durationSec,
}: {
  card: SpeakerCard;
  color: string;
  grouping: NameGrouping;
  names: Record<string, string>;
  durationSec: number;
}) {
  const t = useT();
  const value = names[card.label] ?? "";
  const key = nameKey(value);
  const group = grouping.byLabel[card.label];
  const merged = Boolean(group && group.labels.length > 1);
  const clue = formatHints(card.hints);
  const samples = [...card.samples].sort((a, b) => a.index - b.index);

  return (
    <div
      className="card"
      style={{ display: "flex", flexWrap: "wrap", gap: "20px 28px", padding: "20px 22px", borderRadius: 10 }}
    >
      {/* 左の塊（統計と注意） */}
      <div style={{ flex: "1 0 200px", maxWidth: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="dot" style={{ width: 10, height: 10, background: color }} />
          <span style={{ fontSize: 17, fontWeight: 600 }}>{t.engine.speakerLabel(card.label)}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--ink-3)" }}>{t.naming.talkTime}</span>
            <span className="num">{percentText(card.share)}</span>
          </div>
          <Bar ratio={card.share} height={4} color={color} roundFill={false} />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--ink-3)" }}>{t.naming.utterances}</span>
            <span className="num">{t.naming.times(card.utterances)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--ink-3)" }}>{t.naming.firstSeen}</span>
            <span className="num">{formatTimestamp(card.firstSec, durationSec)}</span>
          </div>
        </div>
        {card.warnings.map((w) => (
          <div key={w} className="band-warn" style={{ padding: "8px 10px", fontSize: 12, lineHeight: 1.6 }}>
            {t.naming.warning[w]}
          </div>
        ))}
      </div>

      {/* 右の塊（名前・手がかり・サンプル） */}
      <div style={{ flex: "999 1 380px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
            <label htmlFor={`name-${card.label}`} style={{ fontSize: 13, color: "var(--ink-3)", flex: "none" }}>
              {t.naming.nameLabel}
            </label>
            <input
              id={`name-${card.label}`}
              className="input"
              value={value}
              placeholder={t.naming.placeholder(t.engine.speakerLabel(card.label))}
              onChange={(e) => setName(card.label, e.target.value)}
              style={{
                flex: "1 1 180px",
                minWidth: 0,
                fontSize: 15,
                padding: "8px 12px",
                borderColor: merged ? "var(--accent)" : undefined,
              }}
            />
            {card.hints
              .filter((h) => nameKey(h.name) !== key)
              .map((h) => (
                <CandidateButton key={h.name} label={t.naming.insert(h.name)} onClick={() => setName(card.label, h.name)} />
              ))}
          </div>
          <span style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6 }}>
            {t.naming.clue}
            <span style={{ color: "var(--ink)" }}>{clue ?? t.naming.clueNone}</span>
          </span>
          {merged && group ? (
            <div className="band-info" style={{ padding: "8px 12px", borderRadius: 6, fontSize: 13, lineHeight: 1.6 }}>
              {t.naming.mergeNote(group.name, t.common.labels(group.labels.map(t.engine.speakerLabel)))}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {samples.map((s) => {
            const playKey = `sample:${card.label}:${s.index}`;
            return (
              <div
                key={s.index}
                style={{
                  display: "grid",
                  gridTemplateColumns: "36px 76px 64px minmax(0, 1fr)",
                  gap: 10,
                  alignItems: "center",
                  padding: "9px 0",
                  borderTop: "1px solid var(--line-soft)",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t.naming.position(s.index)}</span>
                <SamplePlayButton playKey={playKey} src={() => api.audioSrc(s.audioPath)} />
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {formatTimestamp(s.start, durationSec)}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                  <span style={{ fontSize: 14, lineHeight: 1.6 }}>{truncate(s.text, SAMPLE_TEXT_MAX)}</span>
                  <PlayProgress playKey={playKey} />
                </div>
              </div>
            );
          })}
          {samples.length === 0 ? (
            <div style={{ padding: "9px 0", borderTop: "1px solid var(--line-soft)", fontSize: 13, color: "var(--ink-4)" }}>
              {t.naming.noSamples}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 話者を決められなかった部分の名前の手がかり（約束 版2。仕様書に無いので足した枠） */
function UnresolvedHints({
  hints,
  selected,
  names,
  durationSec,
}: {
  hints: UnresolvedHint[];
  selected: string;
  names: Record<string, string>;
  durationSec: number;
}) {
  const t = useT();
  if (!hints.length) return null;
  const currentKey = nameKey(names[selected]);
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "18px 22px", borderRadius: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>{t.naming.hintsTitle}</h2>
        <p className="pretty" style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6 }}>
          {t.naming.hintsLead}
        </p>
      </div>
      {hints.map((h, hi) => (
        <div key={`${h.name}-${hi}`} style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--line-soft)", paddingTop: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
            <span style={{ fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>{h.name}</span>
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{t.naming.hint("", formatHintSources(h.sources))}</span>
            </span>
            {nameKey(h.name) !== currentKey ? (
              <CandidateButton label={t.naming.insertInto(h.name, t.engine.speakerLabel(selected))} onClick={() => setName(selected, h.name)} />
            ) : null}
          </div>
          {h.clips.map((c, ci) => {
            const playKey = `hint:${hi}:${ci}`;
            return (
              <div
                key={ci}
                style={{ display: "grid", gridTemplateColumns: "76px 64px minmax(0, 1fr)", gap: 10, alignItems: "center", padding: "9px 0" }}
              >
                <SamplePlayButton playKey={playKey} src={() => api.audioSrc(c.audioPath)} />
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {formatTimestamp(c.start, durationSec)}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                  <span style={{ fontSize: 14, lineHeight: 1.6 }}>{truncate(c.text, SAMPLE_TEXT_MAX)}</span>
                  <PlayProgress playKey={playKey} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

/**
 * 録音が主役の画面の「話者」のタブの中。題は録音の上の段にあり、下の帯は保存だけ（「話者」「文字起こし」はタブで切り替え、
 * 名前を付けなくても保存できる。2026-09-27 決定）
 */
export function NamingScreen() {
  const t = useT();
  const speakers = useApp((s) => s.speakers);
  const hints = useApp((s) => s.hints);
  const names = useApp((s) => s.names);
  const selectedState = useApp((s) => s.selectedLabel);
  const applyError = useApp((s) => s.applyError);
  const durationSec = useApp((s) => s.file?.durationSec ?? s.view?.durationSec ?? 0);

  const order = useMemo(() => speakers.map((c) => c.label), [speakers]);
  const colors = useMemo(() => labelColors(order), [order]);
  const grouping = useMemo(() => groupNames(order, names), [order, names]);
  const selected = order.includes(selectedState ?? "") ? (selectedState as string) : order[0];
  const card = speakers.find((c) => c.label === selected);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          flex: "none",
          padding: "12px 32px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <p className="pretty" style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.7 }}>
          {t.naming.lead}
        </p>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)" }}>
        <SpeakerList speakers={speakers} colors={colors} grouping={grouping} names={names} selected={selected} />
        <div style={{ minHeight: 0, overflow: "auto", padding: "20px 32px 28px" }}>
          {card ? (
            <div style={{ maxWidth: 960, display: "flex", flexDirection: "column", gap: 14 }}>
              <SpeakerDetail card={card} color={colors[card.label]} grouping={grouping} names={names} durationSec={durationSec} />
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button type="button" className="btn btn-mid" onClick={() => stepLabel(-1)}>
                  {t.naming.prev}
                </button>
                <button type="button" className="btn btn-mid" onClick={() => stepLabel(1)}>
                  {t.naming.next}
                </button>
              </div>
              <UnresolvedHints hints={hints} selected={card.label} names={names} durationSec={durationSec} />
            </div>
          ) : null}
        </div>
      </div>

      {applyError ? (
        <div style={{ flex: "none", padding: "10px 32px", borderTop: "1px solid var(--line)", background: "var(--bg-bar)" }}>
          <ErrorBand error={applyError} small />
        </div>
      ) : null}

    </div>
  );
}
