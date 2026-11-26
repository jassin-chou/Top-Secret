import { rotateShape, shapeBounds, type Dir, type ShapeDef } from '@planehunt/shared';
import { PlaneShape } from './marks';

/** 小張的飛機形狀圖（選形狀卡片、擺放時的方向預覽、對戰時的參考） */
export function ShapePreview({
  shape,
  dir = 'up',
  className = '',
  headLabel = false,
  label,
  decorative = false,
}: {
  shape: ShapeDef;
  dir?: Dir;
  className?: string;
  headLabel?: boolean;
  label?: string;
  /** 旁邊已經有文字說明時設為 true，螢幕閱讀器就不會重複念 */
  decorative?: boolean;
}) {
  const b = shapeBounds(rotateShape(shape, dir));
  // 固定以至少 5×5 的畫框置中，不同形狀之間的大小才看得出差別
  const frame = Math.max(5, b.w, b.h);
  const ox = (frame - b.w) / 2 - b.minX;
  const oy = (frame - b.h) / 2 - b.minY;
  // 格線對齊飛機的格子（置中時可能有半格位移）
  const lines = [];
  const fx = ox - Math.floor(ox);
  const fy = oy - Math.floor(oy);
  for (let i = 0; i <= frame; i++) {
    const vx = fx + i;
    const hy = fy + i;
    if (vx > 0.01 && vx < frame - 0.01) lines.push(<line key={`v${i}`} x1={vx} y1={0} x2={vx} y2={frame} className="preview-grid" />);
    if (hy > 0.01 && hy < frame - 0.01) lines.push(<line key={`h${i}`} x1={0} y1={hy} x2={frame} y2={hy} className="preview-grid" />);
  }
  return (
    <svg
      viewBox={`-0.2 -0.2 ${frame + 0.4} ${frame + 0.4}`}
      className={`shape-preview ${className}`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : (label ?? `${shape.name}，${shape.cells.length} 格`)}
    >
      {lines}
      <PlaneShape plane={{ x: ox, y: oy, dir }} shape={shape} headLabel={headLabel} />
    </svg>
  );
}
