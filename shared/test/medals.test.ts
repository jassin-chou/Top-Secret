import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDALS,
  applyResult,
  emptyStats,
  nameFromEmail,
  rankPlayers,
  sortMedals,
  type HistoryEntry,
  type PlayerStats,
} from '../src/index.js';

let seq = 0;
function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  seq++;
  return {
    id: `G${seq}-1`,
    mode: 'plane',
    result: 'win',
    endReason: 'cleared',
    vs: 'friend',
    myName: '我',
    oppName: '你',
    gameId: `ROOM${seq}`,
    round: 1,
    summary: '10×10',
    moves: 30,
    hits: 12,
    pieces: 3,
    oppFound: 1,
    firstShotHead: false,
    finishedAt: Date.UTC(2026, 10, 26, 6), // 台灣下午兩點
    ...over,
  };
}

function play(list: HistoryEntry[], start: PlayerStats | null = null) {
  let s = start;
  const earned: string[] = [];
  for (const e of list) {
    const r = applyResult(s, e, { now: e.finishedAt, oppUid: `opp-${e.oppName}` });
    s = r.stats;
    earned.push(...r.earned);
  }
  return { stats: s!, earned };
}

test('there are at least 20 medals with unique ids and full designs', () => {
  assert.ok(MEDALS.length >= 20);
  assert.equal(new Set(MEDALS.map((m) => m.id)).size, MEDALS.length);
  for (const m of MEDALS) assert.ok(m.name && m.desc && m.shape && m.color && m.icon && m.tier);
  // 形狀和顏色的組合要夠多樣
  assert.ok(new Set(MEDALS.map((m) => m.shape)).size >= 6);
  assert.ok(new Set(MEDALS.map((m) => m.color)).size >= 9);
});

test('only games against people count towards the win rate', () => {
  const { stats } = play([
    entry({ result: 'win' }),
    entry({ result: 'lose' }),
    entry({ vs: 'bot', level: 'hard', result: 'win' }),
    entry({ vs: 'bot', level: 'easy', result: 'lose' }),
  ]);
  assert.equal(stats.games, 2);
  assert.equal(stats.wins, 1);
  assert.equal(stats.botGames, 2);
  assert.equal(stats.botWins, 1);
  assert.equal(stats.botHardWins, 1);
  assert.ok(stats.medals.bot_slayer, '打敗困難電腦');
});

test('the same game is never counted twice', () => {
  const e = entry();
  const once = applyResult(null, e, { now: 1 }).stats;
  const twice = applyResult(once, e, { now: 2 });
  assert.equal(twice.stats.games, 1);
  assert.deepEqual(twice.earned, []);
});

test('streak medals: 5 battleship wins in a row makes you 海戰棋大將軍', () => {
  const wins = Array.from({ length: 5 }, () => entry({ mode: 'ship', oppFound: 2, pieces: 5 }));
  const { stats, earned } = play([entry({ mode: 'ship', result: 'lose' }), ...wins]);
  assert.equal(stats.modes.ship.bestStreak, 5);
  assert.ok(earned.includes('first_win'));
  assert.ok(earned.includes('streak_3'));
  assert.ok(earned.includes('ship_general'));
  assert.equal(stats.medals.ship_general?.game, wins[4].id);
  // 輸一場連勝就歸零，但最佳紀錄留著
  const after = play([entry({ mode: 'ship', result: 'lose' })], stats).stats;
  assert.equal(after.streak, 0);
  assert.equal(after.bestStreak, 5);
});

test('single-game medals check that game only', () => {
  assert.ok(play([entry({ oppFound: 0 })]).earned.includes('flawless'));
  assert.ok(play([entry({ oppFound: 2, pieces: 3 })]).earned.includes('comeback'));
  assert.ok(play([entry({ firstShotHead: true })]).earned.includes('first_blood'));
  assert.ok(play([entry({ moves: 10, hits: 6 })]).earned.includes('sharpshooter'));
  assert.ok(!play([entry({ moves: 10, hits: 5 })]).earned.includes('sharpshooter'));
  const ab = play([entry({ mode: 'ab', moves: 3, hits: undefined, pieces: undefined, oppFound: undefined })]).earned;
  assert.ok(ab.includes('quick_crack') && ab.includes('mind_reader'));
  // 對手離開而贏的，不算單局表現獎牌
  assert.ok(!play([entry({ endReason: 'forfeit', oppFound: 0 })]).earned.includes('flawless'));
  // 跟電腦贏的不算
  assert.ok(!play([entry({ vs: 'bot', level: 'easy', oppFound: 0 })]).earned.includes('flawless'));
  assert.ok(play([entry({ finishedAt: Date.UTC(2026, 10, 26, 17) })]).earned.includes('night_owl')); // 台灣凌晨 1 點
});

test('leaderboard: Google players with enough games, best win rate first', () => {
  const mk = (name: string | null, google: boolean, wins: number, games: number) => {
    const s = emptyStats();
    s.name = name;
    s.google = google;
    s.games = games;
    s.wins = wins;
    s.modes.ab = { games, wins, streak: 0, bestStreak: 0 };
    s.medals = { first_win: { at: 1, game: 'x' }, streak_10: { at: 2, game: 'y' } };
    return s;
  };
  const rows = rankPlayers(
    [
      { uid: 'a', stats: mk('amy', true, 6, 10) },
      { uid: 'b', stats: mk('bob', true, 3, 3) },
      { uid: 'c', stats: mk('cat', true, 2, 2) }, // 場數不夠
      { uid: 'd', stats: mk(null, false, 9, 9) }, // 訪客不上榜
      { uid: 'e', stats: mk('eve', true, 6, 10) },
    ],
    'all',
    'e',
  );
  assert.deepEqual(
    rows.map((r) => [r.rank, r.name, r.rate, r.me]),
    [
      [1, 'bob', 100, false],
      [2, 'amy', 60, false],
      [2, 'eve', 60, true],
    ],
  );
  assert.deepEqual(rows[0].medals, ['streak_10', 'first_win']);
  assert.equal(rankPlayers([{ uid: 'a', stats: mk('amy', true, 6, 10) }], 'plane', null).length, 0);
  assert.equal(nameFromEmail('jassin.chou@gmail.com'), 'jassin.chou');
  assert.deepEqual(sortMedals(['first_win', 'nope', 'bot_master']), ['bot_master', 'first_win']);
});
