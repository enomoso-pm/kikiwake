// 画面1 準備（UI 画面仕様書 §4）
import type { EnvironmentCheck, EnvironmentItem, ModelInfo } from "@contract/types";
import { Bar } from "../components/Bar";
import { ErrorBand } from "../components/ErrorBand";
import { formatModelSize, formatProgressBytes } from "../lib/format";
import {
  MODEL_ROLE,
  allModelsReady,
  isDownloading,
  leaveSetup,
  pauseDownload,
  startDownload,
} from "../store/setup";
import { useApp } from "../store/state";

const ENV_LABEL: Record<EnvironmentItem["id"], string> = {
  os: "OS",
  cpu: "チップ",
  memory: "メモリ",
  disk: "空き容量",
  gpu: "GPU",
};

const LEVEL: Record<EnvironmentItem["level"], { badge: string; ink: string; bg: string; message: string }> = {
  ok: { badge: "問題なし", ink: "var(--ok-ink)", bg: "var(--ok-bg)", message: "var(--ink-3)" },
  warn: { badge: "注意", ink: "var(--warn-ink)", bg: "var(--warn-bg)", message: "var(--warn-ink)" },
  error: { badge: "不可", ink: "var(--err-ink)", bg: "var(--err-bg)", message: "var(--err-ink)" },
};

function gb(n: number): string {
  return Number.isInteger(n) ? `${n} GB` : `${n.toFixed(1)} GB`;
}

/** 値の列（表示文は値を繰り返さないので、値はここで出す） */
function envValue(env: EnvironmentCheck, id: EnvironmentItem["id"]): string {
  switch (id) {
    case "os":
      return env.os === "macos" ? `macOS ${env.osVersion}` : `Windows ${env.osVersion}`;
    case "cpu":
      return env.cpu;
    case "memory":
      return gb(env.memoryGB);
    case "disk":
      return `${env.freeDiskGB.toFixed(1)} GB`;
    case "gpu":
      return env.gpu.name;
  }
}

function modelTitle(m: ModelInfo): string {
  const role = MODEL_ROLE[m.id];
  return role ? `${role}（${m.label}モデル）` : m.label;
}

function modelStatus(m: ModelInfo): { text: string; color: string; ratio: number; bar: string } {
  const ratio = m.sizeBytes > 0 ? m.downloadedBytes / m.sizeBytes : 0;
  const bytes = formatProgressBytes(m.downloadedBytes, m.sizeBytes);
  const pct = Math.floor(ratio * 100);
  switch (m.state) {
    case "missing":
      return { text: "まだダウンロードしていません", color: "var(--ink-3)", ratio: 0, bar: "var(--accent)" };
    case "downloading":
      return { text: `ダウンロード中　${bytes}（${pct}%）`, color: "var(--accent)", ratio, bar: "var(--accent)" };
    case "partial":
      return { text: `中断中　${bytes}　— 続きから再開できます`, color: "var(--ink-3)", ratio, bar: "var(--paused-bar)" };
    case "verifying":
      return {
        text: "確認中　ダウンロードしたファイルが壊れていないか確かめています",
        color: "var(--accent)",
        ratio: 1,
        bar: "var(--accent)",
      };
    case "ready":
      return { text: "ダウンロード済み", color: "var(--ok-ink)", ratio: 1, bar: "var(--ok-bar)" };
    case "error":
      return { text: `失敗　${bytes}　— 続きから再開できます`, color: "var(--err-ink)", ratio, bar: "var(--err-bar)" };
  }
}

export function SetupScreen() {
  const env = useApp((s) => s.env);
  const models = useApp((s) => s.models);
  const setupError = useApp((s) => s.setupError);

  const blocked = !env || !env.canRun || env.checks.some((c) => c.level === "error");
  const busy = isDownloading(models);
  const verifying = models.some((m) => m.state === "verifying");
  const allReady = allModelsReady(models);
  const resumable = models.some((m) => m.state === "partial" || m.state === "error");
  const total = models.reduce((a, m) => a + m.sizeBytes, 0);
  const remaining = models.filter((m) => m.state !== "ready").reduce((a, m) => a + m.sizeBytes, 0);

  let primary: { label: string; onClick?: () => void };
  if (allReady) primary = { label: "次へ", onClick: leaveSetup };
  else if (busy) primary = { label: "次へ" };
  else if (resumable) primary = { label: "続きからダウンロードする", onClick: () => void startDownload() };
  else primary = { label: `ダウンロードする（合計 ${formatModelSize(remaining)}）`, onClick: () => void startDownload() };
  const primaryDisabled = blocked || !primary.onClick;

  return (
    <div className="page-scroll">
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 32px 40px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>はじめに準備をします</h1>
          <p className="pretty" style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.75 }}>
            この PC で動くかを確かめ、文字起こしに使う AI モデルをダウンロードします。ダウンロードは初回だけで、その後はネットにつながなくても動きます。録音と文字起こしは、この
            PC の外に出しません。
          </p>
        </div>

        {setupError ? <ErrorBand error={setupError} /> : null}

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>動作条件</h2>
            <p className="pretty" style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.7 }}>
              文字起こしはこの PC
              の力だけで行うため、処理に足りる性能と空き容量があるかを確かめています。「不可」が1つでもあると進めません。「注意」は進めますが、時間がかかったり途中で止まったりすることがあります。
            </p>
          </div>
          {env ? (
            <div className="card">
              {env.checks.map((c, i) => {
                const lv = LEVEL[c.level];
                return (
                  <div
                    key={c.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "96px 200px 76px minmax(0, 1fr)",
                      gap: 14,
                      alignItems: "center",
                      padding: "12px 18px",
                      borderTop: i ? "1px solid var(--line-soft)" : "none",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{ENV_LABEL[c.id]}</span>
                    <span style={{ fontSize: 14 }}>{envValue(env, c.id)}</span>
                    <span
                      className="nowrap"
                      style={{
                        justifySelf: "start",
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 4,
                        color: lv.ink,
                        background: lv.bg,
                      }}
                    >
                      {lv.badge}
                    </span>
                    <span className="pretty" style={{ fontSize: 13, lineHeight: 1.6, color: lv.message }}>
                      {c.message}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {env && blocked ? (
            <div className="band-error" style={{ padding: "12px 16px", fontSize: 14, lineHeight: 1.6 }}>
              動作条件を満たしていない項目があるため、先に進めません。
            </div>
          ) : null}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>AI モデルのダウンロード（初回のみ）</h2>
            <p className="pretty" style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.7 }}>
              合計 {formatModelSize(total)}{" "}
              あり、回線によっては数十分かかります。途中で中断しても、次は続きから再開できます。終わるまでネットにつないだままにしてください。
            </p>
          </div>
          <div className="card">
            {models.map((m, i) => {
              const st = modelStatus(m);
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    padding: "16px 18px",
                    borderTop: i ? "1px solid var(--line-soft)" : "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{modelTitle(m)}</span>
                    <span className="nowrap" style={{ fontSize: 13, color: "var(--ink-3)" }}>
                      {formatModelSize(m.sizeBytes)}
                    </span>
                  </div>
                  <Bar ratio={st.ratio} height={6} color={st.bar} />
                  <span className="num" style={{ fontSize: 13, color: st.color }}>
                    {st.text}
                  </span>
                  {m.state === "error" && m.error ? <ErrorBand error={m.error} small /> : null}
                </div>
              );
            })}
          </div>
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 4 }}>
          {busy ? (
            <button type="button" className="btn btn-secondary" disabled={verifying} onClick={() => void pauseDownload()}>
              中断
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={primaryDisabled} onClick={primary.onClick}>
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  );
}
