import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// 全体の見た目を先に読む（画面の部品の見た目 objects.css などが、同じ強さの指定で全体の見た目を上書きできるように。
// 後に読むと .app の flex-direction が .objects-app に勝ち、録音の一覧の横に並ぶはずの右の列が下に回る）
import "./styles/app.css";
import { App } from "./App";
import { initApi } from "./api";
import { bootstrap } from "./store/bootstrap";

const root = document.getElementById("root") as HTMLElement;

initApi()
  .then(() => {
    void bootstrap();
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((e: unknown) => {
    root.textContent = e instanceof Error ? e.message : String(e);
    root.style.cssText = "padding:40px;font-size:14px;line-height:1.7;color:#8f2a23";
  });
