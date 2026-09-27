// 新しい版の知らせ（約束 版10。2026-09-27 決定）: 起動したときに一度だけエンジンに尋ね（エンジンが GitHub の最新のリリースを見る）、
// 新しい録音の画面に帯を出す。アプリは自動では入れ替えない（利用者が手順を読んで入れ替える）。
// 帯の「この版は知らせない」で、その版の帯を出さない（覚えておく）。窓の「あとで」は窓を閉じるだけ（帯は残る）
import { api } from "../api";
import { getState, setState } from "./state";

const DISMISSED_KEY = "kikiwake.update.dismissed";
/** 「起動したときに新しい版を確かめる」を外した（"off"）。無ければ確かめる（2026-09-27 決定: 設定を置く・初めは確かめる） */
const CHECK_KEY = "kikiwake.update.check";

function readCheck(): boolean {
  try {
    return window.localStorage.getItem(CHECK_KEY) !== "off";
  } catch {
    return true;
  }
}

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** 起動したときに一度だけ呼ぶ。確かめる設定を外していれば尋ねない（通信しない）。確かめられなくても何も出さない */
export async function checkForUpdate(): Promise<void> {
  const on = readCheck();
  setState({ updateCheck: on, updateDismissed: readDismissed() });
  if (!on) {
    setState({ update: null });
    return;
  }
  try {
    const update = await api.checkUpdate();
    if (getState().updateCheck) setState({ update });
  } catch {
    // 知らせは出さないだけ（エンジンがログに理由を書く）
  }
}

/** 「起動したときに新しい版を確かめる」を入れる・外す。外すと帯と窓も消す。入れたら、その場で一度確かめる */
export function setUpdateCheck(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(CHECK_KEY);
    else window.localStorage.setItem(CHECK_KEY, "off");
  } catch {
    // 覚えておけない所では、この回だけ
  }
  setState(on ? { updateCheck: true } : { updateCheck: false, update: null, updateOpen: false });
  if (on && !getState().update) void checkForUpdate();
}

export function openUpdate(): void {
  setState({ updateOpen: true });
}

/** 「あとで」: 窓を閉じる（帯は残る） */
export function closeUpdate(): void {
  setState({ updateOpen: false });
}

/** 「この版は知らせない」: この版の帯を出さない（次の版はまた知らせる） */
export function skipUpdate(): void {
  const version = getState().update?.version;
  if (!version) return;
  try {
    window.localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // 覚えておけない所では、この回だけ
  }
  setState({ updateDismissed: version, updateOpen: false });
}

/** リリースのページをブラウザで開く（URL はエンジンが版の番号から作る） */
export async function openReleasePage(): Promise<void> {
  const version = getState().update?.version;
  if (!version) return;
  try {
    await api.openReleasePage(version);
  } catch {
    // ブラウザを開けなくても、画面はそのまま
  }
}
