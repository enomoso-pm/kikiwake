#!/usr/bin/env python3
"""画面の見本（ui/ の開発サーバ）で鳴らす、仮の音を作る。

    python3 scripts/make_mock_audio.py        # -> contract/fixtures/samples/*.wav

見本のデータ（contract/fixtures）は、架空の4人会議を Mac の読み上げの声で作って処理した結果。
その声は公開の場で配れない（macOS の使用許諾で、システムの声を公開・再配布に使うことは認められていない）ので、
リポジトリには声の代わりに、話者ごとに高さの違う短い音を入れる。長さは見本のデータの区間に合わせる。
本物のアプリは、利用者の録音から切り出した声を鳴らす（ここは関係しない）。
"""
from __future__ import annotations

import json
import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "contract" / "fixtures"
SR = 16000
# 話者ごとの音の高さ（Hz）。確認用（話者を決められなかった部分）は低め
PITCH = {"話者A": 392.0, "話者B": 440.0, "話者C": 494.0, "話者D": 523.3, "確認用": 330.0}


def spans() -> dict[str, float]:
    """見本のデータに出てくる音声のパス → 長さ（秒）。区間の長さに 0.4 秒を足す（切り出すときの前後の余白の分）"""
    out: dict[str, float] = {}

    def walk(v: object) -> None:
        if isinstance(v, dict):
            p = v.get("audioPath")
            if isinstance(p, str) and p.startswith("samples/"):
                s, e = v.get("start"), v.get("end")
                length = (e - s + 0.4) if isinstance(s, (int, float)) and isinstance(e, (int, float)) else 5.0
                out[p] = max(out.get(p, 0.0), min(max(length, 1.0), 15.0))
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    for f in sorted(FIX.glob("*.json")):
        walk(json.loads(f.read_text(encoding="utf-8")))
    return out


def tone(seconds: float, hz: float) -> bytes:
    """0.5 秒ごとに 0.18 秒だけ鳴る柔らかい音（前後を 20ms でなめらかに）"""
    frames = []
    for i in range(round(seconds * SR)):
        t = i / SR
        ph = t % 0.5
        if ph < 0.18:
            env = min(1.0, ph / 0.02, (0.18 - ph) / 0.02)
            v = 0.12 * env * math.sin(2 * math.pi * hz * t)
        else:
            v = 0.0
        frames.append(struct.pack("<h", int(v * 32767)))
    return b"".join(frames)


def main() -> None:
    d = FIX / "samples"
    d.mkdir(exist_ok=True)
    want = spans()
    for old in d.glob("*.wav"):
        if f"samples/{old.name}" not in want:
            old.unlink()
    for path, seconds in sorted(want.items()):
        name = Path(path).name
        hz = next((h for k, h in PITCH.items() if name.startswith(k)), 440.0)
        with wave.open(str(FIX / path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(tone(seconds, hz))
    print(f"{len(want)} 個の仮の音 -> {d.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
