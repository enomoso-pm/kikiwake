# Kikiwake（聞き分け）

> **English:** Kikiwake is a macOS app that turns meeting recordings into speaker-labeled transcripts, entirely on your Mac.
> The app is available in **Japanese and English**. Transcription currently supports **Japanese recordings only**.

会議の録音・録画から、「誰が・何を話したか」が分かる文字起こしを作る Mac のアプリです。
**音声も文字も、この Mac の中だけで処理します。**

![話者に名前を付ける画面](docs/images/naming.png)

## できること

- 録音・録画（.m4a・.mp3・.wav・.mp4・.mov）をドラッグするだけで、話者ごとに分けて文字起こしする
- 話者ごとに声を聞いて名前を付ける。自己紹介など、名前の手がかりも出す
- 文字起こしを確かめ、行ごとの名前や文字を直してから保存する（.md・.txt・.json）
- 左の録音の一覧で、文字起こし中・順番待ち・前に文字起こしした録音を行き来する（文字起こしを待つ間も、ほかの録音を開ける）
- 4 時間ほどの長い録音でも、メモリを使いすぎずに最後まで文字起こしする
- 画面共有の録画から、マニュアルの素材（場面ごとの画面の絵と、その間の発言をまとめた zip）を書き出す。AI に渡して手順書を書かせるための説明（README.md）入り。
  会議アプリの参加者の枠は見分けられたときに外し、カメラに映った人は黒く塗る
- 画面は日本語と英語（Mac の言語に合わせて始まり、窓の右上で切り替えられる。保存するファイルの見出しなども画面の言語で）。文字起こしできるのは、今は日本語の録音だけ

| 新しい録音 | 文字起こし |
|---|---|
| ![新しい録音の画面](docs/images/file-selected.png) | ![文字起こしの画面](docs/images/result.png) |

## 必要なもの

- Apple シリコン（M1 以降）の Mac と、macOS 14 以降
- メモリ 16GB 以上をおすすめ（8GB の Mac では注意が出ます。長い録音は、ほかのアプリを閉じてから文字起こししてください）
- 空き容量 4GB 以上（AI モデル約 3.2GB と作業用）
- 初回だけインターネット（AI モデルをダウンロードするため）

いまのところ、確かめたのは MacBook Air（M4・16GB）と macOS 26 の組み合わせだけです。

## 入れ方

1. [Releases](https://github.com/enomoso-pm/kikiwake/releases) から `Kikiwake_<版>_aarch64.dmg` を落とします
2. 開いて、「Kikiwake」を「アプリケーション」にドラッグします
3. 初めて開くときだけ、macOS の確かめが要ります（.dmg の窓にも、同じ手順を実物の画面の絵で載せています）。Kikiwake は Apple の有料の開発者登録をしていないので、そのままでは「開けません」と出ます
   - **macOS 15 以降**:
     1. 「アプリケーション」の「Kikiwake」を開きます。「“Kikiwake”は開いていません」という警告が出たら「完了」を押します（「ゴミ箱に入れる」は押さないでください）。この警告は開き直しても出るので、そのまま次へ進みます
     2. .dmg の中の「設定を開く」をダブルクリックします。「システム設定」の「プライバシーとセキュリティ」の、「セキュリティ」の欄が開きます（アップルメニュー →「システム設定」→「プライバシーとセキュリティ」と進み、右側を下へ送っても同じです）
     3. 「お使いのMacを保護するために“Kikiwake”がブロックされました。」の横の「このまま開く」を押し、パスワードを入れます
     4. 「“Kikiwake”を開きますか?」と出たら「このまま開く」を押すと開きます（出ないときは、Kikiwake を開き直してください）
   - **macOS 14**: Finder で「Kikiwake」を右クリック →「開く」→ もう一度「開く」
   - 2 回目からは普通に開けます。新しい版に入れ替えたときは、もう一度この手順が要ります
4. 「書類」「デスクトップ」「ダウンロード」や外付けのドライブ、Google ドライブなどにある録音を使うと、macOS が「フォルダ内のファイルへのアクセス」を尋ねることがあります。「許可」を押してください（録音を読み込み、文字起こしを同じフォルダに保存するために使います）

落としたファイルが本物かは、Releases に載せた照合用の値（SHA-256）と `shasum -a 256 Kikiwake_<版>_aarch64.dmg` の結果が同じかで確かめられます。

## 使い方

窓の左に録音の一覧、右に選んだ録音が出ます。

1. **準備**（初回だけ）: 動作条件を確かめて、AI モデル（約 3.2GB）をダウンロードし、「はじめる」を押します。あとから一覧の下の「AI モデルと動作条件」で見返せます
2. **新しい録音**: 録音・録画を窓にドラッグします（または「ファイルを選ぶ」）。どの画面でも、窓に落とせば新しい録音になります。「文字起こしをはじめる」を押します
3. **文字起こし中**: 待ちます。M4 の Mac で録音の長さの 0.2〜0.4 倍ほど（68 分の録音で約 15 分）。文字起こし中は Mac がスリープしません。待つ間も、一覧からほかの録音を開けます。文字起こし中に選んだ録音は順番待ちになり、前のものが終わると自動ではじまります
4. **話者**: 話者ごとに「▶ 再生」で声を聞き、名前を入れます。名前を付けなくても保存できます（「話者A」などのまま）
5. **文字起こし**: 確かめて、必要なら直して、右下の「保存…」で保存します（「話者」のタブからも保存できます）。出てくる窓で形式（.md・.txt・.json）と保存先を選びます。保存先は初めは元のファイルと同じフォルダで、ファイルの名前は「〈元の名前〉_文字起こし.md」のように録音の名前入りです（英語の画面では「〈元の名前〉_transcript.md」）。一度選んだ形式と保存先は、次からもそのまま使います

**録音の一覧**: 文字起こし中・順番待ち・前に文字起こしした録音が並び、状態の印（文字起こし中・順番待ち・中断・保存前・保存済み・保存後に手直し）で、どこまで済んだかが分かります。名前を付けた録音は、「松本・田中ほか2人」のように話者の名前も出ます。
開くと、閉じたときのタブ（話者・文字起こし）に、入れかけの名前や直した文字のまま戻ります（保存していなくても残ります）。見ていない間に文字起こしが終わった録音には「●」が付きます。
一覧の行の右上の「…」から、保存したファイルを Finder で表示したり、要らなくなった録音を削除したりできます（削除しても、元のファイルと保存したファイルは消えません）。途中で中断した録音は「再開する」で続きから文字起こしできます。
元のファイルを移したり、書き換えたりしたときは、録音の上に帯が出て、選び直す・結び直すことができます。

**マニュアルの素材**: 画面共有の録画（.mp4・.mov）を選んだときは、「文字起こしをはじめる」の前に「マニュアル用に、画面の絵も取り出す」にチェックを入れると、文字起こしと同時に画面を読み取ります（2 時間半の録画で約 2 分）。
保存の窓で「マニュアルの素材」の「.zip」にチェックを入れると、「〈元の名前〉_マニュアル素材.zip」を保存します。中身は、場面ごとの画面の絵（frames/）、区間ごとの絵と発言（timeline.md）、文字起こし（transcript.md）、AI への説明（README.md）です。
AI（Claude など）にこの zip を渡し、「README.md を読んで、その手順でマニュアルを作って」と頼んでください。zip を受け付けるかは、AI のサービスと設定によります。
絵は共有した画面の部分だけを切り出し（会議アプリの参加者の枠は、見分けられたときに外します）、カメラに映った人は黒く塗ります。それでも、画面に映っていたほかの情報（通知・メール・お客さまの情報など）や、見分けられなかった参加者の名前が残ることがあります。渡す前に zip の中の frames を確かめてください。
前に文字起こしした録画も、「新しい録音」から選び直してチェックを入れれば、文字起こしは使い回して画面だけを読み取ります。

**新しい版**: 起動したときに新しい版を確かめ、あれば新しい録音の画面に知らせます。自動では入れ替えません。「内容と手順を見る」で、更新内容と入れ替えかたを確かめてください。確かめるのをやめるときは、一覧の下の「AI モデルと動作条件」で「起動したときに新しい版を確かめる」を外します。

## 音声と文字の扱い

- 文字起こしはすべてこの Mac の中で行います。音声も文字も外に送りません。使い方の送信（テレメトリ）もありません
- インターネットを使うのは、初回の AI モデルのダウンロード（huggingface.co）と、起動したときの新しい版の確認（GitHub）だけです。新しい版の確認は、最新の版の番号を尋ねるだけで、録音や文字は送りません（GitHub には、この Mac の IP アドレスと Kikiwake の版の番号が伝わります。「AI モデルと動作条件」で止められます）
- マニュアルの素材の zip は、保存の窓で選んだときにだけ作ります。マニュアル用にした録画では、画面の読み取りの結果（場面の区切りの時刻など。数十 KB）を作業用のファイルに置き、絵は保存のときに元の録画から取り出します
- 作業用のファイル（録音の一覧）は `~/Library/Application Support/Kikiwake/jobs/` に置きます（1 時間の録音で約 8MB）。使い終えた録音から取り出した音声は、別の録音を始めたときとアプリを終えるときに消します。文字起こし・名前・手直しは、一覧の「…」から削除するまで残ります。元の録音・録画と、保存したファイルには触りません
- ログ（`~/Library/Logs/Kikiwake/kikiwake.log`）には、文字起こしの段階・時刻・エラーと、新しい版の確認の結果だけを書きます。文字起こしの中身と、録音の名前・場所は書きません
- 会議などを録音するときは、話す人の了承を得てください

## 消し方

アプリを「アプリケーション」からゴミ箱に入れたうえで、次のフォルダを消します。

| フォルダ | 中身 |
|---|---|
| `~/Library/Application Support/Kikiwake` | AI モデル（約 3.2GB）と録音の一覧（作業用のファイル） |
| `~/Library/Caches/Kikiwake` | 画面の一時ファイル（前の版の作業用のファイルは、新しい版を開くと上へ移す） |
| `~/Library/Logs/Kikiwake` | ログ |

## 困ったとき

- エラーの帯の「詳細をコピー」の中身と、ログの最後のほうを添えて、[Issue](https://github.com/enomoso-pm/kikiwake/issues) で知らせてください（どちらにも文字起こしの中身は入りません。ファイルの場所はホームフォルダを「~」にして出します）
- 会社のネットワークなどで AI モデルをダウンロードできないときは、別の回線で次の 2 つを落とし、`~/Library/Application Support/Kikiwake/models/` に同じ名前で置いてください

| ファイル | 大きさ | SHA-256 | ダウンロード元 |
|---|---|---|---|
| `ggml-large-v3.bin` | 3,095,033,483 バイト | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` | [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3.bin) |
| `Nemotron-3-Diarization.q8_0.gguf` | 107,012,128 バイト | `08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1` | [huggingface.co/nvidia/Nemotron-3-Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization/resolve/f667ed73aee57d40cc39428eb768b4fd87a0a29e/Nemotron-3-Diarization.q8_0.gguf) |

## しくみ

| 部分 | 使っているもの |
|---|---|
| 音声の取り出し | macOS の AVFoundation（自作の `decode-avf`） |
| 話者の判定 | [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) と Nemotron 3 Diarization（自作の `kikiwake-diar` で少しずつ流し込む） |
| 書き起こし | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) と Whisper large-v3（GPU は Metal） |
| 突き合わせ・名前の手がかり・保存 | Rust（`core/`） |
| 画面の読み取り（マニュアルの素材） | macOS の AVFoundation・Vision（`decode-avf`）と Rust（`core/`。場面の区切り・参加者の枠の切り出し） |
| 画面と外枠 | [Tauri 2](https://tauri.app/)・React・TypeScript |

架空の 4 人会議（約 2 分 40 秒）での精度: 話者の誤り率（DER）12.7%、文字の誤り率 2.8%、話者の正解率 94%。

## 作り方（開発する人向け）

ソースからの作り方・テスト・リポジトリの中身は [docs/BUILD.md](docs/BUILD.md) にあります。

## ライセンス

Kikiwake は [MIT ライセンス](LICENSE) です。使っているもののライセンスの一覧は [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) にあり、アプリのメニューの「ヘルプ」→「ライセンス（全文）」からも見られます。

AI モデルはアプリに含めず、初回にそれぞれの配布元からダウンロードします: Whisper large-v3（OpenAI・MIT）、Nemotron 3 Diarization（NVIDIA・OpenMDW 1.1）。

---

## English

Kikiwake (聞き分け, "telling voices apart") is a macOS app that creates speaker-labeled transcripts from meeting recordings.
Everything runs locally on your Mac: no audio or text is sent anywhere, and there is no telemetry. The only network access is the one-time download of the AI models from Hugging Face, and a check for a new version on GitHub at launch (it only asks for the latest version number; GitHub sees your IP address and your Kikiwake version; you can turn this off in “AI models & requirements”). New versions are never installed automatically.

- **Language:** The app is available in **Japanese and English**. It starts in your Mac's language, and you can switch at the top right of the window. Saved transcripts follow the app's language. Transcription currently supports **Japanese recordings only**.
- **Requirements:** Apple silicon Mac, macOS 14 or later, 16 GB of memory recommended, about 4 GB of free disk space.
- **Recordings list:** The list on the left shows recordings being transcribed, queued, and done, each with a status (Transcribing, Queued, Stopped, Not saved yet, Saved, Edited since saving). You can open another recording while one is being transcribed. Reopening returns you to where you left off, including names you were typing and text you edited (even if you didn't save a file). Stopped recordings can be resumed. Removing a recording from the list deletes only Kikiwake's working data, not your recording or saved transcripts.
- **Materials for a manual:** For a screen-sharing recording (.mp4 or .mov), check “Also take screen images for a manual” before starting. When saving, check the `.zip` under “Materials for a manual” to save a zip with an image of each scene, the remarks made during it, the transcript, and a README that tells an AI (such as Claude) how to write a step-by-step manual from them. The images are cut down to the shared screen (the meeting app's participant panel is removed when it can be told apart) and people on camera are blacked out; other things that were on screen may remain, so check the images before you share the zip. Whether an AI service accepts a zip depends on the service and its settings.
- **Install:** Download the `.dmg` from [Releases](https://github.com/enomoso-pm/kikiwake/releases) and drag Kikiwake to Applications. The app is not notarized by Apple, so on first launch go to System Settings → Privacy & Security and click "Open Anyway" (macOS 15 or later; the “設定を開く” (Open Settings) icon in the `.dmg` opens that screen). Step-by-step instructions are in `Read Me First.txt` in the `.dmg`.
- **Built with:** whisper.cpp (Whisper large-v3), NeMo-Speech.cpp (Nemotron 3 Diarization), Tauri, React, and Rust.
- **License:** MIT. See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) for third-party licenses.
