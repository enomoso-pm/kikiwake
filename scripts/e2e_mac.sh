#!/bin/bash
# 画面（ui/）を本物のエンジンで自動で通す（Phase 2 手順5）。開発用のビルドにだけ入る操作役（src-tauri/dev/*.js・src-tauri/src/dev.rs）を使う。
# 画面は製品と同じビルド（ui/ の npm run build）。ui/ のファイルは触らない。
#
#   bash scripts/e2e_mac.sh [boot|setup|synth|history|en|photo|real|screens|speech]...  既定は synth。SKIP_BUILD=1 でビルドを飛ばす
#   BUNDLE=1 なら .app の形の開発用ビルド（target/debug/bundle/macos/Kikiwake.app）で動かす。Info.plist で決まること
#   （対応する言語の宣言で、macOS が足すメニューの項目などの言語が変わる）はこちらでないと確かめられない。
#   識別子がいつもの Kikiwake と同じなので、WebKit の保存（覚えた画面の言語）もいつもの Kikiwake と同じ所になる
#     boot   起動だけ（書体の確かめを出す）
#     setup  準備の画面: 話者判定のモデル（107MB）を取る（途中で中断して続きから）→「はじめる」→「AI モデルと動作条件」で見返す
#     synth  合成会議を2本（同じ音声の写し）: 処理中の閉じる確かめ（段階の文・順番待ちの一文）・中止と再開・順番待ち・2本目がすぐ始まる・
#            話者のタブから保存・再生・保存と見本の比較・手直し・上書き・「詳細」・処理中にほかの録音を開く・「●」・選び直し・ドラッグ中の案内・窓の幅
#     photo  説明書の写真（KIKIWAKE_E2E_REC で録音を置く場所を変えられる。既定は作業フォルダ。2本目は同じフォルダの「定例会議_0926.wav」）
#     real   手元の長い録音（KIKIWAKE_REAL_SAMPLE にパス。中身は出さず、時間と件数だけ）。REOPEN=1 で選び直しも
#     history 履歴と閉じたときの状態（約束 版8・版9）。同じ作業フォルダで2回起動する: history1（1本目を保存して手直しし名前を入れかける・
#            2本目を裏で終わらせて「●」・3本目の処理中に4本目を順番待ちにして閉じる）→ history2（一覧の並びと状態・「●」が残る・
#            開き直すと手直しが戻る・「保存…」の窓が前に選んだまま・保存したファイルが見つからない・元のファイルが見つからない／変わった・結び直す・
#            行の「…」の「削除…」・再開）
#     en     英語（約束 版7）: 英語の Mac のまね（-AppleLanguages (en-US)。この Mac の設定は変えない）で合成会議を通し、
#            メニュー・画面・保存するファイル（名前と中身）が英語か、日本語に切り替えると日本語になるか、英語がはみ出さないか
#     screens マニュアルの素材（約束 版13）: 作り物の画面共有の録画（合成会議の声。scripts/make_screens_video.sh。ffmpeg が要る）で
#            「マニュアル用に、画面の絵も取り出す」→ 保存の .zip。終わったら zip の中身（ファイル・timeline の区間・小窓が黒いか）をここで確かめる。
#            同じ作業フォルダで 2 回起動する: screens（↑。終わりに判定の版を 1 つ下げる）→ screens2（約束 版14: 前の版で読み取った録画を開くと、
#            .zip の行が押せず理由と作り直し方が出る → 案内のとおりに選び直すと .zip の行が戻る）
#     speech 英語の録音（約束 版15）: 英語の合成会議（~/Library/Caches/Kikiwake-dev/synth_en/synth_meeting.wav。リポジトリには入れていない）を
#            「自動で見分ける」で通し、言語・英語の名前の手がかり・選び直し・一覧の「…」の「日本語で文字起こしし直す…」まで
#
# 作業フォルダは ~/Library/Caches/Kikiwake-dev/phase2/e2e/<筋書き>/（毎回まっさらにする）。snap/*.json は見た目の記録（手順5-3）。
# アプリのデータ（この Mac の速さの記録・覚えた画面の言語）も作業フォルダの中に分け、いつもの Kikiwake に混ぜない。
# 画面の言語は毎回この Mac の言語から始める（前に選んだ言語は操作役が起動のときに忘れさせる。src-tauri/dev/init.js）
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV="$HOME/Library/Caches/Kikiwake-dev"
TAURI="$ROOT/build/tools/node_modules/.bin/tauri"
APP="$ROOT/src-tauri/target/debug/kikiwake"
BUNDLE_ARGS=(--no-bundle)
if [ "${BUNDLE:-}" = 1 ]; then
  APP="$ROOT/src-tauri/target/debug/bundle/macos/Kikiwake.app/Contents/MacOS/kikiwake"
  BUNDLE_ARGS=(--bundles app)
fi
SYNTH="$DEV/synth/synth_meeting.wav"

if [ "${SKIP_BUILD:-}" != 1 ]; then
  (cd "$ROOT/src-tauri" && CI=true "$TAURI" build --debug "${BUNDLE_ARGS[@]}") >"$DEV/phase2/e2e_build.log" 2>&1
  if ! grep -q "Finished" "$DEV/phase2/e2e_build.log" || [ ! -x "$APP" ]; then
    tail -30 "$DEV/phase2/e2e_build.log"
    echo "ビルドに失敗（$DEV/phase2/e2e_build.log）"
    exit 1
  fi
fi

scenario_json() { # 名前 作業フォルダ 録音 → scenario.json
  python3 - "$@" <<'EOF'
import json, os, sys
name, work, rec = sys.argv[1], sys.argv[2], sys.argv[3]
root = os.environ["ROOT"]
sc = {"name": name, "snapDir": f"{work}/snap"}
if os.environ.get("FONTFIX") == "1":
    sc["fontFix"] = True  # 手順5-3 の書体の直し方の候補を画面の中だけで試す
if name == "boot":
    sc["fontProbe"] = True
elif name == "synth":
    fx = f"{root}/contract/fixtures"
    sc.update(recording=rec, recording2=rec.replace(".wav", "_2.wav"), fixtures=fx, refDir=f"{work}/ref", expectSpeakers=4, expectHints=True,
              names=json.load(open(f"{fx}/names.json", encoding="utf-8")), timeoutMin=10)
elif name == "photo":
    fx = f"{root}/contract/fixtures"
    sc.update(recording=rec, recording2=os.path.join(os.path.dirname(rec), "定例会議_0926.wav"),
              names=json.load(open(f"{fx}/names.json", encoding="utf-8")), timeoutMin=10)
elif name == "en":
    sc.update(recording=rec, expectSpeakers=4, timeoutMin=10)
elif name in ("history1", "history2"):
    fx = f"{root}/contract/fixtures"
    sc.update(recording=rec, recording2=rec.replace(".wav", "_2.wav"), recording3=rec.replace(".wav", "_3.wav"), recording4=rec.replace(".wav", "_4.wav"),
              fixtures=fx, cacheDir=f"{work}/cache", saveDir=f"{work}/out", timeoutMin=10, names=json.load(open(f"{fx}/names.json", encoding="utf-8")))
elif name in ("screens", "screens2"):
    sc.update(recording=rec, cacheDir=f"{work}/cache", timeoutMin=10)
elif name == "speech":
    sc.update(recording=rec, expectSpeakers=4, timeoutMin=10)
elif name == "real":
    sc.update(recording=rec, quiet=True, timeoutMin=45, reopen=os.environ.get("REOPEN") == "1")
    sc.pop("snapDir")
json.dump(sc, open(f"{work}/scenario.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
EOF
}

# 画面がロックされている・画面がスリープしていると、窓が見えないので WebKit が画面の台本のタイマーを止め、筋書きが進まない
# （2026-09-27 に、画面が 10 分でスリープしてロックされ、履歴の筋書きが止まった）。ロックされていれば始めない。
# 動いている間は caffeinate -d で画面をスリープさせない（アプリが終わると外れる。Mac の設定は変えない）
if ioreg -n Root -d1 -a 2>/dev/null | grep -A1 CGSSessionScreenIsLocked | grep -q "<true/>"; then
  echo "画面がロックされている。ロックを外してから動かす（窓が見えないと、画面の台本が止まる）"
  exit 3
fi

status=0
for sc in "${@:-synth}"; do
  WORK="$DEV/phase2/e2e/$sc${FONTFIX:+-fontfix}"
  rm -rf "$WORK"
  mkdir -p "$WORK/cache" "$WORK/snap" "$WORK/ref" "$WORK/rec" "$WORK/out"
  # 新しい版の知らせ（約束 版10）: GitHub に尋ねる代わりに、この答えを読ませる（開発用のビルドだけ。ネットにつながない）。
  # synth・history は新しい版がある答え（帯と窓を確かめる）、ほかは古い版の答え（帯を出さない。説明書の写真にも写さない）
  printf '%s' '{"tag_name":"v9.9.9","name":"Kikiwake 9.9.9","body":"- （操作役）新しい版の知らせの確かめ","published_at":"2026-10-05T00:00:00Z"}' >"$WORK/update-newer.json"
  printf '%s' '{"tag_name":"v0.0.1","name":"Kikiwake 0.0.1"}' >"$WORK/update-none.json"
  UPDATE_JSON="$WORK/update-none.json"
  case "$sc" in synth | history) UPDATE_JSON="$WORK/update-newer.json" ;; esac
  MODELS="$DEV/models"
  REC=""
  LIMIT=900
  APP_ARGS=()
  case "$sc" in
    boot)
      LIMIT=120
      ;;
    setup)
      # 書き起こしのモデルだけある状態（ハードリンク。3GB を写さない）→ 話者判定のモデルを取る
      MODELS="$WORK/models"
      mkdir -p "$MODELS"
      ln "$DEV/models/ggml-large-v3.bin" "$MODELS/ggml-large-v3.bin"
      LIMIT=1500
      ;;
    synth)
      REC="$WORK/rec/synth_meeting.wav"
      cp "$SYNTH" "$REC"
      cp "$SYNTH" "$WORK/rec/synth_meeting_2.wav"
      ;;
    photo)
      # KIKIWAKE_E2E_REC で録音を置く場所を変えられる（説明書の画面の写真に、ユーザー名の入った場所を写さないため）
      REC="${KIKIWAKE_E2E_REC:-$WORK/rec/要件レビュー.wav}"
      mkdir -p "$(dirname "$REC")"
      cp "$SYNTH" "$REC"
      cp "$SYNTH" "$(dirname "$REC")/定例会議_0926.wav"
      rm -f "${REC%.*}_文字起こし.md"  # 前に保存したもの（同じ名前があると、保存の確かめが上書きの窓で止まる。speech と同じ）
      ;;
    history)
      REC="$WORK/rec/synth_meeting.wav"
      for n in "" _2 _3 _4; do cp "$SYNTH" "$WORK/rec/synth_meeting$n.wav"; done
      ;;
    en)
      REC="$WORK/rec/synth_meeting.wav"
      cp "$SYNTH" "$REC"
      # このアプリだけ英語の Mac のまね（macOS の引数。Mac の設定は変えない）
      APP_ARGS=(-AppleLanguages "(en-US)")
      ;;
    screens)
      VID="$DEV/screens/screens_demo.mp4"
      mkdir -p "$DEV/screens"
      [ -f "$VID" ] || bash "$ROOT/scripts/make_screens_video.sh" "$SYNTH" "$VID" >/dev/null
      REC="$WORK/rec/画面共有デモ.mp4"
      cp "$VID" "$REC"
      ;;
    speech)
      # 英語の合成会議（Mac の読み上げの英語の声で作ったもの。声は配れないので、リポジトリには入れていない）。
      # KIKIWAKE_E2E_REC で録音を置く場所を変えられる（案内の写真に、ユーザー名の入った場所を写さないため。photo と同じ）
      REC="${KIKIWAKE_E2E_REC:-$WORK/rec/英語の会議.wav}"
      mkdir -p "$(dirname "$REC")"
      cp "$DEV/synth_en/synth_meeting.wav" "$REC"
      rm -f "${REC%.*}_文字起こし.md"  # 前に保存したもの（同じ名前があると、保存の確かめが上書きの窓で止まる）
      ;;
    real)
      REC="${KIKIWAKE_REAL_SAMPLE:?KIKIWAKE_REAL_SAMPLE に実録音のパスを入れる}"
      LIMIT=3600
      ;;
    *) echo "知らない筋書き: $sc"; exit 2 ;;
  esac
  # 筋書き history と screens は、同じ作業フォルダで2回起動する（閉じてから開き直す）
  PHASES=("$sc")
  [ "$sc" = history ] && PHASES=(history1 history2)
  [ "$sc" = screens ] && PHASES=(screens screens2)
  for phase in "${PHASES[@]}"; do
    ROOT="$ROOT" scenario_json "$phase" "$WORK" "$REC"
    echo "== ${phase}（$(date '+%H:%M:%S')）"
    # 標準出力は記録に残し、操作役の行（[画面] …）だけをその場で出す
    KIKIWAKE_DEV_E2E="$WORK/scenario.json" KIKIWAKE_MODELS_DIR="$MODELS" KIKIWAKE_CACHE_DIR="$WORK/cache" KIKIWAKE_APP_DATA_DIR="$WORK/appdata" KIKIWAKE_UPDATE_JSON="$UPDATE_JSON" \
      "$APP" ${APP_ARGS[@]+"${APP_ARGS[@]}"} > >(tee "$WORK/stdout-$phase.log" | grep --line-buffered "^\[画面\]") 2>"$WORK/stderr-$phase.log" &
    pid=$!
    caffeinate -d -w "$pid" &
    # 時間切れの見張り（別のプロセスにすると、出力の管を持ったまま残ってパイプが閉じない）
    waited=0
    while kill -0 "$pid" 2>/dev/null; do
      sleep 1
      waited=$((waited + 1))
      if [ "$waited" -ge "$LIMIT" ]; then
        kill "$pid" 2>/dev/null
        echo "[画面] NG 時間切れ（${LIMIT} 秒）"
      fi
    done
    wait "$pid"
    code=$?
    sleep 0.5
    echo "== $phase 終了コード $code"
    [ "$code" = 0 ] || { status=1; break; }
    # マニュアルの素材: 保存した zip の中身（ファイル・timeline の区間・右下の小窓が黒く、地は黒くない・transcript.md が保存した .md と同じ）
    if [ "$phase" = screens ]; then
      python3 - "$WORK/rec" <<'PYCHECK' || { status=1; break; }
import glob, os, subprocess, sys, zipfile
rec = sys.argv[1]
ng = 0
def check(name, ok, detail=""):
    global ng
    ng += 0 if ok else 1
    print(f"[画面] {'OK' if ok else 'NG'} {name}{('　' + detail) if detail else ''}", flush=True)
zips = glob.glob(os.path.join(rec, "*_マニュアル素材.zip"))
check("zip が 1 つ", len(zips) == 1, str(zips))
z = zipfile.ZipFile(zips[0])
names = z.namelist()
want = ["README.md", "timeline.md", "timeline.json", "transcript.md"] + [f"frames/{i:04d}.jpg" for i in range(1, 5)]
check("zip の中身", names == want, str(names))
check("zip の検査（CRC）", z.testzip() is None)
tl = z.read("timeline.md").decode()
for part in ["## 1. カメラの時間", "一時的な表示", "前と同じ画面", "画面の中の変化", "![2](frames/0001.jpg)", "変わった所：右"]:
    check(f"timeline に「{part}」", part in tl)
md = glob.glob(os.path.join(rec, "*_文字起こし.md"))
check("transcript.md が保存した .md と同じ", len(md) == 1 and z.read("transcript.md") == open(md[0], "rb").read())
readme = z.read("README.md").decode()
check("README は「読み方」と「書き方」", "この zip の読み方" in readme and "マニュアルの書き方" in readme)
check("スクロールは次の場面にまとめ、動きの多い時間は無い", "動きの多い時間" not in tl)
tmp = os.path.join(rec, "frame1.jpg")
open(tmp, "wb").write(z.read("frames/0001.jpg"))
def px(x, y):
    # JPEG は色の間引きがあるので、白黒にしてから 1 画素を切り出す（そのままでは ffmpeg が 1 画素に切れない）
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", tmp, "-vf", f"format=gray,crop=1:1:{x}:{y}", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True).stdout
    return out[0] if out else -1
check("右下の小窓（カメラの代わり）は黒く塗っている", 0 <= px(1270, 710) < 16, str(px(1270, 710)))
check("地は塗っていない", px(40, 40) > 200, str(px(40, 40)))
os.remove(tmp)
sys.exit(1 if ng else 0)
PYCHECK
    fi
  done
done
exit "$status"
