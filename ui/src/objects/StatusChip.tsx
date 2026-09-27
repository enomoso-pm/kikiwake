// 案A: 録音の状態の印（一覧の行と、録音の上の段で同じもの）
import { useT } from "../i18n";
import type { Status, Tone } from "./model";

export function StatusChip({ status, tone }: { status: Status; tone: Tone }) {
  const t = useT().objects.status;
  const text = status.id === "running" ? t.running(status.percent) : status.id === "queued" ? t.queued(status.position) : t[status.id];
  return <span className={`objects-chip ${tone}`}>{text}</span>;
}
