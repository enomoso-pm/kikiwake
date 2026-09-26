import { describe, expect, it } from "vitest";
import { isCommitKey, isEscape, isPlainEnter } from "./keys";

const key = (k: string, o: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; isComposing: boolean; keyCode: number }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...o,
});

describe("キー操作（§2.7）", () => {
  it("⌘+Enter・Ctrl+Enter で決定。Enter 単独では決定しない", () => {
    expect(isCommitKey(key("Enter", { metaKey: true }))).toBe(true);
    expect(isCommitKey(key("Enter", { ctrlKey: true }))).toBe(true);
    expect(isCommitKey(key("Enter"))).toBe(false);
    expect(isCommitKey(key("Enter", { shiftKey: true }))).toBe(false);
  });

  it("日本語入力の変換中の Enter は、どれも決定にしない", () => {
    expect(isCommitKey(key("Enter", { metaKey: true, isComposing: true }))).toBe(false);
    expect(isPlainEnter(key("Enter", { isComposing: true }))).toBe(false);
    expect(isPlainEnter(key("Enter", { keyCode: 229 }))).toBe(false);
    expect(isEscape(key("Escape", { isComposing: true }))).toBe(false);
    expect(isPlainEnter(key("Enter"))).toBe(true);
  });
});
