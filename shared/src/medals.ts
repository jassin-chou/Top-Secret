/**
 * 戰績、獎牌與排行榜規則。
 *
 * - 每位玩家一份 PlayerStats（後端存在 players/{uid}），每打完一局更新一次
 * - 勝率、連勝只算「跟真人」的對戰；跟電腦練習另外計數，只影響練習類獎牌
 * - 排行榜只列出用 Google 登入、而且跟真人打滿 MIN_RANKED_GAMES 局的玩家
 */
import type { BotLevel } from './bot.js';
import type { HistoryEntry } from './history.js';
import type { GameMode } from './types.js';

export interface ModeRecord {
  games: number;
  wins: number;
  /** 目前連勝 */
  streak: number;
  bestStreak: number;
}

export interface EarnedMedal {
  at: number;
  /** 在哪一局拿到的（對戰紀錄的 id） */
  game: string;
}

export interface PlayerStats {
  /** 排行榜上的名字：Gmail 的 @ 前面那段；訪客是 null */
  name: string | null;
  google: boolean;
  // ---- 跟真人 ----
  games: number;
  wins: number;
  streak: number;
  bestStreak: number;
  modes: Record<GameMode, ModeRecord>;
  /** 對戰過的真人（uid，最多記 50 位） */
  opponents: string[];
  // ---- 跟電腦 ----
  botGames: number;
  botWins: number;
  botHardWins: number;
  medals: Partial<Record<MedalId, EarnedMedal>>;
  /** 最近算過的對戰紀錄 id，避免同一局算兩次 */
  recent: string[];
  updatedAt: number;
}

export const MODES: GameMode[] = ['plane', 'ship', 'ab'];
export const MIN_RANKED_GAMES = 3;

const emptyMode = (): ModeRecord => ({ games: 0, wins: 0, streak: 0, bestStreak: 0 });

export function emptyStats(): PlayerStats {
  return {
    name: null,
    google: false,
    games: 0,
    wins: 0,
    streak: 0,
    bestStreak: 0,
    modes: { plane: emptyMode(), ship: emptyMode(), ab: emptyMode() },
    opponents: [],
    botGames: 0,
    botWins: 0,
    botHardWins: 0,
    medals: {},
    recent: [],
    updatedAt: 0,
  };
}

/** 舊資料或缺欄位時補齊 */
export function normalizeStats(raw: Partial<PlayerStats> | null | undefined): PlayerStats {
  const base = emptyStats();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    modes: {
      plane: { ...emptyMode(), ...raw.modes?.plane },
      ship: { ...emptyMode(), ...raw.modes?.ship },
      ab: { ...emptyMode(), ...raw.modes?.ab },
    },
    opponents: raw.opponents ?? [],
    medals: raw.medals ?? {},
    recent: raw.recent ?? [],
  };
}

/** Gmail 的 @ 前面那段，當排行榜名字 */
export function nameFromEmail(email: string | null | undefined): string | null {
  const prefix = email?.split('@')[0]?.trim();
  return prefix ? prefix.slice(0, 30) : null;
}

// ---------------------------------------------------------------------------
// 獎牌
// ---------------------------------------------------------------------------

export type MedalShape = 'round' | 'shield' | 'star' | 'hex' | 'ribbon' | 'diamond' | 'crown';
export type MedalColor =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'ruby'
  | 'sapphire'
  | 'teal'
  | 'amethyst'
  | 'emerald'
  | 'rose'
  | 'obsidian'
  | 'midnight';
export type MedalIcon =
  | 'star'
  | 'swords'
  | 'trophy'
  | 'flame'
  | 'plane'
  | 'ship'
  | 'digits'
  | 'triad'
  | 'target'
  | 'bolt'
  | 'shield'
  | 'arrow'
  | 'eye'
  | 'people'
  | 'repeat'
  | 'moon'
  | 'chip';

/** 1 普通、2 稀有、3 史詩、4 傳說：排行榜上越稀有的排越前面 */
export type MedalTier = 1 | 2 | 3 | 4;

export const TIER_NAME: Record<MedalTier, string> = { 1: '普通', 2: '稀有', 3: '史詩', 4: '傳說' };

interface MedalDef {
  id: string;
  name: string;
  desc: string;
  tier: MedalTier;
  shape: MedalShape;
  color: MedalColor;
  icon: MedalIcon;
  /** s 是已經加上這一局之後的戰績，e 是這一局 */
  check(s: PlayerStats, e: HistoryEntry): boolean;
}

const vsFriend = (e: HistoryEntry) => e.vs === 'friend';
const cleanWin = (e: HistoryEntry) => e.result === 'win' && e.endReason === 'cleared';
const boardMode = (e: HistoryEntry) => e.mode === 'plane' || e.mode === 'ship';
/** 台灣時間幾點 */
const taipeiHour = (ts: number) => new Date(ts + 8 * 3600_000).getUTCHours();

const DEFS = [
  // ---- 入門 ----
  { id: 'first_win', name: '初登場勝利', desc: '第一次贏真人', tier: 1, shape: 'round', color: 'bronze', icon: 'star',
    check: (s) => s.wins >= 1 },
  { id: 'games_10', name: '十戰老兵', desc: '跟真人打滿 10 場', tier: 1, shape: 'round', color: 'silver', icon: 'swords',
    check: (s) => s.games >= 10 },
  { id: 'rematch', name: '再來一局！', desc: '在同一個房間打到第 5 局', tier: 1, shape: 'ribbon', color: 'teal', icon: 'repeat',
    check: (_s, e) => vsFriend(e) && e.round >= 5 },
  { id: 'night_owl', name: '夜貓子', desc: '半夜 0～5 點跟真人打完一局', tier: 1, shape: 'round', color: 'midnight', icon: 'moon',
    check: (_s, e) => vsFriend(e) && taipeiHour(e.finishedAt) < 5 },
  { id: 'trainee', name: '勤奮練習生', desc: '跟電腦練習 10 局', tier: 1, shape: 'round', color: 'bronze', icon: 'chip',
    check: (s) => s.botGames >= 10 },

  // ---- 稀有 ----
  { id: 'streak_3', name: '三連勝', desc: '跟真人連贏 3 場', tier: 2, shape: 'ribbon', color: 'ruby', icon: 'flame',
    check: (s) => s.bestStreak >= 3 },
  { id: 'plane_ace', name: '王牌飛行員', desc: '尋機頭贏真人 10 場', tier: 2, shape: 'hex', color: 'sapphire', icon: 'plane',
    check: (s) => s.modes.plane.wins >= 10 },
  { id: 'ship_admiral', name: '艦隊司令', desc: '海戰棋贏真人 10 場', tier: 2, shape: 'hex', color: 'teal', icon: 'ship',
    check: (s) => s.modes.ship.wins >= 10 },
  { id: 'ab_genius', name: '數字神算', desc: '幾A幾B 贏真人 10 場', tier: 2, shape: 'hex', color: 'amethyst', icon: 'digits',
    check: (s) => s.modes.ab.wins >= 10 },
  { id: 'all_rounder', name: '三棲全能', desc: '三種玩法都贏過真人', tier: 2, shape: 'diamond', color: 'emerald', icon: 'triad',
    check: (s) => MODES.every((m) => s.modes[m].wins >= 1) },
  { id: 'sharpshooter', name: '神射手', desc: '尋機頭或海戰棋贏真人，命中率 60% 以上（至少開 8 砲）', tier: 2, shape: 'round', color: 'ruby', icon: 'target',
    check: (_s, e) => vsFriend(e) && boardMode(e) && cleanWin(e) && e.moves >= 8 && (e.hits ?? 0) / e.moves >= 0.6 },
  { id: 'quick_crack', name: '速解密碼', desc: '幾A幾B 跟真人對戰，5 次以內猜中', tier: 2, shape: 'star', color: 'amethyst', icon: 'bolt',
    check: (_s, e) => vsFriend(e) && e.mode === 'ab' && cleanWin(e) && e.moves <= 5 },
  { id: 'social', name: '好人緣', desc: '跟 5 位不同的人對戰過', tier: 2, shape: 'round', color: 'rose', icon: 'people',
    check: (s) => s.opponents.length >= 5 },
  { id: 'bot_slayer', name: '電腦剋星', desc: '打敗「困難」的電腦', tier: 2, shape: 'hex', color: 'obsidian', icon: 'chip',
    check: (s) => s.botHardWins >= 1 },

  // ---- 史詩 ----
  { id: 'plane_general', name: '尋機頭大元帥', desc: '尋機頭跟真人連贏 5 場', tier: 3, shape: 'shield', color: 'sapphire', icon: 'plane',
    check: (s) => s.modes.plane.bestStreak >= 5 },
  { id: 'ship_general', name: '海戰棋大將軍', desc: '海戰棋跟真人連贏 5 場', tier: 3, shape: 'shield', color: 'teal', icon: 'ship',
    check: (s) => s.modes.ship.bestStreak >= 5 },
  { id: 'ab_general', name: '密碼破譯大師', desc: '幾A幾B 跟真人連贏 5 場', tier: 3, shape: 'shield', color: 'amethyst', icon: 'digits',
    check: (s) => s.modes.ab.bestStreak >= 5 },
  { id: 'wins_25', name: '常勝軍', desc: '贏真人 25 場', tier: 3, shape: 'star', color: 'gold', icon: 'trophy',
    check: (s) => s.wins >= 25 },
  { id: 'games_50', name: '身經百戰', desc: '跟真人打滿 50 場', tier: 3, shape: 'shield', color: 'obsidian', icon: 'swords',
    check: (s) => s.games >= 50 },
  { id: 'first_blood', name: '天選之砲', desc: '尋機頭跟真人對戰，第一砲就打中機頭', tier: 3, shape: 'star', color: 'ruby', icon: 'bolt',
    check: (_s, e) => vsFriend(e) && e.mode === 'plane' && e.firstShotHead === true },
  { id: 'flawless', name: '滴水不漏', desc: '尋機頭或海戰棋贏真人，對手一架飛機、一艘船都沒打下來', tier: 3, shape: 'shield', color: 'silver', icon: 'shield',
    check: (_s, e) => vsFriend(e) && boardMode(e) && cleanWin(e) && e.oppFound === 0 },
  { id: 'comeback', name: '絕地反攻', desc: '只剩最後一架飛機或一艘船時，逆轉贏真人', tier: 3, shape: 'ribbon', color: 'gold', icon: 'arrow',
    check: (_s, e) =>
      vsFriend(e) && boardMode(e) && cleanWin(e) && (e.pieces ?? 0) > 1 && e.oppFound === (e.pieces ?? 0) - 1 },

  // ---- 傳說 ----
  { id: 'streak_10', name: '十連霸', desc: '跟真人連贏 10 場', tier: 4, shape: 'crown', color: 'gold', icon: 'flame',
    check: (s) => s.bestStreak >= 10 },
  { id: 'mind_reader', name: '讀心術', desc: '幾A幾B 跟真人對戰，3 次以內猜中', tier: 4, shape: 'star', color: 'obsidian', icon: 'eye',
    check: (_s, e) => vsFriend(e) && e.mode === 'ab' && cleanWin(e) && e.moves <= 3 },
  { id: 'bot_master', name: '人機大戰冠軍', desc: '打敗「困難」的電腦 10 次', tier: 4, shape: 'crown', color: 'silver', icon: 'chip',
    check: (s) => s.botHardWins >= 10 },
] as const satisfies readonly MedalDef[];

export type MedalId = (typeof DEFS)[number]['id'];
export type Medal = Omit<MedalDef, 'id' | 'check'> & { id: MedalId };

/** 全部獎牌（依稀有度排好） */
export const MEDALS: Medal[] = DEFS.map(({ check: _check, ...m }) => m as Medal);
const MEDAL_BY_ID = new Map<string, (typeof DEFS)[number]>(DEFS.map((d) => [d.id, d]));

export function medalById(id: string): Medal | undefined {
  const d = MEDAL_BY_ID.get(id);
  if (!d) return undefined;
  const { check: _check, ...m } = d;
  return m as Medal;
}

/** 越稀有、越晚定義的排越前面（排行榜名字後面顯示用） */
export function sortMedals(ids: string[]): MedalId[] {
  const order = new Map<string, number>(DEFS.map((d, i) => [d.id, i]));
  return ids
    .filter((id): id is MedalId => MEDAL_BY_ID.has(id))
    .sort((a, b) => MEDAL_BY_ID.get(b)!.tier - MEDAL_BY_ID.get(a)!.tier || order.get(b)! - order.get(a)!);
}

// ---------------------------------------------------------------------------
// 更新戰績
// ---------------------------------------------------------------------------

/**
 * 把一局的結果加進戰績，回傳新的戰績和這局新拿到的獎牌。
 * 同一局（同一個 entry.id）重複送來不會算兩次。
 */
export function applyResult(
  input: PlayerStats | null,
  entry: HistoryEntry,
  opts: { oppUid?: string; now: number },
): { stats: PlayerStats; earned: MedalId[] } {
  const s = structuredClone(normalizeStats(input));
  if (s.recent.includes(entry.id)) return { stats: s, earned: [] };
  const win = entry.result === 'win';

  if (entry.vs === 'friend') {
    s.games += 1;
    s.wins += win ? 1 : 0;
    s.streak = win ? s.streak + 1 : 0;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    const m = s.modes[entry.mode];
    m.games += 1;
    m.wins += win ? 1 : 0;
    m.streak = win ? m.streak + 1 : 0;
    m.bestStreak = Math.max(m.bestStreak, m.streak);
    if (opts.oppUid && !s.opponents.includes(opts.oppUid)) s.opponents = [...s.opponents, opts.oppUid].slice(-50);
  } else {
    s.botGames += 1;
    s.botWins += win ? 1 : 0;
    if (win && (entry.level as BotLevel | undefined) === 'hard') s.botHardWins += 1;
  }

  s.recent = [...s.recent, entry.id].slice(-30);
  s.updatedAt = opts.now;

  const earned: MedalId[] = [];
  for (const d of DEFS) {
    if (s.medals[d.id]) continue;
    if ((d.check as MedalDef['check'])(s, entry)) {
      s.medals[d.id] = { at: opts.now, game: entry.id };
      earned.push(d.id);
    }
  }
  return { stats: s, earned };
}

// ---------------------------------------------------------------------------
// 排行榜
// ---------------------------------------------------------------------------

export type BoardScope = 'all' | GameMode;

export interface LeaderRow {
  rank: number;
  name: string;
  games: number;
  wins: number;
  /** 勝率（0～100 的整數） */
  rate: number;
  bestStreak: number;
  medals: MedalId[];
  me: boolean;
}

export function recordFor(s: PlayerStats, scope: BoardScope) {
  if (scope === 'all') return { games: s.games, wins: s.wins, bestStreak: s.bestStreak };
  const m = s.modes[scope];
  return { games: m.games, wins: m.wins, bestStreak: m.bestStreak };
}

/** 勝率高的排前面；勝率一樣比贏的場數，再比打的場數 */
export function rankPlayers(
  players: Array<{ uid: string; stats: PlayerStats }>,
  scope: BoardScope,
  meUid: string | null,
): LeaderRow[] {
  const rows = players
    .filter((p) => p.stats.google && p.stats.name)
    .map((p) => {
      const r = recordFor(p.stats, scope);
      return {
        uid: p.uid,
        name: p.stats.name!,
        ...r,
        exact: r.games ? r.wins / r.games : 0,
        medals: sortMedals(Object.keys(p.stats.medals)),
      };
    })
    .filter((r) => r.games >= MIN_RANKED_GAMES)
    .sort((a, b) => b.exact - a.exact || b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name));

  let rank = 0;
  let prev: (typeof rows)[number] | null = null;
  return rows.map((r, i) => {
    if (!prev || prev.exact !== r.exact || prev.wins !== r.wins) rank = i + 1;
    prev = r;
    return {
      rank,
      name: r.name,
      games: r.games,
      wins: r.wins,
      rate: Math.round(r.exact * 100),
      bestStreak: r.bestStreak,
      medals: r.medals,
      me: r.uid === meUid,
    };
  });
}
