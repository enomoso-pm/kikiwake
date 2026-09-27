#!/bin/bash
# 配る .dmg を作る（Kikiwake.app・「アプリケーション」への近道・はじめに読んでください.txt・英語の Read Me First.txt）。
#
#   bash scripts/make_dmg.sh        # -> build/dist/Kikiwake_<版>_aarch64.dmg と .sha256（照合用の値）
#
# ふだんは scripts/build_app_mac.sh（.app を作ってからこれを呼ぶ）を使う。
# Apple の有料の開発者登録をしていないので、署名は簡易署名か自己署名の証明書（build_app_mac.sh）。初めて開くときに macOS の確かめが要り、
# その手順を .dmg の中の案内（scripts/dmg/）と README に書いている。
# 署名が壊れていると「壊れているため開けません」になり、設定から開く道も無くなるので、作る前と作ったあと（.dmg の中の .app）の両方で確かめる。
# 署名したあとに .app の中を書き換えない
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
cp "$ROOT/scripts/dmg/はじめに読んでください.txt" "$ROOT/scripts/dmg/Read Me First.txt" "$STAGE/"

mkdir -p "$OUT"
rm -f "$OUT/$NAME" "$OUT/$NAME.sha256"
hdiutil create -volname "Kikiwake $VER" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$OUT/$NAME" >/dev/null
(cd "$OUT" && shasum -a 256 "$NAME" >"$NAME.sha256")

# 作った .dmg を読み取り専用で開き（Finder には出さない）、中の .app の署名を確かめる
MNT="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$OUT/$NAME" >/dev/null
if ! codesign --verify --deep --strict "$MNT/Kikiwake.app"; then
  hdiutil detach "$MNT" >/dev/null
  echo ".dmg の中の Kikiwake.app の署名が壊れている"
  exit 1
fi
hdiutil detach "$MNT" >/dev/null
rmdir "$MNT" 2>/dev/null || true
echo ".dmg の中の Kikiwake.app の署名は壊れていない"
echo "$OUT/$NAME（$(du -h "$OUT/$NAME" | cut -f1)）"
cat "$OUT/$NAME.sha256"
