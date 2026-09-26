// 工程バー（UI 画面仕様書 §2.2）。一度結果を出したあとだけ、今いない方の「名前付け」「結果」を押して移れる。
// 同じとき「1 ファイル」も押せ、別の録音を選べる（2026-09-26 決定。仕様書に無い）。
// 準備は一度やれば終わりなので工程に入れない（2026-09-26 決定。仕様書は「1 準備」〜「5 結果」）。
// 準備の画面では、4つとも「まだ」の見た目で並べ、「次へ」で「1 ファイル」から工程に入る。
// 完了の画面（工程の外）では4つとも「済んだ」の見た目。「1 ファイル」「3 名前付け」「4 結果」は押せる
import { requestNewRecording } from "../store/leave";
import { navigateStep } from "../store/naming";
import { useApp, type Screen } from "../store/state";

const STEPS: Array<{ screen: Screen; label: string }> = [
  { screen: "file", label: "ファイル" },
  { screen: "processing", label: "処理" },
  { screen: "naming", label: "名前付け" },
  { screen: "result", label: "結果" },
];

export function StepBar() {
  const screen = useApp((s) => s.screen);
  const reached = useApp((s) => s.reachedResult);
  const applying = useApp((s) => s.applying);
  const finished = screen === "done";
  // 準備の画面では -1（どれも「まだ」）、完了の画面では 4（どれも「済んだ」）
  const current = finished ? STEPS.length : STEPS.findIndex((s) => s.screen === screen);
  return (
    <nav className="stepbar" aria-label="工程">
      {STEPS.map((step, i) => {
        const afterResult = reached && !applying && (screen === "naming" || screen === "result" || finished);
        const toNew = afterResult && step.screen === "file";
        const nav = toNew || (afterResult && (step.screen === "naming" || step.screen === "result") && i !== current);
        const state = i === current ? "current" : i < current ? "done" : "";
        return (
          <button
            key={step.screen}
            type="button"
            className={`step ${state}${nav ? " nav" : ""}`}
            disabled={!nav}
            title={toNew ? "別の録音を選ぶ" : nav ? `${step.label}へ移る` : undefined}
            aria-current={i === current ? "step" : undefined}
            onClick={toNew ? requestNewRecording : nav ? () => navigateStep(step.screen as "naming" | "result") : undefined}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-name">{step.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
