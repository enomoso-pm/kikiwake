#!/usr/bin/env python3
"""使っているもののライセンス一覧（THIRD_PARTY_NOTICES.txt）を作る。

    python3 scripts/make_notices.py        # -> THIRD_PARTY_NOTICES.txt（リポジトリ直下。.app の Contents/Resources にも入る）

中身は、配る .app に入るものだけ:
  1. エンジン（C/C++）: whisper-cli（whisper.cpp）、kikiwake-diar（NeMo-Speech.cpp と sentencepiece）
  2. 画面（ui/）に組み込まれる npm の部品（dependencies とその先）
  3. アプリの外枠（Rust）に組み込まれる crate（cargo metadata の通常の依存。手続き的マクロとビルド用は入らないので除く）
  4. 初回に取得するモデル（アプリには入らない。取得先とライセンスだけ）
各部品のライセンスのファイルをそのまま載せる。同じ文面は2回目から「[T12] と同じ」とし、
Apache License 2.0 と Mozilla Public License 2.0 の全文は最後の付録に1回だけ載せる。

前提: scripts/build_engines_mac.sh を一度動かしてある（sentencepiece のソースが build/deps にある）、ui/ で npm install 済み。
ネットワークは使わない（cargo metadata --offline）。
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "THIRD_PARTY_NOTICES.txt"
TP = ROOT / "third_party"
SPM = ROOT / "build" / "deps" / "sentencepiece" / "src"
LICENSE_NAME = re.compile(r"^(licen[cs]e|copying|notice|unlicense|copyright)([-._].*)?$", re.I)
RULE = "=" * 78
SUB = "-" * 78


def sh(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def is_apache(text: str) -> bool:
    t = norm(text)
    return "Apache License" in t and "Version 2.0, January 2004" in t and "TERMS AND CONDITIONS" in t and len(t) > 8000


def is_mpl2(text: str) -> bool:
    t = norm(text)
    return "Mozilla Public License Version 2.0" in t and len(t) > 10000


def apache_header(text: str) -> str:
    """Apache の全文の前に置かれた著作権の行（NVIDIA の LICENSE など）。無ければ空"""
    head = text.split("Apache License", 1)[0].strip()
    return head if len(head) < 400 else ""


class Notices:
    def __init__(self) -> None:
        self.out: list[str] = []
        self.seen: dict[str, str] = {}
        self.apache = ""
        self.mpl2 = ""

    def w(self, s: str = "") -> None:
        self.out.append(s)

    def text(self, label: str, text: str) -> None:
        """ライセンスの文面を載せる（大きな定型の全文は付録を指し、同じ文面は前の番号を指す）"""
        text = text.replace("\r\n", "\n").strip("\n")
        if is_apache(text):
            self.apache = self.apache or text.split("Apache License", 1)[1]
            head = apache_header(text)
            self.w(f"[{label}] Apache License 2.0（全文は付録 A）" + (f"\n{head}" if head else ""))
            return
        if is_mpl2(text):
            self.mpl2 = self.mpl2 or text
            self.w(f"[{label}] Mozilla Public License 2.0（全文は付録 B）")
            return
        h = hashlib.sha256(norm(text).encode()).hexdigest()
        if h in self.seen:
            self.w(f"[{label}] {self.seen[h]} と同じ文面")
            return
        tag = f"T{len(self.seen) + 1}"
        self.seen[h] = tag
        self.w(f"[{label}] ({tag})")
        self.w(text)

    def files(self, d: Path, only: list[str] | None = None) -> int:
        """フォルダの直下のライセンスのファイルを全部載せる。載せた数を返す"""
        n = 0
        for f in sorted(d.iterdir()) if d.is_dir() else []:
            if f.is_file() and LICENSE_NAME.match(f.name) and (only is None or f.name in only):
                self.text(f.name, f.read_text(encoding="utf-8", errors="replace"))
                self.w()
                n += 1
        return n


def license_section(src: Path, start_marker: str) -> str:
    """単一ヘッダーのライブラリの末尾にあるライセンスの文（コメントの中）を取り出す"""
    s = src.read_text(encoding="utf-8", errors="replace")
    i = s.rfind(start_marker)
    if i < 0:
        sys.exit(f"ライセンスの文が見つからない: {src}")
    body = s[i:]
    end = body.find("*/")
    return body[:end if end >= 0 else None].strip()


def engines(n: Notices) -> None:
    n.w(RULE)
    n.w("1. エンジン（C/C++。.app の Contents/MacOS に同梱）")
    n.w(RULE)
    n.w()
    wv = sh("git", "describe", "--tags", "--always", cwd=TP / "whisper.cpp")
    n.w(f"■ whisper.cpp {wv}（書き起こし: whisper-cli。ggml を含む）  https://github.com/ggml-org/whisper.cpp")
    n.w()
    n.files(TP / "whisper.cpp", only=["LICENSE"])
    n.w("whisper-cli に組み込まれる examples/ の単一ヘッダーのライブラリ:")
    n.w()
    n.text("miniaudio.h", license_section(TP / "whisper.cpp/examples/miniaudio.h", "This software is available as a choice"))
    n.w()
    n.text("stb_vorbis.c", license_section(TP / "whisper.cpp/examples/stb_vorbis.c", "This software is available under 2 licenses"))
    n.w()
    nv = sh("git", "rev-parse", "--short", "HEAD", cwd=TP / "NeMo-Speech.cpp")
    n.w(f"■ NeMo-Speech.cpp {nv}（話者判定: kikiwake-diar。改変した ggml と llama.cpp の一部を含む）  https://github.com/NVIDIA/NeMo-Speech.cpp")
    n.w()
    n.files(TP / "NeMo-Speech.cpp", only=["LICENSE", "NOTICE"])
    n.w("NeMo-Speech.cpp の THIRD_PARTY_NOTICES.md をそのまま載せる。kikiwake-diar に組み込まれるのは、このうち ggml（改変版）・")
    n.w("llama.cpp の一部・SentencePiece（下）だけで、KenLM・Flashlight Text・Open JTalk・CppJieba・cpp-httplib・miniaudio は入っていない")
    n.w("（出来た実行ファイルの記号で確かめた）。")
    n.w()
    n.text("THIRD_PARTY_NOTICES.md", (TP / "NeMo-Speech.cpp/THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8"))
    n.w()
    if not SPM.is_dir():
        sys.exit("sentencepiece のソースが無い。先に scripts/build_engines_mac.sh を動かす")
    sv = sh("git", "rev-parse", "--short", "HEAD", cwd=SPM)
    n.w(f"■ SentencePiece {sv}（kikiwake-diar に静的に組み込む。abseil・protobuf-lite などを含む）  https://github.com/google/sentencepiece")
    n.w()
    n.files(SPM, only=["LICENSE"])
    for sub in ["absl", "protobuf-lite", "darts_clone", "esaxx"]:
        n.w(f"third_party/{sub}:")
        n.files(SPM / "third_party" / sub)


def npm(n: Notices) -> None:
    ui = ROOT / "ui"
    nm = ui / "node_modules"
    if not nm.is_dir():
        sys.exit("ui/node_modules が無い。先に ui で npm install")
    todo = list(json.loads((ui / "package.json").read_text())["dependencies"])
    done: dict[str, dict] = {}
    while todo:
        name = todo.pop()
        if name in done:
            continue
        pj = json.loads((nm / name / "package.json").read_text())
        done[name] = pj
        todo += list(pj.get("dependencies", {}))
    n.w(RULE)
    n.w("2. 画面（ui/）に組み込まれる部品（npm）")
    n.w(RULE)
    n.w()
    for name in sorted(done):
        pj = done[name]
        n.w(f"■ {name} {pj['version']}  License: {pj.get('license')}")
        if not n.files(nm / name):
            n.w("（パッケージにライセンスのファイルが無い）")
        n.w()


def cargo(n: Notices) -> None:
    meta = json.loads(sh("cargo", "metadata", "--format-version", "1", "--locked", "--offline",
                         "--filter-platform", "aarch64-apple-darwin", cwd=ROOT / "src-tauri"))
    pk = {p["id"]: p for p in meta["packages"]}
    nodes = {x["id"]: x for x in meta["resolve"]["nodes"]}
    root = next(i for i in meta["workspace_members"] if pk[i]["name"] == "kikiwake")
    seen: set[str] = set()
    stack = [root]
    while stack:
        i = stack.pop()
        if i in seen:
            continue
        seen.add(i)
        for d in nodes[i]["deps"]:
            if None not in [k["kind"] for k in d["dep_kinds"]]:
                continue  # ビルド用・テスト用
            p = pk[d["pkg"]]
            if any("proc-macro" in t["kind"] for t in p["targets"]):
                continue  # コンパイルのときだけ動き、.app には入らない
            stack.append(d["pkg"])
    crates = sorted((pk[i] for i in seen if pk[i]["source"]), key=lambda p: (p["name"], p["version"]))
    n.w(RULE)
    n.w(f"3. アプリの外枠（Rust）に組み込まれる crate（{len(crates)} 個）")
    n.w(RULE)
    n.w()
    for p in crates:
        d = Path(p["manifest_path"]).parent
        n.w(f"■ {p['name']} {p['version']}  License: {p.get('license') or p.get('license_file')}"
            + (f"  {p['repository']}" if p.get("repository") else ""))
        if not n.files(d):
            # パッケージにライセンスのファイルが無い: Cargo.toml の作者で定型文を載せる（MPL は付録の全文）
            lic = p.get("license") or ""
            who = ", ".join(p.get("authors") or []) or f"the {p['name']} authors"
            if "MIT" in lic:
                n.text("MIT（パッケージにファイルが無いため定型文）", MIT_TEMPLATE.format(who=who))
            elif lic == "BSD-3-Clause":
                n.text("BSD-3-Clause（パッケージにファイルが無いため定型文）", BSD3_TEMPLATE.format(who=who))
            elif lic == "MPL-2.0":
                n.w("[MPL-2.0] Mozilla Public License 2.0（全文は付録 B。パッケージにファイルが無い）")
            else:
                sys.exit(f"ライセンスのファイルが無く、定型文も無い: {p['name']} {p['version']}（{lic}）")
            n.w(f"ソース: https://crates.io/crates/{p['name']}/{p['version']}")
        n.w()


def models(n: Notices) -> None:
    n.w(RULE)
    n.w("4. 初回に取得するモデル（アプリには入っていない。Kikiwake が取得先から直接取る）")
    n.w(RULE)
    n.w()
    n.w("■ Whisper large-v3（書き起こし。OpenAI）  License: MIT")
    n.w("  モデル: https://github.com/openai/whisper （ライセンス: https://github.com/openai/whisper/blob/main/LICENSE）")
    n.w("  取得先（whisper.cpp 用に変換したもの）: https://huggingface.co/ggerganov/whisper.cpp （ggml-large-v3.bin）")
    n.w()
    n.w("■ Nemotron 3 Diarization（話者の判定。NVIDIA）  License: OpenMDW-1.1")
    n.w("  取得先: https://huggingface.co/nvidia/Nemotron-3-Diarization （Nemotron-3-Diarization.q8_0.gguf）")
    n.w("  ライセンスの全文は取得先のページに書かれている")
    n.w()


def appendix(n: Notices) -> None:
    n.w(RULE)
    n.w("付録 A. Apache License 2.0（全文）")
    n.w(RULE)
    n.w()
    n.w(("Apache License" + n.apache).strip("\n"))
    n.w()
    if n.mpl2:
        n.w(RULE)
        n.w("付録 B. Mozilla Public License 2.0（全文）")
        n.w(RULE)
        n.w()
        n.w("MPL 2.0 の部品は改変せずに使っている。ソースは上に書いた取得先（crates.io・各リポジトリ）から入手できる。")
        n.w()
        n.w(n.mpl2.strip("\n"))
        n.w()


MIT_TEMPLATE = """Copyright (c) {who}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""

BSD3_TEMPLATE = """Copyright (c) {who}
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."""


def main() -> None:
    version = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["version"]
    n = Notices()
    n.w(f"Kikiwake {version} — 使っているもののライセンス（Third-party notices）")
    n.w()
    n.w("Kikiwake 自体は MIT ライセンス（同じフォルダの LICENSE）。Kikiwake is licensed under the MIT License.")
    n.w("このファイルには、配る .app に組み込まれている他の人の作ったものと、そのライセンスの全文を載せる。")
    n.w("This file lists the third-party software included in the Kikiwake app and their license texts.")
    n.w("作り方: python3 scripts/make_notices.py")
    n.w()
    engines(n)
    npm(n)
    cargo(n)
    models(n)
    appendix(n)
    OUT.write_text("\n".join(n.out).rstrip("\n") + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.0f}KB・文面 {len(n.seen)} 種類")


if __name__ == "__main__":
    main()
