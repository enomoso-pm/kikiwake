import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 受け渡しの約束（型・見本データ）は ui/ の外の ../contract にある。コピーせず直接読む
const contractDir = fileURLToPath(new URL("../contract", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: { alias: { "@contract": contractDir } },
  // Tauri の開発時は固定のポートが要る（src-tauri/tauri.conf.json の devUrl と同じ番号。Tauri の既定の 1420 とはずらした）
  server: { port: 1430, strictPort: true, fs: { allow: [repoRoot] } },
  build: { target: "es2022", outDir: "dist" },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
