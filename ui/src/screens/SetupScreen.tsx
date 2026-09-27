// 画面1 準備（UI 画面仕様書 §4）
import type { EnvironmentCheck, EnvironmentItem, ModelInfo } from "@contract/types";
import { Bar } from "../components/Bar";
import { ErrorBand } from "../components/ErrorBand";
import { useT, type Messages } from "../i18n";
import { formatModelSize, formatProgressBytes } from "../lib/format";
import {
  allModelsReady,
  isDownloading,
  leaveSetup,
  pauseDownload,
  startDownload,
} from "../store/setup";
import { useApp } from "../store/state";

const LEVEL: Record<EnvironmentItem["level"], { ink: string; bg: string; message: string }> = {
  ok: { ink: "var(--ok-ink)", bg: "var(--ok-bg)", message: "var(--ink-3)" },
  warn: { ink: "var(--warn-ink)", bg: "var(--warn-bg)", message: "var(--warn-ink)" },
  error: { ink: "var(--err-ink)", bg: "var(--err-bg)", message: "var(--err-ink)" },
};

function gb(n: number): string {
  return Number.isInteger(n) ? `${n} GB` : `${n.toFixed(1)} GB`;
}

/** 値の列（表示文は値を繰り返さないので、値はここで出す） */
function envValue(t: Messages, env: EnvironmentCheck, id: EnvironmentItem["id"]): string {
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
      return t.engine.gpuName(env.gpu.name);
  }
}

function modelTitle(t: Messages, m: ModelInfo): string {
  const role = t.setup.modelRole[m.id];
  const label = t.engine.modelLabel(m.id, m.label);
  return role ? t.setup.modelTitle(role, label) : label;
}

function modelStatus(t: Messages, m: ModelInfo): { text: string; color: string; ratio: number; bar: string } {
  const ratio = m.sizeBytes > 0 ? m.downloadedBytes / m.sizeBytes : 0;
  const bytes = formatProgressBytes(m.downloadedBytes, m.sizeBytes);
  const pct = Math.floor(ratio * 100);
  switch (m.state) {
    case "missing":
      return { text: t.setup.status.missing, color: "var(--ink-3)", ratio: 0, bar: "var(--accent)" };
    case "downloading":
      return { text: t.setup.status.downloading(bytes, pct), color: "var(--accent)", ratio, bar: "var(--accent)" };
    case "partial":
      return { text: t.setup.status.partial(bytes), color: "var(--ink-3)", ratio, bar: "var(--paused-bar)" };
    case "verifying":
      return {
        text: t.setup.status.verifying,
        color: "var(--accent)",
        ratio: 1,
        bar: "var(--accent)",
      };
    case "ready":
      return { text: t.setup.status.ready, color: "var(--ok-ink)", ratio: 1, bar: "var(--ok-bar)" };
    case "error":
      return { text: t.setup.status.error(bytes), color: "var(--err-ink)", ratio, bar: "var(--err-bar)" };
  }
}

export function SetupScreen() {
  const t = useT();
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
  if (allReady) primary = { label: t.setup.next, onClick: leaveSetup };
  else if (busy) primary = { label: t.setup.next };
  else if (resumable) primary = { label: t.setup.resume, onClick: () => void startDownload() };
  else primary = { label: t.setup.download(formatModelSize(remaining)), onClick: () => void startDownload() };
  const primaryDisabled = blocked || !primary.onClick;

  return (
    <div className="page-scroll">
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 32px 40px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>{t.setup.title}</h1>
          <p className="pretty" style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.75 }}>
            {t.setup.lead}
          </p>
        </div>

        {setupError ? <ErrorBand error={setupError} /> : null}

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t.setup.envTitle}</h2>
            <p className="pretty" style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.7 }}>
              {t.setup.envLead}
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
                    <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{t.setup.envLabel[c.id]}</span>
                    <span style={{ fontSize: 14 }}>{envValue(t, env, c.id)}</span>
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
                      {t.setup.level[c.level]}
                    </span>
                    <span className="pretty" style={{ fontSize: 13, lineHeight: 1.6, color: lv.message }}>
                      {t.engine.envMessage(c)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {env && blocked ? (
            <div className="band-error" style={{ padding: "12px 16px", fontSize: 14, lineHeight: 1.6 }}>
              {t.setup.blocked}
            </div>
          ) : null}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t.setup.modelsTitle}</h2>
            <p className="pretty" style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.7 }}>
              {t.setup.modelsLead(formatModelSize(total))}
            </p>
          </div>
          <div className="card">
            {models.map((m, i) => {
              const st = modelStatus(t, m);
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
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{modelTitle(t, m)}</span>
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
              {t.setup.pause}
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
