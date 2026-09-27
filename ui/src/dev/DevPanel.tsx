// 開発用の切替パネル（見本だけ。製品には入れない。UI 画面仕様書 §11・§12）
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { mockDev } from "../api";
import type { MockNotice, MockScenario } from "../api/mock";
import { demoQueue, devSetSource } from "../objects/store";
import { devJump, reloadEnvironment, setDevNames } from "../store/dev";
import { checkForUpdate } from "../store/update";
import { useApp, type Screen } from "../store/state";

const DEV_BORDER = "1px dashed #9a9ea4";

function Option({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        whiteSpace: "nowrap",
        flex: "none",
        font: "inherit",
        fontSize: 12,
        padding: "4px 8px",
        borderRadius: 5,
        border: `1px solid ${active ? "#1d1f22" : "#cfd0cb"}`,
        background: active ? "#1d1f22" : "#fff",
        color: active ? "#fff" : "#1d1f22",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, color: "#6b6f75", fontWeight: 600 }}>{title}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{children}</div>
    </div>
  );
}

const SCREEN_OPTIONS: Array<[Screen, string]> = [
  ["setup", "準備"],
  ["file", "新しい録音"],
  ["processing", "文字起こし中"],
  ["naming", "話者のタブ"],
  ["result", "文字起こしのタブ"],
];

export default function DevPanel() {
  const dev = mockDev;
  const [open, setOpen] = useState(false);
  const [sc, setSc] = useState<MockScenario | null>(() => dev?.scenario() ?? null);
  const [notice, setNotice] = useState<MockNotice | null>(null);
  const screen = useApp((s) => s.screen);

  useEffect(() => dev?.onScenario((s) => setSc({ ...s })), [dev]);
  useEffect(
    () =>
      dev?.onNotice((n) => {
        setNotice(n);
        if (n.kind === "text") window.setTimeout(() => setNotice((cur) => (cur === n ? null : cur)), 3500);
      }),
    [dev],
  );

  if (!dev || !sc) return null;
  const set = (patch: Partial<MockScenario>) => dev.setScenario(patch);
  /** 新しい版の答えを変えて、もう一度尋ねる（製品は起動したときに一度だけ） */
  const setUpdate = async (update: MockScenario["update"]) => {
    set({ update });
    await checkForUpdate();
  };
  const atLeast = (s: Screen) => ["processing", "naming", "result"].indexOf(screen) >= ["processing", "naming", "result"].indexOf(s);

  const panel: CSSProperties = {
    position: "fixed",
    right: 14,
    top: 52,
    zIndex: 40,
    width: 252,
    boxSizing: "border-box",
    maxHeight: "calc(100vh - 70px)",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 14,
    borderRadius: 10,
    border: DEV_BORDER,
    background: "#f1f1ee",
    boxShadow: "0 8px 24px rgba(0,0,0,.12)",
    fontSize: 12,
  };

  return (
    <>
      <button
        type="button"
        title="開発用の切替"
        data-dev-toggle=""
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed",
          // 右端は表示の言語の切り替え（製品にもある）。見本だけのこのボタンはその左に置く
          right: 150,
          top: 12,
          zIndex: 40,
          whiteSpace: "nowrap",
          font: "inherit",
          fontSize: 12,
          padding: "6px 10px",
          borderRadius: 6,
          border: DEV_BORDER,
          background: "#f1f1ee",
          color: "#3d4046",
          cursor: "pointer",
          opacity: 0.85,
        }}
      >
        {open ? "開発用 ✕" : "開発用"}
      </button>

      {open ? (
        <div style={panel}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>開発用の切替</span>
            <span style={{ fontSize: 11, color: "#6b6f75", lineHeight: 1.5 }}>
              アプリの外側（見本のときだけ）。見本データは contract/fixtures の合成会議（架空の4人）
            </span>
          </div>

          <Group title="案A: 開いている録音の元のファイル">
            {(
              [
                ["ok", "ある"],
                ["missing", "見つからない"],
                ["changed-same", "変わった（長さは同じ）"],
                ["changed-diff", "変わった（切った）"],
              ] as const
            ).map(([k, label]) => (
              <Option key={k} label={label} onClick={() => void devSetSource(k)} />
            ))}
          </Group>
          <Group title="案A: 保存したファイル">
            <Option label="ある" active={!sc.savedMissing} onClick={() => set({ savedMissing: false })} />
            <Option label="見つからない（移した・消した）" active={sc.savedMissing} onClick={() => set({ savedMissing: true })} />
          </Group>
          <Group title="案A: 順番待ち">
            <Option label="処理中と順番待ち2件を作る（1件約20秒）" onClick={() => void demoQueue(dev.demoPaths())} />
          </Group>

          <Group title="画面">
            {SCREEN_OPTIONS.map(([s, label]) => (
              <Option key={s} label={label} active={screen === s} onClick={() => void devJump(s)} />
            ))}
          </Group>

          <Group title="データ量">
            <Option
              label="見本（2分44秒・4ラベル）"
              active={sc.data === "sample"}
              onClick={() => {
                set({ data: "sample" });
                if (atLeast("processing")) void devJump(screen);
              }}
            />
            <Option
              label="多い（4時間・10ラベル・確認用60）"
              active={sc.data === "large"}
              onClick={() => {
                set({ data: "large" });
                if (atLeast("processing")) void devJump(screen);
              }}
            />
          </Group>

          <Group title="OS">
            <Option label="Mac" active={sc.os === "mac"} onClick={() => (set({ os: "mac" }), void reloadEnvironment())} />
            <Option label="Windows" active={sc.os === "windows"} onClick={() => (set({ os: "windows" }), void reloadEnvironment())} />
          </Group>

          <Group title="準備の作例">
            {(
              [
                ["normal", "通常"],
                ["warn", "注意あり"],
                ["block", "進めない"],
                ["partial", "取得途中"],
                ["failed", "取得失敗"],
                ["ready", "取得済み"],
              ] as const
            ).map(([k, label]) => (
              <Option key={k} label={label} active={sc.setup === k} onClick={() => (set({ setup: k }), void devJump("setup"))} />
            ))}
          </Group>

          <Group title="ファイルの作例">
            {(
              [
                ["normal", "通常"],
                ["unsupported", "非対応"],
                ["previous", "前回あり"],
              ] as const
            ).map(([k, label]) => (
              <Option key={k} label={label} active={sc.file === k} onClick={() => (set({ file: k }), void devJump("file"))} />
            ))}
          </Group>

          <Group title="処理の作例">
            <Option label="通常" active={sc.job === "normal"} onClick={() => (set({ job: "normal" }), void devJump("processing"))} />
            <Option label="途中で失敗" active={sc.job === "failed"} onClick={() => (set({ job: "failed" }), void devJump("processing"))} />
          </Group>

          <Group title="処理の再生速度">
            <Option label="60倍" active={sc.speed === 60} onClick={() => set({ speed: 60 })} />
            <Option label="600倍" active={sc.speed === 600} onClick={() => set({ speed: 600 })} />
          </Group>

          <Group title="新しい版の知らせ（約束 版10）">
            <Option label="なし" active={sc.update === "none"} onClick={() => void setUpdate("none")} />
            <Option label="あり（1.0.1）" active={sc.update === "available"} onClick={() => void setUpdate("available")} />
          </Group>

          <Group title="窓を閉じる（約束 版5）">
            <Option label="閉じる操作をまねる" onClick={() => dev.simulateCloseRequest()} />
          </Group>

          <Group title="名前付けの作例">
            <Option label="通常" active={sc.naming === "normal"} onClick={() => (set({ naming: "normal" }), void devJump("naming"))} />
            <Option
              label="注意あり（短い・2人）"
              active={sc.naming === "warnings"}
              onClick={() => (set({ naming: "warnings" }), void devJump("naming"))}
            />
          </Group>

          <Group title="名前を入れる">
            <Option label="台本どおり" onClick={() => setDevNames(dev.demoNames())} />
            <Option label="同じ名前でまとめる" onClick={() => setDevNames(dev.mergeNames())} />
            <Option label="空にする" onClick={() => setDevNames({})} />
          </Group>

          <Group title="名前の確定">
            <Option label="通常" active={!sc.applyFails} onClick={() => set({ applyFails: false })} />
            <Option label="失敗させる" active={sc.applyFails} onClick={() => set({ applyFails: true })} />
          </Group>

          <Group title="結果の作例">
            {(
              [
                ["one", "確認用1件"],
                ["typical", "定番の誤認識"],
                ["none", "確認用なし"],
                ["repeat", "繰り返しあり"],
              ] as const
            ).map(([k, label]) => (
              <Option key={k} label={label} active={sc.result === k} onClick={() => (set({ result: k }), void devJump("result"))} />
            ))}
          </Group>

          <Group title="保存の作例">
            {(
              [
                ["normal", "通常"],
                ["existing", "同じ名前のファイルあり"],
                ["failed", "失敗"],
              ] as const
            ).map(([k, label]) => (
              <Option key={k} label={label} active={sc.save === k} onClick={() => set({ save: k })} />
            ))}
          </Group>
        </div>
      ) : null}

      {notice?.kind === "text" ? (
        <div
          style={{
            position: "fixed",
            right: 14,
            bottom: 14,
            zIndex: 45,
            maxWidth: 420,
            padding: "8px 12px",
            borderRadius: 8,
            border: DEV_BORDER,
            background: "#f1f1ee",
            color: "#3d4046",
            fontSize: 12,
            lineHeight: 1.5,
            overflowWrap: "anywhere",
          }}
        >
          {notice.text}
        </div>
      ) : null}

      {notice?.kind === "closed" ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            background: "#e7e7e3",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
          }}
        >
          <span style={{ fontSize: 14, color: "#5d6168" }}>{notice.text}</span>
          <button type="button" className="btn btn-secondary compact" onClick={() => window.location.reload()}>
            開き直す
          </button>
        </div>
      ) : null}
    </>
  );
}
