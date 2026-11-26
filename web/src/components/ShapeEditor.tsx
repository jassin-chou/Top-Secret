import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  CLASSIC_SHAPE,
  EDITOR_SIZE,
  MAX_SHAPE_CELLS,
  checkShape,
  shapeBounds,
  type Cell,
  type ShapeDef,
} from '@planehunt/shared';

type Tool = 'body' | 'head';

interface Drawing {
  filled: Set<string>;
  head: Cell | null;
}

const key = (x: number, y: number) => `${x},${y}`;

/** 把形狀放到 7×7 畫布正中間 */
function toDrawing(shape: ShapeDef): Drawing {
  const b = shapeBounds(shape.cells);
  const ox = Math.floor((EDITOR_SIZE - b.w) / 2) - b.minX;
  const oy = Math.floor((EDITOR_SIZE - b.h) / 2) - b.minY;
  const filled = new Set(shape.cells.map((c) => key(c.x + ox, c.y + oy)));
  return { filled, head: { x: ox, y: oy } };
}

function toShape(d: Drawing, name: string): [ShapeDef | null, string | null] {
  if (!d.head) return [null, '還沒放機頭：切到「放機頭」，點一格'];
  const h = d.head;
  const cells = [...d.filled].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x: x - h.x, y: y - h.y };
  });
  return checkShape({ name: name.trim() || '自訂', cells });
}

interface Props {
  initial: ShapeDef | null;
  onChange(shape: ShapeDef | null, error: string | null): void;
}

/** 在 7×7 方格上畫自己的飛機：點或拖曳畫機身，再指定一格當機頭 */
export function ShapeEditor({ initial, onChange }: Props) {
  const [drawing, setDrawing] = useState<Drawing>(() => toDrawing(initial ?? CLASSIC_SHAPE));
  const [tool, setTool] = useState<Tool>('body');
  const [name, setName] = useState(initial && initial.name !== '自訂' ? initial.name : '');
  const paint = useRef<boolean | null>(null);

  const [shape, error] = toShape(drawing, name);
  useEffect(() => {
    onChange(shape, error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, name]);

  const apply = (x: number, y: number, start: boolean) => {
    setDrawing((d) => {
      const k = key(x, y);
      if (tool === 'head') {
        const filled = new Set(d.filled);
        filled.add(k);
        return { filled, head: { x, y } };
      }
      const isHead = d.head?.x === x && d.head?.y === y;
      if (start) paint.current = !d.filled.has(k);
      if (isHead || paint.current === null) return d;
      if (paint.current === d.filled.has(k)) return d;
      const filled = new Set(d.filled);
      if (paint.current) {
        if (filled.size >= MAX_SHAPE_CELLS) return d;
        filled.add(k);
      } else filled.delete(k);
      return { ...d, filled };
    });
  };

  const cellAt = (e: PointerEvent): Cell | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const v = el?.closest<HTMLElement>('[data-cell]')?.dataset.cell;
    if (!v) return null;
    const [x, y] = v.split(',').map(Number);
    return { x, y };
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const c = cellAt(e);
    if (!c) return;
    e.preventDefault();
    apply(c.x, c.y, true);
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (paint.current === null || tool !== 'body' || e.buttons === 0) return;
    const c = cellAt(e);
    if (c) apply(c.x, c.y, false);
  };

  useEffect(() => {
    const stop = () => (paint.current = null);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const cells = [];
  for (let y = 0; y < EDITOR_SIZE; y++) {
    for (let x = 0; x < EDITOR_SIZE; x++) {
      const isHead = drawing.head?.x === x && drawing.head?.y === y;
      const on = drawing.filled.has(key(x, y));
      cells.push(
        <button
          key={key(x, y)}
          type="button"
          data-cell={key(x, y)}
          className={`editor-cell${on ? ' is-on' : ''}${isHead ? ' is-head' : ''}`}
          aria-label={`第 ${y + 1} 列第 ${x + 1} 格：${isHead ? '機頭' : on ? '機身' : '空白'}`}
          aria-pressed={on}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              apply(x, y, true);
              paint.current = null;
            }
          }}
        >
          {isHead ? '頭' : ''}
        </button>,
      );
    }
  }

  return (
    <div className="editor">
      <div className="editor-tools">
        <fieldset className="segmented segmented--small">
          <legend className="sr-only">畫筆</legend>
          {(
            [
              ['body', '畫機身'],
              ['head', '放機頭'],
            ] as const
          ).map(([t, label]) => (
            <label key={t} className={tool === t ? 'is-on' : ''}>
              <input type="radio" name="editor-tool" checked={tool === t} onChange={() => setTool(t)} />
              {label}
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn btn--quiet btn--small" onClick={() => setDrawing({ filled: new Set(), head: null })}>
          全部擦掉
        </button>
      </div>

      <div
        className="editor-grid"
        style={{ gridTemplateColumns: `repeat(${EDITOR_SIZE}, 1fr)`, gridTemplateRows: `repeat(${EDITOR_SIZE}, 1fr)` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
      >
        {cells}
      </div>

      <div className="field">
        <label htmlFor="shape-name">幫它取個名字（選填）</label>
        <input id="shape-name" value={name} maxLength={8} placeholder="自訂" onChange={(e) => setName(e.target.value)} />
      </div>

      <p className={`editor-status${error ? ' is-error' : ''}`} role="status">
        {error ?? `「${shape!.name}」共 ${shape!.cells.length} 格`}
      </p>
      <p className="hint">點格子或拖曳來畫，再點一下可以擦掉。每一格都要上下左右連在一起，最多 {MAX_SHAPE_CELLS} 格。</p>
    </div>
  );
}
