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
| `history_example.json` | 履歴 | 作例: 履歴の一覧（版9。書き終えた・途中・元ファイルが無い・話者の判定の前に止まった・元ファイルが変わった）。見本では開くと合成会議の結果を出す |
| `saved_files/*` | 5 | 保存されるファイルの見本。手直しが無いとき（`transcript.md`・`transcript_named.md`・`transcript_named.txt`）と、`edits_example.json` を当てたとき（`edited/`） |

- 見本の書き起こしは Whisper large-v3 の実際の出力（文脈を引き継がない設定）で、句読点が少ないことや「PM」→「BM」の聞き間違いもそのままにしてある
- 合成会議では、話者の判定が序盤の田中・鈴木の自己紹介を「誰の声か決めきれない」として出さず、確認用に回っている（C++ 版の既定の後処理）。
  その自己紹介は `unresolved_hints.json` で名前の手がかりとして出す
- **`samples/*.wav` は声ではなく仮の音**（話者ごとに高さの違う短い音。`python3 scripts/make_mock_audio.py` で作る）。
  合成会議の声は Mac の読み上げの声で作っていて、その声は公開の場で配れない（macOS の使用許諾）ため。見本の画面で鳴らす音だけの違いで、データは実際の出力
- 見本データは、合成会議の台本・音声・計測の結果から開発用のツール（公開していない）で作っている。形を変えたら、そのツールで作り直す

## 作業用のファイルと保存先

- 作業用のファイル（取り出した音声・話者判定・書き起こし・names.json・サンプル音声・閉じたときの状態など）は **作業フォルダ** に置く
  （Mac `~/Library/Application Support/Kikiwake/jobs/<録音ごとの ID>/`。そのまま履歴になる。版8）。同期フォルダ（Google ドライブ等）に置かない。
  前の置き場所（`~/Library/Caches/Kikiwake/`）の作業フォルダは、アプリを開いたときに移す
- 取り出した音声と行の再生の切り抜きは、その録音を使い終えたら消す（別の録音を始めたとき・アプリを終えるとき。`src-tauri/engine/src/tidy.rs`）。
  作業フォルダを丸ごと消すのは、利用者が履歴から消したときだけ（`src-tauri/engine/src/history.rs`）
- 保存先（既定は元ファイルと同じフォルダ。画面は利用者が一度選んだ保存先を覚えている。版12）には、利用者が保存したファイルだけを書く。
  ファイル名は録音の名前入りの「<元の名前>_文字起こし.md」など（英語の画面では「<元の名前>_transcript.md」。版12。版11までは `transcript_named.md` など）。
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
- **版7（2026-09-27）** 画面の言語をエンジンに知らせる
  - `setLocale(locale)`・型 `Locale`（"ja" | "en"）: 画面が起動したとき・言語を切り替えたときに呼ぶ。エンジンはこれで Mac のメニューを作り直し、
    既定の保存先の名前（英語では「<名前>_transcript/」）と、保存するファイルの中の言葉を合わせる。覚えておき、次に開いたときのメニューも最初からその言語で
  - 英語で保存したファイル: .md は見出し・確認用の欄を英語に、.md・.txt・.json の「話者A」「不明」を「Speaker A」「Unknown」に（付けた名前はそのまま・ファイル名は同じ）。
    日本語で保存したファイルは今までと一字一句同じ
  - 既定の保存先の名前は、処理が終わったとき（`JobDone.outDir`）・ファイルを調べたとき（`FileInfo.previous.outDir`）の言語で決まる。あとで言語を切り替えても、出した保存先は変えない
  - エンジンが返す文（エラー・動作条件・「話者A」など）は今までどおり日本語で、訳すのは画面（`ui/src/i18n` の `engine`）
- **版8（2026-09-27）** 履歴と、閉じたときの状態を残す
  - `listHistory()`・型 `HistoryItem`・`HistoryStatus`: 過去の録音の一覧（最後に使った順）。書き終えた録音と、途中の録音（中止した・止まった・処理中に閉じた）の両方
    （2026-09-27 決定: 状態に関わらず残す）。元ファイルが今もあるか（`sourceAvailable`）、ファイルに保存していない手直しがあるか（`unsavedEdits`）も
  - `openHistory(jobId)`・型 `HistoryOpened`: 書き終えた録音を処理せずに開く（元ファイルがあれば再生のために音声を取り出すだけ）。元ファイルが無くても開け、行の再生だけできない。
    途中の録音は今までどおり `startJob(path)` で続きから
  - `deleteHistory(jobId)`: 作業フォルダを丸ごと消す（1件ずつ。画面は確かめてから呼ぶ）。元の録音・録画と保存したファイルは消さない
  - `relinkSource(jobId, path)`: 元ファイルを選び直す（大きさと長さが同じなら結び直し、jobId が変わる）。違えば新しいエラー `not_same_recording`
  - `saveDraft(jobId, draft)`・型 `JobDraft`・`JobDone.draft`: 閉じたときの状態（名前付けで入れかけた名前・結果の画面の手直しと画面）を作業フォルダに置き、
    開き直すと（履歴から・同じファイルを選び直して）戻る。形は画面が決める。書き起こしが変わったら返さない
  - 保存していない手直しがあっても、閉じる・別の録音へ移るときに確かめない（手直しは残るため。2026-09-27 決定）。版6の `setUnsavedChanges` は無くした。処理中に閉じるときの確かめは今までどおり
  - 書き終えた書き起こしは、アプリを更新しても使い回す（`FileInfo.previous.resultReusable` は「書き終えている」で決める。前は書き起こしに使ったプログラムが同じときだけで、更新のたびにやり直していた）
  - 作例 `fixtures/history_example.json`（一覧の4件: 書き終えた・途中・元ファイルが無い・話者の判定の前に止まった）
- **版9（2026-09-27）** 録音が主役の画面（案A: 左に録音の一覧・右に選んだ録音。処理中にほかの録音を開ける）
  - `HistoryItem.sourceState`・型 `SourceState`（"ok" | "missing" | "changed"）: 元ファイルが見つからないのか、場所にあるが変わった（大きさか更新日時が違う）のかを分ける。
    `sourceAvailable` は残す（ok のときだけ true）
  - `HistoryItem.saved`: 文字起こしをファイルに保存したことがある（状態の印「保存前」「保存済み」「保存後に手直し」のため）。`JobDraft.savedOnce` から決める
    （前の版の閉じたときの状態は `savedFiles` が空でなければ保存したとみなす）
  - `JobDraft.savedOnce`: 保存したことがある。保存したあとで名前を変えると `savedFiles` は空に戻るが、これは残る。画面が保存したら true にする
  - `HistoryItem.namedSpeakers`・型 `NamedSpeakers`: 付けた名前（同じ名前は1つ・発言の多い順）と、名前を付けていない話者の数。一覧の行に「松本・田中ほか2人」と出す。名前を確定していなければ省略
  - `FileInfo.previousChanged`: 同じ場所の録音を前に文字起こししていて、そのあとファイルが変わった（新しい録音として扱う）ときの、前の処理日
  - エンジンの動き: 処理中にほかの録音を開いても（`openHistory`・`relinkSource`）、処理中の録音の取り出した音声を消さない（前は消していた。今までの画面は処理中にほかの録音を開けなかったので起きていなかった）。
    別の録音を始めても、画面で見ている録音（最後に開いた・名前付け・結果・行の再生をした録音）の音声は消さない。
    行の再生で取り出した音声が無ければ、元ファイルから取り出し直す（68 分の録音で約1秒）。
    処理の終わりを知らせた直後に `startJob` を呼んでも断らない（前の処理が片付けて抜けるのを待つ。画面は終わりの知らせで順番待ちの次を始める）
  - 関数は増えていない。見本 `history_example.json` に版9 の欄を足した（元ファイルが変わった録音を1件足した）
- **版10（2026-09-27）** 新しい版の知らせ（自動では入れ替えない）
  - `checkUpdate()`・型 `UpdateInfo`: 起動したときに画面が一度だけ呼ぶ。エンジンが GitHub の最新のリリース（enomoso-pm/kikiwake。下書きと試用版は入らない）に尋ね、
    今の版より新しければ、版・題・更新内容（リリースの本文）・公開日・ページを返す。無い・確かめられないときは null（エラーにしない。ログに一行）
  - `openReleasePage(version)`: その版のリリースのページをブラウザで開く。URL はエンジンが版の番号から作る（画面から URL は受けない・GitHub が返す URL も使わない）
  - 問い合わせるのはエンジンで、画面の安全の設定（CSP の connect-src）は緩めない。送るのは HTTPS の問い合わせだけ（GitHub には IP アドレスと版の番号が伝わる。録音や文字は送らない）
  - 開発用のビルドだけ、環境変数 `KIKIWAKE_UPDATE_JSON` に GitHub の答えの形の JSON を置くと、問い合わせずにそれを読む（操作役の筋書き用）

- **版11（2026-09-29）** 保存の失敗を分ける
  - `ErrorCode` に `not_writable`（保存先のフォルダに書き込めない。書き込む許可が無い・読み取り専用のディスク）と `save_failed`（そのほかの理由で保存できない）を足した。
    `saveOutputs` が返す。前は `engine_failed`（「書き起こしの途中で問題が起きました」）で、保存の失敗に合わない文だった。空き容量が無いときは今までどおり `disk_full`
  - 関数・型の形は変わらない。見本 `errors.json` に2つ足した

- **版12（2026-09-29）** 保存を「保存…」の窓に（「保存周りの情報が多すぎる」という指摘から）
  - 保存するファイルの名前を録音の名前入りに: 「<元ファイルの名前（拡張子なし）>_文字起こし.<形式>」（英語の画面では「_transcript」）。名前を付けたかどうかでは変えない。
    `SaveRequest.dir` にそのまま書く（フォルダは作らない）。中身は今までどおり Python 版と同じ（core が作ったものの名前だけ、エンジンが付け替える）。
    版11までの Python 版と同じ名前（`transcript_named.md`／`transcript.md`）は、2026-09-26 の決定を戻した（元の UI 画面仕様書 §8.9 の形）
  - 保存先の既定（`JobStarted.outDir`・`JobDone.outDir`・`HistoryOpened.outDir`・`FileInfo.previous.outDir`）を、元ファイルと同じフォルダに（元のフォルダが無ければ書類フォルダ）。
    版11までは元ファイルの隣の「<名前>_文字起こし/」。画面は「保存…」の窓で選んだ形式と保存先を覚え、選んでいなければ既定に保存する
  - `JobDraft.lastSavedFiles`: 最後に保存したファイル（保存したあとで名前を変えて `savedFiles` が空に戻っても、次に保存するまで残す）。画面が書く
  - `HistoryItem.savedFiles`: エンジンが閉じたときの状態の `lastSavedFiles`（無ければ `savedFiles`）を返す。一度も保存していなければ省略。
    一覧の行の「…」の「Finder で表示」に使う（保存の帯の「Finder で表示」は外した）
  - `not_writable` の文を「「保存…」の保存先で、別のフォルダを選んでください」に（「保存先を変える」のボタンが無くなったため）。見本 `errors.json` も
  - 関数は増えていない