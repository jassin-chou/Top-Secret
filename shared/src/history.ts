/**
 * 對戰紀錄：每打完一局，替每位玩家各留一筆。
 * 線上對戰由後端在棋局結束的那一刻寫入；跟電腦練習則由瀏覽器算好後送給後端保存。
 */
import { BOT_LEVELS, type BotLevel } from './bot.js';
import { GameError } from './errors.js';
import { opponentOf } from './engine.js';
import { pieceCount } from './plane.js';
import type { GameMode, GameRecord, Settings } from './types.js';

export interface HistoryEntry {
  /** 線上：房號-局數；練習：p-練習代碼-局數。同一局重複寫入會覆蓋，不會變兩筆 */
  id: string;
  mode: GameMode;
  result: 'win' | 'lose';
  endReason: 'cleared' | 'forfeit';
  vs: 'friend' | 'bot';
  /** 跟電腦練習時的難度 */
  level?: BotLevel;
  myName: string;
  oppName: string;
  gameId: string;
  round: number;
  /** 這局的設定，例如「10×10，3 架經典」 */
  summary: string;
  /** 飛機版、海戰棋：開了幾砲；幾A幾B：猜了幾次 */
  moves: number;
  /** 飛機版、海戰棋：打中幾砲 */
  hits?: number;
  /** 飛機版、海戰棋：每人有幾架飛機／幾艘船 */
  pieces?: number;
  /** 飛機版、海戰棋：對手打下了我幾架飛機／幾艘船 */
  oppFound?: number;
  /** 飛機版：我的第一砲就打中機頭 */
  firstShotHead?: boolean;
  finishedAt: number;
}

export const HISTORY_LIMIT = 100;

export function settingsSummary(s: Settings): string {
  if (s.mode === 'ab') return `${s.digits} 位數${s.repeat ? '，數字可重複' : ''}`;
  if (s.mode === 'ship') return `${s.size}×${s.size}，${s.fleet.length} 艘船`;
  return `${s.size}×${s.size}，${s.planes} 架「${s.shape.name}」`;
}

/** 從一局已結束的棋局，算出某位玩家的紀錄；還沒分出勝負就回傳 null */
export function historyEntryFor(
  rec: GameRecord,
  uid: string,
  opts: { vs: 'friend' | 'bot'; level?: BotLevel; idPrefix?: string },
): HistoryEntry | null {
  const g = rec.pub;
  if (g.status !== 'finished' || !g.winner || !g.playerIds.includes(uid)) return null;
  const opp = opponentOf(g, uid);
  if (!opp) return null;
  const shots = g.shots?.[uid] ?? [];
  const entry: HistoryEntry = {
    id: `${opts.idPrefix ?? ''}${g.id}-${g.round}`,
    mode: g.settings.mode,
    result: g.winner === uid ? 'win' : 'lose',
    endReason: g.endReason === 'forfeit' ? 'forfeit' : 'cleared',
    vs: opts.vs,
    myName: g.players[uid]?.name ?? '',
    oppName: g.players[opp]?.name ?? '',
    gameId: g.id,
    round: g.round,
    summary: settingsSummary(g.settings),
    moves: g.settings.mode === 'ab' ? (g.guesses?.[uid]?.length ?? 0) : shots.length,
    finishedAt: g.updatedAt,
  };
  if (g.settings.mode !== 'ab') {
    entry.hits = shots.filter((s) => s.r !== 'miss').length;
    entry.pieces = pieceCount(g.settings);
    entry.oppFound = g.found?.[opp] ?? 0;
    if (g.settings.mode === 'plane') entry.firstShotHead = shots[0]?.r === 'head';
  }
  if (opts.level) entry.level = opts.level;
  return entry;
}

/** 線上對戰結束時，雙方各一筆 */
export function historyEntries(rec: GameRecord): Array<{ uid: string; entry: HistoryEntry }> {
  const out: Array<{ uid: string; entry: HistoryEntry }> = [];
  for (const uid of rec.pub.playerIds) {
    const entry = historyEntryFor(rec, uid, { vs: 'friend' });
    if (entry) out.push({ uid, entry });
  }
  return out;
}

// ---- 練習紀錄由瀏覽器送來，後端要逐欄檢查 ----

const MODES: GameMode[] = ['plane', 'ship', 'ab'];

function str(v: unknown, max: number, field: string): string {
  if (typeof v !== 'string') throw new GameError('BAD_REQUEST', `${field} 格式不正確`);
  return v.trim().slice(0, max);
}

function count(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10000) {
    throw new GameError('BAD_REQUEST', `${field} 格式不正確`);
  }
  return v;
}

/** 檢查瀏覽器送來的練習紀錄，只留下認得的欄位 */
export function normalizePracticeEntry(raw: unknown, now: number): HistoryEntry {
  const o = (raw ?? {}) as Record<string, unknown>;
  const mode = o.mode as GameMode;
  if (!MODES.includes(mode)) throw new GameError('BAD_REQUEST', '玩法不正確');
  if (o.result !== 'win' && o.result !== 'lose') throw new GameError('BAD_REQUEST', '勝負不正確');
  const gameId = str(o.gameId, 12, '代碼');
  if (!/^[A-Z0-9]{4,12}$/.test(gameId)) throw new GameError('BAD_REQUEST', '代碼不正確');
  const round = count(o.round, '局數');
  const entry: HistoryEntry = {
    id: `p-${gameId}-${round}`,
    mode,
    result: o.result,
    endReason: o.endReason === 'forfeit' ? 'forfeit' : 'cleared',
    vs: 'bot',
    myName: str(o.myName, 20, '暱稱'),
    oppName: str(o.oppName, 20, '對手名稱'),
    gameId,
    round,
    summary: str(o.summary, 60, '設定'),
    moves: count(o.moves, '步數'),
    finishedAt: now,
  };
  if (o.hits !== undefined && mode !== 'ab') entry.hits = count(o.hits, '命中數');
  if (BOT_LEVELS.includes(o.level as BotLevel)) entry.level = o.level as BotLevel;
  return entry;
}
