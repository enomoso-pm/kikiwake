#!/usr/bin/env bash
# 配布用のエンジンを Mac（Apple シリコン）向けに作る（Phase 2 手順1）。Phase 0 の計測用のビルドは build_engines_phase0_mac.sh。
#
#   - エンジンごとに、静的にリンクした1本の実行ファイルにする。Homebrew のライブラリに頼らない。
#     2つのエンジンの ggml（whisper.cpp の 0.23.0 と、NeMo 同梱のパッチ入り 0.12.0）は別物で名前が同じなので、
#     共有ライブラリのままでは1つのフォルダに並べられない
#   - CPU の命令は M1 を基準にする（GGML_NATIVE=OFF）。既定の -mcpu=native は、ビルドした Mac（M4）の命令 i8mm・sme を使い、
#     M1〜M3 で落ちるおそれがある
#   - 動く macOS の下限は 14.0。指定しないと、ビルドした Mac の版が下限になる
#   - Metal のシェーダは実行ファイルに埋め込む（別のファイルは要らない）
#   - third_party/ の中身は変えない。ビルドの出力は build/engines/ に置く。
#     NeMo 同梱の ggml には NeMo 公式のパッチを当てる（NeMo の手順どおり。Phase 0 で当て済みなら何もしない）
#
#   前提: Xcode Command Line Tools、cmake 3.26 以上、ninja、git（sentencepiece のソースを取る）
#   使い方: bash scripts/build_engines_mac.sh
#   出力:   build/engines/bin/{whisper-cli,nemo-speech,decode-avf}
#           src-tauri/binaries/<名前>-aarch64-apple-darwin（Tauri が .app に同梱する置き場所）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NS="$ROOT/third_party/NeMo-Speech.cpp"
OUT="$ROOT/build/engines"
BIN="$OUT/bin"
MACOS_MIN=14.0
TRIPLE=aarch64-apple-darwin
JOBS="$(sysctl -n hw.ncpu)"
export MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN"

# 作った Mac のフォルダの場所（ユーザー名入り）を実行ファイルに残さない（__FILE__ とデバッグ情報の場所を /kikiwake に置き換える）
PREFIX_MAP="-ffile-prefix-map=$ROOT=/kikiwake"
PREFIX_FLAGS=(
  "-DCMAKE_C_FLAGS=$PREFIX_MAP"
  "-DCMAKE_CXX_FLAGS=$PREFIX_MAP"
  "-DCMAKE_OBJC_FLAGS=$PREFIX_MAP"
  "-DCMAKE_OBJCXX_FLAGS=$PREFIX_MAP"
)

# どのエンジンにも共通の設定。Homebrew（/opt/homebrew・/usr/local）のライブラリは探させない
COMMON=(
  "${PREFIX_FLAGS[@]}"
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_OSX_ARCHITECTURES=arm64
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN"
  "-DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local"
  -DBUILD_SHARED_LIBS=OFF
  -DGGML_NATIVE=OFF
  -DGGML_METAL=ON
  -DGGML_METAL_EMBED_LIBRARY=ON
  -DGGML_OPENMP=OFF   # Phase 0 のビルドでも見つからず使っていなかった（ggml 自前のスレッド）
)
mkdir -p "$BIN"

# NeMo-Speech.cpp は中国語の読み上げ用データだけを Git LFS で持つ（話者判定には不要）。git-lfs 無しで取得できるように無効にする
NOLFS=(-c filter.lfs.process= -c filter.lfs.smudge= -c filter.lfs.clean= -c filter.lfs.required=false)
[ -f "$ROOT/third_party/whisper.cpp/CMakeLists.txt" ] || git -C "$ROOT" submodule update --init third_party/whisper.cpp
[ -f "$NS/CMakeLists.txt" ] || git -C "$ROOT" "${NOLFS[@]}" submodule update --init third_party/NeMo-Speech.cpp
[ -f "$NS/ggml/CMakeLists.txt" ] || git -C "$NS" "${NOLFS[@]}" submodule update --init ggml

# ---- 1. 書き起こし: whisper.cpp → whisper-cli -----------------------------------------------
cmake -S "$ROOT/third_party/whisper.cpp" -B "$OUT/whisper" "${COMMON[@]}" \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF -DWHISPER_COREML=OFF
cmake --build "$OUT/whisper" --target whisper-cli -j "$JOBS"
cp "$OUT/whisper/bin/whisper-cli" "$BIN/whisper-cli"

# ---- 2. sentencepiece（NeMo の話者判定のライブラリが必須にしている。書き起こし用の部品だが外せない）------
# NeMo 同梱の scripts/build_sentencepiece_static.sh と同じ版・同じ設定（abseil と protobuf は中に取り込む）。
# そのスクリプトは GNU の install -D を使い macOS では動かないうえ、既定の出力先が third_party の中なので、ここで同じことをする
SPM_COMMIT=17d7580d6407802f85855d2cc9190634e2c95624
SPM="$ROOT/build/deps/sentencepiece"
[ -d "$SPM/src/.git" ] || git clone --filter=blob:none --no-checkout https://github.com/google/sentencepiece.git "$SPM/src"
if [ "$(git -C "$SPM/src" rev-parse HEAD 2>/dev/null)" != "$SPM_COMMIT" ]; then
  git -C "$SPM/src" fetch --depth 1 origin "$SPM_COMMIT"
  git -C "$SPM/src" checkout --quiet "$SPM_COMMIT"
fi
# CMAKE_POLICY_VERSION_MINIMUM: sentencepiece の cmake_minimum_required が 3.5 未満で、CMake 4 はそのままでは受け付けない
cmake -S "$SPM/src" -B "$SPM/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN" \
  "-DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local" "${PREFIX_FLAGS[@]}" \
  -DSPM_BUILD_TEST=OFF -DSPM_ENABLE_SHARED=OFF -DSPM_ENABLE_TCMALLOC=OFF \
  -DSPM_ABSL_PROVIDER=internal -DSPM_PROTOBUF_PROVIDER=internal
cmake --build "$SPM/build" --target sentencepiece-static -j "$JOBS"
mkdir -p "$SPM/lib" "$SPM/include"
cp "$SPM/build/src/libsentencepiece.a" "$SPM/lib/libsentencepiece.a"
cp "$SPM/src/src/sentencepiece_processor.h" "$SPM/include/sentencepiece_processor.h"

# ---- 3. 話者判定: NeMo-Speech.cpp → nemo-speech（話者判定だけ。プリセット metal-diar と同じ設定）------------
"$NS/scripts/apply-ggml-patches.sh"
cmake -S "$NS" -B "$OUT/nemo-diar" "${COMMON[@]}" \
  -DNEMO_SPEECH_BUILD_EXAMPLES=OFF -DNEMO_SPEECH_BUILD_TESTS=OFF -DNEMO_SPEECH_BUILD_TOOLS=OFF \
  -DNEMO_SPEECH_GGML_PATCHED=OFF -DNEMO_SPEECH_BUILD_ASR=OFF -DNEMO_SPEECH_BUILD_DIAR=ON \
  -DNEMO_SPEECH_BUILD_TTS=OFF -DNEMO_SPEECH_BUILD_NMT=OFF \
  -DSENTENCEPIECE_LIB="$SPM/lib/libsentencepiece.a" -DSENTENCEPIECE_INCLUDE_DIR="$SPM/include" \
  -DCMAKE_PROJECT_nemo_speech_INCLUDE="$ROOT/scripts/cmake/nemo_static.cmake" \
  -DKIKIWAKE_DIAR_MAIN="$ROOT/src-tauri/engines/kikiwake-diar/main.cpp"
cmake --build "$OUT/nemo-diar" --target nemo_speech_cli kikiwake-diar -j "$JOBS"
cp "$OUT/nemo-diar/bin/nemo-speech" "$BIN/nemo-speech"
cp "$OUT/nemo-diar/bin/kikiwake-diar" "$BIN/kikiwake-diar"

# ---- 4. 音声の取り出し: AVFoundation（Swift。OS 標準のフレームワークだけに依存）-------------------------
xcrun swiftc -O -target "arm64-apple-macos$MACOS_MIN" "$ROOT/src-tauri/engines/decode-avf/main.swift" -o "$BIN/decode-avf"

# ---- 5. Tauri の同梱の置き場所へ --------------------------------------------------------------
mkdir -p "$ROOT/src-tauri/binaries"
for n in whisper-cli nemo-speech kikiwake-diar decode-avf; do cp "$BIN/$n" "$ROOT/src-tauri/binaries/$n-$TRIPLE"; done

# ---- 6. 確かめ: 依存が OS 標準だけか・動く macOS の下限・M1 に無い命令が入っていないか ------------------
bash "$ROOT/scripts/check_engines_mac.sh" "$BIN/whisper-cli" "$BIN/nemo-speech" "$BIN/kikiwake-diar" "$BIN/decode-avf"
