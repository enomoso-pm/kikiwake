#!/bin/bash
# 配るアプリ（Kikiwake.app）と .dmg を作る。先に scripts/build_engines_mac.sh でエンジンを作っておく（docs/BUILD.md）。
#
#   bash scripts/build_app_mac.sh     # -> src-tauri/target/release/bundle/macos/Kikiwake.app と build/dist/Kikiwake_<版>_aarch64.dmg
#
# 作った Mac のフォルダの場所（ユーザー名入り）が実行ファイルに残らないよう、Rust のソースの場所を置き換えてから作り
# （--remap-path-prefix。C/C++ のエンジンは build_engines_mac.sh の -ffile-prefix-map）、最後に残っていないかを確かめる。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI="$ROOT/build/tools/node_modules/.bin/tauri"
APP="$ROOT/src-tauri/target/release/bundle/macos/Kikiwake.app"
[ -x "$TAURI" ] || { echo "Tauri の道具が無い: npm install --prefix build/tools @tauri-apps/cli@^2"; exit 1; }

# 置き換えは、合うもののうち後ろに書いたものが勝つので、広いもの（ホーム）を先に書く
export RUSTFLAGS="--remap-path-prefix=$HOME=/home --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$ROOT=/kikiwake ${RUSTFLAGS:-}"
(cd "$ROOT/src-tauri" && CI=true "$TAURI" build)

# grep -q だと途中で読むのをやめ、pipefail で「見つからない」側に倒れるので、数えてから比べる
LEFT="$(strings -a "$APP"/Contents/MacOS/* | grep -c "$HOME/" || true)"
if [ "$LEFT" != 0 ]; then
  strings -a "$APP"/Contents/MacOS/* | grep "$HOME/" | head -5
  echo "作った Mac のフォルダの場所が実行ファイルに $LEFT か所残っている（上）。エンジンを作り直したか確かめる"
  exit 1
fi
echo "実行ファイルに、作った Mac のフォルダの場所は残っていない"
bash "$ROOT/scripts/make_dmg.sh"
