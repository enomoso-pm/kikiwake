# Kikiwake の作り方（開発する人向け）

Apple シリコンの Mac で作ります（Intel の Mac と Windows は、まだ対象外）。

## 要るもの

| もの | 版の目安 | 入れ方の例 |
|---|---|---|
| Xcode Command Line Tools | — | `xcode-select --install` |
| CMake・Ninja | CMake 3.26 以上 | `brew install cmake ninja` |
| Rust | stable | [rustup](https://rustup.rs/) |
| Node.js | 20 以上 | `brew install node` |
| git・Python 3 | — | Command Line Tools に入っている |

## 作る

```bash
git clone https://github.com/enomoso-pm/kikiwake.git
cd kikiwake

# 1. エンジン（whisper-cli・kikiwake-diar・decode-avf）。静的にリンクした 1 本ずつ・M1 基準・macOS 14 以降。
#    要る部品（third_party の 2 つと、その中の ggml・sentencepiece）はこのスクリプトが取ってくる
bash scripts/build_engines_mac.sh

# 2. 画面の部品と、Tauri の道具（Mac 全体には入れず build/tools に置く）
(cd ui && npm ci)
npm install --prefix build/tools @tauri-apps/cli@^2

# 3. アプリと配る .dmg → src-tauri/target/release/bundle/macos/Kikiwake.app・build/dist/Kikiwake_<版>_aarch64.dmg（と照合用の .sha256）
bash scripts/build_app_mac.sh
```

- 作った Mac のフォルダの場所（ユーザー名入り）が実行ファイルに残らないよう、エンジンは `-ffile-prefix-map`、アプリは `--remap-path-prefix` で
  ソースの場所を置き換えて作り、`build_app_mac.sh` の最後に残っていないかを確かめる

- `git clone --recursive` は使わない（NeMo-Speech.cpp が持つ、話者判定に要らない部品と大容量ファイル置き場のデータまで落ちてくる）
- エンジンの確かめ（依存が OS 標準だけ・動く macOS の下限・M1 に無い命令が無いか）は `scripts/check_engines_mac.sh`（`build_engines_mac.sh` の最後に自動で走る）
- AI モデルは、アプリが初回にダウンロードする（リポジトリには入れない）

## 署名

- 何も渡さなければ簡易署名（ad-hoc。`src-tauri/tauri.conf.json` の `signingIdentity` が `-`）で作る。**ソースから自分で作る人はこれでよい**。
  ただし簡易署名は作るたびに中身が変わるので、macOS には作り直した版が別のアプリに見える（初めて開くときと同じ確かめが要り、
  フォルダへのアクセスの許可も聞かれ直す）
- 配る版は、作る人のキーチェーンにある自己署名の証明書で署名する: `KIKIWAKE_SIGN_IDENTITY="証明書の名前" bash scripts/build_app_mac.sh`。
  同じ証明書で署名し続けると、版をまたいでも macOS が同じアプリとして扱う。Apple の公証はしていないので、「このまま開く」の手順は変わらず要る。
  証明書の鍵は公開のリポジトリに入れない
- 署名したあとに .app の中を書き換えない。`build_app_mac.sh` と `make_dmg.sh` が `codesign --verify --deep --strict` で確かめる
  （.dmg を作ったあと、.dmg の中の .app も）。署名が壊れていると「壊れているため開けません」になり、設定から開く道が無くなる

## 動かす・確かめる

```bash
(cd ui && npm run dev)                                          # 画面だけを見本のデータで（http://localhost:1430）
(cd src-tauri && ../build/tools/node_modules/.bin/tauri dev)    # 開発用のビルドで本物のエンジンにつなぐ

(cd core && cargo test --release)                               # 中核のロジック
(cd src-tauri/engine && cargo test --release)                   # 処理の流れ（作業フォルダの掃除など）
(cd ui && npm test && npm run typecheck)                        # 画面の計算の部分と型
```

`scripts/e2e_mac.sh` は、開発用のビルドにだけ入る操作役が、アプリの中で画面のボタンを押して自動で通します
（`boot` は起動だけ。`synth`（日本語の通し・順番待ち・処理中にほかの録音を開く）・`en`（英語の Mac のまね）・`history`（録音の一覧と閉じたときの状態。2回起動する）・
`setup`（準備）・`photo`（説明書の写真）などは、確かめ用の録音とモデルの置き場所が要るので、スクリプトの先頭を見てください）。
動いている間は Kikiwake の窓が開くので、触らないでください。画面がロックされていると窓が見えず画面の台本が止まるので、スクリプトは始めずに知らせます。

## リポジトリの中身

| 場所 | 中身 |
|---|---|
| `core/` | 中核のロジック（Rust）: 語と話者の区間の突き合わせ、話者カード、名前の手がかり、繰り返しの検出、保存の書式 |
| `src-tauri/` | アプリの外枠（Tauri 2）。`src/` は画面が呼ぶ関数とメニュー、`engine/` は Tauri に頼らない処理の流れ（エンジンの呼び出し・作業フォルダ・モデルのダウンロード・保存・新しい版の確認）、`engines/` は自作のエンジン（音声の取り出し `decode-avf`・話者判定 `kikiwake-diar`）、`dev/` は開発用のビルドだけの操作役 |
| `ui/` | 画面（React・TypeScript・Vite）。[ui/README.md](../ui/README.md) |
| `contract/` | 画面とエンジン側の受け渡しの約束（データの形・関数・見本データ）。[contract/README.md](../contract/README.md) |
| `third_party/` | エンジン 2 つ（whisper.cpp・NeMo-Speech.cpp。git submodule で版を固定。中身は変えない） |
| `scripts/` | エンジンのビルド、.dmg、ライセンス一覧（`make_notices.py`）、見本の仮の音（`make_mock_audio.py`）、操作役（`e2e_mac.sh`） |

## 決まりごと

- 画面は外から何も読み込まない（CSP で塞いでいる。書体は Mac のもの）。送信やテレメトリは入れない。
  通信は、AI モデルのダウンロード（huggingface.co）と、起動したときの新しい版の確認（GitHub の最新のリリースの版の番号）だけで、どちらもエンジン（Rust）が行う
- 使う部品を足したり版を上げたりしたら、`python3 scripts/make_notices.py` でライセンス一覧（`THIRD_PARTY_NOTICES.txt`）を作り直す
- 見本の音声（`contract/fixtures/samples/`）は仮の音だけにする。Mac の読み上げの声で作った音声は公開の場で配れない（`contract/README.md`）
