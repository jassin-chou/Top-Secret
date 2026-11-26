/**
 * 練習模式：在瀏覽器裡跟電腦對戰，不需要伺服器。
 * 用的是跟線上對戰同一套規則引擎（shared），只是電腦的動作在這裡自動執行。
 * 進度存在 sessionStorage，重新整理頁面可以接著打。
 */
import {
  BOT_LEVELS,
  BOT_LEVEL_NAME,
  GameError,
  chooseBotGuess,
  chooseBotShot,
  createGameRecord,
  fire,
  POKE_LINE,
  generateRoomCode,
  say,
  historyEntryFor,
  joinGame,
  leaveGame,
  makeGuess,
  normalizeName,
  normalizeSettings,
  placePlanes,
  randomCode,
  randomPlacement,
  setSecret,
  unready,
  viewFor,
  voteRematch,
  type BotLevel,
  type GameRecord,
  type HistoryEntry,
  type QuickLineId,
  type Plane,
} from '@planehunt/shared';
import type { Backend, ViewPatch } from './backend';

export const PRACTICE_ME = 'p_you';
const BOT = 'p_bot';
const KEY = (id: string) => `planehunt.practice.${id}`;

interface PracticeGame {
  rec: GameRecord;
  level: BotLevel;
}

const games = new Map<string, PracticeGame>();
const listeners = new Map<string, Set<(rec: GameRecord) => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// ---- 電腦也會聊天：回你的話，你想太久也會催你 ----

const BOT_REPLIES: Record<QuickLineId | 'text', string[]> = {
  slow: ['別催啦，我在想～', '好啦好啦', '慢工出細活'],
  win: ['走著瞧！', '這可不一定喔', '哼哼，我也是'],
  close: ['差一點點！', '運氣真好'],
  nice: ['謝謝～', '你也不錯喔'],
  haha: ['哈哈哈', '笑什麼啦'],
  argh: ['嘿嘿', '承讓承讓'],
  text: ['嗯嗯', '我是電腦，看不太懂', '專心下棋！'],
};
/** 輪到你超過這麼久，電腦會戳你一下（每一回合最多一次） */
const BOT_POKE_AFTER_MS = 30_000;
const pokeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pokedAt = new Map<string, number>();

function botSay(id: string, msg: { line?: QuickLineId; text?: string }) {
  const cur = games.get(id);
  if (!cur) return;
  try {
    save({ ...cur, rec: say(cur.rec, BOT, msg, Date.now()) });
  } catch {
    // 房間關了或說太快：這句就不說了
  }
}

function botReply(id: string, to: { line?: unknown; text?: unknown }) {
  if (Math.random() < 0.3) return; // 偶爾已讀不回
  const key = (typeof to.line === 'string' && to.line in BOT_REPLIES ? to.line : 'text') as QuickLineId | 'text';
  const options = BOT_REPLIES[key];
  setTimeout(() => botSay(id, { text: options[Math.floor(Math.random() * options.length)] }), 900 + Math.random() * 900);
}

/** 輪到你、而且這一回合還沒被戳過：30 秒後戳你一下 */
function schedulePoke(id: string) {
  clearTimeout(pokeTimers.get(id));
  pokeTimers.delete(id);
  const g = games.get(id);
  if (!g) return;
  const { pub } = g.rec;
  if (pub.status !== 'playing' || pub.turn !== PRACTICE_ME || pokedAt.get(id) === pub.seq) return;
  const seq = pub.seq;
  pokeTimers.set(
    id,
    setTimeout(() => {
      pokeTimers.delete(id);
      const cur = games.get(id);
      if (!cur || cur.rec.pub.status !== 'playing' || cur.rec.pub.turn !== PRACTICE_ME || cur.rec.pub.seq !== seq) return;
      pokedAt.set(id, seq);
      botSay(id, { line: POKE_LINE });
    }, BOT_POKE_AFTER_MS),
  );
}

function load(id: string): PracticeGame | null {
  const hit = games.get(id);
  if (hit) return hit;
  try {
    const raw = sessionStorage.getItem(KEY(id));
    if (!raw) return null;
    const g = JSON.parse(raw) as PracticeGame;
    games.set(id, g);
    return g;
  } catch {
    return null;
  }
}

/** 練習打完一局時要做什麼（App 會設成「送到後端存進對戰紀錄」） */
let recorder: ((entry: HistoryEntry) => void) | null = null;
export function setPracticeRecorder(fn: ((entry: HistoryEntry) => void) | null) {
  recorder = fn;
}

function save(g: PracticeGame) {
  const id = g.rec.pub.id;
  const before = games.get(id)?.rec.pub.status;
  games.set(id, g);
  // 分出勝負的那一刻記一筆；自己中途離開的不算
  if (before !== 'finished' && g.rec.pub.status === 'finished' && g.rec.pub.endReason !== 'forfeit') {
    const entry = historyEntryFor(g.rec, PRACTICE_ME, { vs: 'bot', level: g.level, idPrefix: 'p-' });
    if (entry) recorder?.(entry);
  }
  try {
    sessionStorage.setItem(KEY(id), JSON.stringify(g));
  } catch {
    // 無痕模式等情況：只存在記憶體
  }
  for (const fn of listeners.get(id) ?? []) fn(g.rec);
  schedule(id);
  schedulePoke(id);
}

/** 電腦擺好飛機、船，或設好密碼（每局開始時） */
function botPrepare(rec: GameRecord): GameRecord {
  if (rec.pub.status !== 'placing' || rec.pub.players[BOT]?.ready) return rec;
  const { settings } = rec.pub;
  if (settings.mode === 'ab') return setSecret(rec, BOT, randomCode(settings), Date.now());
  const planes = randomPlacement(settings)?.planes;
  if (!planes) throw new GameError('INTERNAL', '電腦找不到位置擺飛機');
  return placePlanes(rec, BOT, planes, Date.now());
}

/** 輪到電腦時，等一下下再開火，看起來比較像在思考 */
function schedule(id: string) {
  const g = games.get(id);
  if (!g || timers.has(id)) return;
  const { pub } = g.rec;
  if (pub.status !== 'playing' || pub.turn !== BOT) return;
  const delay = 600 + Math.random() * 600;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      const cur = games.get(id);
      if (!cur || cur.rec.pub.status !== 'playing' || cur.rec.pub.turn !== BOT) return;
      const { settings } = cur.rec.pub;
      if (settings.mode === 'ab') {
        const guess = chooseBotGuess(settings, cur.rec.pub.guesses?.[BOT] ?? [], cur.level);
        save({ ...cur, rec: makeGuess(cur.rec, BOT, guess, Date.now()) });
        return;
      }
      const target = chooseBotShot(settings, cur.rec.pub.shots[BOT] ?? [], cur.level, Math.random, cur.rec.pub.sunk?.[BOT] ?? []);
      save({ ...cur, rec: fire(cur.rec, BOT, target.x, target.y, Date.now()) });
    }, delay),
  );
}

function requireGame(id: unknown): PracticeGame {
  const g = typeof id === 'string' ? load(id) : null;
  if (!g) throw new GameError('NOT_FOUND', '這場練習已經結束了，回首頁再開一場吧');
  return g;
}

type Body = Record<string, unknown>;

export function createPracticeBackend(): Backend {
  return {
    mode: 'practice',
    async init() {
      return PRACTICE_ME;
    },

    async call<T>(action: string, raw: object = {}): Promise<T> {
      const body = raw as Body;
      const now = Date.now();
      const done = (g: PracticeGame) => {
        save(g);
        return viewFor(g.rec, PRACTICE_ME) as T;
      };

      switch (action) {
        case 'whoami':
          return { uid: PRACTICE_ME } as T;

        case 'create': {
          const level: BotLevel = BOT_LEVELS.includes(body.level as BotLevel) ? (body.level as BotLevel) : 'normal';
          const settings = normalizeSettings(body.settings);
          const name = typeof body.name === 'string' && body.name.trim() ? normalizeName(body.name) : '你';
          let id = generateRoomCode();
          while (load(id)) id = generateRoomCode();
          let rec = createGameRecord({ id, uid: PRACTICE_ME, name, settings, now });
          rec = joinGame(rec, BOT, `電腦（${BOT_LEVEL_NAME[level]}）`, now);
          rec = botPrepare(rec);
          return done({ rec, level });
        }

        case 'state':
          return viewFor(requireGame(body.gameId).rec, PRACTICE_ME) as T;

        case 'place': {
          const g = requireGame(body.gameId);
          return done({ ...g, rec: placePlanes(g.rec, PRACTICE_ME, body.planes as Plane[], now) });
        }

        case 'secret': {
          const g = requireGame(body.gameId);
          return done({ ...g, rec: setSecret(g.rec, PRACTICE_ME, String(body.secret ?? ''), now) });
        }

        case 'guess': {
          const g = requireGame(body.gameId);
          const rec = makeGuess(g.rec, PRACTICE_ME, String(body.guess ?? ''), now);
          const last = rec.pub.lastGuess;
          return { ...done({ ...g, rec }), result: last ? { a: last.a, b: last.b } : null } as T;
        }

        case 'unready': {
          const g = requireGame(body.gameId);
          return done({ ...g, rec: unready(g.rec, PRACTICE_ME, now) });
        }

        case 'fire': {
          const g = requireGame(body.gameId);
          const rec = fire(g.rec, PRACTICE_ME, Number(body.x), Number(body.y), now);
          return { ...done({ ...g, rec }), result: rec.pub.last?.r ?? null } as T;
        }

        case 'rematch': {
          // 電腦永遠願意再來一局
          const g = requireGame(body.gameId);
          let rec = voteRematch(g.rec, PRACTICE_ME, now);
          rec = voteRematch(rec, BOT, now);
          rec = botPrepare(rec);
          return done({ ...g, rec });
        }

        case 'say': {
          const g = requireGame(body.gameId);
          const view = done({ ...g, rec: say(g.rec, PRACTICE_ME, { line: body.line, text: body.text }, now) });
          botReply(g.rec.pub.id, { line: body.line, text: body.text });
          return view;
        }

        case 'leave': {
          const g = requireGame(body.gameId);
          const rec = leaveGame(g.rec, PRACTICE_ME, now);
          const view = viewFor(rec, PRACTICE_ME) as T;
          const id = rec.pub.id;
          games.delete(id);
          clearTimeout(timers.get(id));
          timers.delete(id);
          clearTimeout(pokeTimers.get(id));
          pokeTimers.delete(id);
          try {
            sessionStorage.removeItem(KEY(id));
          } catch {
            // ignore
          }
          return view;
        }
      }
      throw new GameError('BAD_REQUEST', `沒有 ${action} 這個動作`);
    },

    watch(gameId, { onView, onFatal }) {
      const g = load(gameId);
      if (!g) {
        onFatal('這場練習已經結束了，回首頁再開一場吧');
        return () => {};
      }
      const fn = (rec: GameRecord) => onView(viewFor(rec, PRACTICE_ME) as ViewPatch);
      if (!listeners.has(gameId)) listeners.set(gameId, new Set());
      listeners.get(gameId)!.add(fn);
      fn(g.rec);
      schedule(gameId); // 重新整理後如果輪到電腦，繼續打
      return () => listeners.get(gameId)?.delete(fn);
    },
  };
}

let singleton: Backend | null = null;
export function practiceBackend(): Backend {
  singleton ??= createPracticeBackend();
  return singleton;
}
