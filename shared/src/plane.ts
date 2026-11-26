/**
 * 棋子（飛機或船）的幾何：旋轉、擺放驗證、命中判定、擺放搜尋。
 * 飛機版與海戰棋共用，差別只在「每個棋子是什麼形狀」（pieceShapes）。
 */
import { CLASSIC_SHAPE, shapeBounds, shipShape } from './shapes.js';
import type { BoardSettings, Cell, Dir, Plane, PlaneCell, PlaneSettings, Settings, ShapeDef, Shot, ShotResult } from './types.js';

export const DIRS: Dir[] = ['up', 'right', 'down', 'left'];

export const DEFAULT_SETTINGS: PlaneSettings = { mode: 'plane', size: 10, planes: 3, shape: CLASSIC_SHAPE };
export const MIN_SIZE = 5;
export const MAX_SIZE = 12;
export const MIN_PLANES = 1;
export const MAX_PLANES = 5;

/**
 * 棋子之間必須「完全分開」：不能重疊、不能上下左右相鄰，斜角也不能碰到。
 * 改成 false 就只檢查上下左右。只有一個棋子時不受影響。
 */
export const NO_DIAGONAL_TOUCH = true;

export function isBoardSettings(settings: Settings): settings is BoardSettings {
  return settings.mode === 'plane' || settings.mode === 'ship';
}

/** 這個設定下，每個玩家要擺的棋子形狀（依序）；幾A幾B 沒有棋子 */
export function pieceShapes(settings: Settings): ShapeDef[] {
  if (settings.mode === 'ab') return [];
  return settings.mode === 'ship' ? settings.fleet.map(shipShape) : Array(settings.planes).fill(settings.shape);
}

export function pieceCount(settings: Settings): number {
  return pieceShapes(settings).length;
}

/** 螢幕座標（y 向下）順時針旋轉 */
function rotate(dx: number, dy: number, dir: Dir): [number, number] {
  switch (dir) {
    case 'up':
      return [dx, dy];
    case 'right':
      return [-dy, dx];
    case 'down':
      return [-dx, -dy];
    case 'left':
      return [dy, -dx];
  }
}

/** 形狀轉向後的相對座標（給預覽用） */
export function rotateShape(shape: ShapeDef, dir: Dir): Cell[] {
  return shape.cells.map((c) => {
    const [x, y] = rotate(c.x, c.y, dir);
    return { x, y };
  });
}

export function planeCells(p: Plane, shape: ShapeDef): PlaneCell[] {
  return shape.cells.map((c, i) => {
    const [rx, ry] = rotate(c.x, c.y, p.dir);
    return { x: p.x + rx, y: p.y + ry, part: i === 0 ? 'head' : 'body' };
  });
}

export function nextDir(dir: Dir): Dir {
  return DIRS[(DIRS.indexOf(dir) + 1) % DIRS.length];
}

export function inBounds(c: Cell, size: number): boolean {
  return Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < size && c.y < size;
}

/** 形狀轉任何方向都放不進棋盤 */
export function shapeTooBig(shape: ShapeDef, size: number): boolean {
  const b = shapeBounds(shape.cells);
  return Math.max(b.w, b.h) > size;
}

/** 格子的唯一鍵（加位移避免負座標相撞） */
export const cellKey = (x: number, y: number) => (y + 64) * 1024 + (x + 64);
export const keyCell = (k: number): Cell => ({ x: (k % 1024) - 64, y: Math.floor(k / 1024) - 64 });

export interface Occupant {
  /** 第幾個棋子 */
  piece: number;
  part: PlaneCell['part'];
}

/** 建立「格子 → 哪一個棋子的哪個部位」對照表；shapes 跟 planes 一一對應。重疊時回傳 null */
export function occupancy(planes: Array<Plane | null>, shapes: ShapeDef[]): Map<number, Occupant> | null {
  const map = new Map<number, Occupant>();
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    if (!p) continue;
    for (const c of planeCells(p, shapes[i])) {
      const k = cellKey(c.x, c.y);
      if (map.has(k)) return null;
      map.set(k, { piece: i, part: c.part });
    }
  }
  return map;
}

export function pieceAt(planes: Plane[], shapes: ShapeDef[], x: number, y: number): Occupant | null {
  return occupancy(planes, shapes)?.get(cellKey(x, y)) ?? null;
}

const NEIGHBORS_8: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];
const NEIGHBORS_4: Array<[number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1]];
/** 「碰到」的定義：預設含斜角 */
export const TOUCH: Array<[number, number]> = NO_DIAGONAL_TOUCH ? NEIGHBORS_8 : NEIGHBORS_4;

export type Conflict = 'out' | 'overlap' | 'touch';

export const CONFLICT_TEXT: Record<Conflict, string> = {
  out: '這裡放不下：會超出棋盤',
  overlap: '這裡放不下：會跟其他棋子重疊',
  touch: NO_DIAGONAL_TOUCH ? '彼此要完全分開，不能貼在一起（斜角也不行）' : '彼此要分開，不能貼在一起',
};

export interface Placed {
  plane: Plane;
  shape: ShapeDef;
}

/** 把 cand 加到 placed 之後會有什麼問題；沒問題回傳 null */
export function placementConflict(settings: BoardSettings, placed: Placed[], cand: Placed): Conflict | null {
  const cells = planeCells(cand.plane, cand.shape);
  if (!cells.every((c) => inBounds(c, settings.size))) return 'out';
  const occ = new Set<number>();
  for (const p of placed) for (const c of planeCells(p.plane, p.shape)) occ.add(cellKey(c.x, c.y));
  if (cells.some((c) => occ.has(cellKey(c.x, c.y)))) return 'overlap';
  if (pieceCount(settings) > 1) {
    for (const c of cells) {
      for (const [dx, dy] of TOUCH) {
        if (occ.has(cellKey(c.x + dx, c.y + dy))) return 'touch';
      }
    }
  }
  return null;
}

/** 回傳錯誤訊息；合法則回傳 null。planes 要跟 pieceShapes(settings) 一一對應 */
export function validatePlacement(planes: unknown, settings: BoardSettings): string | null {
  const shapes = pieceShapes(settings);
  const unit = settings.mode === 'ship' ? '艘船' : '架飛機';
  if (!Array.isArray(planes)) return '棋子資料格式不正確';
  if (planes.length !== shapes.length) return `需要擺好 ${shapes.length} ${unit}`;
  const placed: Placed[] = [];
  for (let i = 0; i < shapes.length; i++) {
    const p = planes[i] as Plane;
    if (!p || typeof p !== 'object') return `還有${unit.slice(1)}沒擺好`;
    if (!DIRS.includes(p.dir)) return '朝向不正確';
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) return '座標不正確';
    const conflict = placementConflict(settings, placed, { plane: p, shape: shapes[i] });
    if (conflict === 'out') return '有棋子超出棋盤';
    if (conflict === 'overlap') return '棋子之間不能重疊';
    if (conflict === 'touch') return CONFLICT_TEXT.touch;
    placed.push({ plane: p, shape: shapes[i] });
  }
  return null;
}

// ---------------------------------------------------------------------------
// 擺放搜尋：隨機擺放、檢查「這個棋盤放得下嗎」
// ---------------------------------------------------------------------------

/** 可重現的亂數（前後端用同一個種子，可行性檢查的結果才會一致） */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Candidate {
  plane: Plane;
  cells: number[];
  zone: number[];
}

function toCandidate(plane: Plane, shape: ShapeDef, size: number, separate: boolean): Candidate | null {
  const pc = planeCells(plane, shape);
  if (!pc.every((c) => inBounds(c, size))) return null;
  const cells = pc.map((c) => c.y * size + c.x);
  const zone = new Set(cells);
  if (separate) {
    for (const c of pc) {
      for (const [dx, dy] of TOUCH) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) zone.add(ny * size + nx);
      }
    }
  }
  return { plane, cells, zone: [...zone] };
}

/** 某個形狀所有放得進棋盤的位置。ignoreHead：船沒有機頭，同一組格子只留一個 */
function candidatesFor(shape: ShapeDef, size: number, separate: boolean, ignoreHead: boolean): Candidate[] {
  const list: Candidate[] = [];
  const seen = new Set<string>();
  for (const dir of DIRS) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = toCandidate({ x, y, dir }, shape, size, separate);
        if (!c) continue;
        const key = ignoreHead ? [...c.cells].sort((a, b) => a - b).join(',') : `${x},${y},${dir}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push(c);
      }
    }
  }
  return list;
}

const shapeKey = (s: ShapeDef) => s.cells.map((c) => `${c.x},${c.y}`).join(';');

/**
 * 找一組合法擺法（深度優先 + 隨機順序），回傳的陣列跟 pieceShapes(settings) 一一對應。
 * keep：已經擺好、要保留的棋子（同樣一一對應，沒擺的是 null）。
 * budget 限制搜尋步數，避免極端情況卡住；找不到回傳 null。
 */
export function findPlacement(
  settings: BoardSettings,
  rng: () => number = Math.random,
  keep: Array<Plane | null> = [],
  budget = 60_000,
): Plane[] | null {
  const { size } = settings;
  const shapes = pieceShapes(settings);
  const n = shapes.length;
  if (shapes.some((s) => shapeTooBig(s, size))) return null;
  if (shapes.reduce((a, s) => a + s.cells.length, 0) > size * size) return null;
  const separate = n > 1;
  const ship = settings.mode === 'ship';

  const blocked = new Uint16Array(size * size);
  const result: Array<Plane | null> = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const p = keep[i];
    if (!p) continue;
    const c = toCandidate(p, shapes[i], size, separate);
    if (!c || c.cells.some((k) => blocked[k])) return null;
    for (const k of c.zone) blocked[k]++;
    result[i] = p;
  }

  // 每種形狀各自的候選位置，洗牌
  const lists = new Map<string, Candidate[]>();
  for (const s of shapes) {
    const key = shapeKey(s);
    if (lists.has(key)) continue;
    const list = candidatesFor(s, size, separate, ship);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    lists.set(key, list);
  }

  // 先擺大的；同形狀的棋子依序取候選（避免重複搜尋同一組合的不同排列）
  const todo = shapes
    .map((s, i) => ({ i, key: shapeKey(s), size: s.cells.length }))
    .filter((t) => !result[t.i])
    .sort((a, b) => b.size - a.size || a.key.localeCompare(b.key));

  let steps = 0;
  const dfs = (t: number, start: number): boolean => {
    if (t === todo.length) return true;
    const { i, key } = todo[t];
    const list = lists.get(key)!;
    for (let ci = start; ci < list.length; ci++) {
      if (++steps > budget) return false;
      const c = list[ci];
      let ok = true;
      for (const k of c.cells) {
        if (blocked[k]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (const k of c.zone) blocked[k]++;
      result[i] = c.plane;
      const nextStart = t + 1 < todo.length && todo[t + 1].key === key ? ci + 1 : 0;
      if (dfs(t + 1, nextStart)) return true;
      result[i] = null;
      for (const k of c.zone) blocked[k]--;
      if (steps > budget) return false;
    }
    return false;
  };
  return dfs(0, 0) ? (result as Plane[]) : null;
}

const FEASIBLE_SEEDS = [0x5eed, 0xbeef, 0xc0ffee];

/** 這個設定是否擺得下（前後端用同樣的種子與步數，所以判斷一致） */
export function isFeasible(settings: BoardSettings): boolean {
  return FEASIBLE_SEEDS.some((seed) => findPlacement(settings, seededRng(seed), [], 30_000) !== null);
}

/** 飛機版：在這個棋盤上最多能放幾架（上限 MAX_PLANES） */
export function maxFeasiblePlanes(size: number, shape: ShapeDef): number {
  let n = 0;
  while (n < MAX_PLANES && isFeasible({ mode: 'plane', size, shape, planes: n + 1 })) n++;
  return n;
}

/** 隨機擺放：先保留已經擺好的棋子補滿；補不下就整盤重來 */
export function randomPlacement(
  settings: BoardSettings,
  keep: Array<Plane | null> = [],
): { planes: Plane[]; reset: boolean } | null {
  const n = pieceCount(settings);
  const kept = keep.filter(Boolean).length;
  const partial = kept > 0 && kept < n;
  const withKeep = partial ? findPlacement(settings, Math.random, keep) : null;
  if (withKeep) return { planes: withKeep, reset: false };
  const fresh =
    findPlacement(settings, Math.random) ??
    FEASIBLE_SEEDS.map((s) => findPlacement(settings, seededRng(s), [], 30_000)).find(Boolean);
  return fresh ? { planes: fresh, reset: partial } : null;
}

const COLS = 'ABCDEFGHIJKLMNOP';
export function colLabel(x: number): string {
  return COLS[x] ?? String(x + 1);
}
/** 座標標籤，例如 C7 */
export function coordLabel(x: number, y: number): string {
  return `${colLabel(x)}${y + 1}`;
}

/** 一組格子的外框線段（以格為單位，用於畫出輪廓） */
export function cellsOutline(cells: Cell[]): Array<[number, number, number, number]> {
  const set = new Set(cells.map((c) => cellKey(c.x, c.y)));
  const segs: Array<[number, number, number, number]> = [];
  for (const { x, y } of cells) {
    if (!set.has(cellKey(x, y - 1))) segs.push([x, y, x + 1, y]);
    if (!set.has(cellKey(x, y + 1))) segs.push([x, y + 1, x + 1, y + 1]);
    if (!set.has(cellKey(x - 1, y))) segs.push([x, y, x, y + 1]);
    if (!set.has(cellKey(x + 1, y))) segs.push([x + 1, y, x + 1, y + 1]);
  }
  return segs;
}

export function planeOutline(p: Plane, shape: ShapeDef): Array<[number, number, number, number]> {
  return cellsOutline(planeCells(p, shape));
}

/** 一組棋子周圍「一定是空的」格子（完全分開的規則下，擊沉的船旁邊不會有別的船） */
export function surroundingCells(pieces: Placed[], size: number): Cell[] {
  const own = new Set<number>();
  for (const p of pieces) for (const c of planeCells(p.plane, p.shape)) own.add(cellKey(c.x, c.y));
  const out = new Map<number, Cell>();
  for (const p of pieces) {
    for (const c of planeCells(p.plane, p.shape)) {
      for (const [dx, dy] of TOUCH) {
        const n = { x: c.x + dx, y: c.y + dy };
        const k = cellKey(n.x, n.y);
        if (inBounds(n, size) && !own.has(k)) out.set(k, n);
      }
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// 飛機版「自動標記」：打到機頭之後，只用自己看得到的資訊推理
// ---------------------------------------------------------------------------

export interface FoundPlane {
  /** 打中的機頭 */
  head: Cell;
  /** 還有可能的擺法（機頭固定，最多四個朝向） */
  options: Placed[];
  /** 只剩一種擺法時，就是它 */
  known: Placed | null;
  /** 不管是哪一種擺法，一定是空的格子（還沒開過火的） */
  empty: Cell[];
}

/** 機頭在 head、朝 dir 的那架飛機 */
function planeWithHeadAt(head: Cell, dir: Dir, shape: ShapeDef): Plane {
  const h = planeCells({ x: 0, y: 0, dir }, shape)[0];
  return { x: head.x - h.x, y: head.y - h.y, dir };
}

/**
 * 根據自己打出去的砲推理每架被找到的飛機：
 * - 飛機的格子不會是「沒打中」，也不會是另一個機頭
 * - 飛機之間完全分開，所以任何打中的格子（機頭或機身）都不會貼著別架飛機
 * 只有一種擺法的飛機會再拿來排除其他飛機的擺法，反覆到沒有變化為止。
 * 只有一架飛機時，找到機頭就贏了，不需要推理。
 */
export function deduceFoundPlanes(settings: PlaneSettings, shots: Array<Pick<Shot, 'x' | 'y' | 'r'>>): FoundPlane[] {
  if (settings.planes < 2) return [];
  const { size, shape } = settings;
  const result = new Map<number, ShotResult>();
  for (const s of shots) result.set(cellKey(s.x, s.y), s.r);
  const heads = shots.filter((s) => s.r === 'head').map(({ x, y }) => ({ x, y }));
  const known = new Map<number, Placed>(); // 機頭 → 確定的擺法

  const optionsFor = (head: Cell): Placed[] => {
    const hk = cellKey(head.x, head.y);
    const others = [...known.entries()].filter(([k]) => k !== hk).map(([, p]) => p);
    return DIRS.map((dir) => ({ plane: planeWithHeadAt(head, dir, shape), shape })).filter((cand) => {
      const cells = planeCells(cand.plane, cand.shape);
      if (!cells.every((c) => inBounds(c, size))) return false;
      const own = new Set(cells.map((c) => cellKey(c.x, c.y)));
      for (const c of cells) {
        const r = result.get(cellKey(c.x, c.y));
        if (r === 'miss' || (r === 'head' && cellKey(c.x, c.y) !== hk)) return false;
        for (const [dx, dy] of TOUCH) {
          const k = cellKey(c.x + dx, c.y + dy);
          const nr = result.get(k);
          if (!own.has(k) && (nr === 'head' || nr === 'body')) return false;
        }
      }
      return placementConflict(settings, others, cand) === null;
    });
  };

  for (let changed = true; changed; ) {
    changed = false;
    for (const h of heads) {
      const k = cellKey(h.x, h.y);
      if (known.has(k)) continue;
      const opts = optionsFor(h);
      if (opts.length === 1) {
        known.set(k, opts[0]);
        changed = true;
      }
    }
  }

  return heads.map((head) => {
    const k = cellKey(head.x, head.y);
    const fixed = known.get(k);
    const options = fixed ? [fixed] : optionsFor(head);
    let empty: Cell[] = [];
    if (options.length) {
      const counts = new Map<number, { cell: Cell; n: number }>();
      for (const o of options) {
        for (const c of surroundingCells([o], size)) {
          const ck = cellKey(c.x, c.y);
          const e = counts.get(ck);
          if (e) e.n++;
          else counts.set(ck, { cell: c, n: 1 });
        }
      }
      empty = [...counts.entries()]
        .filter(([ck, e]) => e.n === options.length && !result.has(ck))
        .map(([, e]) => e.cell);
    }
    return { head, options, known: fixed ?? null, empty };
  });
}
