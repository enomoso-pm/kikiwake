#!/bin/bash
# .dmg の窓の背景（background.png 1920×1200 と background@2x.png 3840×2400）を background.html から作り直す。
# 作った絵はリポジトリに入れる（.dmg を作るたびには描かない）。文や配置を変えたときだけ動かす。
#
#   bash scripts/dmg/render_background.sh
#
# Google Chrome を画面なしで使う。描くたびに使い捨てのプロファイルを作り、キーチェーンには触れない（--use-mock-keychain）。
# Chrome は絵を書き終えても終わらないことがあるので、絵ができたら終わらせる
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Google Chrome が無い（場所は CHROME で渡せる）"; exit 1; }

render() { # 倍率 出力するファイル [HTML]
  local out="$2" page="${3:-$DIR/background.html}" prof pid
  prof="$(mktemp -d)"
  rm -f "$out"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --use-mock-keychain --user-data-dir="$prof" --window-size="${SIZE:-1920,1200}" --force-device-scale-factor="$1" \
    --screenshot="$out" "file://$page" >/dev/null 2>&1 &
  pid=$!
  for _ in $(seq 120); do
    [ -s "$out" ] && { sleep 1; break; }
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -rf "$prof"
  [ -s "$out" ] || { echo "描けなかった: $out"; exit 1; }
}

if [ "${1:-}" = "--page" ]; then # 見本など、別の HTML を描く: --page <HTML> <出力> <幅,高さ> [倍率]
  SIZE="$4" render "${5:-1}" "$3" "$2"
  exit 0
fi
render 1 "$DIR/background.png"
render 2 "$DIR/background@2x.png"
sips -g pixelWidth -g pixelHeight "$DIR/background.png" "$DIR/background@2x.png" | grep -v '^/' | paste - - | sed 's/^ *//'
