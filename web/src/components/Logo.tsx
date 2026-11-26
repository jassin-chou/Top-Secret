/** 網站 logo：深藍色飛機＋紅色機頭（跟分頁上的小圖示同一個圖形） */
export function Logo({ className = 'logo' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 5 4" aria-hidden="true" focusable="false">
      <path d="M2 0h1v1h2v1H3v1h1v1H1V3h1V2H0V1h2z" fill="#223f94" />
      <circle cx="2.5" cy="0.5" r="0.42" fill="#cf2338" />
    </svg>
  );
}
