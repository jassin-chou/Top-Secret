import { planeCells, planeOutline, type Cell, type GameMode, type Plane, type ShapeDef, type Shot } from '@planehunt/shared';

export type PlaneVariant = 'mine' | 'ghost' | 'invalid' | 'reveal' | 'sunk';

/** 依模式畫飛機或船 */
export function PieceShape({
  mode,
  plane,
  shape,
  variant = 'mine',
  headLabel = true,
}: {
  mode: GameMode;
  plane: Plane;
  shape: ShapeDef;
  variant?: PlaneVariant;
  headLabel?: boolean;
}) {
  return mode === 'ship' ? (
    <ShipShape plane={plane} shape={shape} variant={variant} />
  ) : (
    <PlaneShape plane={plane} shape={shape} variant={variant} headLabel={headLabel} />
  );
}

/** 藍筆畫的船：圓角船身 + 一排舷窗 */
export function ShipShape({ plane, shape, variant = 'mine' }: { plane: Plane; shape: ShapeDef; variant?: PlaneVariant }) {
  const cells = planeCells(plane, shape);
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0 + 1;
  const h = Math.max(...ys) - y0 + 1;
  const inset = 0.12;
  return (
    <g className={`plane ship plane--${variant}`}>
      <rect
        x={x0 + inset}
        y={y0 + inset}
        width={w - inset * 2}
        height={h - inset * 2}
        rx={0.38}
        className="ship-hull"
      />
      {cells.map((c) => (
        <circle key={`${c.x},${c.y}`} cx={c.x + 0.5} cy={c.y + 0.5} r={0.09} className="ship-window" />
      ))}
    </g>
  );
}

/** 藍筆畫的飛機：淡淡的墨水底 + 外框線 + 機頭 */
export function PlaneShape({
  plane,
  shape,
  variant = 'mine',
  headLabel = true,
}: {
  plane: Plane;
  shape: ShapeDef;
  variant?: PlaneVariant;
  headLabel?: boolean;
}) {
  const cells = planeCells(plane, shape);
  const head = cells[0];
  return (
    <g className={`plane plane--${variant}`}>
      {cells.map((c) => (
        <rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={1} height={1} className="plane-wash" />
      ))}
      {planeOutline(plane, shape).map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="plane-line" />
      ))}
      <rect x={head.x + 0.14} y={head.y + 0.14} width={0.72} height={0.72} rx={0.22} className="plane-head" />
      {headLabel && (
        <text x={head.x + 0.5} y={head.y + 0.69} className="plane-head-text" textAnchor="middle">
          頭
        </text>
      )}
    </g>
  );
}

/** 開火結果：灰色叉叉＝沒打中、綠色圈圈＝打中（機身 / 船）、紅色印章＝打中機頭 */
export function ShotMark({ shot, fresh = false }: { shot: Shot; fresh?: boolean }) {
  const { x, y } = shot;
  // 海戰棋的打中與擊沉，跟飛機的機身用同一個綠圈
  const r = shot.r === 'hit' || shot.r === 'sunk' ? 'body' : shot.r;
  const cls = `shot shot--${r}${fresh ? ' is-fresh' : ''}`;
  if (r === 'miss') {
    return (
      <g className={cls}>
        <path d={`M${x + 0.3} ${y + 0.3} L${x + 0.7} ${y + 0.7}`} pathLength={1} />
        <path d={`M${x + 0.7} ${y + 0.3} L${x + 0.3} ${y + 0.7}`} pathLength={1} />
      </g>
    );
  }
  if (r === 'body') {
    return (
      <g className={cls}>
        <circle cx={x + 0.5} cy={y + 0.5} r={0.28} pathLength={1} />
      </g>
    );
  }
  return (
    <g className={cls}>
      <circle cx={x + 0.5} cy={y + 0.5} r={0.4} className="stamp-disc" />
      <text x={x + 0.5} y={y + 0.7} className="stamp-text" textAnchor="middle">
        頭
      </text>
    </g>
  );
}

/** 規則保證一定是空的格子（擊沉的船旁邊）：更淡的小點 */
export function EmptyHint({ cell }: { cell: Cell }) {
  return <circle className="empty-hint" cx={cell.x + 0.5} cy={cell.y + 0.5} r={0.07} />;
}

/** 自己的推理筆記：淡淡的鉛筆小點（跟灰色叉叉分得開） */
export function PencilMark({ cell }: { cell: Cell }) {
  return <circle className="pencil-mark" cx={cell.x + 0.5} cy={cell.y + 0.5} r={0.1} />;
}

/** 螢光筆塗過的格子（瞄準位置 / 最新一發） */
export function Highlight({ cell, kind = 'aim' }: { cell: Cell; kind?: 'aim' | 'last' | 'blocked' }) {
  return <rect x={cell.x + 0.05} y={cell.y + 0.1} width={0.9} height={0.8} rx={0.1} className={`hl hl--${kind}`} />;
}
