# 受け渡しの約束（contract）

画面（`ui/`）と、エンジン側（`src-tauri/`・`core/`）の間の約束。ここを正とする。

| ファイル | 中身 |
|---|---|
| `types.ts` | やり取りするデータの形 |
| `api.ts` | 画面が呼ぶ関数の一覧（`KikiwakeApi`） |
| `format.ts` | 表示の書式（時刻・本文1行。保存するファイルと同じ規則） |
| `fixtures/` | 見本データ。架空の4人会議（合成会議）を処理した実際の出力と、手で作った作例 |

画面の見本実装 `ui/src/api/mock.ts` は fixtures を返し、本物の実装 `ui/src/api/tauri.ts` は Tauri の外枠（`src-tauri/`）を呼ぶ。
型は `contract/` から直接 import する（`ui/` にコピーして書き直さない）。

## 見本データ（fixtures/）

「作例」は、注意表示・エラー表示を画面で確かめるために手で作ったもの。それ以外は合成会議の実際の出力。

| ファイル | 画面 | 中身 |
|---|---|---|
| `environment_mac.json` | 1 | Mac の実際の値（macOS 26.2・Apple M4・16GB） |
| `environment_windows_example.json` | 1 | 作例: Windows・NVIDIA の GPU |
| `environment_problem_example.json` | 1 | 作例: メモリの警告と空き容量のエラー（`canRun: false`） |
| `models_initial.json` | 1 | 取得前の2モデル（どちらも必須。合わせて約3.2GB） |
| `models_downloading_example.json` | 1 | 作例: 取得の途中 |
| `file_info.json` | 2 | 合成会議（164秒） |
| `file_info_68min_example.json` | 2 | 作例: 68分・前回の話者判定を使い回せる（書き起こしはまだ無い `resultReusable: false`） |
| `file_unsupported_example.json` | 2 | 作例: 非対応の形式 |
| `job_progress_example.json` | 3 | 68分の録音を処理したときのイベントの流れ（`atSec` の間隔で再生。見本では時間を縮める） |
| `speakers.json` ＋ `samples/` | 4 | 合成会議の話者カード4枚とサンプル音声（`audioPath` は `fixtures/` からの相対パス） |
| `speakers_warnings_example.json` | 4 | 作例: 手がかり2人分（話者C）と発言2%未満（話者E） |
| `unresolved_hints.json` ＋ `samples/確認用_*.wav` | 4 | 確認用に回った部分の名前の手がかり（合成会議では田中・鈴木の自己紹介）と、その声の音声 |
| `names.json` | 4→5 | 台本どおりに名前を付けた対応 |
| `transcript.json` / `transcript_named.json` | 5 | 結果（ラベル版・実名版）。確認用が1件ある。行（`Line`）に `id` と `label` が付き、実名版も行は名前でまとめない |
| `edits_example.json` | 5 | 結果の画面での手直しの作例（確認用の行 u2 を「田中」で確定・行 u8 だけ「鈴木（デザイナー）」・行 u0 の「BM」を「PM」に） |
| `transcript_unresolved_example.json` | 5 | 作例: 確認用に定番の誤認識文 |
| `transcript_repeat_example.json` | 5 | 作例: 書き起こしが同じ文の繰り返しになって読めない範囲（`repeats`。本文の上の注意の帯） |
| `errors.json` | 全体 | エラーの種類ごとの表示文 |
| `saved_files/*` | 5 | 保存されるファイルの見本。手直しが無いとき（`transcript.md`・`transcript_named.md`・`transcript_named.txt`）と、`edits_example.json` を当てたとき（`edited/`） |

- 見本の書き起こしは Whisper large-v3 の実際の出力（文脈を引き継がない設定）で、句読点が少ないことや「PM」→「BM」の聞き間違いもそのままにしてある
- 合成会議では、話者の判定が序盤の田中・鈴木の自己紹介を「誰の声か決めきれない」として出さず、確認用に回っている（C++ 版の既定の後処理）。
  その自己紹介は `unresolved_hints.json` で名前の手がかりとして出す
- **`samples/*.wav` は声ではなく仮の音**（話者ごとに高さの違う短い音。`python3 scripts/make_mock_audio.py` で作る）。
  合成会議の声は Mac の読み上げの声で作っていて、その声は公開の場で配れない（macOS の使用許諾）ため。見本の画面で鳴らす音だけの違いで、データは実際の出力
- 見本データは、合成会議の台本・音声・計測の結果から開発用のツール（公開していない）で作っている。形を変えたら、そのツールで作り直す

## 作業用のファイルと保存先

- 作業用のファイル（取り出した音声・話者判定・書き起こし・names.json・サンプル音声など）は **アプリのキャッシュ** に置く
  （Mac `~/Library/Caches/Kikiwake/`）。同期フォルダ（Google ドライブ等）に置かない
- 取り出した音声と行の再生の切り抜きは、その録音を使い終えたら消す（別の録音を始めたとき・アプリを終えるとき）。
  30 日選び直していない録音は丸ごと消す（`src-tauri/engine/src/tidy.rs`）
- 保存先（既定は元ファイルの隣の「<名前>_文字起こし/」）には、利用者が保存したファイルだけを書く。ファイル名は `transcript_named.md` など。
  同じ名前があれば `SaveResult.existing` を返し、画面が上書きしてよいか確かめる

## 変え方

- `types.ts` / `api.ts` を変えたら、版を上げて下の履歴に書き、`ui/src/api/mock.ts` と `ui/src/api/tauri.ts` を合わせる

## 履歴

- 版1（2026-09-25）初版
- **版2（2026-09-26）**
  - 書き起こしは正確さ優先（Whisper large-v3）だけにした（速さ優先の turbo を廃止。2つのモデルは大きすぎるため）:
    `Quality` 型・`startJob` の `quality`・`ModelId` の `whisper-large-v3-turbo`・`ModelInfo.required` を削除。
    `FileInfo.estimates`（品質ごと）→ `estimate`（1本）。モデルの表示名 "書き起こし（正確さ優先）" → "書き起こし"
  - 確認用に回った部分の名前の手がかりを追加: 型 `UnresolvedHint` / `UnresolvedClip`、関数 `getUnresolvedHints(jobId)`、
    見本 `unresolved_hints.json` と `samples/確認用_*.wav`。聞かせる音声は名乗った位置の約1秒前から。手がかりは名前付けの画面に出す
  - 注意 `mixed_voices` は「1つのラベルに違う名前の自己紹介が2人分以上」のときだけ出す（呼びかけ直後だけの名前は数えない）
- **版3（2026-09-26）** 結果の画面の手直しと再生
  - 結果の画面の行を `Line`（`Utterance` に `id` と `label` を足したもの）に。`TranscriptView.utterances` / `unresolved` は `Line[]`。
    行は名前を付ける前の区切りで、名前付けをやり直しても `id` も区切りも変わらない。同じ名前のラベルの隣り合う行も画面ではまとめない
  - `LineEdits`（行ごとの名前・確認用の確定・直した文字）を足し、`SaveRequest.edits` で渡す。手直しは画面側が持つ（アプリを閉じると消える）。
    保存では手直しを当ててから、同じ名前の隣り合う行を1行にまとめる（手直しが無ければ移植元の Python 版の実名版と一字一句同じ）
  - `recordingSrc(jobId, startSec, endSec)`（行の再生）
  - 保存: `.txt` は本文の行だけ（確認用は末尾）。同じ名前のファイルがあれば書かずに `SaveResult.existing` を返し、`SaveRequest.overwrite: true` で呼び直すと上書き
  - `FileInfo.previous.processedAt`（前回の処理日）
- **版4（2026-09-26）** 書き起こしの繰り返しの知らせ
  - 書き起こしが同じ文の繰り返しになって読めない範囲を `TranscriptView.repeats`（`RepeatNotice[]`）で渡す。
    書き起こしは止めずに最後まで続け、結果の画面の**本文の上に注意の帯**で知らせる
  - `RepeatNotice`: 開始・終了の時刻、そのうち人が話していた秒数、画面にそのまま出せる文（`message`）。
    人が話していた部分を上書きしたときだけ入れる（無音の部分の誤認識の繰り返しは、確認用の欄に回っていて本文に入らないので入れない）
  - `repeats` は省略できる（無い・空なら何も出さない）。作例 `transcript_repeat_example.json`
  - 動作条件の表示文（`EnvironmentItem.message`）は値を繰り返さない書き方に（例「メモリ 16GB」→「足りています」）。
    `freeDiskGB` は小数第1位まで、`gpu.name` はコア数入り（例「Apple M4 GPU（10コア）」）
- **版5（2026-09-26）** 処理中に窓を閉じるときの確かめ
  - `onCloseRequested(cb)`: 処理中に窓を閉じようとした（⌘Q を含む）ことを知らせる。処理中でなければ届かず、そのまま閉じる
  - `closeApp()`: 処理を止めてアプリを閉じる（話者の判定まで済んでいれば、その結果は残る）
- **版6（2026-09-26）** ドラッグ中の知らせ・閉じる前の知らせ・保存しないまま閉じた結果を戻す
  - `onFileDragOver(cb)`・型 `FileDragOver`: ファイルのドラッグが窓の上にある間の位置（窓の中身の左上からの画面の CSS の座標）。
    窓から出た・落としたら `over: false`。アプリの中では HTML5 の dragenter・dragover が画面に届かない（Tauri が外枠でドラッグを受ける）ため
  - `setUnsavedChanges(unsaved)`: 保存していない手直しがあるかを画面が知らせる。`onCloseRequested` は、処理中か、ここで true の間だけ届く。
    「閉じる操作のたびに知らせる」形は、画面が固まったり起動に失敗したりすると窓を閉じられなくなるので採らなかった
  - `FileInfo.previous.resultReusable`: 前回の書き起こしまでそろっている（同じエンジン・引数・モデル）。始めると書き起こしをやり直さず、
    数秒で名前付けへ進む（取り出した音声は使い終えたら消しているので、元の録音から取り出し直す。68 分の録音で 1.2 秒）。このとき `estimate` は数秒
  - `JobDone.names`: この録音で前に確定した名前（`applyNames` で渡したもの）。名前付けの画面に最初から入れておく。無ければ省略
  - 一度も保存していない結果（手直し無し）のまま閉じる・別の録音へ移るときは、確かめない（同じ録音を選び直せば数秒で戻せるため）
