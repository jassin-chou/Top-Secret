/**
 * 電腦對手的出手策略（飛機版與海戰棋共用難度設定）。
 *
 * 想法：列出「還沒解決的目標可能擺在哪裡」的所有擺法，扣掉跟已知結果矛盾的，
 * 再統計每一格的可能性。打中過的格子會讓附近的擺法權重大幅提高（追擊）。
 * - 簡單：大多亂打，偶爾參考機率
 * - 普通：常常參考機率、會追擊，但有時會亂打
 * - 困難：每次都打機率最高的格子
 */
import { DIRS, TOUCH, cellKey, inBounds, planeCells, surroundingCells } from './plane.js';
import { shipShape } from './shapes.js';
import { abScore, allCodes, randomCode } from './code.js';
import type {
  AbSettings,
  BoardSettings,
  Cell,
  Guess,
  PlaneSettings,
  ShipSettings,
  Shot,
  ShotResult,
  SunkPiece,
} from './types.js';

export type BotLevel = 'easy' | 'normal' | 'hard';

export const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
export const BOT_LEVEL_NAME: Record<BotLevel, string> = { easy: '簡單', normal: '普通', hard: '困難' };

const touches = (a: Cell, b: Cell) => TOUCH.some(([dx, dy]) => a.x + dx === b.x && a.y + dy === b.y);

/** 飛機版：每一格「是還沒找到的機頭」的分數 */
export function headScores(settings: PlaneSettings, shots: Shot[]): Map<number, number> {
  const { size, shape } = settings;
  const known = new Map<number, ShotResult>();
  for (const s of shots) known.set(cellKey(s.x, s.y), s.r);
  const foundHeads = shots.filter((s) => s.r === 'head');

  const scores = new Map<number, number>();
  for (const dir of DIRS) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cells = planeCells({ x, y, dir }, shape);
        if (!cells.every((c) => inBounds(c, size))) continue;
        const head = cells[0];
        // 機頭那格打過了：不是沒打中、就是機身、就是已經找到的機頭 → 不可能是「還沒找到的飛機」
        if (known.has(cellKey(head.x, head.y))) continue;

        let ok = true;
        let bodyHits = 0;
        for (let i = 1; i < cells.length && ok; i++) {
          const r = known.get(cellKey(cells[i].x, cells[i].y));
          if (r === 'miss' || r === 'head') ok = false;
          else if (r === 'body') bodyHits++;
        }
        // 多架飛機時要完全分開：不能貼著已經找到的機頭
        if (ok && settings.planes > 1 && foundHeads.length) {
          ok = !cells.some((c) => foundHeads.some((h) => touches(c, h)));
        }
        if (!ok) continue;
        const k = cellKey(head.x, head.y);
        scores.set(k, (scores.get(k) ?? 0) + (1 + 25 * bodyHits * bodyHits));
      }
    }
  }
  return scores;
}

/**
 * 海戰棋：每一格「有還沒擊沉的船」的分數。
 * sunk 是電腦已經擊沉的船（位置公開），船的周圍一定是空的。
 */
export function shipScores(settings: ShipSettings, shots: Shot[], sunk: SunkPiece[]): Map<number, number> {
  const { size, fleet } = settings;
  const separate = fleet.length > 1;
  const known = new Map<number, ShotResult>();
  for (const s of shots) known.set(cellKey(s.x, s.y), s.r);

  const sunkPlaced = sunk.map((p) => ({ plane: p, shape: shipShape(fleet[p.k]) }));
  const sunkCells = new Set<number>();
  for (const p of sunkPlaced) for (const c of planeCells(p.plane, p.shape)) sunkCells.add(cellKey(c.x, c.y));
  const blocked = new Set(sunkCells);
  if (separate) for (const c of surroundingCells(sunkPlaced, size)) blocked.add(cellKey(c.x, c.y));

  // 打中了但還沒沉的格子：一定屬於還沒擊沉的船
  const openHits = shots.filter((s) => (s.r === 'hit' || s.r === 'sunk') && !sunkCells.has(cellKey(s.x, s.y)));

  // 還沒沉的船，依長度分組
  const sunkIdx = new Set(sunk.map((p) => p.k));
  const remaining = new Map<number, number>();
  fleet.forEach((len, i) => {
    if (!sunkIdx.has(i)) remaining.set(len, (remaining.get(len) ?? 0) + 1);
  });

  const scores = new Map<number, number>();
  for (const [len, count] of remaining) {
    const shape = shipShape(len);
    // 船只要兩個方向（橫、直）就涵蓋所有位置
    for (const dir of ['up', 'left'] as const) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const cells = planeCells({ x, y, dir }, shape);
          if (!cells.every((c) => inBounds(c, size))) continue;
          let ok = true;
          let covered = 0;
          const mine = new Set<number>();
          for (const c of cells) {
            const k = cellKey(c.x, c.y);
            mine.add(k);
            const r = known.get(k);
            if (r === 'miss' || blocked.has(k)) {
              ok = false;
              break;
            }
            if (r === 'hit') covered++;
          }
          if (!ok) continue;
          // 完全分開：沒被這艘船涵蓋的打中格子屬於別艘船，這艘船不能貼著它
          if (separate && openHits.some((h) => !mine.has(cellKey(h.x, h.y)) && cells.some((c) => touches(c, h)))) continue;
          const w = count * (1 + 25 * covered * covered);
          for (const c of cells) {
            const k = cellKey(c.x, c.y);
            if (!known.has(k)) scores.set(k, (scores.get(k) ?? 0) + w);
          }
        }
      }
    }
  }
  return scores;
}

function unshotCells(size: number, shots: Shot[]): Cell[] {
  const shot = new Set(shots.map((s) => cellKey(s.x, s.y)));
  const out: Cell[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!shot.has(cellKey(x, y))) out.push({ x, y });
  return out;
}

/** 依權重抽一格 */
function weightedPick(cells: Cell[], weight: (c: Cell) => number, rng: () => number): Cell {
  const ws = cells.map(weight);
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return cells[Math.floor(rng() * cells.length)];
  let r = rng() * total;
  for (let i = 0; i < cells.length; i++) {
    r -= ws[i];
    if (r <= 0) return cells[i];
  }
  return cells[cells.length - 1];
}

/**
 * 電腦要打哪一格。
 * shots：電腦自己打過的紀錄；sunk：電腦擊沉的船（只有海戰棋需要）
 */
export function chooseBotShot(
  settings: BoardSettings,
  shots: Shot[],
  level: BotLevel,
  rng: () => number = Math.random,
  sunk: SunkPiece[] = [],
): Cell {
  const open = unshotCells(settings.size, shots);
  if (!open.length) throw new Error('沒有格子可以打了');

  const randomRate = level === 'easy' ? 0.85 : level === 'normal' ? 0.45 : 0;
  if (rng() < randomRate) return open[Math.floor(rng() * open.length)];

  const scores = settings.mode === 'ship' ? shipScores(settings, shots, sunk) : headScores(settings, shots);
  const score = (c: Cell) => scores.get(cellKey(c.x, c.y)) ?? 0;

  if (level === 'hard') {
    let best = -1;
    let picks: Cell[] = [];
    for (const c of open) {
      const s = score(c);
      if (s > best) {
        best = s;
        picks = [c];
      } else if (s === best) picks.push(c);
    }
    return picks[Math.floor(rng() * picks.length)];
  }
  // 簡單、普通：依分數抽樣（高分格子機會大，但不一定挑最好的）
  return weightedPick(open, score, rng);
}

// ---------------------------------------------------------------------------
// 幾A幾B
// ---------------------------------------------------------------------------

/** 跟目前所有猜測結果都對得上的密碼 */
export function consistentCodes(settings: AbSettings, guesses: Guess[]): string[] {
  return allCodes(settings).filter((c) =>
    guesses.every((g) => {
      const r = abScore(c, g.g);
      return r.a === g.a && r.b === g.b;
    }),
  );
}

/**
 * 電腦要猜哪個數字。
 * - 簡單：大多亂猜（不一定符合已知線索）
 * - 普通：多半從符合所有線索的數字裡挑，偶爾亂猜
 * - 困難：挑「最壞情況下剩最少可能」的數字（候選太多時先隨機挑）
 */
export function chooseBotGuess(
  settings: AbSettings,
  guesses: Guess[],
  level: 'easy' | 'normal' | 'hard',
  rng: () => number = Math.random,
): string {
  const tried = new Set(guesses.map((g) => g.g));
  const pickUntried = (list: string[]) => {
    const open = list.filter((c) => !tried.has(c));
    return open.length ? open[Math.floor(rng() * open.length)] : null;
  };

  if (!guesses.length) return randomCode(settings, rng);
  // 簡單、普通會「分心」亂猜一次（像真人一樣不是每次都用上全部線索）
  const distract = level === 'easy' ? 0.75 : level === 'normal' ? 0.3 : 0;
  if (rng() < distract) {
    for (let i = 0; i < 50; i++) {
      const c = randomCode(settings, rng);
      if (!tried.has(c)) return c;
    }
  }

  const cands = consistentCodes(settings, guesses).filter((c) => !tried.has(c));
  if (!cands.length) return pickUntried(allCodes(settings)) ?? randomCode(settings, rng);
  if (level !== 'hard' || cands.length === 1 || cands.length > 1500) {
    return cands[Math.floor(rng() * cands.length)];
  }

  // 困難：在候選裡（最多抽 300 個）找「回答後最壞情況剩最少候選」的猜法
  const pool = cands.length <= 300 ? cands : Array.from({ length: 300 }, () => cands[Math.floor(rng() * cands.length)]);
  let best: string[] = [];
  let bestWorst = Infinity;
  for (const g of pool) {
    const buckets = new Map<number, number>();
    let worst = 0;
    for (const c of cands) {
      const r = abScore(c, g);
      const k = r.a * 10 + r.b;
      const n = (buckets.get(k) ?? 0) + 1;
      buckets.set(k, n);
      if (n > worst) worst = n;
      if (worst > bestWorst) break;
    }
    if (worst < bestWorst) {
      bestWorst = worst;
      best = [g];
    } else if (worst === bestWorst) best.push(g);
  }
  return best[Math.floor(rng() * best.length)];
}
