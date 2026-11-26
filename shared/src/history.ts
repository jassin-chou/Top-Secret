/**
 * 對戰紀錄：每打完一局，替每位玩家各留一筆。
 * 線上對戰由後端在棋局結束的那一刻寫入；跟電腦練習則由瀏覽器算好後送給後端保存。
 */
import { BOT_LEVELS, type BotLevel } from './bot.js';
import { GameError } from './errors.js';
import { normalizeSettings, opponentOf } from './engine.js';
import { isBoardSettings, pieceCount, validatePlacement } from './plane.js';
import type { GameMode, GameRecord, Guess, Plane, Settings, Shot, ShotResult } from './types.js';

/** 一方在這局的完整資料（結束後才記，所以棋子位置、密碼都可以公開） */
export interface SideDetail {
  /** 飛機版、海戰棋：自己藏的飛機／船 */
  pieces?: Plane[];
  /** 飛機版、海戰棋：自己打出去的每一發（n 是全局順序） */
  shots?: Shot[];
  /** 幾A幾B：自己的密碼 */
  code?: string;
  /** 幾A幾B：自己猜的每一次 */
  guesses?: Guess[];
}

/** 一局的詳細紀錄，可以在對戰紀錄裡一步一步重播 */
export interface GameDetail {
  settings: Settings;
  /** 這局是不是我先攻 */
  meFirst: boolean;
  me: SideDetail;
  opp: SideDetail;
}

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
  /** 逐步紀錄（加入這個功能之前打的局沒有） */
  detail?: GameDetail;
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
  entry.detail = gameDetail(rec, uid, opp);
  return entry;
}

/** Firestore 不收 undefined：沒有的欄位就不要放 */
function side(rec: GameRecord, id: string): SideDetail {
  const g = rec.pub;
  const out: SideDetail = {};
  if (g.settings.mode === 'ab') {
    const code = rec.priv[id]?.secret ?? g.codes?.[id];
    if (code) out.code = code;
    out.guesses = (g.guesses?.[id] ?? []).map(({ g: guess, a, b, n }) => ({ g: guess, a, b, n }));
  } else {
    const pieces = rec.priv[id]?.planes ?? g.reveal?.[id];
    if (pieces?.length) out.pieces = pieces.map(({ x, y, dir }) => ({ x, y, dir }));
    out.shots = (g.shots?.[id] ?? []).map(({ x, y, r, n, k }) => (k === undefined ? { x, y, r, n } : { x, y, r, n, k }));
  }
  return out;
}

export function gameDetail(rec: GameRecord, uid: string, opp: string): GameDetail {
  return { settings: rec.pub.settings, meFirst: rec.pub.firstTurn === uid, me: side(rec, uid), opp: side(rec, opp) };
}

/** 列表只需要摘要；逐步紀錄等點進去再拿 */
export function withoutDetail(entry: HistoryEntry): HistoryEntry {
  const { detail: _detail, ...rest } = entry;
  return rest;
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
  const detail = normalizeDetail(o.detail, mode);
  if (detail) entry.detail = detail;
  return entry;
}

// ---- 練習的逐步紀錄也是瀏覽器送來的：格式不對就整個不存（不影響紀錄本身） ----

const SHOT_RESULTS: ShotResult[] = ['head', 'body', 'miss', 'hit', 'sunk'];
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function normalizeSide(raw: unknown, settings: Settings): SideDetail | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: SideDetail = {};
  if (settings.mode === 'ab') {
    const digits = new RegExp(`^\\d{${settings.digits}}$`);
    if (o.code !== undefined) {
      if (typeof o.code !== 'string' || !digits.test(o.code)) return null;
      out.code = o.code;
    }
    if (!Array.isArray(o.guesses) || o.guesses.length > 500) return null;
    const guesses: Guess[] = [];
    for (const raw of o.guesses as Array<Record<string, unknown>>) {
      if (typeof raw?.g !== 'string' || !digits.test(raw.g)) return null;
      if (!isInt(raw.a, 0, settings.digits) || !isInt(raw.b, 0, settings.digits) || !isInt(raw.n, 0, 100000)) return null;
      guesses.push({ g: raw.g, a: raw.a, b: raw.b, n: raw.n });
    }
    out.guesses = guesses;
    return out;
  }
  if (!isBoardSettings(settings)) return null;
  if (o.pieces !== undefined) {
    if (validatePlacement(o.pieces, settings)) return null;
    out.pieces = (o.pieces as Plane[]).map(({ x, y, dir }) => ({ x, y, dir }));
  }
  const max = settings.size * settings.size;
  if (!Array.isArray(o.shots) || o.shots.length > max) return null;
  const shots: Shot[] = [];
  for (const raw of o.shots as Array<Record<string, unknown>>) {
    if (!isInt(raw?.x, 0, settings.size - 1) || !isInt(raw.y, 0, settings.size - 1)) return null;
    if (!SHOT_RESULTS.includes(raw.r as ShotResult) || !isInt(raw.n, 0, 100000)) return null;
    const shot: Shot = { x: raw.x, y: raw.y, r: raw.r as ShotResult, n: raw.n };
    if (raw.k !== undefined) {
      if (!isInt(raw.k, 0, pieceCount(settings) - 1)) return null;
      shot.k = raw.k;
    }
    shots.push(shot);
  }
  out.shots = shots;
  return out;
}

export function normalizeDetail(raw: unknown, mode: GameMode): GameDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  let settings: Settings;
  try {
    settings = normalizeSettings(o.settings);
  } catch {
    return null;
  }
  if (settings.mode !== mode) return null;
  const me = normalizeSide(o.me, settings);
  const opp = normalizeSide(o.opp, settings);
  if (!me || !opp) return null;
  return { settings, meFirst: o.meFirst === true, me, opp };
}
