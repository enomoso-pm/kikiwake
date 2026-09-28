#!/bin/bash
# 画面（ui/）を本物のエンジンで自動で通す（Phase 2 手順5）。開発用のビルドにだけ入る操作役（src-tauri/dev/*.js・src-tauri/src/dev.rs）を使う。
# 画面は製品と同じビルド（ui/ の npm run build）。ui/ のファイルは触らない。
#
#   bash scripts/e2e_mac.sh [boot|setup|synth|history|en|photo|real]...  既定は synth。SKIP_BUILD=1 でビルドを飛ばす
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
    real)
      REC="${KIKIWAKE_REAL_SAMPLE:?KIKIWAKE_REAL_SAMPLE に実録音のパスを入れる}"
      LIMIT=3600
      ;;
    *) echo "知らない筋書き: $sc"; exit 2 ;;
  esac
  # 筋書き history は、同じ作業フォルダで2回起動する（閉じてから開き直す）
  PHASES=("$sc")
  [ "$sc" = history ] && PHASES=(history1 history2)
  for phase in "${PHASES[@]}"; do
    ROOT="$ROOT" scenario_json "$phase" "$WORK" "$REC"
    echo "== $phase（$(date '+%H:%M:%S')）"
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
  done
done
exit "$status"
