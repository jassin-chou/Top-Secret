import type { Cell, ShapeDef } from './types.js';

/** 自己畫飛機時的畫布大小（7×7） */
export const EDITOR_SIZE = 7;
export const MIN_SHAPE_CELLS = 3;
export const MAX_SHAPE_CELLS = 20;

export interface ShapePreset extends ShapeDef {
  id: string;
}

/** 用字串畫形狀：H = 機頭、# = 機身、. = 空白 */
export function shapeFromRows(name: string, rows: string[]): ShapeDef {
  let head: Cell | null = null;
  const body: Cell[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'H') head = { x, y };
      else if (ch === '#') body.push({ x, y });
    }),
  );
  if (!head) throw new Error(`形狀 ${name} 沒有機頭`);
  const h: Cell = head;
  return { name, cells: [{ x: 0, y: 0 }, ...body.map((c) => ({ x: c.x - h.x, y: c.y - h.y }))] };
}

export const SHAPE_PRESETS: ShapePreset[] = [
  { id: 'mini', ...shapeFromRows('迷你機', ['.H.', '###', '.#.']) },
  { id: 'small', ...shapeFromRows('小飛機', ['.H.', '###', '.#.', '###']) },
  { id: 'classic', ...shapeFromRows('經典', ['..H..', '#####', '..#..', '.###.']) },
  { id: 'jet', ...shapeFromRows('客機', ['...H...', '...#...', '#######', '...#...', '..###..']) },
];

export const CLASSIC_SHAPE: ShapeDef = SHAPE_PRESETS.find((s) => s.id === 'classic')!;

export function shapeBounds(cells: Cell[]) {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 兩個形狀是否完全相同（用來判斷目前選的是不是某個預設形狀） */
export function sameShape(a: ShapeDef, b: ShapeDef): boolean {
  if (a.cells.length !== b.cells.length) return false;
  const key = (c: Cell) => `${c.x},${c.y}`;
  const set = new Set(a.cells.map(key));
  return b.cells.every((c) => set.has(key(c)));
}

/**
 * 驗證並整理形狀。回傳 [形狀, null] 或 [null, 錯誤訊息]。
 * 規則：3–20 格、含機頭、格子之間上下左右相連、大小不超過 7×7。
 */
export function checkShape(input: unknown): [ShapeDef, null] | [null, string] {
  const raw = (input ?? {}) as { name?: unknown; cells?: unknown };
  if (!Array.isArray(raw.cells)) return [null, '飛機形狀資料不正確'];
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 8)
      : '自訂';

  const seen = new Set<string>();
  const cells: Cell[] = [];
  for (const c of raw.cells as Array<Partial<Cell>>) {
    if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y)) return [null, '飛機形狀資料不正確'];
    if (Math.abs(c.x!) >= EDITOR_SIZE || Math.abs(c.y!) >= EDITOR_SIZE) return [null, '飛機畫得太大了'];
    const k = `${c.x},${c.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push({ x: c.x!, y: c.y! });
  }
  if (!seen.has('0,0')) return [null, '要指定一格當機頭'];
  if (cells.length < MIN_SHAPE_CELLS) return [null, `飛機至少要 ${MIN_SHAPE_CELLS} 格`];
  if (cells.length > MAX_SHAPE_CELLS) return [null, `飛機最多 ${MAX_SHAPE_CELLS} 格`];
  const b = shapeBounds(cells);
  if (b.w > EDITOR_SIZE || b.h > EDITOR_SIZE) return [null, `飛機不能超過 ${EDITOR_SIZE}×${EDITOR_SIZE}`];

  // 從機頭出發，上下左右走得到每一格才算一架完整的飛機
  const reach = new Set(['0,0']);
  const queue: Cell[] = [{ x: 0, y: 0 }];
  while (queue.length) {
    const { x, y } = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (seen.has(k) && !reach.has(k)) {
        reach.add(k);
        queue.push({ x: x + dx, y: y + dy });
      }
    }
  }
  if (reach.size !== cells.length) return [null, '飛機的每一格都要連在一起（上下左右相鄰）'];

  const body = cells
    .filter((c) => c.x !== 0 || c.y !== 0)
    .sort((a, b2) => a.y - b2.y || a.x - b2.x);
  return [{ name, cells: [{ x: 0, y: 0 }, ...body] }, null];
}

// ---------------------------------------------------------------------------
// 海戰棋的船
// ---------------------------------------------------------------------------

export const MIN_SHIP_LEN = 1;
export const MAX_SHIP_LEN = 6;
export const MAX_SHIPS = 12;

export const SHIP_NAMES: Record<number, string> = {
  1: '小艇',
  2: '驅逐艦',
  3: '巡洋艦',
  4: '戰艦',
  5: '航空母艦',
  6: '超級航艦',
};

export function shipName(len: number): string {
  return SHIP_NAMES[len] ?? `${len} 格船`;
}

/** 長度 len 的船：從錨點往下延伸的一直線 */
export function shipShape(len: number): ShapeDef {
  return { name: shipName(len), cells: Array.from({ length: len }, (_, i) => ({ x: 0, y: i })) };
}

export interface FleetPreset {
  id: string;
  name: string;
  fleet: number[];
  note: string;
}

export const FLEET_PRESETS: FleetPreset[] = [
  { id: 'classic', name: '經典艦隊', fleet: [5, 4, 3, 3, 2], note: '美式桌遊的 5 艘船' },
  { id: 'big', name: '大艦隊', fleet: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1], note: '俄式 10 艘船' },
  { id: 'small', name: '小艦隊', fleet: [3, 2, 2], note: '小棋盤快速玩' },
];

export const CLASSIC_FLEET = FLEET_PRESETS[0].fleet;

/** 驗證並整理艦隊（由長到短排序）。回傳 [艦隊, null] 或 [null, 錯誤訊息] */
export function checkFleet(input: unknown): [number[], null] | [null, string] {
  if (!Array.isArray(input) || input.length === 0) return [null, '艦隊至少要有 1 艘船'];
  if (input.length > MAX_SHIPS) return [null, `艦隊最多 ${MAX_SHIPS} 艘船`];
  for (const len of input) {
    if (!Number.isInteger(len) || len < MIN_SHIP_LEN || len > MAX_SHIP_LEN) {
      return [null, `船的長度要在 ${MIN_SHIP_LEN} 到 ${MAX_SHIP_LEN} 格之間`];
    }
  }
  return [[...(input as number[])].sort((a, b) => b - a), null];
}

/** 艦隊的文字說明，例如「5、4、3、3、2 格各一艘」 */
export function fleetSummary(fleet: number[]): string {
  return `${fleet.join('、')} 格`;
}
