// 画面が使う api の入口。
// - Tauri の中（window.__TAURI__ がある）なら ./tauri.ts の tauriApi（Phase 2 手順5でエンジン側が置く）
// - それ以外なら見本 ./mock.ts（開発サーバのときだけ。製品のビルドには見本も見本データも入れない）
// tauri.ts は、置かれるまで空の対応表になるだけなので、無くてもビルドは通る。置けばこのままつながる。
import type { KikiwakeApi } from "@contract/api";
import type { MockDev } from "./mock";

const tauriModules = import.meta.glob<{ tauriApi: KikiwakeApi }>("./tauri.ts", { eager: true });

function notReady(): never {
  throw new Error("api がまだ用意できていません");
}

/** 画面から OS の機能やファイルに触るときは、必ずこれを通す */
export let api: KikiwakeApi = new Proxy({} as KikiwakeApi, { get: notReady });

/** 見本のときだけある開発用の切替（製品では null） */
export let mockDev: MockDev | null = null;

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

export async function initApi(): Promise<void> {
  if (inTauri()) {
    const mod = tauriModules["./tauri.ts"];
    if (!mod) throw new Error("ui/src/api/tauri.ts が見つかりません（エンジンとの接続は Phase 2 手順5で置かれます）");
    api = mod.tauriApi;
    return;
  }
  if (import.meta.env.DEV) {
    const mock = await import("./mock");
    api = mock.mockApi;
    mockDev = mock.mockDev;
    return;
  }
  throw new Error("この画面は Kikiwake アプリの中で動きます（見本は開発サーバでだけ使えます）");
}
