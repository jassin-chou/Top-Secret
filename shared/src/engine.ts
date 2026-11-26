/**
 * 遊戲規則引擎：全部是純函式 (record, ...) => 新 record。
 * 後端在 Firestore 交易 / 記憶體鎖裡呼叫它們；Firestore 交易可能重跑，所以這裡不能有副作用。
 */
import { GameError } from './errors.js';
import {
  DEFAULT_SETTINGS,
  MAX_PLANES,
  MAX_SIZE,
  MIN_PLANES,
  MIN_SIZE,
  NO_DIAGONAL_TOUCH,
  cellKey,
  inBounds,
  isFeasible,
  pieceAt,
  pieceCount,
  pieceShapes,
  planeCells,
  shapeTooBig,
  validatePlacement,
} from './plane.js';
import { CLASSIC_FLEET, checkFleet, checkShape, shipName } from './shapes.js';
import { DEFAULT_AB, MAX_DIGITS, MIN_DIGITS, abScore, checkCode } from './code.js';
import { CHAT_GAP_MS, CHAT_KEEP, POKE_GAP_MS, POKE_LINE, cleanChatText, isQuickLine } from './chat.js';
import type { ChatMessage, GameDoc, GameRecord, GameView, Plane, Settings, Shot, ShotResult } from './types.js';

export type Rng = () => number;

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;
export const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export function generateRoomCode(rng: Rng = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeRoomCode(input: unknown): string {
  if (typeof input !== 'string') throw new GameError('BAD_REQUEST', '房號格式不正確');
  const code = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!CODE_RE.test(code)) throw new GameError('BAD_REQUEST', '房號是 6 碼英數字，請再確認一次');
  return code;
}

export function normalizeName(input: unknown): string {
  if (typeof input !== 'string') throw new GameError('BAD_REQUEST', '請輸入暱稱');
  // 去掉控制字元，限制長度
  const name = input.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12);
  if (!name) throw new GameError('BAD_REQUEST', '請輸入暱稱');
  return name;
}

export function normalizeSettings(input: unknown): Settings {
  const s = (input ?? {}) as Record<string, unknown>;
  const mode = s.mode ?? 'plane';
  if (mode !== 'plane' && mode !== 'ship' && mode !== 'ab') {
    throw new GameError('BAD_REQUEST', '遊戲模式只能是飛機版、海戰棋或幾A幾B');
  }

  if (mode === 'ab') {
    const digits = (s.digits as number | undefined) ?? DEFAULT_AB.digits;
    if (!Number.isInteger(digits) || digits < MIN_DIGITS || digits > MAX_DIGITS) {
      throw new GameError('BAD_REQUEST', `幾A幾B 的位數要在 ${MIN_DIGITS} 到 ${MAX_DIGITS} 位之間`);
    }
    const repeat = s.repeat === undefined ? DEFAULT_AB.repeat : s.repeat;
    if (typeof repeat !== 'boolean') throw new GameError('BAD_REQUEST', '「數字可否重複」設定不正確');
    return { mode: 'ab', digits, repeat };
  }

  const size = (s.size as number | undefined) ?? DEFAULT_SETTINGS.size;
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new GameError('BAD_REQUEST', `棋盤大小需介於 ${MIN_SIZE}×${MIN_SIZE} 到 ${MAX_SIZE}×${MAX_SIZE}`);
  }
  const apart = NO_DIAGONAL_TOUCH ? '完全分開的' : '分開的';

  if (mode === 'ship') {
    const [fleet, fleetErr] = s.fleet === undefined ? [CLASSIC_FLEET, null] : checkFleet(s.fleet);
    if (!fleet) throw new GameError('BAD_REQUEST', fleetErr);
    if (fleet[0] > size) throw new GameError('BAD_REQUEST', `${shipName(fleet[0])}（${fleet[0]} 格）放不進 ${size}×${size} 的棋盤`);
    const settings: Settings = { mode: 'ship', size, fleet };
    if (!isFeasible(settings)) {
      throw new GameError(
        'BAD_REQUEST',
        `${size}×${size} 的棋盤放不下這支${fleet.length > 1 ? apart : ''}艦隊，請減少船隻或把格子調大`,
      );
    }
    return settings;
  }

  const planes = (s.planes as number | undefined) ?? DEFAULT_SETTINGS.planes;
  if (!Number.isInteger(planes) || planes < MIN_PLANES || planes > MAX_PLANES) {
    throw new GameError('BAD_REQUEST', `飛機數需介於 ${MIN_PLANES} 到 ${MAX_PLANES} 架`);
  }
  const [shape, shapeErr] = s.shape === undefined ? [DEFAULT_SETTINGS.shape, null] : checkShape(s.shape);
  if (!shape) throw new GameError('BAD_REQUEST', shapeErr);
  if (shapeTooBig(shape, size)) {
    throw new GameError('BAD_REQUEST', `這種飛機放不進 ${size}×${size} 的棋盤，請把格子調大`);
  }
  const settings: Settings = { mode: 'plane', size, planes, shape };
  if (!isFeasible(settings)) {
    throw new GameError(
      'BAD_REQUEST',
      `${size}×${size} 的棋盤放不下 ${planes} 架${planes > 1 ? apart : ''}「${shape.name}」，請減少飛機或把格子調大`,
    );
  }
  return settings;
}

export function opponentOf(game: GameDoc, uid: string): string | null {
  return game.playerIds.find((id) => id !== uid) ?? null;
}

function clone(rec: GameRecord): GameRecord {
  return structuredClone(rec);
}

function requirePlayer(game: GameDoc, uid: string) {
  if (!game.playerIds.includes(uid)) throw new GameError('NOT_PLAYER', '你不是這個房間的玩家');
}

function touch(rec: GameRecord, now: number) {
  rec.pub.updatedAt = now;
}

export function createGameRecord(opts: { id: string; uid: string; name: string; settings: Settings; now: number }): GameRecord {
  const { id, uid, name, settings, now } = opts;
  return {
    pub: {
      id,
      status: 'waiting',
      settings,
      hostId: uid,
      playerIds: [uid],
      players: { [uid]: { name, ready: false, left: false, wins: 0 } },
      turn: null,
      firstTurn: null,
      shots: { [uid]: [] },
      found: { [uid]: 0 },
      sunk: { [uid]: [] },
      guesses: { [uid]: [] },
      lastGuess: null,
      codes: null,
      winner: null,
      endReason: null,
      reveal: null,
      rematch: [],
      round: 1,
      seq: 0,
      last: null,
      chat: [],
      createdAt: now,
      updatedAt: now,
    },
    priv: { [uid]: { planes: null, secret: null } },
  };
}

/**
 * 房間超過這麼久沒有任何動作就算過期：
 * 邀請連結不能再加入，房裡的人也不能再下棋（還是看得到最後的棋盤）。
 */
export const ROOM_IDLE_MS = 24 * 60 * 60 * 1000;

export function isRoomExpired(game: GameDoc, now: number): boolean {
  return game.status !== 'closed' && now - game.updatedAt > ROOM_IDLE_MS;
}

/** 後端在每個會改變棋局的動作前呼叫（離開房間除外） */
export function assertRoomActive(game: GameDoc, uid: string, now: number) {
  if (!isRoomExpired(game, now)) return;
  if (game.playerIds.includes(uid)) {
    throw new GameError('ROOM_EXPIRED', '這間房間超過 24 小時沒有動靜，已經關閉了，請重新開一間');
  }
  throw new GameError('ROOM_EXPIRED', '這個邀請連結已經過期了（房間超過 24 小時沒有動靜），請朋友重新開一間房間');
}

/**
 * 把房間裡的某位玩家換成另一個身分（訪客改用以前登入過的 Google 帳號時用）。
 * uid 是很長的亂數字串，所以直接把整份公開資料裡的舊 uid 換成新 uid。
 */
export function reassignPlayer(input: GameRecord, from: string, to: string, now: number): GameRecord {
  if (from === to || !input.pub.playerIds.includes(from)) return input;
  if (input.pub.playerIds.includes(to)) {
    throw new GameError(
      'SAME_ACCOUNT',
      '這個 Google 帳號已經是這間房間裡的另一位玩家了。同一個帳號不能跟自己對戰：請換一個 Google 帳號，或等這局結束再登入',
    );
  }
  const json = JSON.stringify(input.pub).split(JSON.stringify(from)).join(JSON.stringify(to));
  const rec: GameRecord = { pub: JSON.parse(json) as GameDoc, priv: structuredClone(input.priv) };
  if (rec.priv[from]) {
    rec.priv[to] = rec.priv[from];
    delete rec.priv[from];
  }
  touch(rec, now);
  return rec;
}

export function joinGame(input: GameRecord, uid: string, name: string, now: number): GameRecord {
  const rec = clone(input);
  const g = rec.pub;
  if (g.playerIds.includes(uid)) {
    // 重新進入同一房間：不改任何狀態
    return rec;
  }
  if (g.status === 'closed') throw new GameError('ROOM_CLOSED', '這個房間已經關閉了');
  if (g.playerIds.length >= 2) throw new GameError('ROOM_FULL', '房間已經滿了');
  g.playerIds.push(uid);
  g.players[uid] = { name, ready: false, left: false, wins: 0 };
  g.shots[uid] = [];
  g.found[uid] = 0;
  g.sunk[uid] = [];
  g.guesses[uid] = [];
  g.status = 'placing';
  rec.priv[uid] = { planes: null, secret: null };
  touch(rec, now);
  return rec;
}

/** 標記準備好；雙方都準備好就開始對戰 */
function markReady(rec: GameRecord, uid: string, rng: Rng) {
  const g = rec.pub;
  g.players[uid].ready = true;
  const bothReady = g.playerIds.length === 2 && g.playerIds.every((id) => g.players[id].ready);
  if (bothReady) {
    g.status = 'playing';
    if (!g.firstTurn) g.firstTurn = g.playerIds[Math.floor(rng() * 2)];
    g.turn = g.firstTurn;
  }
}

export function placePlanes(input: GameRecord, uid: string, planes: Plane[], now: number, rng: Rng = Math.random): GameRecord {
  const rec = clone(input);
  const g = rec.pub;
  requirePlayer(g, uid);
  if (g.status !== 'placing') throw new GameError('WRONG_PHASE', '現在不是擺放的階段');
  if (g.settings.mode === 'ab') throw new GameError('WRONG_PHASE', '幾A幾B 不用擺棋子，請設定密碼');
  const err = validatePlacement(planes, g.settings);
  if (err) throw new GameError('INVALID_PLACEMENT', err);
  rec.priv[uid] = { ...rec.priv[uid], planes: planes.map((p) => ({ x: p.x, y: p.y, dir: p.dir })) };
  markReady(rec, uid, rng);
  touch(rec, now);
  return rec;
}

/** 幾A幾B：設定自己的密碼 */
export function setSecret(input: GameRecord, uid: string, secret: string, now: number, rng: Rng = Math.random): GameRecord {
  const rec = clone(input);
  const g = rec.pub;
  requirePlayer(g, uid);
  if (g.status !== 'placing') throw new GameError('WRONG_PHASE', '現在不能設定密碼');
  if (g.settings.mode !== 'ab') throw new GameError('WRONG_PHASE', '這個玩法不用設定密碼');
  const [code, err] = checkCode(secret, g.settings);
  if (!code) throw new GameError('INVALID_PLACEMENT', err!);
  rec.priv[uid] = { ...rec.priv[uid], secret: code };
  markReady(rec, uid, rng);
  touch(rec, now);
  return rec;
}

export function unready(input: GameRecord, uid: string, now: number): GameRecord {
  const rec = clone(input);
  const g = rec.pub;
  requirePlayer(g, uid);
  if (g.status !== 'placing') throw new GameError('WRONG_PHASE', '對戰已經開始，不能再修改');
  g.players[uid].ready = false;
  touch(rec, now);
  return rec;
}

export function fire(input: GameRecord, uid: string, x: number, y: number, now: number): GameRecord {
  const rec = clone(input);
  const g = rec.pub;
  requirePlayer(g, uid);
  if (g.status !== 'playing') throw new GameError('WRONG_PHASE', '現在不能開火');
  if (g.turn !== uid) throw new GameError('NOT_YOUR_TURN', '還沒輪到你');
  if (g.settings.mode === 'ab') throw new GameError('WRONG_PHASE', '幾A幾B 請用猜數字');
  if (!inBounds({ x, y }, g.settings.size)) throw new GameError('BAD_REQUEST', '座標超出棋盤');
  const mine = g.shots[uid];
  if (mine.some((s) => s.x === x && s.y === y)) throw new GameError('ALREADY_SHOT', '這一格已經打過了');

  const opp = opponentOf(g, uid)!;
  const oppPlanes = rec.priv[opp]?.planes;
  if (!oppPlanes) throw new GameError('INTERNAL', '找不到對手的棋子資料');

  const shapes = pieceShapes(g.settings);
  const hit = pieceAt(oppPlanes, shapes, x, y);
  let r: ShotResult;
  let k: number | undefined;
  if (!hit) r = 'miss';
  else if (g.settings.mode === 'plane') r = hit.part === 'head' ? 'head' : 'body';
  else {
    // 海戰棋：這艘船的每一格（含這一發）都被打過了，就是擊沉
    const done = new Set(mine.map((s) => cellKey(s.x, s.y)));
    done.add(cellKey(x, y));
    const sunk = planeCells(oppPlanes[hit.piece], shapes[hit.piece]).every((c) => done.has(cellKey(c.x, c.y)));
    r = sunk ? 'sunk' : 'hit';
    if (sunk) k = hit.piece;
  }

  g.seq += 1;
  // Firestore 不接受 undefined：k 只有擊沉時才寫入
  const shot: Shot = k === undefined ? { x, y, r, n: g.seq } : { x, y, r, n: g.seq, k };
  mine.push(shot);
  g.last = { by: uid, ...shot };
  if (r === 'head' || r === 'sunk') g.found[uid] += 1;
  if (k !== undefined) g.sunk[uid].push({ ...oppPlanes[k], k });

  if (g.found[uid] >= pieceCount(g.settings)) {
    finish(rec, uid, 'cleared');
  } else {
    g.turn = opp;
  }
  touch(rec, now);
  return rec;
}

/** 幾A幾B：猜對方的密碼 */
export function makeGuess(input: GameRecord, uid: string, guess: string, now: number): GameRecord {
  const rec = clone(input);
  const g = rec.pub;
  requirePlayer(g, uid);
  if (g.status !== 'playing') throw new GameError('WRONG_PHASE', '現在不能猜');
  if (g.turn !== uid) throw new GameError('NOT_YOUR_TURN', '還沒輪到你');
  if (g.settings.mode !== 'ab') throw new GameError('WRONG_PHASE', '這個玩法請用開火');
  const [code, err] = checkCode(guess, g.settings);
  if (!code) throw new GameError('BAD_REQUEST', err!);
  const mine = g.guesses[uid] ?? (g.guesses[uid] = []);
  if (mine.some((x) => x.g === code)) throw new GameError('ALREADY_SHOT', '這個數字已經猜過了');

  const opp = opponentOf(g, uid)!;
  const secret = rec.priv[opp]?.secret;
  if (!secret) throw new GameError('INTERNAL', '找不到對手的密碼');

  const { a, b } = abScore(secret, code);
  g.seq += 1;
  const entry = { g: code, a, b, n: g.seq };
  mine.push(entry);
  g.lastGuess = { ...entry, by: uid };

  if (a === g.settings.digits) finish(rec, uid, 'cleared');
  else g.turn = opp;
  touch(rec, now);
  return rec;
}

function finish(rec: GameRecord, winner: string, reason: 'cleared' | 'forfeit') {
  const g = rec.pub;
  g.status = 'finished';
  g.turn = null;
  g.winner = winner;
  g.endReason = reason;
  g.players[winner].wins += 1;
  g.rematch = [];
  if (g.settings.mode === 'ab') {
    const codes: Record<string, string> = {};
    for (const id of g.playerIds) codes[id] = rec.priv[id]?.secret ?? '';
    g.codes = codes;
  } else {
    const reveal: Record<string, Plane[]> = {};
    for (const id of g.playerIds) reveal[id] = rec.priv[id]?.planes ?? [];
    g.reveal = reveal;
  }
}

export function voteRematch(input: GameRecord, uid: string, now: number): GameRecord {
  const rec = clone(input);
  const g = rec.pub;
  requirePlayer(g, uid);
  if (g.status !== 'finished') throw new GameError('WRONG_PHASE', '這局還沒結束');
  const opp = opponentOf(g, uid);
  if (!opp || g.players[opp].left) throw new GameError('OPPONENT_LEFT', '對手已經離開房間');
  if (!g.rematch.includes(uid)) g.rematch.push(uid);

  if (g.playerIds.every((id) => g.rematch.includes(id))) {
    // 開新的一局：保留雙方上一局的擺法當作預設，換另一個人先攻
    g.status = 'placing';
    g.round += 1;
    g.firstTurn = g.firstTurn ? opponentOf(g, g.firstTurn) : null;
    g.turn = null;
    g.winner = null;
    g.endReason = null;
    g.reveal = null;
    g.codes = null;
    g.rematch = [];
    g.last = null;
    g.lastGuess = null;
    for (const id of g.playerIds) {
      g.players[id].ready = false;
      g.shots[id] = [];
      g.found[id] = 0;
      g.sunk[id] = [];
      g.guesses[id] = [];
    }
  }
  touch(rec, now);
  return rec;
}

export function leaveGame(input: GameRecord, uid: string, now: number): GameRecord {
  const rec = clone(input);
  const g = rec.pub;
  requirePlayer(g, uid);
  g.players[uid].left = true;
  const opp = opponentOf(g, uid);
  if (g.status === 'waiting' || !opp) {
    g.status = 'closed';
  } else if (g.status === 'placing' || g.status === 'playing') {
    finish(rec, opp, 'forfeit');
  } else if (g.status === 'finished') {
    g.rematch = g.rematch.filter((id) => id !== uid);
    if (g.players[opp].left) g.status = 'closed';
  }
  touch(rec, now);
  return rec;
}

/**
 * 說一句話：快捷句（line）或自己打的字（text）。
 * 對手進房後到房間關閉前都可以說；太頻繁會被擋下。
 */
export function say(input: GameRecord, uid: string, msg: { line?: unknown; text?: unknown }, now: number): GameRecord {
  const rec = clone(input);
  const g = rec.pub;
  requirePlayer(g, uid);
  if (g.status === 'waiting') throw new GameError('WRONG_PHASE', '朋友還沒進來，等一下再聊');
  if (g.status === 'closed') throw new GameError('ROOM_CLOSED', '這個房間已經關閉了');

  const entry: ChatMessage = { n: 0, by: uid, at: now };
  if (msg.line !== undefined && msg.line !== null) {
    if (!isQuickLine(msg.line)) throw new GameError('BAD_REQUEST', '不認得這句話');
    entry.line = msg.line;
  } else {
    entry.text = cleanChatText(msg.text);
  }

  const chat = g.chat ?? [];
  const mine = chat.filter((m) => m.by === uid);
  const lastMine = mine[mine.length - 1];
  if (lastMine && now - lastMine.at < CHAT_GAP_MS) throw new GameError('TOO_FAST', '說太快了，休息一下');
  if (entry.line === POKE_LINE) {
    const lastPoke = [...mine].reverse().find((m) => m.line === POKE_LINE);
    if (lastPoke && now - lastPoke.at < POKE_GAP_MS) throw new GameError('TOO_FAST', '剛剛才催過，等幾秒再催');
  }

  entry.n = (chat[chat.length - 1]?.n ?? 0) + 1;
  g.chat = [...chat, entry].slice(-CHAT_KEEP);
  touch(rec, now);
  return rec;
}

/** 某位玩家能看到的資料 */
export function viewFor(rec: GameRecord, uid: string | null): GameView {
  return {
    game: rec.pub,
    me: uid && rec.pub.playerIds.includes(uid) ? (rec.priv[uid] ?? { planes: null, secret: null }) : null,
  };
}
