#!/usr/bin/env bash
# 配布する実行ファイルを確かめる（Phase 2 手順1）。どれか1つでも外れたら終了コード 1。
#   1. 依存が OS 標準だけか（/usr/lib と /System/Library。Homebrew や @rpath の共有ライブラリが無い）
#   2. 動く macOS の下限が 14.0 以下か
#   3. M1 に無い命令が入っていないか（i8mm・bf16 は M2 から、sme は M4 だけ、sve は Apple のチップに無い）
#      M4 以外の Mac が手元に無いので、実機で動かす代わりに、逆アセンブルして命令の名前を数える
# 使い方: bash scripts/check_engines_mac.sh <実行ファイル>...
set -uo pipefail
MACOS_MIN=14.0
# M1 に無い命令（逆アセンブラには全部の機能を有効にして名前で出させる）
BAD='\b(smmla|ummla|usmmla|usdot|sudot|bfdot|bfmmla|bfmlalb|bfmlalt|bfcvt|bfcvtn|bfcvtn2|smstart|smstop|fmopa|fmops|smopa|umopa)\b|\bz[0-9]+\.[bhsdq]\b|\bza[0-9]*[hv]?\.'
status=0
for f in "$@"; do
  echo "== $(basename "$f")（$(du -h "$f" | cut -f1 | tr -d ' ')）"
  deps=$(otool -L "$f" | tail -n +2 | awk '{print $1}')
  bad_deps=$(echo "$deps" | grep -v -E '^(/usr/lib/|/System/Library/)' || true)
  if [ -n "$bad_deps" ]; then echo "  NG 依存に OS 標準以外: $bad_deps"; status=1
  else echo "  OK 依存は OS 標準だけ（$(echo "$deps" | wc -l | tr -d ' ') 個）"; fi
  minos=$(otool -l "$f" | awk '/LC_BUILD_VERSION/{b=1} b&&/minos/{print $2; exit}')
  if [ "$(printf '%s\n%s\n' "$minos" "$MACOS_MIN" | sort -V | head -1)" = "$minos" ]; then echo "  OK 動く macOS の下限 $minos"
  else echo "  NG 動く macOS の下限が ${minos}（$MACOS_MIN より新しい）"; status=1; fi
  # 関数の後ろに置かれた定数の表（前後が <unknown> の所）は、たまたま命令の形に読めても実行されないので数えない
  hits=$(objdump -d --no-show-raw-insn --mattr=+i8mm,+bf16,+sme,+sve,+sve2 "$f" 2>/dev/null | python3 -c '
import re, sys
bad = re.compile(sys.argv[1])
lines = sys.stdin.read().splitlines()
unk = ["<unknown>" in l for l in lines]
for i, l in enumerate(lines):
    m = bad.search(l)
    if m and not (i > 0 and unk[i - 1]) and not (i + 1 < len(lines) and unk[i + 1]):
        print(m.group(0))
' "$BAD")
  n=$(printf '%s' "$hits" | grep -c . || true)
  if [ "$n" -eq 0 ]; then echo "  OK M1 に無い命令 0 件"
  else echo "  NG M1 に無い命令 $n 件（例: $(printf '%s\n' "$hits" | sort | uniq -c | sort -rn | head -5 | tr -s ' ' | tr '\n' ' ')）"; status=1; fi
done
exit $status
