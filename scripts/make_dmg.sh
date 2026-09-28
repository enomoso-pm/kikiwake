#!/bin/bash
# 配る .dmg を作る（Kikiwake.app・「アプリケーション」への近道・3 の画面を開く「設定を開く」・はじめに読む.txt・英語の Read Me First.txt と、窓の手順の絵）。
#
#   bash scripts/make_dmg.sh        # -> build/dist/Kikiwake_<版>_aarch64.dmg と .sha256（照合用の値）
#
# ふだんは scripts/build_app_mac.sh（.app を作ってからこれを呼ぶ）を使う。
# Apple の有料の開発者登録をしていないので、署名は簡易署名か自己署名の証明書（build_app_mac.sh）。初めて開くときに macOS の確かめが要り、
# その手順を .dmg の窓の絵（scripts/dmg/background.html）と中の案内（scripts/dmg/）と README に書いている。
# 窓の絵とアイコンの並びは dmgbuild（scripts/dmg/dmgbuild_settings.py。Finder を操作せずに書き込む）で入れる。
# dmgbuild は 1.6.7 に固定（1.6.5 以前は絵の置き場所を作ったときの場所で覚えるため、macOS 26 の Finder で絵が出なかった）。
# 署名が壊れていると「壊れているため開けません」になり、設定から開く道も無くなるので、作る前と作ったあと（.dmg の中の .app）の両方で確かめる。
# 署名したあとに .app の中を書き換えない
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$ROOT/src-tauri/tauri.conf.json")"
APP="$ROOT/src-tauri/target/release/bundle/macos/Kikiwake.app"
OUT="$ROOT/build/dist"
NAME="Kikiwake_${VER}_aarch64.dmg"
DMGBUILD="$ROOT/build/tools/dmgbuild/bin/dmgbuild"

[ -d "$APP" ] || { echo "先に .app を作る（$APP が無い）"; exit 1; }
[ -x "$DMGBUILD" ] || {
  echo "dmgbuild が無い（Python 3.10 以上が要る。docs/BUILD.md）: python3 -m venv build/tools/dmgbuild && build/tools/dmgbuild/bin/pip install dmgbuild==1.6.7 ds_store==1.3.1 mac_alias==2.2.2"
  exit 1
}
codesign --verify --deep --strict "$APP"

mkdir -p "$OUT"
rm -f "$OUT/$NAME" "$OUT/$NAME.sha256"
"$DMGBUILD" -s "$ROOT/scripts/dmg/dmgbuild_settings.py" -D app="$APP" -D dir="$ROOT/scripts/dmg" "Kikiwake $VER" "$OUT/$NAME" >/dev/null
(cd "$OUT" && shasum -a 256 "$NAME" >"$NAME.sha256")

# 作った .dmg を読み取り専用で開き（Finder には出さない）、中身の並びと、中の .app の署名を確かめる
MNT="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$OUT/$NAME" >/dev/null
fail=""
for f in Kikiwake.app はじめに読む.txt "Read Me First.txt" .background.tiff .DS_Store; do
  [ -e "$MNT/$f" ] || fail="$fail $f が無い。"
done
[ "$(readlink "$MNT/アプリケーション" || true)" = /Applications ] || fail="$fail 「アプリケーション」への近道が無い。"
[ "$(readlink "$MNT/設定を開く" || true)" = /System/Library/PreferencePanes/Security.prefPane ] || fail="$fail 「設定を開く」の近道が無い。"
codesign --verify --deep --strict "$MNT/Kikiwake.app" || fail="$fail Kikiwake.app の署名が壊れている。"
hdiutil detach "$MNT" >/dev/null
rmdir "$MNT" 2>/dev/null || true
[ -z "$fail" ] || { echo ".dmg の中身がおかしい:$fail"; exit 1; }
echo ".dmg の中身（.app・近道・設定を開く・案内・窓の絵）がそろい、Kikiwake.app の署名は壊れていない"
echo "$OUT/$NAME（$(du -h "$OUT/$NAME" | cut -f1)）"
cat "$OUT/$NAME.sha256"
