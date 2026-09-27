// 文字起こしのタブの計算（行・発言時間・人・行数と字数・名前の色）。文字起こしのタブと「詳細」（どちらのタブからも開く）で同じものを使う
import { useMemo } from "react";
import { FREE_NAME_COLOR, NO_NAME_COLOR, labelColors } from "../../lib/colors";
import { nameKey } from "../../lib/names";
import { buildRows, peopleOf, resultStats, talkTimes } from "../../lib/transcript";
import { useApp } from "../../store/state";

export function useTranscriptModel() {
  const view = useApp((s) => s.view);
  const lineNames = useApp((s) => s.lineNames);
  const confirmed = useApp((s) => s.confirmed);
  const textHistory = useApp((s) => s.textHistory);
  const speakers = useApp((s) => s.speakers);
  const appliedNames = useApp((s) => s.appliedNames);

  const rows = useMemo(
    () => (view ? buildRows(view, lineNames, confirmed, textHistory) : []),
    [view, lineNames, confirmed, textHistory],
  );
  const talk = useMemo(() => (view ? talkTimes(view, rows) : []), [view, rows]);
  const people = useMemo(() => peopleOf(rows, talk), [rows, talk]);
  const stats = useMemo(() => resultStats(rows), [rows]);

  // 名前の色: ラベルの色（まとめた人は最初のラベルの色）。この画面で入力した名前は灰色
  const colorOf = useMemo(() => {
    const labels = speakers.map((c) => c.label);
    const byLabel = labelColors(labels);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));
    const map = new Map<string, string>();
    for (const label of sorted) {
      const k = nameKey(appliedNames[label] || label);
      if (!map.has(k)) map.set(k, byLabel[label]);
    }
    return (name: string | null) => (name === null ? NO_NAME_COLOR : map.get(nameKey(name)) ?? FREE_NAME_COLOR);
  }, [speakers, appliedNames]);

  return { view, rows, talk, people, stats, colorOf, labelCount: speakers.length };
}
