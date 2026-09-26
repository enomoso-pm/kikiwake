// 画面1 準備（UI 画面仕様書 §4）
import type { ModelId, ModelInfo } from "@contract/types";
import { api } from "../api";
import { toAppError } from "../lib/errors";
import { getState, setState } from "./state";
import { goTo } from "./ui";

/** 表示とダウンロードの順（§4.4。downloadModels はこの順に1つずつ取る） */
export const MODEL_ORDER: readonly ModelId[] = ["nemotron-3-diarization", "whisper-large-v3"];

/** 役割（D11「AI モデル」は役割を先に書く） */
export const MODEL_ROLE: Partial<Record<ModelId, string>> = {
  "nemotron-3-diarization": "声を聞き分ける",
  "whisper-large-v3": "声を文字にする",
};

export function sortModels(list: ModelInfo[]): ModelInfo[] {
  const rank = (id: ModelId) => {
    const i = MODEL_ORDER.indexOf(id);
    return i < 0 ? MODEL_ORDER.length : i;
  };
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
}

export async function loadSetup(): Promise<void> {
  try {
    const [env, models] = await Promise.all([api.checkEnvironment(), api.getModels()]);
    setState({ env, models: sortModels(models), setupError: null });
  } catch (e) {
    setState({ setupError: toAppError(e) });
  }
}

export function onModelProgress(m: ModelInfo): void {
  setState((s) => {
    const found = s.models.some((x) => x.id === m.id);
    const models = found ? s.models.map((x) => (x.id === m.id ? m : x)) : [...s.models, m];
    return { models: sortModels(models) };
  });
}

export function isDownloading(models: ModelInfo[]): boolean {
  return models.some((m) => m.state === "downloading" || m.state === "verifying");
}

export function allModelsReady(models: ModelInfo[]): boolean {
  return models.length > 0 && models.every((m) => m.state === "ready");
}

/** 上から順に、まだのものを取る（中断・失敗したものは続きから。失敗の帯は消す） */
export async function startDownload(): Promise<void> {
  const s = getState();
  if (!s.env?.canRun || isDownloading(s.models)) return;
  const ids = s.models.filter((m) => m.state !== "ready").map((m) => m.id);
  if (!ids.length) return;
  setState({
    models: s.models.map((m) => (m.state === "error" ? { ...m, error: undefined } : m)),
    setupError: null,
  });
  try {
    await api.downloadModels(ids);
  } catch (e) {
    setState({ setupError: toAppError(e) });
  }
}

export async function pauseDownload(): Promise<void> {
  try {
    await api.cancelDownload();
  } catch (e) {
    setState({ setupError: toAppError(e) });
  }
}

export function leaveSetup(): void {
  goTo("file");
}
