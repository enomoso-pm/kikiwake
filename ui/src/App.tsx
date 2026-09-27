import { Suspense, lazy } from "react";
import { mockDev } from "./api";
import ObjectsApp from "./objects/ObjectsApp";

// 開発用の切替パネルは見本のときだけ（製品のビルドには入らない）
const DevPanel = import.meta.env.DEV ? lazy(() => import("./dev/DevPanel")) : null;

/**
 * 画面は録音が主役の形（左に録音の一覧・右に選んだ録音。2026-09-27 に製品の画面にした）。
 * 前の形（工程バー・履歴の画面・完了の画面）は、アプリの中で通したあとに消した（2026-09-27 決定）
 */
export function App() {
  return (
    <>
      <ObjectsApp />
      {DevPanel && mockDev ? (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      ) : null}
    </>
  );
}
