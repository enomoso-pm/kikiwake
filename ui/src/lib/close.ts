// 処理中に閉じるときの確かめの本文の選び方（2026-09-27 決定: 何が残り、何を破棄するかを正確に書く）
import type { Stage } from "@contract/types";

export type CloseCase = "beforeSeparation" | "converting" | "finishing";

/**
 * 処理中の録音の段階から、閉じたときに何が残るかを決める（エンジンの作り: src-tauri/engine/src/job.rs）。
 * - 声の聞き分けが済む前（前回の聞き分けを使い回していなければ）: 何も残らない。再開すると最初から
 * - 声を文字にしている間: 聞き分けの結果だけ残る（90 分を超える録音は、約1時間ずつ書き終えた区切りも）
 * - まとめている間: 文字にした結果まで残る。再開するとすぐに終わる
 */
export function closeCase(stage: Stage, reusedSeparation: boolean): CloseCase {
  if (stage === "merge") return "finishing";
  if (stage === "transcribe" || reusedSeparation) return "converting";
  return "beforeSeparation";
}
