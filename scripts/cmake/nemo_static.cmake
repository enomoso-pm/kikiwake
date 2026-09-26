# NeMo-Speech.cpp を配布用に静的リンクするための差し込み（third_party/ は変えない）。
# scripts/build_engines_mac.sh が -DCMAKE_PROJECT_nemo_speech_INCLUDE=<このファイル> で渡し、
# NeMo の project(nemo_speech) の直後に読まれる。
#
# NeMo は話者判定の本体 nemo_speech_asr と C の呼び出し口 nemo_speech_asr_c を SHARED と固定で書いている
# （src/asr/CMakeLists.txt）。BUILD_SHARED_LIBS=OFF だけでは共有ライブラリのまま残り、
# nemo-speech が @rpath/libnemo_speech_asr.dylib に依存する。この2つだけ STATIC に置き換えて、1本の実行ファイルにする。
include_guard(GLOBAL)

function(add_library name)
  set(args ${ARGN})
  if(name STREQUAL "nemo_speech_asr" OR name STREQUAL "nemo_speech_asr_c")
    list(TRANSFORM args REPLACE "^SHARED$" "STATIC")
  endif()
  _add_library(${name} ${args})
endfunction()

# 話者判定の小さな実行ファイル kikiwake-diar（src-tauri/engines/kikiwake-diar/main.cpp）を NeMo のビルドに足す。
# C の呼び出し口 nemo_speech_asr_c に WAV を少しずつ流し込む（nemo-speech diarize は録音全体を一度に流し込む）。
# NeMo の CMakeLists.txt が全部の部品を定義し終えたあとに足す（cmake_language DEFER）
if(KIKIWAKE_DIAR_MAIN)
  function(_kikiwake_add_diar)
    add_executable(kikiwake-diar "${KIKIWAKE_DIAR_MAIN}")
    target_link_libraries(kikiwake-diar PRIVATE nemo_speech_asr_c)
    target_compile_features(kikiwake-diar PRIVATE cxx_std_17)
    set_target_properties(kikiwake-diar PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
  endfunction()
  cmake_language(DEFER CALL _kikiwake_add_diar)
endif()
