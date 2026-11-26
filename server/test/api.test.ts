import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { CLASSIC_SHAPE, planeCells, type GameView, type Plane } from '@planehunt/shared';
import { lanAddresses, startServer } from '../src/server.js';
import { MemoryStore } from '../src/store/memory.js';
import { LocalAuth } from '../src/auth/index.js';

let server: Server;
let base: string;
const store = new MemoryStore();

before(async () => {
  server = await startServer(
    { config: { mode: 'local', allowedOrigins: ['http://allowed.test'] }, store, auth: new LocalAuth() },
    0,
    '127.0.0.1',
  );
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function client(token: string) {
  return async function call<T = GameView & { result?: string }>(action: string, body: object = {}): Promise<T> {
    const res = await fetch(`${base}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { error: { message: string; code: string } } & T;
    if (!res.ok) throw Object.assign(new Error(data.error.message), { code: data.error.code, status: res.status });
    return data as T;
  };
}

/** 讀 SSE 直到 predicate 成立 */
async function waitForEvent(url: string, predicate: (v: GameView) => boolean, timeoutMs = 3000): Promise<GameView> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (data) {
          const v = JSON.parse(data.slice(6)) as GameView;
          if (predicate(v)) return v;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

const TOKEN_A = 'token-aaaaaaaaaaaaaaaa';
const TOKEN_B = 'token-bbbbbbbbbbbbbbbb';
const A_PLANES: Plane[] = [{ x: 2, y: 0, dir: 'up' }];
const B_PLANES: Plane[] = [{ x: 5, y: 9, dir: 'down' }];

test('two players play a full 1-plane game over HTTP + SSE', async () => {
  const a = client(TOKEN_A);
  const b = client(TOKEN_B);
  const { uid: uidA } = await a<{ uid: string }>('whoami');
  const { uid: uidB } = await b<{ uid: string }>('whoami');
  assert.notEqual(uidA, uidB);
  assert.ok(!uidA.includes(TOKEN_A));

  const created = await a('create', { name: '阿明', settings: { planes: 1 } });
  const gameId = created.game.id;
  assert.match(gameId, /^[A-Z2-9]{6}$/);
  assert.equal(created.game.status, 'waiting');

  // A 開著 SSE 等 B 加入
  const joinedSeen = waitForEvent(`${base}/stream?gameId=${gameId}&token=${TOKEN_A}`, (v) => v.game.status === 'placing');
  await new Promise((r) => setTimeout(r, 50));
  await b('join', { gameId: gameId.toLowerCase(), name: '小華' });
  const seen = await joinedSeen;
  assert.equal(seen.game.players[uidB].name, '小華');

  // 第三人加入會被拒絕
  await assert.rejects(client('token-cccccccccccccccc')('join', { gameId, name: 'C' }), { code: 'ROOM_FULL' });

  await assert.rejects(a('place', { gameId, planes: [{ x: 0, y: 0, dir: 'up' }] }), { code: 'INVALID_PLACEMENT' });
  await a('place', { gameId, planes: A_PLANES });
  const started = await b('place', { gameId, planes: B_PLANES });
  assert.equal(started.game.status, 'playing');
  // 公開狀態中沒有對手飛機
  assert.ok(!JSON.stringify(started.game).includes('"dir"'));
  assert.deepEqual(started.me?.planes, B_PLANES);

  // 輪流開火，先攻的人直接打對方機頭
  const first = started.game.turn === uidA ? a : b;
  const second = first === a ? b : a;
  const targetHead = first === a ? B_PLANES[0] : A_PLANES[0];
  const wing = planeCells(targetHead, CLASSIC_SHAPE).find((c) => c.part === 'body')!;

  const r1 = await first('fire', { gameId, x: wing.x, y: wing.y });
  assert.equal(r1.result, 'body');
  await assert.rejects(first('fire', { gameId, x: 0, y: 5 }), { code: 'NOT_YOUR_TURN' });
  await second('fire', { gameId, x: 9, y: 4 });
  const win = await first('fire', { gameId, x: targetHead.x, y: targetHead.y });
  assert.equal(win.result, 'head');
  assert.equal(win.game.status, 'finished');
  assert.ok(win.game.reveal);

  await a('rematch', { gameId });
  const again = await b('rematch', { gameId });
  assert.equal(again.game.status, 'placing');
  assert.equal(again.game.round, 2);
});

test('custom shapes and board sizes are validated on create', async () => {
  const a = client(TOKEN_A);
  const rocket = { name: '火箭', cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 3 }] };
  const ok = await a('create', { name: 'A', settings: { size: 7, planes: 2, shape: rocket } });
  assert.ok(ok.game.settings.mode !== 'ab' && ok.game.settings.size === 7);
  const st = ok.game.settings;
  assert.ok(st.mode === 'plane' && st.shape.name === '火箭' && st.shape.cells.length === 6);

  await assert.rejects(a('create', { name: 'A', settings: { size: 5, planes: 2, shape: CLASSIC_SHAPE } }), /放不下 2 架/);
  await assert.rejects(
    a('create', { name: 'A', settings: { size: 7, planes: 1, shape: { cells: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } } }),
    /連在一起/,
  );

  // 加入後，擺得太近會被後端拒絕
  const b = client(TOKEN_B);
  const gameId = ok.game.id;
  await b('join', { gameId, name: 'B' });
  await assert.rejects(
    a('place', { gameId, planes: [{ x: 1, y: 0, dir: 'up' }, { x: 3, y: 1, dir: 'up' }] }),
    { code: 'INVALID_PLACEMENT' },
  );
  const placed = await a('place', { gameId, planes: [{ x: 1, y: 0, dir: 'up' }, { x: 5, y: 0, dir: 'up' }] });
  assert.equal(placed.game.players[placed.game.hostId].ready, true);
});

test('battleship rooms work end to end', async () => {
  const a = client(TOKEN_A);
  const b = client(TOKEN_B);
  const created = await a('create', { name: 'A', settings: { mode: 'ship', size: 6, fleet: [2] } });
  const gameId = created.game.id;
  await b('join', { gameId, name: 'B' });
  await a('place', { gameId, planes: [{ x: 0, y: 0, dir: 'left' }] }); // A1–B1
  const started = await b('place', { gameId, planes: [{ x: 5, y: 5, dir: 'down' }] }); // F5–F6
  const [first, second] = started.game.turn === started.game.hostId ? [a, b] : [b, a];
  const target = first === a ? [{ x: 5, y: 5 }, { x: 5, y: 4 }] : [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  assert.equal((await first('fire', { gameId, ...target[0] })).result, 'hit');
  await second('fire', { gameId, x: 3, y: 3 });
  const win = await first('fire', { gameId, ...target[1] });
  assert.equal(win.result, 'sunk');
  assert.equal(win.game.status, 'finished');
});

test('1A2B rooms work end to end', async () => {
  const a = client(TOKEN_A);
  const b = client(TOKEN_B);
  const created = await a('create', { name: 'A', settings: { mode: 'ab', digits: 3 } });
  const gameId = created.game.id;
  await b('join', { gameId, name: 'B' });
  await assert.rejects(a('secret', { gameId, secret: '112' }), { code: 'INVALID_PLACEMENT' });
  await a('secret', { gameId, secret: '123' });
  const started = await b('secret', { gameId, secret: '987' });
  assert.equal(started.game.status, 'playing');
  assert.ok(!JSON.stringify(started.game).includes('123'));
  assert.equal(started.me?.secret, '987');
  const [first, second, target] = started.game.turn === started.game.hostId ? [a, b, '987'] : [b, a, '123'];
  const r1 = await first<GameView & { result: { a: number; b: number } }>('guess', { gameId, guess: target.split('').reverse().join('') });
  assert.deepEqual(r1.result, { a: 1, b: 2 });
  await second('guess', { gameId, guess: '456' });
  const win = await first<GameView & { result: { a: number; b: number } }>('guess', { gameId, guess: target });
  assert.deepEqual(win.result, { a: 3, b: 0 });
  assert.equal(win.game.status, 'finished');
  assert.equal(win.game.codes?.[win.game.hostId], '123');
});

test('match history is written for both players and practice results can be saved', async () => {
  type Hist = { entries: Array<Record<string, unknown>> };
  const c = client('token-cccccccccccccccc');
  const d = client('token-dddddddddddddddd');
  assert.deepEqual((await c<Hist>('history')).entries, []);

  const created = await c('create', { name: '小C', settings: { mode: 'ab', digits: 3 } });
  const gameId = created.game.id;
  await d('join', { gameId, name: '小D' });
  await c('secret', { gameId, secret: '123' });
  const started = await d('secret', { gameId, secret: '987' });
  const cFirst = started.game.turn === started.game.hostId;
  if (!cFirst) await d('guess', { gameId, guess: '456' });
  await c('guess', { gameId, guess: '987' });

  const hc = (await c<Hist>('history')).entries;
  const hd = (await d<Hist>('history')).entries;
  assert.equal(hc.length, 1);
  assert.equal(hd.length, 1);
  assert.equal(hc[0].result, 'win');
  assert.equal(hc[0].oppName, '小D');
  assert.equal(hc[0].vs, 'friend');
  assert.equal(hc[0].summary, '3 位數');
  assert.equal(hc[0].moves, 1);
  assert.equal(hd[0].result, 'lose');
  assert.equal(hd[0].id, hc[0].id);

  // 再來一局後中途離開：判負也要留紀錄，而且是另一筆
  await c('rematch', { gameId });
  await d('rematch', { gameId });
  await d('leave', { gameId });
  const hc2 = (await c<Hist>('history')).entries;
  assert.equal(hc2.length, 2);
  assert.equal(hc2[0].endReason, 'forfeit');
  assert.equal(hc2[0].result, 'win');
  assert.equal(hc2[0].round, 2);

  // 練習紀錄：後端只收認得的欄位，id 由後端決定
  const entry = {
    mode: 'plane', result: 'lose', endReason: 'cleared', myName: '小C', oppName: '電腦（困難）',
    gameId: 'ABC234', round: 1, summary: '10×10，3 架「經典」', moves: 30, hits: 12, level: 'hard', hacked: true,
  };
  await c('record', { entry });
  await c('record', { entry }); // 重送不會變兩筆
  const hc3 = (await c<Hist>('history')).entries;
  assert.equal(hc3.length, 3);
  assert.equal(hc3[0].id, 'p-ABC234-1');
  assert.equal(hc3[0].vs, 'bot');
  assert.equal(hc3[0].level, 'hard');
  assert.equal('hacked' in hc3[0], false);
  await assert.rejects(c('record', { entry: { ...entry, mode: 'chess' } }), { code: 'BAD_REQUEST' });
  await assert.rejects(c('record', { entry: { ...entry, moves: -1 } }), { code: 'BAD_REQUEST' });
});

test('a guest who signs in to an existing account keeps their seat and history', async () => {
  type View = { game: { id: string; hostId: string; playerIds: string[]; players: Record<string, { name: string }> }; me: unknown };
  const guestToken = 'token-guest-guest-guest-1';
  const guest = client(guestToken);
  const friend = client('token-friend-friend-frnd');
  const account = client('token-account-account-acct');

  const created = await guest<View>('create', { name: '訪客', settings: { mode: 'ab', digits: 3 } });
  const gameId = created.game.id;
  await friend('join', { gameId, name: '朋友' });
  await guest('secret', { gameId, secret: '123' });
  await guest('record', {
    entry: { mode: 'ab', result: 'win', myName: '訪客', oppName: '電腦（普通）', gameId: 'PRAC22', round: 1, summary: '4 位數', moves: 5 },
  });

  await account('merge', { guestToken, gameId });
  const me = (await account<{ uid: string }>('whoami')).uid;
  const view = await account<View>('state', { gameId });
  assert.equal(view.game.hostId, me);
  assert.ok(view.game.playerIds.includes(me));
  assert.equal(view.game.players[me].name, '訪客');
  assert.ok(view.me, '搬過來的座位要帶著自己的密碼');
  const hist = await account<{ entries: unknown[] }>('history');
  assert.equal(hist.entries.length, 1);

  // 朋友想用「已經在房間裡的帳號」合併：同一個帳號不能跟自己對戰
  await assert.rejects(friend('merge', { guestToken: 'token-account-account-acct', gameId }), { code: 'SAME_ACCOUNT' });
  // 對方的 token 不對就不能搬
  await assert.rejects(account('merge', { guestToken: 'bad token!', gameId }), { code: 'UNAUTHENTICATED' });
});

test('players can chat during a game; strangers cannot', async () => {
  type View = { game: { id: string; chat?: Array<{ by: string; line?: string; text?: string }> } };
  const a = client('token-chat-a-chat-a-chat');
  const b = client('token-chat-b-chat-b-chat');
  const c = client('token-chat-c-chat-c-chat');
  const created = await a<View>('create', { name: '小美', settings: { mode: 'ab', digits: 3 } });
  const gameId = created.game.id;
  await b('join', { gameId, name: '小華' });
  await a('say', { gameId, line: 'slow' });
  const v = await b<View>('say', { gameId, text: '馬上好' });
  assert.deepEqual(
    v.game.chat?.map((m) => m.line ?? m.text),
    ['太慢了！', '馬上好'].map((t, i) => (i === 0 ? 'slow' : t)),
  );
  await assert.rejects(a('say', { gameId, line: 'win' }), { code: 'TOO_FAST' });
  await assert.rejects(c('say', { gameId, line: 'win' }), { code: 'NOT_PLAYER' });
});

test('leaderboard: Google players, games against people only, medals', async () => {
  type Board = {
    boards: Record<string, Array<{ name: string; games: number; wins: number; rate: number; medals: string[]; me: boolean }>>;
    me: { google: boolean; name: string | null; games: number; medals: Record<string, unknown> };
  };
  const amy = client('token-amy-amy-amy-amy-a|amy.lin@gmail.com');
  const bob = client('token-bob-bob-bob-bob-b|bob@gmail.com');
  const guest = client('token-guest-lb-guest-lb');

  // 三局幾A幾B：Amy 贏兩局、Bob 贏一局
  const gameIds: string[] = [];
  for (const winner of [amy, amy, bob]) {
    const created = await amy<{ game: { id: string; turn: string; hostId: string } }>('create', {
      name: 'Amy',
      settings: { mode: 'ab', digits: 3 },
    });
    const gameId = created.game.id;
    gameIds.push(gameId);
    await bob('join', { gameId, name: 'Bob' });
    await amy('secret', { gameId, secret: '123' });
    const started = await bob<{ game: { turn: string; hostId: string } }>('secret', { gameId, secret: '456' });
    const amyFirst = started.game.turn === started.game.hostId;
    const loser = winner === amy ? bob : amy;
    // 輸的那一方先亂猜一次，再讓贏的人猜中
    if ((winner === amy) !== amyFirst) await loser('guess', { gameId, guess: '789' });
    await winner('guess', { gameId, guess: winner === amy ? '456' : '123' });
  }
  // 跟電腦練習的勝場不算勝率
  await amy('record', {
    entry: { mode: 'ab', result: 'win', myName: 'Amy', oppName: '電腦（困難）', gameId: 'BOT234', round: 1, summary: '3 位數', moves: 4, level: 'hard' },
  });
  await guest('profile');

  const lb = await amy<Board>('leaderboard');
  assert.deepEqual(
    lb.boards.all.map((r) => [r.name, r.wins, r.games, r.rate, r.me]),
    [
      ['amy.lin', 2, 3, 67, true],
      ['bob', 1, 3, 33, false],
    ],
  );
  assert.equal(lb.boards.plane.length, 0);
  assert.equal(lb.boards.ab.length, 2);
  assert.ok(lb.boards.all[0].medals.includes('first_win'));
  assert.ok(lb.boards.all[0].medals.includes('bot_slayer'));
  assert.equal(lb.me.name, 'amy.lin');

  const mine = await bob<{ stats: { games: number; medals: Record<string, { game: string }>; opponentCount: number } }>('stats');
  assert.equal(mine.stats.games, 3);
  assert.equal(mine.stats.opponentCount, 1);
  assert.equal(mine.stats.medals.first_win.game, `${gameIds[2]}-1`);
  const g = await guest<Board>('leaderboard');
  assert.equal(g.me.google, false);
  assert.ok(g.boards.all.every((r) => !r.me));
});

test('invite links expire after 24 idle hours', async () => {
  const host = client('token-host-host-host-host');
  const late = client('token-late-late-late-late');
  const created = await host<{ game: { id: string } }>('create', { name: '房主', settings: { mode: 'ab', digits: 3 } });
  const gameId = created.game.id;
  await store.update(gameId, (r) => ({ ...r, pub: { ...r.pub, updatedAt: r.pub.updatedAt - 25 * 60 * 60 * 1000 } }));
  await assert.rejects(late('join', { gameId, name: '遲到' }), { code: 'ROOM_EXPIRED' });
  // 房主自己離開不受影響
  await host('leave', { gameId });
});

test('auth, validation and CORS', async () => {
  const noAuth = await fetch(`${base}/whoami`, { method: 'POST' });
  assert.equal(noAuth.status, 401);

  const bad = await fetch(`${base}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN_A}` },
    body: '{"gameId": "nope"',
  });
  assert.equal(bad.status, 400);

  await assert.rejects(client(TOKEN_A)('join', { gameId: 'ZZZZZZ', name: 'x' }), { code: 'NOT_FOUND' });

  const pre = await fetch(`${base}/fire`, { method: 'OPTIONS', headers: { Origin: 'http://allowed.test' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://allowed.test');
  const other = await fetch(`${base}/fire`, { method: 'OPTIONS', headers: { Origin: 'http://evil.test' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);

  const health = (await (await fetch(`${base}/health`)).json()) as { ok: boolean; mode: string; lan: string[] };
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'local');
  assert.ok(Array.isArray(health.lan));
});

test('phone invite link skips virtual network adapters', () => {
  const nic = (address: string) => [{ address, family: 'IPv4', internal: false }] as never;
  // 實際案例：有線網路 + VirtualBox + 兩張 VMware 虛擬網卡
  assert.deepEqual(
    lanAddresses({
      乙太網路: nic('140.124.94.50'),
      '乙太網路 2': nic('192.168.56.1'),
      'VMware Network Adapter VMnet1': nic('192.168.98.1'),
      'VMware Network Adapter VMnet8': nic('192.168.92.1'),
    }),
    ['140.124.94.50'],
  );
  assert.deepEqual(lanAddresses({ '乙太網路': nic('10.0.0.5'), 'Wi-Fi': nic('192.168.1.23') }), ['192.168.1.23', '10.0.0.5']);
});
