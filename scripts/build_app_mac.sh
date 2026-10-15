#!/bin/bash
# 配るアプリ（Kikiwake.app）と .dmg を作る。先に scripts/build_engines_mac.sh でエンジンを作っておく（docs/BUILD.md）。
#
#   bash scripts/build_app_mac.sh     # -> src-tauri/target/release/bundle/macos/Kikiwake.app と build/dist/Kikiwake_<版>_aarch64.dmg
#   KIKIWAKE_SIGN_IDENTITY="証明書の名前" bash scripts/build_app_mac.sh   # 自分で用意した署名の証明書で署名する（無ければ簡易署名）
#
# 署名: 何も渡さなければ簡易署名（ad-hoc。tauri.conf.json の signingIdentity "-"）。ソースから自分で作る人はこれでよい。
# 配る版は、キーチェーンにある自己署名の証明書の名前を KIKIWAKE_SIGN_IDENTITY に入れて作る（Tauri の APPLE_SIGNING_IDENTITY に渡す）。
# 同じ証明書で署名し続けると、macOS が版をまたいで同じアプリとして扱う（フォルダへのアクセスの許可が更新で消えない見込み）。
# Apple の公証はしていないので、初めて開くとき・新しい版に入れ替えたときの「このまま開く」は変わらず要る
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
if [ -n "${KIKIWAKE_SIGN_IDENTITY:-}" ]; then
  # 自己署名の証明書は「信頼」の設定が無いと -v（有効なものだけ）の一覧に出ないので、-v を付けずに名前で探す。
  # 一覧を先に受け取ってから探す（パイプの後ろの grep -q は、下の LEFT と同じ理由で「無い」側に倒れることがある）
  IDS="$(security find-identity -p codesigning)"
  grep -qF "\"$KIKIWAKE_SIGN_IDENTITY\"" <<<"$IDS" || {
    echo "署名の証明書「${KIKIWAKE_SIGN_IDENTITY}」がキーチェーンに無い（security find-identity -p codesigning で確かめる）"
    exit 1
  }
  export APPLE_SIGNING_IDENTITY="$KIKIWAKE_SIGN_IDENTITY"
fi
(cd "$ROOT/src-tauri" && CI=true "$TAURI" build)

# 署名の確かめ（壊れていると「壊れているため開けません」になり、設定から開く道が無くなる）と、どの署名かを出す
# （証明書の名前 Authority は -dvv で出る。簡易署名は Signature=adhoc）
codesign --verify --deep --strict "$APP"
codesign -dvv "$APP" 2>&1 | grep -E "^(Authority|Signature|TeamIdentifier)=" | sed 's/^/署名: /'

# grep -q だと途中で読むのをやめ、pipefail で「見つからない」側に倒れるので、数えてから比べる
LEFT="$(strings -a "$APP"/Contents/MacOS/* | grep -c "$HOME/" || true)"
if [ "$LEFT" != 0 ]; then
  strings -a "$APP"/Contents/MacOS/* | grep "$HOME/" | head -5
  echo "作った Mac のフォルダの場所が実行ファイルに $LEFT か所残っている（上）。エンジンを作り直したか確かめる"
  exit 1
fi
echo "実行ファイルに、作った Mac のフォルダの場所は残っていない"
bash "$ROOT/scripts/make_dmg.sh"
