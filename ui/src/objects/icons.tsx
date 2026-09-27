// 案A の小さな図（線だけ。色は文字の色に合わせる）
export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 2.2v9.6M2.2 7h9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** 一覧を出し入れする（左に仕切りのある四角） */
export function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.2 3v10" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** 設定（つまみの付いた横線） */
export function SlidersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M1.5 4h11M1.5 10h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="5" cy="4" r="1.8" fill="#fff" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="9.5" cy="10" r="1.8" fill="#fff" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
