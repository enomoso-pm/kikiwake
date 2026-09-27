// 開発用の切替パネルから画面へ直接移る（見本だけ。製品のビルドには入らない）
import { api, mockDev } from "../api";
import { stopPlayback } from "../lib/player";
import { inspectPath } from "./file";
import { startJob } from "./job";
import { applyNamesAndShow } from "./naming";
import { loadSetup } from "./setup";
import { getState, setState, waitFor, type Screen } from "./state";
import { goTo } from "./ui";

async function runnableFile(): Promise<boolean> {
  if (!mockDev) return false;
  await inspectPath(mockDev.runnableFilePath());
  return Boolean(getState().file);
}

async function runToNaming(): Promise<boolean> {
  if (!mockDev || !(await runnableFile())) return false;
  await startJob();
  if (!(await waitFor((s) => Boolean(s.job?.jobId)))) return false;
  const id = getState().job?.jobId;
  if (!id) return false;
  mockDev.finishJobNow(id);
  return waitFor((s) => s.screen === "naming" && s.job?.jobId === id);
}

export async function devJump(screen: Screen): Promise<void> {
  if (!mockDev) return;
  stopPlayback();
  setState({ dialog: null, detailOpen: false });
  switch (screen) {
    case "setup":
      await loadSetup();
      goTo("setup");
      return;
    case "file":
      setState({ job: null, file: null, fileError: null, startError: null });
      goTo("file");
      if (mockDev.scenario().file === "previous") await inspectPath(mockDev.scenarioFilePath());
      return;
    case "processing":
      if (await runnableFile()) await startJob();
      return;
    case "naming":
      await runToNaming();
      return;
    case "result":
      if (await runToNaming()) {
        const s = getState();
        if (Object.values(s.names).every((v) => !v.trim())) setState({ names: mockDev.demoNames() });
        await applyNamesAndShow();
      }
      return;
  }
}

/** OS の切替: ⌘／Ctrl などは動作条件の os で決めるので、読み直す */
export async function reloadEnvironment(): Promise<void> {
  const env = await api.checkEnvironment();
  setState({ env });
}

export function setDevNames(names: Record<string, string>): void {
  setState({ names });
}
