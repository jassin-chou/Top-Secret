/**
 * 獎牌圖示（SVG）：形狀 × 顏色 × 圖案 組合出每一面獎牌。
 * 稀有度越高越亮：史詩有陰影，傳說會發光。
 */
import { useId, type ReactNode } from 'react';
import { medalById, type MedalColor, type MedalIcon, type MedalShape } from '@planehunt/shared';

/** light/dark：漸層的亮面與暗面；edge：外框；icon：中間圖案的顏色 */
const PALETTE: Record<MedalColor, { light: string; dark: string; edge: string; icon: string }> = {
  bronze: { light: '#f2b884', dark: '#a85b26', edge: '#7a3d14', icon: '#fff7ee' },
  silver: { light: '#f7f9fc', dark: '#9ba6b4', edge: '#6b7583', icon: '#3a4352' },
  gold: { light: '#fff0a3', dark: '#e0a312', edge: '#a8730a', icon: '#7a4b00' },
  ruby: { light: '#ff8a98', dark: '#c0172e', edge: '#86101f', icon: '#ffffff' },
  sapphire: { light: '#8cb6ff', dark: '#2443a6', edge: '#162c75', icon: '#ffffff' },
  teal: { light: '#7fe6df', dark: '#12898a', edge: '#0b5f60', icon: '#ffffff' },
  amethyst: { light: '#d3b0ff', dark: '#7040b8', edge: '#4c2785', icon: '#ffffff' },
  emerald: { light: '#86e6b4', dark: '#16824f', edge: '#0d5a36', icon: '#ffffff' },
  rose: { light: '#ffc3d5', dark: '#d9517f', edge: '#a13058', icon: '#ffffff' },
  obsidian: { light: '#69707f', dark: '#1d2028', edge: '#0c0e12', icon: '#ffd75e' },
  midnight: { light: '#5865c9', dark: '#141a46', edge: '#0b0f2c', icon: '#ffe48a' },
};

/** 外形（40×40）；body 是主體，extra 是畫在主體後面的裝飾（例如緞帶尾巴） */
function shapeParts(shape: MedalShape, fill: string, dark: string, edge: string): { body: ReactNode; back?: ReactNode } {
  const common = { fill, stroke: edge, strokeWidth: 1.4, strokeLinejoin: 'round' as const };
  switch (shape) {
    case 'round':
      return {
        body: (
          <>
            <circle cx="20" cy="20" r="17" {...common} />
            <circle cx="20" cy="20" r="13.2" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.2" />
          </>
        ),
      };
    case 'shield':
      return {
        body: (
          <>
            <path d="M20 2.5 34.5 8v11c0 9.5-6.2 15.6-14.5 18.5C11.7 34.6 5.5 28.5 5.5 19V8z" {...common} />
            <path d="M20 6.5 31 10.6V19c0 7.3-4.7 12.1-11 14.6-6.3-2.5-11-7.3-11-14.6v-8.4z" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.1" />
          </>
        ),
      };
    case 'star':
      return {
        body: (
          <path
            d="M20 2.2l4.9 10.6 11.6 1.3-8.6 7.9 2.4 11.4L20 27.6 9.7 33.4l2.4-11.4-8.6-7.9 11.6-1.3z"
            {...common}
          />
        ),
      };
    case 'hex':
      return {
        body: (
          <>
            <path d="M20 2.5 35.2 11.2v17.6L20 37.5 4.8 28.8V11.2z" {...common} />
            <path d="M20 6.6 31.6 13.3v13.4L20 33.4 8.4 26.7V13.3z" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.1" />
          </>
        ),
      };
    case 'diamond':
      return {
        body: (
          <>
            <path d="M20 1.8 38.2 20 20 38.2 1.8 20z" {...common} />
            <path d="M20 6.5 33.5 20 20 33.5 6.5 20z" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.1" />
          </>
        ),
      };
    case 'ribbon': {
      // 玫瑰花結：鋸齒圓 + 兩條緞帶尾巴
      const pts: string[] = [];
      for (let i = 0; i < 24; i++) {
        const r = i % 2 ? 13.2 : 15.6;
        const a = (Math.PI * 2 * i) / 24 - Math.PI / 2;
        pts.push(`${(20 + r * Math.cos(a)).toFixed(2)},${(16.5 + r * Math.sin(a)).toFixed(2)}`);
      }
      return {
        back: (
          <>
            <path d="M12.5 24 8 38.5l5.2-2.6 3.3 3.4L19.5 27z" fill={dark} stroke={edge} strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M27.5 24 32 38.5l-5.2-2.6-3.3 3.4L20.5 27z" fill={dark} stroke={edge} strokeWidth="1.2" strokeLinejoin="round" />
          </>
        ),
        body: (
          <>
            <polygon points={pts.join(' ')} {...common} />
            <circle cx="20" cy="16.5" r="10" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.1" />
          </>
        ),
      };
    }
    case 'crown':
      return {
        body: (
          <>
            <path d="M4.5 31.5 6.2 11.5l7.6 7.8L20 6.2l6.2 13.1 7.6-7.8 1.7 20z" {...common} />
            <rect x="4.5" y="31" width="31" height="5.5" rx="1.6" fill={dark} stroke={edge} strokeWidth="1.2" />
            <circle cx="6.2" cy="10.5" r="2" fill={fill} stroke={edge} strokeWidth="1.1" />
            <circle cx="20" cy="5.2" r="2.2" fill={fill} stroke={edge} strokeWidth="1.1" />
            <circle cx="33.8" cy="10.5" r="2" fill={fill} stroke={edge} strokeWidth="1.1" />
          </>
        ),
      };
  }
}

/** 中間的圖案（畫在 16×16 的格子裡） */
function iconPaths(icon: MedalIcon, c: string, bg: string): ReactNode {
  const stroke = { fill: 'none', stroke: c, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (icon) {
    case 'star':
      return <path d="M8 1.5l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.1l-3.9 2.2.9-4.3-3.3-3 4.4-.5z" fill={c} />;
    case 'swords':
      return (
        <>
          <path d="M2.5 2.5l11 11M13.5 2.5l-11 11" {...stroke} />
          <path d="M2.5 10.2l3.3 3.3M13.5 10.2l-3.3 3.3" {...stroke} />
        </>
      );
    case 'trophy':
      return (
        <>
          <path d="M4 1.5h8v3.6a4 4 0 0 1-8 0z" fill={c} />
          <path d="M4 3H1.8v1A2.6 2.6 0 0 0 4.4 6.6M12 3h2.2v1a2.6 2.6 0 0 1-2.6 2.6" {...stroke} strokeWidth={1.3} />
          <rect x="6.8" y="9" width="2.4" height="3" fill={c} />
          <rect x="4.5" y="12.3" width="7" height="2.2" rx=".6" fill={c} />
        </>
      );
    case 'flame':
      return <path d="M8 .8c1 3 4.3 4.6 4.3 8.6A4.3 4.3 0 0 1 8 15.2a4.3 4.3 0 0 1-4.3-4.3c0-2.2 1.1-3.4 2.2-4.4 0 1.7.7 2.6 1.6 2.8C6.8 7 7 3.9 8 .8z" fill={c} />;
    case 'plane':
      // 跟網站 logo 一樣的飛機
      return <path d="M6.2 1.5h3.6v3.3h5.4v3H9.8v3.1h2.6v3.6H3.6v-3.6h2.6V7.8H.8v-3h5.4z" fill={c} />;
    case 'ship':
      return (
        <>
          <path d="M.8 9.3h14.4l-2.6 4.6H3.4z" fill={c} />
          <rect x="4.6" y="5.6" width="6.8" height="3" rx=".6" fill={c} />
          <path d="M8 1.2v4.2M8 1.6l3 1.2-3 1.1" {...stroke} strokeWidth={1.2} />
        </>
      );
    case 'digits':
      return (
        <text x="8" y="12.2" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={c} fontFamily="inherit" letterSpacing="-0.3">
          AB
        </text>
      );
    case 'triad':
      return (
        <>
          <circle cx="8" cy="3.6" r="2.6" fill={c} />
          <circle cx="3.4" cy="11.6" r="2.6" fill={c} />
          <circle cx="12.6" cy="11.6" r="2.6" fill={c} />
          <path d="M8 3.6 3.4 11.6h9.2z" fill="none" stroke={c} strokeWidth="1" strokeOpacity=".7" />
        </>
      );
    case 'target':
      return (
        <>
          <circle cx="8" cy="8" r="6.4" {...stroke} strokeWidth={1.5} />
          <circle cx="8" cy="8" r="3.4" {...stroke} strokeWidth={1.5} />
          <circle cx="8" cy="8" r="1.3" fill={c} />
        </>
      );
    case 'bolt':
      return <path d="M9.6.8 3 9.2h4.3L6.2 15.2l6.8-8.6H8.6z" fill={c} />;
    case 'shield':
      return (
        <>
          <path d="M8 1.2l5.8 2v4.6c0 3.6-2.5 5.9-5.8 7.2-3.3-1.3-5.8-3.6-5.8-7.2V3.2z" fill={c} />
          <path d="M5.3 8l2 2 3.6-3.8" fill="none" stroke={bg} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'arrow':
      return <path d="M8 1.2l5.6 6.4h-3.4v7.2H5.8V7.6H2.4z" fill={c} />;
    case 'eye':
      return (
        <>
          <path d="M.8 8c2-3.6 4.5-5.2 7.2-5.2S13.2 4.4 15.2 8c-2 3.6-4.5 5.2-7.2 5.2S2.8 11.6.8 8z" fill={c} />
          <circle cx="8" cy="8" r="2.6" fill={bg} />
          <circle cx="8" cy="8" r="1.1" fill={c} />
        </>
      );
    case 'people':
      return (
        <>
          <circle cx="5.4" cy="4.6" r="2.4" fill={c} />
          <circle cx="11" cy="5.4" r="2" fill={c} opacity=".85" />
          <path d="M1.2 14c0-3 1.9-5 4.2-5s4.2 2 4.2 5z" fill={c} />
          <path d="M9.4 14c.1-1.4-.2-2.9-1-3.9a3.2 3.2 0 0 1 2.6-1.1c2 0 3.8 1.7 3.8 5z" fill={c} opacity=".85" />
        </>
      );
    case 'repeat':
      return (
        <>
          <path d="M2.6 7.2A5.4 5.4 0 0 1 12.4 4.3M13.4 8.8a5.4 5.4 0 0 1-9.8 2.9" {...stroke} />
          <path d="M12.8 1.2v3.4H9.4M3.2 14.8v-3.4h3.4" {...stroke} />
        </>
      );
    case 'moon':
      return (
        <>
          <path d="M10.6 1.4A6.6 6.6 0 1 0 14.8 11a5.6 5.6 0 0 1-4.2-9.6z" fill={c} />
          <circle cx="13.2" cy="3.4" r=".9" fill={c} />
        </>
      );
    case 'chip':
      return (
        <>
          <rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.4" fill={c} />
          <path d="M6 1v2.6M10 1v2.6M6 12.4V15M10 12.4V15M1 6h2.6M1 10h2.6M12.4 6H15M12.4 10H15" {...stroke} strokeWidth={1.3} />
          <rect x="6.2" y="6.2" width="3.6" height="3.6" rx=".5" fill={bg} />
        </>
      );
  }
}

interface Props {
  id: string;
  size?: number;
  /** 還沒拿到：灰階顯示 */
  locked?: boolean;
  /** 不在旁邊顯示文字時，讀螢幕軟體會念出名稱 */
  label?: boolean;
}

export function Medal({ id, size = 22, locked = false, label = true }: Props) {
  const gid = useId().replace(/:/g, '');
  const m = medalById(id);
  if (!m) return null;
  const p = PALETTE[m.color];
  const fill = `url(#mg${gid})`;
  const { body, back } = shapeParts(m.shape, fill, p.dark, p.edge);
  // 星形中間比較窄，圖案縮小一點、往下一點
  const iconBox = m.shape === 'star' ? 'translate(14 14.4) scale(.75)' : m.shape === 'crown' ? 'translate(13 18) scale(.875)' : m.shape === 'ribbon' ? 'translate(13 9.5) scale(.875)' : 'translate(12 12)';
  return (
    <svg
      className={`medal medal--t${m.tier}${locked ? ' is-locked' : ''}`}
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label ? `${m.name}：${m.desc}` : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {label && <title>{`${m.name}：${m.desc}`}</title>}
      <defs>
        <linearGradient id={`mg${gid}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={p.light} />
          <stop offset="1" stopColor={p.dark} />
        </linearGradient>
      </defs>
      {back}
      {body}
      {/* 左上角的反光 */}
      <ellipse cx="14" cy="11" rx="6" ry="3" fill="#ffffff" opacity="0.28" transform="rotate(-30 14 11)" />
      <g transform={iconBox}>{iconPaths(m.icon, p.icon, p.dark)}</g>
    </svg>
  );
}
