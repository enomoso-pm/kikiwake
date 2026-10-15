#!/bin/bash
# マニュアルの素材（画面の絵）の確かめ用に、作り物の画面共有の録画を作る（開発用。アプリには入らない。ffmpeg が要る）。
# 中身は箱と模様だけ（人の顔・文字は無い）。音声は渡した WAV（合成会議など）。長さは音声に合わせる。
#
#   bash scripts/make_screens_video.sh <音声.wav> <出力.mp4>
#
# 時刻（秒）と、判定で期待すること（core/src/screens.rs）:
#   0〜40    ギャラリー表示の代わり（画面全体が動き続ける）        → カメラの時間（絵なし）。動き続けるかは前後 30 秒で見るので 30 秒より長く
#   40〜     右下に小窓（動き続ける模様）                          → 端の小窓として、共有の区間のあいだずっと黒く塗る
#   40〜70   スライド A                                            → 場面の切り替わり
#   70〜74   右上に通知（4 秒）                                    → 一時的な表示（絵なし）。そのあとのスライド A は「前と同じ」
#   90〜105  スライド B                                            → 場面の切り替わり
#   105〜118 スライド B の右に窓                                   → 画面の中の変化（右）
#   118〜130 中身が毎秒動く（スクロールの代わり）                  → 動きの多い時間（真ん中の 1 枚）
#   130〜150 スライド C                                            → 場面の切り替わり
#   150〜    スライド A に戻る                                     → 前と同じ画面
set -euo pipefail
AUDIO="$1"
OUT="$2"
DUR="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$AUDIO")"
W=1280
H=720
# スライドの箱（x:y:w:h:色）。enable で出す時刻を決める
A="between(t,40,90)+gte(t,150)"
B="between(t,90,118)"
C="between(t,130,150)"
VF="drawbox=x=80:y=60:w=1120:h=90:color=0x1f4e9c:t=fill:enable='$A'"
VF+=",drawbox=x=80:y=200:w=520:h=380:color=0x6b8fd6:t=fill:enable='$A'"
VF+=",drawbox=x=660:y=200:w=380:h=160:color=0xd8a24a:t=fill:enable='$A'"
VF+=",drawbox=x=80:y=60:w=1120:h=90:color=0x2e7d32:t=fill:enable='$B'"
VF+=",drawbox=x=80:y=200:w=360:h=420:color=0x9ccc65:t=fill:enable='$B'"
VF+=",drawbox=x=480:y=200:w=360:h=420:color=0x558b2f:t=fill:enable='$B'"
VF+=",drawbox=x=80:y=60:w=1120:h=90:color=0x6a1b9a:t=fill:enable='$C'"
VF+=",drawbox=x=80:y=200:w=1120:h=120:color=0xce93d8:t=fill:enable='$C'"
VF+=",drawbox=x=80:y=360:w=1120:h=120:color=0x8e24aa:t=fill:enable='$C'"
# 通知（右上・4 秒）と、スライド B の右の窓
VF+=",drawbox=x=900:y=10:w=360:h=90:color=0x333333:t=fill:enable='between(t,70,74)'"
VF+=",drawbox=x=880:y=240:w=340:h=260:color=0x222222:t=fill:enable='between(t,105,118)'"
# スクロールの代わり（横じまが毎秒ずれる。drawbox の位置は毎コマ計算し直さないので、overlay の eval=frame で動かす）

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=0xf5f5f5:s=${W}x${H}:r=30:d=$DUR" \
  -f lavfi -i "cellauto=s=${W}x${H}:r=30:rule=30:random_fill_ratio=0.5" \
  -f lavfi -i "testsrc2=s=320x180:r=30" \
  -f lavfi -i "color=c=0x455a64:s=1120x60:r=30" \
  -f lavfi -i "color=c=0x90a4ae:s=1120x40:r=30" \
  -i "$AUDIO" \
  -filter_complex "[0:v]$VF[base];[1:v]trim=duration=40,setpts=PTS-STARTPTS[gal];[base][gal]overlay=0:0:eof_action=pass[g];[g][3:v]overlay=x=80:y='200+mod(floor(t)*53,300)':eval=frame:enable='between(t,118,130)':shortest=1[s1];[s1][4:v]overlay=x=80:y='420+mod(floor(t)*31,200)':eval=frame:enable='between(t,118,130)':shortest=1[s2];[s2][2:v]overlay=W-w:H-h:enable='gte(t,40)':shortest=1[v]" \
  -map "[v]" -map 5:a -t "$DUR" -c:v libx264 -pix_fmt yuv420p -preset veryfast -g 300 -c:a aac -b:a 96k "$OUT"
echo "$OUT"
