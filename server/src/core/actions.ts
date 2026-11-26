import {
  GameError,
  HISTORY_LIMIT,
  withoutDetail,
  MODES,
  applyResult,
  nameFromEmail,
  normalizeStats,
  rankPlayers,
  createGameRecord,
  assertRoomActive,
  historyEntries,
  normalizePracticeEntry,
  reassignPlayer,
  say,
  fire,
  generateRoomCode,
  joinGame,
  leaveGame,
  makeGuess,
  normalizeName,
  normalizeRoomCode,
  normalizeSettings,
  placePlanes,
  setSecret,
  unready,
  viewFor,
  voteRematch,
  type GameRecord,
  type HistoryEntry,
  type PlayerStats,
  type Plane,
  type Rng,
} from '@planehunt/shared';
import type { GameStore } from '../store/types.js';
import type { Authenticator, Identity } from '../auth/index.js';

export interface ActionDeps {
  store: GameStore;
  /** 用來驗證「另一個身分」的 token（merge 動作）；沒有提供時 merge 無法使用 */
  auth?: Authenticator;
  /** 呼叫者的身分（含 Google Email），排行榜名字用 */
  me?: Identity;
  now?: () => number;
  rng?: Rng;
}

type Body = Record<string, unknown>;

function int(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new GameError('BAD_REQUEST', `${field} 必須是整數`);
  return v;
}

function parsePlanes(v: unknown): Plane[] {
  if (!Array.isArray(v) || v.length > 5) throw new GameError('BAD_REQUEST', '飛機資料格式不正確');
  return v.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return { x: int(o.x, 'x'), y: int(o.y, 'y'), dir: o.dir as Plane['dir'] };
  });
}

export const ACTIONS = [
  'whoami',
  'create',
  'join',
  'state',
  'place',
  'secret',
  'unready',
  'fire',
  'guess',
  'rematch',
  'leave',
  'history',
  'historyEntry',
  'record',
  'merge',
  'say',
  'profile',
  'leaderboard',
  'stats',
] as const;
export type ActionName = (typeof ACTIONS)[number];

export function isAction(s: string): s is ActionName {
  return (ACTIONS as readonly string[]).includes(s);
}

/** 所有遊戲動作的入口；本機 dev server 與 Azure Functions 共用 */
export async function runAction(deps: ActionDeps, uid: string, action: ActionName, body: Body): Promise<unknown> {
  const now = deps.now ?? Date.now;
  const rng = deps.rng ?? Math.random;
  const { store } = deps;

  /**
   * 改棋局；如果這一步讓棋局分出勝負，順便替雙方寫對戰紀錄。
   * Firestore 交易衝突時 fn 會重跑，所以用最後一次的結果判斷。
   */
  const mutate = async (id: string, fn: (r: GameRecord) => GameRecord, opts: { allowExpired?: boolean } = {}) => {
    let ended = false;
    const rec = await store.update(id, (r) => {
      // 超過 24 小時沒動靜的房間不能再加入或下棋（離開不受限制）
      if (!opts.allowExpired) assertRoomActive(r.pub, uid, now());
      const next = fn(r);
      ended = r.pub.status !== 'finished' && next.pub.status === 'finished';
      return next;
    });
    if (ended) {
      try {
        const entries = historyEntries(rec);
        await Promise.all(entries.map(({ uid: who, entry }) => store.addHistory(who, entry)));
        // 戰績與獎牌：雙方各更新一次（對手 uid 用來算「跟幾位不同的人打過」）
        await Promise.all(
          entries.map(({ uid: who, entry }) =>
            countGame(who, entry, rec.pub.playerIds.find((p) => p !== who)),
          ),
        );
      } catch (e) {
        // 紀錄寫失敗不影響這一步棋
        console.error('寫入對戰紀錄失敗', e);
      }
    }
    return rec;
  };

  /** 把一局加進某人的戰績（同一局重複送來不會算兩次） */
  const countGame = (who: string, entry: HistoryEntry, oppUid?: string) =>
    store.updateStats(who, (s) => applyResult(s, entry, { oppUid, now: now() }).stats);

  /** 用 Google 登入的人：記下排行榜名字（Gmail 的 @ 前面那段） */
  const syncProfile = async (): Promise<PlayerStats> => {
    const me = deps.me;
    const cur = await store.getStats(uid);
    if (!me?.google) return normalizeStats(cur);
    const name = nameFromEmail(me.email);
    if (cur?.google && cur.name === name) return cur;
    return store.updateStats(uid, (s) => ({ ...normalizeStats(s), google: true, name }));
  };

  switch (action) {
    case 'whoami':
      return { uid };

    case 'create': {
      // 用 Google 登入的人：順便記下排行榜名字（失敗也不影響開房）
      await syncProfile().catch((e) => console.error('更新排行榜名字失敗', e));
      const name = normalizeName(body.name);
      const settings = normalizeSettings(body.settings);
      for (let attempt = 0; attempt < 8; attempt++) {
        const id = generateRoomCode(rng);
        const rec = createGameRecord({ id, uid, name, settings, now: now() });
        if (await store.create(rec)) return viewFor(rec, uid);
      }
      throw new GameError('INTERNAL', '暫時無法建立房間，請再試一次');
    }

    case 'join': {
      // 用 Google 登入的人：順便記下排行榜名字（失敗也不影響開房）
      await syncProfile().catch((e) => console.error('更新排行榜名字失敗', e));
      const id = normalizeRoomCode(body.gameId);
      const name = normalizeName(body.name);
      const rec = await mutate(id, (r) => joinGame(r, uid, name, now()));
      return viewFor(rec, uid);
    }

    case 'state': {
      const id = normalizeRoomCode(body.gameId);
      const rec = await store.get(id);
      if (!rec) throw new GameError('NOT_FOUND', '找不到這個房間');
      return viewFor(rec, uid);
    }

    case 'place': {
      const id = normalizeRoomCode(body.gameId);
      const planes = parsePlanes(body.planes);
      const rec = await mutate(id, (r) => placePlanes(r, uid, planes, now(), rng));
      return viewFor(rec, uid);
    }

    case 'secret': {
      const id = normalizeRoomCode(body.gameId);
      if (typeof body.secret !== 'string') throw new GameError('BAD_REQUEST', '請輸入密碼');
      const secret = body.secret;
      const rec = await mutate(id, (r) => setSecret(r, uid, secret, now(), rng));
      return viewFor(rec, uid);
    }

    case 'guess': {
      const id = normalizeRoomCode(body.gameId);
      if (typeof body.guess !== 'string') throw new GameError('BAD_REQUEST', '請輸入要猜的數字');
      const guess = body.guess;
      const rec = await mutate(id, (r) => makeGuess(r, uid, guess, now()));
      const last = rec.pub.lastGuess;
      return { ...viewFor(rec, uid), result: last ? { a: last.a, b: last.b } : null };
    }

    case 'unready': {
      const id = normalizeRoomCode(body.gameId);
      const rec = await mutate(id, (r) => unready(r, uid, now()));
      return viewFor(rec, uid);
    }

    case 'fire': {
      const id = normalizeRoomCode(body.gameId);
      const x = int(body.x, 'x');
      const y = int(body.y, 'y');
      const rec = await mutate(id, (r) => fire(r, uid, x, y, now()));
      return { ...viewFor(rec, uid), result: rec.pub.last?.r ?? null };
    }

    case 'rematch': {
      const id = normalizeRoomCode(body.gameId);
      const rec = await mutate(id, (r) => voteRematch(r, uid, now()));
      return viewFor(rec, uid);
    }

    case 'leave': {
      const id = normalizeRoomCode(body.gameId);
      const rec = await mutate(id, (r) => leaveGame(r, uid, now()), { allowExpired: true });
      return viewFor(rec, uid);
    }

    case 'history': {
      // 列表不帶逐步紀錄（點進去才拿），回應比較小
      return { entries: (await store.listHistory(uid, HISTORY_LIMIT)).map(withoutDetail) };
    }

    case 'historyEntry': {
      const id = String(body.id ?? '');
      if (!/^(p-)?[A-Z0-9]{4,12}-\d{1,5}$/.test(id)) throw new GameError('BAD_REQUEST', '紀錄編號不正確');
      const entry = await store.getHistory(uid, id);
      if (!entry) throw new GameError('NOT_FOUND', '找不到這局的紀錄');
      return { entry };
    }

    case 'profile': {
      // 登入 Google 後由前端呼叫一次：讓自己出現在排行榜上
      const s = await syncProfile();
      return { google: s.google, name: s.name };
    }

    case 'stats': {
      // 自己的戰績與獎牌（獎牌收藏、這局拿到哪些新獎牌）
      const s = normalizeStats(await store.getStats(uid));
      return { stats: publicStats(s) };
    }

    case 'leaderboard': {
      const mine = await syncProfile();
      const players = await store.listRankedPlayers();
      const boards = Object.fromEntries(
        (['all', ...MODES] as const).map((scope) => [scope, rankPlayers(players, scope, uid)]),
      );
      return { boards, me: publicStats(mine) };
    }

    case 'say': {
      const id = normalizeRoomCode(body.gameId);
      const rec = await mutate(id, (r) => say(r, uid, { line: body.line, text: body.text }, now()));
      return viewFor(rec, uid);
    }

    case 'merge': {
      // 訪客改用「以前就登入過的 Google 帳號」時：把訪客在這間房間的座位和對戰紀錄搬到帳號底下。
      // 要同時拿得出兩個身分的 token（目前的帳號 + 訪客），才能搬。
      if (!deps.auth) throw new GameError('BAD_REQUEST', '目前無法合併身分');
      const from = await deps.auth.verifyToken(String(body.guestToken ?? ''));
      if (from.uid === uid) return { ok: true };
      if (body.gameId) {
        const id = normalizeRoomCode(body.gameId);
        try {
          await mutate(id, (r) => reassignPlayer(r, from.uid, uid, now()), { allowExpired: true });
        } catch (e) {
          if (!(e instanceof GameError && e.code === 'NOT_FOUND')) throw e;
        }
      }
      const old = await store.listHistory(from.uid, HISTORY_LIMIT);
      await Promise.all(old.map((entry) => store.addHistory(uid, entry)));
      // 訪客時打的局也算進帳號的戰績（照時間先後，連勝才算得對）
      for (const entry of [...old].sort((a, b) => a.finishedAt - b.finishedAt)) await countGame(uid, entry);
      return { ok: true };
    }

    case 'record': {
      // 跟電腦練習的紀錄（練習在瀏覽器裡跑，打完才送來保存）
      const entry = normalizePracticeEntry(body.entry, now());
      await store.addHistory(uid, entry);
      await countGame(uid, entry);
      return { ok: true };
    }
  }
}

/** 給前端看的戰績：對手 uid 只回傳人數 */
function publicStats(s: PlayerStats) {
  const { opponents, ...rest } = normalizeStats(s);
  return { ...rest, opponentCount: opponents.length };
}

export type PublicStats = ReturnType<typeof publicStats>;
