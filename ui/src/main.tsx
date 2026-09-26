import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initApi } from "./api";
import { bootstrap } from "./store/bootstrap";
import "./styles/app.css";

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
