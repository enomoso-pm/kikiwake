// 音の再生（名前付けのサンプル・確認用の手がかり・結果の画面の行）。
// 同時に鳴るのは1つだけ。別のものを鳴らすと前のものは止まる（UI 画面仕様書 §7.3・§8.5.2）
import { create } from "zustand";

interface PlayerState {
  /** 鳴っているもの。null なら止まっている */
  key: string | null;
  /** 進み具合 0〜1 */
  progress: number;
}

export const usePlayer = create<PlayerState>(() => ({ key: null, progress: 0 }));

let audio: HTMLAudioElement | null = null;
let frame = 0;
let token = 0;

function element(): HTMLAudioElement {
  if (!audio) {
    const a = new Audio();
    a.preload = "auto";
    a.addEventListener("ended", () => stopPlayback());
    a.addEventListener("error", () => {
      if (a.getAttribute("src")) stopPlayback();
    });
    audio = a;
  }
  return audio;
}

function follow(my: number) {
  cancelAnimationFrame(frame);
  const loop = () => {
    if (my !== token || !audio) return;
    const d = audio.duration;
    if (d && Number.isFinite(d) && d > 0) {
      const p = Math.min(1, audio.currentTime / d);
      if (Math.abs(p - usePlayer.getState().progress) >= 0.004) usePlayer.setState({ progress: p });
    }
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
}

/** 鳴らす。src は URL（結果の画面の行は Promise で届く） */
export function startPlayback(key: string, src: string | Promise<string>): void {
  stopPlayback();
  const my = ++token;
  usePlayer.setState({ key, progress: 0 });
  Promise.resolve(src)
    .then((url) => {
      if (my !== token) return;
      const a = element();
      a.src = url;
      a.currentTime = 0;
      a.play().catch(() => {
        if (my === token) stopPlayback();
      });
      follow(my);
    })
    .catch(() => {
      if (my === token) stopPlayback();
    });
}

export function stopPlayback(): void {
  token++;
  cancelAnimationFrame(frame);
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (usePlayer.getState().key !== null) usePlayer.setState({ key: null, progress: 0 });
}

/** 同じものをもう一度押すと止まる */
export function togglePlayback(key: string, src: () => string | Promise<string>): void {
  if (usePlayer.getState().key === key) stopPlayback();
  else startPlayback(key, src());
}
