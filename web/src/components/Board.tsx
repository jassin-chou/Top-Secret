import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { colLabel, coordLabel, type Cell } from '@planehunt/shared';

export type PointerKind = 'mouse' | 'touch' | 'pen' | 'keyboard';

export interface ActivateInfo {
  secondary: boolean;
  pointer: PointerKind;
}

interface BoardProps {
  size: number;
  /** 給螢幕閱讀器的名稱 */
  label: string;
  interactive?: boolean;
  variant?: 'main' | 'side';
  /** 鍵盤游標 / 觸控預覽位置 */
  cursor?: Cell | null;
  onCursorChange?(c: Cell): void;
  onHover?(c: Cell | null): void;
  onActivate?(c: Cell, info: ActivateInfo): void;
  /** 鍵盤操作時念給螢幕閱讀器的格子描述 */
  describeCell?(c: Cell): string;
  children?: ReactNode;
}

/** 座標標籤的留白與字級（以格為單位）。格子越少、每格越大，標籤就相對縮小 */
function labelMetrics(size: number) {
  const scale = Math.min(1, size / 10);
  return { margin: 0.25 + 0.6 * scale, font: 0.42 * scale };
}

/**
 * 方格紙棋盤。座標系統以「格」為單位：(0,0) 是左上角那格的左上角。
 * children 直接以格為單位繪製（例如 <rect x={3} y={4} width={1} height={1} />）。
 */
export function Board({
  size,
  label,
  interactive = false,
  variant = 'main',
  cursor = null,
  onCursorChange,
  onHover,
  onActivate,
  describeCell,
  children,
}: BoardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const lastPointer = useRef<PointerKind>('mouse');
  const pointerFocus = useRef(false);
  const [focused, setFocused] = useState(false);
  // 鍵盤模式：用 Tab 進來或按方向鍵時才顯示外框與虛線游標，滑鼠 / 觸控不顯示
  const [kbd, setKbd] = useState(false);

  const cellFromEvent = (e: { clientX: number; clientY: number }): Cell | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const x = Math.floor(pt.x);
    const y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    return { x, y };
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!interactive || e.pointerType === 'touch') return;
    if (kbd) setKbd(false);
    onHover?.(cellFromEvent(e));
  };

  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const c = cellFromEvent(e);
    if (c) onActivate?.(c, { secondary: false, pointer: lastPointer.current });
  };

  const handleContextMenu = (e: MouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    e.preventDefault();
    const c = cellFromEvent(e);
    if (c) onActivate?.(c, { secondary: true, pointer: lastPointer.current });
  };

  const handleKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const cur = cursor ?? { x: Math.floor(size / 2), y: Math.floor(size / 2) };
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const mv = moves[e.key];
    if (mv || e.key === 'Enter' || e.key === ' ') setKbd(true);
    if (mv) {
      e.preventDefault();
      const next = { x: Math.min(size - 1, Math.max(0, cur.x + mv[0])), y: Math.min(size - 1, Math.max(0, cur.y + mv[1])) };
      onCursorChange?.(next);
      onHover?.(next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate?.(cur, { secondary: false, pointer: 'keyboard' });
    } else if (e.key === 'm' || e.key === 'M') {
      onActivate?.(cur, { secondary: true, pointer: 'keyboard' });
    }
  };

  const lines = [];
  for (let i = 0; i <= size; i++) {
    const edge = i === 0 || i === size;
    lines.push(<line key={`h${i}`} x1={0} y1={i} x2={size} y2={i} className={edge ? 'grid-edge' : 'grid-line'} />);
    lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={size} className={edge ? 'grid-edge' : 'grid-line'} />);
  }

  const { margin: LABEL, font } = labelMetrics(size);
  const labels = [];
  for (let i = 0; i < size; i++) {
    labels.push(
      <text key={`c${i}`} x={i + 0.5} y={-LABEL * 0.35} className="grid-label" textAnchor="middle" style={{ fontSize: `${font}px` }}>
        {colLabel(i)}
      </text>,
      <text key={`r${i}`} x={-LABEL * 0.3} y={i + 0.5 + font * 0.36} className="grid-label" textAnchor="end" style={{ fontSize: `${font}px` }}>
        {i + 1}
      </text>,
    );
  }

  const showCursor = interactive && focused && kbd && cursor;

  return (
    <div className={`board board--${variant}${interactive ? ' is-interactive' : ''}${focused && kbd ? ' is-kbd' : ''}`}>
      <svg
        ref={svgRef}
        viewBox={`${-LABEL} ${-LABEL} ${size + LABEL + 0.1} ${size + LABEL + 0.1}`}
        data-size={size}
        data-margin={LABEL}
        role={interactive ? 'application' : 'img'}
        aria-label={label}
        tabIndex={interactive ? 0 : -1}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType as PointerKind;
          pointerFocus.current = true;
          setKbd(false);
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => onHover?.(null)}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKey}
        onFocus={() => {
          setFocused(true);
          // 不能操作的棋盤（例如對局結束、彈窗關掉後焦點回來）不進鍵盤模式
          if (pointerFocus.current || !interactive) return;
          setKbd(true);
          if (!cursor) onCursorChange?.({ x: Math.floor(size / 2), y: Math.floor(size / 2) });
        }}
        onBlur={() => {
          setFocused(false);
          pointerFocus.current = false;
        }}
      >
        <rect x={0} y={0} width={size} height={size} className="grid-paper" />
        {lines}
        {labels}
        <g className="board-layers">{children}</g>
        {showCursor && (
          <rect x={cursor.x + 0.04} y={cursor.y + 0.04} width={0.92} height={0.92} className="board-cursor" rx={0.08} />
        )}
      </svg>
      {interactive && focused && kbd && cursor && (
        <p className="sr-only" aria-live="polite">
          {coordLabel(cursor.x, cursor.y)} {describeCell?.(cursor) ?? ''}
        </p>
      )}
    </div>
  );
}
