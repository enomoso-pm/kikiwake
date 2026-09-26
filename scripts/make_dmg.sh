#!/bin/bash
# 配る .dmg を作る（Kikiwake.app・「アプリケーション」への近道・はじめに読んでください.txt）。
#
#   bash scripts/make_dmg.sh        # -> build/dist/Kikiwake_<版>_aarch64.dmg と .sha256（照合用の値）
#
# ふだんは scripts/build_app_mac.sh（.app を作ってからこれを呼ぶ）を使う。
# Apple の有料の開発者登録をしていないので、署名は簡易署名だけ。初めて開くときに macOS の確かめが要り、
# その手順を .dmg の中の案内（scripts/dmg/）と README に書いている。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$ROOT/src-tauri/tauri.conf.json")"
APP="$ROOT/src-tauri/target/release/bundle/macos/Kikiwake.app"
OUT="$ROOT/build/dist"
NAME="Kikiwake_${VER}_aarch64.dmg"

[ -d "$APP" ] || { echo "先に .app を作る（$APP が無い）"; exit 1; }
codesign --verify --deep --strict "$APP"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/Kikiwake.app"
ln -s /Applications "$STAGE/アプリケーション"
cp "$ROOT/scripts/dmg/はじめに読んでください.txt" "$STAGE/"

mkdir -p "$OUT"
rm -f "$OUT/$NAME" "$OUT/$NAME.sha256"
hdiutil create -volname "Kikiwake $VER" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$OUT/$NAME" >/dev/null
(cd "$OUT" && shasum -a 256 "$NAME" >"$NAME.sha256")
echo "$OUT/$NAME（$(du -h "$OUT/$NAME" | cut -f1)）"
cat "$OUT/$NAME.sha256"
