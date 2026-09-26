import { Suspense, lazy } from "react";
import { mockDev } from "./api";
import { Dialogs } from "./components/Dialogs";
import { StepBar } from "./components/StepBar";
import { Toast } from "./components/Toast";
import { DoneScreen } from "./screens/DoneScreen";
import { FileScreen } from "./screens/FileScreen";
import { NamingScreen } from "./screens/NamingScreen";
import { ProcessingScreen } from "./screens/ProcessingScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { useApp, type Screen } from "./store/state";

// 開発用の切替パネルは見本のときだけ（製品のビルドには入らない）
const DevPanel = import.meta.env.DEV ? lazy(() => import("./dev/DevPanel")) : null;

function CurrentScreen({ screen }: { screen: Screen }) {
  switch (screen) {
    case "setup":
      return <SetupScreen />;
    case "file":
      return <FileScreen />;
    case "processing":
      return <ProcessingScreen />;
    case "naming":
      return <NamingScreen />;
    case "result":
      return <ResultScreen />;
    case "done":
      return <DoneScreen />;
  }
}

export function App() {
  const booted = useApp((s) => s.booted);
  const screen = useApp((s) => s.screen);
  return (
    <div className="app">
      <StepBar />
      <main className="app-body">{booted ? <CurrentScreen screen={screen} /> : null}</main>
      <Dialogs />
      <Toast />
      {DevPanel && mockDev ? (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      ) : null}
    </div>
  );
}
