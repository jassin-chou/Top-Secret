import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_KEEP,
  say,
  ROOM_IDLE_MS,
  assertRoomActive,
  reassignPlayer,
  setSecret,
  CLASSIC_SHAPE,
  FLEET_PRESETS,
  GameError,
  checkFleet,
  SHAPE_PRESETS,
  checkShape,
  createGameRecord,
  findPlacement,
  fire,
  isFeasible,
  joinGame,
  leaveGame,
  maxFeasiblePlanes,
  normalizeRoomCode,
  normalizeSettings,
  placePlanes,
  pieceAt,
  pieceShapes,
  placementConflict,
  planeCells,
  planeOutline,
  randomPlacement,
  seededRng,
  shapeTooBig,
  unready,
  validatePlacement,
  viewFor,
  voteRematch,
  type GameRecord,
  type Plane,
  type BoardSettings,
  type PlaneSettings,
  type ShapeDef,
} from '../src/index.js';

const settings: PlaneSettings = { mode: 'plane', size: 10, planes: 2, shape: CLASSIC_SHAPE };
const placed = (plane: Plane, shape: ShapeDef = CLASSIC_SHAPE) => ({ plane, shape });
/** 飛機版的開火結果（只看機頭或機身） */
const planeResult = (planes: Plane[], shape: ShapeDef, x: number, y: number) => {
  const hit = pieceAt(planes, Array(planes.length).fill(shape), x, y);
  return !hit ? 'miss' : hit.part === 'head' ? 'head' : 'body';
};
const A_PLANES: Plane[] = [
  { x: 2, y: 0, dir: 'up' },
  { x: 7, y: 5, dir: 'up' },
];
const B_PLANES: Plane[] = [
  { x: 2, y: 9, dir: 'down' },
  { x: 9, y: 5, dir: 'right' },
];
const shape = (id: string) => SHAPE_PRESETS.find((s) => s.id === id)!;

function setup(): GameRecord {
  let rec = createGameRecord({ id: 'ABCDEF', uid: 'a', name: '阿明', settings, now: 1 });
  rec = joinGame(rec, 'b', '小華', 2);
  rec = placePlanes(rec, 'a', A_PLANES, 3);
  rec = placePlanes(rec, 'b', B_PLANES, 4, () => 0); // rng=0 → a 先攻
  return rec;
}

function expectCode(fn: () => unknown, code: string, msg?: RegExp) {
  assert.throws(fn, (e: unknown) => e instanceof GameError && e.code === code && (!msg || msg.test(e.message)));
}

test('preset shapes are valid and have the expected sizes', () => {
  const sizes: Record<string, number> = { mini: 5, small: 8, classic: 10, jet: 13 };
  for (const s of SHAPE_PRESETS) {
    const [ok, err] = checkShape(s);
    assert.equal(err, null, s.id);
    assert.equal(ok!.cells.length, sizes[s.id], s.id);
    assert.deepEqual(s.cells[0], { x: 0, y: 0 });
  }
});

test('custom shape validation', () => {
  assert.match(checkShape({ cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] })[1]!, /機頭/);
  assert.match(checkShape({ cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }] })[1]!, /至少要 3 格/);
  assert.match(checkShape({ cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }] })[1]!, /連在一起/);
  // 斜角不算相連
  assert.match(checkShape({ cells: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] })[1]!, /連在一起/);
  assert.match(checkShape({ cells: [{ x: 0, y: 0 }, { x: 0, y: 7 }] })[1]!, /太大/);
  const many = [];
  for (let i = 0; i < 25; i++) many.push({ x: i % 5, y: Math.floor(i / 5) });
  assert.match(checkShape({ cells: many })[1]!, /最多/);

  const [ok] = checkShape({ name: '  火箭  ', cells: [{ x: 0, y: 3 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 1 }] });
  assert.equal(ok!.name, '火箭');
  assert.equal(ok!.cells.length, 4); // 重複的格子會被去掉
  assert.deepEqual(ok!.cells[0], { x: 0, y: 0 });
});

test('rotations keep the head first and cells unique', () => {
  for (const s of SHAPE_PRESETS) {
    for (const dir of ['up', 'right', 'down', 'left'] as const) {
      const cells = planeCells({ x: 6, y: 6, dir }, s);
      assert.equal(cells.length, s.cells.length);
      assert.deepEqual(cells[0], { x: 6, y: 6, part: 'head' });
      assert.equal(new Set(cells.map((c) => `${c.x},${c.y}`)).size, cells.length);
    }
  }
  // 經典飛機朝右：機身往左延伸
  const right = planeCells({ x: 5, y: 5, dir: 'right' }, CLASSIC_SHAPE);
  assert.ok(right.some((c) => c.x === 2 && c.y === 5));
  assert.ok(right.some((c) => c.x === 4 && c.y === 3));
});

test('outline segments form a closed shape', () => {
  const segs = planeOutline({ x: 4, y: 4, dir: 'up' }, CLASSIC_SHAPE);
  const deg = new Map<string, number>();
  for (const [x1, y1, x2, y2] of segs) {
    for (const k of [`${x1},${y1}`, `${x2},${y2}`]) deg.set(k, (deg.get(k) ?? 0) + 1);
  }
  for (const v of deg.values()) assert.equal(v % 2, 0);
});

test('planes must be completely separated (no edge or diagonal contact)', () => {
  assert.equal(validatePlacement(A_PLANES, settings), null);
  assert.match(validatePlacement([A_PLANES[0]], settings)!, /2 架/);
  assert.match(validatePlacement([{ x: 0, y: 0, dir: 'up' }, A_PLANES[1]], settings)!, /超出/);
  assert.match(validatePlacement([A_PLANES[0], { x: 3, y: 1, dir: 'up' }], settings)!, /重疊/);
  // 機翼左右貼在一起
  assert.match(validatePlacement([A_PLANES[0], { x: 7, y: 0, dir: 'up' }], settings)!, /完全分開/);
  // 只有斜角碰到 (4,1) ↔ (5,2)
  assert.equal(placementConflict(settings, [placed(A_PLANES[0])], placed({ x: 7, y: 1, dir: 'up' })), 'touch');
  // 隔一格就可以
  assert.equal(placementConflict(settings, [placed(A_PLANES[0])], placed({ x: 7, y: 2, dir: 'up' })), null);
  assert.match(validatePlacement([A_PLANES[0], { x: 7, y: 0, dir: 'sideways' }], settings)!, /朝向/);
});

test('search-based placement is always valid', () => {
  const rng = seededRng(42);
  for (const s of SHAPE_PRESETS) {
    for (const size of [6, 8, 10, 12]) {
      const max = maxFeasiblePlanes(size, s);
      for (let n = 1; n <= max; n++) {
        const st: BoardSettings = { mode: 'plane', size, planes: n, shape: s };
        const planes = findPlacement(st, rng);
        assert.ok(planes, `${s.id} ${size} ${n}`);
        assert.equal(validatePlacement(planes, st), null, `${s.id} ${size} ${n}`);
      }
    }
  }
  for (let i = 0; i < 100; i++) {
    const st: BoardSettings = { mode: 'plane', size: 10, planes: 3, shape: CLASSIC_SHAPE };
    const r = randomPlacement(st)!;
    assert.equal(validatePlacement(r.planes, st), null);
  }
});

test('random placement keeps existing planes when it can', () => {
  const st: BoardSettings = { mode: 'plane', size: 10, planes: 3, shape: CLASSIC_SHAPE };
  const keep: Plane[] = [{ x: 2, y: 0, dir: 'up' }];
  const r = randomPlacement(st, keep)!;
  assert.equal(r.reset, false);
  assert.deepEqual(r.planes[0], keep[0]);
  assert.equal(validatePlacement(r.planes, st), null);
});

test('random placement starts over when the kept planes leave no room', () => {
  const rocket = checkShape({ cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 3 }] })[0]!;
  const st: BoardSettings = { mode: 'plane', size: 7, planes: 2, shape: rocket };
  const r = randomPlacement(st, [{ x: 3, y: 2, dir: 'up' }])!;
  assert.equal(r.reset, true);
  assert.equal(validatePlacement(r.planes, st), null);
});

test('feasibility per board size', () => {
  assert.equal(maxFeasiblePlanes(5, CLASSIC_SHAPE), 1);
  assert.ok(maxFeasiblePlanes(10, CLASSIC_SHAPE) >= 3);
  assert.ok(maxFeasiblePlanes(5, shape('mini')) >= 1);
  assert.equal(shapeTooBig(shape('jet'), 5), true);
  assert.equal(shapeTooBig(shape('jet'), 7), false);
  assert.equal(isFeasible({ mode: 'plane', size: 5, planes: 2, shape: CLASSIC_SHAPE }), false);
});

test('settings normalization', () => {
  const d = normalizeSettings({});
  assert.equal(d.mode, 'plane');
  assert.equal(d.size, 10);
  assert.ok(d.mode === 'plane' && d.planes === 3 && d.shape.name === '經典');
  expectCode(() => normalizeSettings({ size: 4 }), 'BAD_REQUEST', /5×5/);
  expectCode(() => normalizeSettings({ size: 5, planes: 1, shape: shape('jet') }), 'BAD_REQUEST', /放不進/);
  expectCode(() => normalizeSettings({ size: 5, planes: 2, shape: CLASSIC_SHAPE }), 'BAD_REQUEST', /放不下 2 架/);
  expectCode(() => normalizeSettings({ shape: { cells: [{ x: 0, y: 0 }] } }), 'BAD_REQUEST', /至少/);
  const custom = normalizeSettings({ size: 7, planes: 2, shape: { name: '火箭', cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 3 }] } });
  assert.ok(custom.mode === 'plane' && custom.shape.cells.length === 6);
});

test('shot resolution', () => {
  assert.equal(planeResult(A_PLANES, CLASSIC_SHAPE, 2, 0), 'head');
  assert.equal(planeResult(A_PLANES, CLASSIC_SHAPE, 0, 1), 'body'); // 機翼
  assert.equal(planeResult(A_PLANES, CLASSIC_SHAPE, 2, 3), 'body'); // 機尾中間
  assert.equal(planeResult(A_PLANES, CLASSIC_SHAPE, 5, 1), 'miss');
  // 自訂形狀：只有機頭那格算機頭
  const rocket = checkShape({ cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }] })[0]!;
  assert.equal(planeResult([{ x: 3, y: 3, dir: 'left' }], rocket, 3, 3), 'head');
  assert.equal(planeResult([{ x: 3, y: 3, dir: 'left' }], rocket, 5, 3), 'body');
});

test('full game flow: join → place → fire → win → rematch', () => {
  let rec = setup();
  assert.equal(rec.pub.status, 'playing');
  assert.equal(rec.pub.turn, 'a');

  expectCode(() => fire(rec, 'b', 0, 0, 5), 'NOT_YOUR_TURN');
  rec = fire(rec, 'a', 0, 0, 5);
  assert.equal(rec.pub.shots.a[0].r, 'miss');
  assert.equal(rec.pub.turn, 'b');
  expectCode(() => fire(rec, 'a', 1, 1, 6), 'NOT_YOUR_TURN');

  rec = fire(rec, 'b', 2, 0, 6); // b 打中 a 的機頭
  assert.equal(rec.pub.found.b, 1);
  assert.equal(rec.pub.last?.r, 'head');

  rec = fire(rec, 'a', 2, 9, 7); // a 打中 b 第一架機頭
  rec = fire(rec, 'b', 5, 5, 8);
  expectCode(() => fire(rec, 'a', 2, 9, 9), 'ALREADY_SHOT');
  rec = fire(rec, 'a', 9, 5, 9); // a 找齊兩個機頭 → 勝
  assert.equal(rec.pub.status, 'finished');
  assert.equal(rec.pub.winner, 'a');
  assert.equal(rec.pub.players.a.wins, 1);
  assert.deepEqual(rec.pub.reveal?.b, B_PLANES);

  rec = voteRematch(rec, 'a', 10);
  assert.equal(rec.pub.status, 'finished');
  rec = voteRematch(rec, 'b', 11);
  assert.equal(rec.pub.status, 'placing');
  assert.equal(rec.pub.round, 2);
  assert.equal(rec.pub.shots.a.length, 0);
  assert.equal(rec.pub.reveal, null);
  rec = placePlanes(rec, 'a', A_PLANES, 12);
  rec = placePlanes(rec, 'b', B_PLANES, 13);
  assert.equal(rec.pub.turn, 'b'); // 換人先攻
});

test('public doc never contains plane positions before the game ends', () => {
  const rec = setup();
  const json = JSON.stringify(rec.pub);
  assert.ok(!json.includes('"dir"'));
  assert.equal(viewFor(rec, 'a').me?.planes?.length, 2);
  assert.equal(viewFor(rec, 'stranger').me, null);
});

test('room capacity, phases and unready', () => {
  let rec = createGameRecord({ id: 'ABCDEF', uid: 'a', name: 'A', settings, now: 1 });
  expectCode(() => placePlanes(rec, 'a', A_PLANES, 2), 'WRONG_PHASE');
  rec = joinGame(rec, 'b', 'B', 2);
  assert.equal(joinGame(rec, 'b', 'B', 3).pub.playerIds.length, 2);
  expectCode(() => joinGame(rec, 'c', 'C', 3), 'ROOM_FULL');
  rec = placePlanes(rec, 'a', A_PLANES, 3);
  rec = unready(rec, 'a', 4);
  assert.equal(rec.pub.players.a.ready, false);
  expectCode(() => placePlanes(rec, 'a', [A_PLANES[0]], 5), 'INVALID_PLACEMENT');
  expectCode(() => placePlanes(rec, 'a', [A_PLANES[0], { x: 7, y: 1, dir: 'up' }], 5), 'INVALID_PLACEMENT', /完全分開/);
});

test('leaving mid-game forfeits', () => {
  let rec = setup();
  rec = leaveGame(rec, 'a', 5);
  assert.equal(rec.pub.status, 'finished');
  assert.equal(rec.pub.winner, 'b');
  assert.equal(rec.pub.endReason, 'forfeit');
  expectCode(() => voteRematch(rec, 'b', 6), 'OPPONENT_LEFT');
  rec = leaveGame(rec, 'b', 7);
  assert.equal(rec.pub.status, 'closed');
});

test('host leaving a waiting room closes it', () => {
  let rec = createGameRecord({ id: 'ABCDEF', uid: 'a', name: 'A', settings, now: 1 });
  rec = leaveGame(rec, 'a', 2);
  assert.equal(rec.pub.status, 'closed');
  expectCode(() => joinGame(rec, 'b', 'B', 3), 'ROOM_CLOSED');
});

test('room code normalization', () => {
  assert.equal(normalizeRoomCode(' abc-234 '), 'ABC234');
  expectCode(() => normalizeRoomCode('ABC10O'), 'BAD_REQUEST');
});

/** 模擬開火結果（跟 engine.fire 相同的判定），回傳結果與擊沉資訊 */
function simulate(st: BoardSettings, planes: Plane[], shots: Array<{ x: number; y: number; r: string; n: number; k?: number }>, x: number, y: number) {
  const shapes = pieceShapes(st);
  const hit = pieceAt(planes, shapes, x, y);
  if (!hit) return { r: 'miss' as const };
  if (st.mode === 'plane') return { r: hit.part === 'head' ? ('head' as const) : ('body' as const) };
  const done = new Set([...shots.map((s) => `${s.x},${s.y}`), `${x},${y}`]);
  const sunk = planeCells(planes[hit.piece], shapes[hit.piece]).every((c) => done.has(`${c.x},${c.y}`));
  return sunk ? { r: 'sunk' as const, k: hit.piece } : { r: 'hit' as const };
}

test('computer opponent always finishes a game without repeating cells', async () => {
  const { chooseBotShot, headScores } = await import('../src/index.js');
  const configs: BoardSettings[] = [
    { mode: 'plane', size: 10, planes: 3, shape: CLASSIC_SHAPE },
    { mode: 'plane', size: 6, planes: 2, shape: shape('mini') },
    { mode: 'plane', size: 8, planes: 1, shape: shape('jet') },
    { mode: 'ship', size: 10, fleet: [5, 4, 3, 3, 2] },
    { mode: 'ship', size: 10, fleet: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] },
    { mode: 'ship', size: 6, fleet: [3, 2, 2] },
  ];
  for (const st of configs) {
    const total = st.mode === 'ship' ? st.fleet.length : st.planes;
    for (const level of ['easy', 'normal', 'hard'] as const) {
      for (let g = 0; g < 6; g++) {
        const planes = randomPlacement(st)!.planes;
        const shots: Array<{ x: number; y: number; r: 'head' | 'body' | 'miss' | 'hit' | 'sunk'; n: number; k?: number }> = [];
        const sunk: Array<Plane & { k: number }> = [];
        let found = 0;
        while (found < total) {
          const c = chooseBotShot(st, shots, level, Math.random, sunk);
          assert.ok(c.x >= 0 && c.y >= 0 && c.x < st.size && c.y < st.size);
          assert.ok(!shots.some((s) => s.x === c.x && s.y === c.y), 'repeated cell');
          const res = simulate(st, planes, shots, c.x, c.y);
          shots.push({ ...c, ...res, n: shots.length });
          if (res.r === 'head' || res.r === 'sunk') found++;
          if (res.r === 'sunk') sunk.push({ ...planes[res.k!], k: res.k! });
          assert.ok(shots.length <= st.size * st.size);
        }
      }
    }
  }
  // 打中機身之後，最可能的機頭會在附近
  const scores = headScores({ mode: 'plane', size: 10, planes: 1, shape: CLASSIC_SHAPE }, [{ x: 5, y: 5, r: 'body', n: 1 }]);
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bx = (best % 1024) - 64;
  const by = Math.floor(best / 1024) - 64;
  assert.ok(Math.abs(bx - 5) <= 3 && Math.abs(by - 5) <= 3);
});

// ---------------------------------------------------------------------------
// 海戰棋
// ---------------------------------------------------------------------------

const ships: BoardSettings = { mode: 'ship', size: 8, fleet: [3, 2] };
// 3 格船橫放在 A1–C1（錨點 A1、朝 left 代表往右延伸），2 格船直放在 F4–F5
const SHIPS_A: Plane[] = [
  { x: 0, y: 0, dir: 'left' },
  { x: 5, y: 3, dir: 'up' },
];
const SHIPS_B: Plane[] = [
  { x: 7, y: 7, dir: 'right' }, // F8–H8
  { x: 0, y: 4, dir: 'up' }, // A5–A6
];

test('fleet presets and validation', () => {
  assert.deepEqual(FLEET_PRESETS.map((f) => f.fleet.reduce((a, b) => a + b, 0)), [17, 20, 7]);
  assert.deepEqual(checkFleet([2, 5, 3])[0], [5, 3, 2]);
  assert.match(checkFleet([])[1]!, /至少/);
  assert.match(checkFleet([7])[1]!, /長度/);
  assert.match(checkFleet(Array(13).fill(1))[1]!, /最多/);

  const d = normalizeSettings({ mode: 'ship' });
  assert.ok(d.mode === 'ship' && d.fleet.join() === '5,4,3,3,2' && d.size === 10);
  expectCode(() => normalizeSettings({ mode: 'ship', size: 5, fleet: [6] }), 'BAD_REQUEST', /放不進/);
  // 大艦隊 10 艘要完全分開，6×6 放不下
  expectCode(() => normalizeSettings({ mode: 'ship', size: 6, fleet: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] }), 'BAD_REQUEST', /放不下/);
  assert.ok(isFeasible({ mode: 'ship', size: 10, fleet: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] }));
  expectCode(() => normalizeSettings({ mode: 'boat' }), 'BAD_REQUEST', /模式/);
});

test('ships must be completely separated too', () => {
  assert.equal(validatePlacement(SHIPS_A, ships), null);
  // 2 格船放在 D1–D2，跟 C1 左右相鄰
  assert.match(validatePlacement([SHIPS_A[0], { x: 3, y: 0, dir: 'up' }], ships)!, /完全分開/);
  // 只碰到斜角 C1 ↔ D2
  assert.match(validatePlacement([SHIPS_A[0], { x: 3, y: 1, dir: 'up' }], ships)!, /完全分開/);
  assert.match(validatePlacement([SHIPS_A[0]], ships)!, /2 艘船/);
  for (let i = 0; i < 50; i++) {
    const st: BoardSettings = { mode: 'ship', size: 10, fleet: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] };
    assert.equal(validatePlacement(randomPlacement(st)!.planes, st), null);
  }
});

test('battleship game: hit, sunk, win', () => {
  let rec = createGameRecord({ id: 'SHIPS2', uid: 'a', name: 'A', settings: ships, now: 1 });
  rec = joinGame(rec, 'b', 'B', 2);
  rec = placePlanes(rec, 'a', SHIPS_A, 3);
  rec = placePlanes(rec, 'b', SHIPS_B, 4, () => 0); // a 先攻
  assert.equal(rec.pub.turn, 'a');

  rec = fire(rec, 'a', 0, 4, 5); // 打中 2 格船的一端
  assert.equal(rec.pub.shots.a[0].r, 'hit');
  assert.equal('k' in rec.pub.shots.a[0], false); // 沒擊沉就不寫 k（Firestore 不接受 undefined）
  rec = fire(rec, 'b', 4, 4, 6);
  rec = fire(rec, 'a', 0, 5, 7); // 擊沉 2 格船
  assert.equal(rec.pub.last?.r, 'sunk');
  assert.equal(rec.pub.last?.k, 1);
  assert.deepEqual(rec.pub.sunk.a, [{ ...SHIPS_B[1], k: 1 }]);
  assert.equal(rec.pub.found.a, 1);
  assert.equal(rec.pub.status, 'playing');

  rec = fire(rec, 'b', 4, 5, 8);
  rec = fire(rec, 'a', 7, 7, 9);
  rec = fire(rec, 'b', 4, 6, 10);
  rec = fire(rec, 'a', 6, 7, 11);
  rec = fire(rec, 'b', 4, 7, 12);
  rec = fire(rec, 'a', 5, 7, 13); // 擊沉 3 格船 → 全滅
  assert.equal(rec.pub.status, 'finished');
  assert.equal(rec.pub.winner, 'a');
  assert.equal(rec.pub.endReason, 'cleared');
  assert.deepEqual(rec.pub.reveal?.b, SHIPS_B);

  rec = voteRematch(rec, 'a', 14);
  rec = voteRematch(rec, 'b', 15);
  assert.deepEqual(rec.pub.sunk.a, []);
  assert.equal(rec.pub.found.a, 0);
});

test('ship bot targets around an open hit and skips cells next to sunk ships', async () => {
  const { shipScores } = await import('../src/index.js');
  const st = { mode: 'ship' as const, size: 10, fleet: [3, 2] };
  // 打中 E5，下一步應該打 E5 上下左右其中一格
  const scores = shipScores(st, [{ x: 4, y: 4, r: 'hit', n: 1 }], []);
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bx = (best % 1024) - 64;
  const by = Math.floor(best / 1024) - 64;
  assert.equal(Math.abs(bx - 4) + Math.abs(by - 4), 1);
  // 擊沉 A1–B1 的 2 格船之後，周圍的格子分數是 0
  const after = shipScores(
    st,
    [
      { x: 0, y: 0, r: 'hit', n: 1 },
      { x: 1, y: 0, r: 'sunk', n: 2, k: 1 },
    ],
    [{ x: 0, y: 0, dir: 'left', k: 1 }],
  );
  for (const [x, y] of [[2, 0], [0, 1], [1, 1], [2, 1]]) assert.equal(after.get((y + 64) * 1024 + (x + 64)) ?? 0, 0);
});

// ---------------------------------------------------------------------------
// 幾A幾B
// ---------------------------------------------------------------------------

test('xAyB scoring', async () => {
  const { abScore } = await import('../src/index.js');
  assert.deepEqual(abScore('4817', '1234'), { a: 0, b: 2 });
  assert.deepEqual(abScore('4817', '4871'), { a: 2, b: 2 });
  assert.deepEqual(abScore('4817', '4817'), { a: 4, b: 0 });
  assert.deepEqual(abScore('4817', '5692'), { a: 0, b: 0 });
  // 可以重複時，同一個數字只算到雙方都有的次數
  assert.deepEqual(abScore('1123', '1111'), { a: 2, b: 0 });
  assert.deepEqual(abScore('1123', '3211'), { a: 0, b: 4 });
  assert.deepEqual(abScore('0012', '1200'), { a: 0, b: 4 });
});

test('code validation and settings', async () => {
  const { checkCode, randomCode } = await import('../src/index.js');
  const st = { mode: 'ab' as const, digits: 4, repeat: false };
  assert.deepEqual(checkCode(' 0123 ', st), ['0123', null]);
  assert.match(checkCode('012', st)[1]!, /4 位/);
  assert.match(checkCode('01a3', st)[1]!, /數字/);
  assert.match(checkCode('1123', st)[1]!, /不能重複/);
  assert.deepEqual(checkCode('1123', { ...st, repeat: true }), ['1123', null]);
  for (let i = 0; i < 50; i++) assert.equal(checkCode(randomCode(st), st)[1], null);

  assert.deepEqual(normalizeSettings({ mode: 'ab' }), { mode: 'ab', digits: 4, repeat: false });
  assert.deepEqual(normalizeSettings({ mode: 'ab', digits: 3, repeat: true }), { mode: 'ab', digits: 3, repeat: true });
  expectCode(() => normalizeSettings({ mode: 'ab', digits: 7 }), 'BAD_REQUEST', /位數/);
});

test('1A2B game: secret, guesses, win, rematch', async () => {
  const { setSecret, makeGuess } = await import('../src/index.js');
  const st = { mode: 'ab' as const, digits: 4, repeat: false };
  let rec = createGameRecord({ id: 'ABAB23', uid: 'a', name: 'A', settings: st, now: 1 });
  rec = joinGame(rec, 'b', 'B', 2);
  expectCode(() => placePlanes(rec, 'a', [], 3), 'WRONG_PHASE');
  expectCode(() => setSecret(rec, 'a', '1123', 3), 'INVALID_PLACEMENT', /不能重複/);
  rec = setSecret(rec, 'a', '4817', 3);
  assert.equal(rec.pub.status, 'placing');
  assert.ok(!JSON.stringify(rec.pub).includes('4817')); // 密碼不在公開資料裡
  rec = setSecret(rec, 'b', '0592', 4, () => 0); // a 先猜
  assert.equal(rec.pub.status, 'playing');
  assert.equal(rec.pub.turn, 'a');

  rec = makeGuess(rec, 'a', '0123', 5);
  assert.deepEqual(rec.pub.guesses.a[0], { g: '0123', a: 1, b: 1, n: 1 });
  assert.equal(rec.pub.turn, 'b');
  expectCode(() => makeGuess(rec, 'a', '0592', 6), 'NOT_YOUR_TURN');
  expectCode(() => fire(rec, 'b', 0, 0, 6), 'WRONG_PHASE');
  rec = makeGuess(rec, 'b', '1234', 6);
  assert.deepEqual(rec.pub.lastGuess, { g: '1234', a: 0, b: 2, n: 2, by: 'b' });
  expectCode(() => makeGuess(rec, 'a', '0123', 7), 'ALREADY_SHOT');
  rec = makeGuess(rec, 'a', '0592', 7);
  assert.equal(rec.pub.status, 'finished');
  assert.equal(rec.pub.winner, 'a');
  assert.deepEqual(rec.pub.codes, { a: '4817', b: '0592' });

  rec = voteRematch(rec, 'a', 8);
  rec = voteRematch(rec, 'b', 9);
  assert.equal(rec.pub.status, 'placing');
  assert.deepEqual(rec.pub.guesses, { a: [], b: [] });
  assert.equal(rec.pub.codes, null);
});

test('1A2B computer always solves the code', async () => {
  const { abScore, chooseBotGuess, randomCode } = await import('../src/index.js');
  const configs = [
    { mode: 'ab' as const, digits: 4, repeat: false },
    { mode: 'ab' as const, digits: 3, repeat: true },
    { mode: 'ab' as const, digits: 5, repeat: false },
  ];
  for (const st of configs) {
    for (const level of ['easy', 'normal', 'hard'] as const) {
      for (let g = 0; g < 4; g++) {
        const secret = randomCode(st);
        const guesses: Array<{ g: string; a: number; b: number; n: number }> = [];
        for (;;) {
          const guess = chooseBotGuess(st, guesses, level);
          assert.ok(!guesses.some((x) => x.g === guess), 'repeated guess');
          const r = abScore(secret, guess);
          guesses.push({ g: guess, ...r, n: guesses.length });
          if (r.a === st.digits) break;
          assert.ok(guesses.length < 60, `${level} took too long`);
        }
      }
    }
  }
});

test('reassignPlayer moves a seat, its secret and every uid reference', () => {
  let rec = createGameRecord({ id: 'ABC234', uid: 'guest-uid', name: '訪客', settings: { mode: 'ab', digits: 3, repeat: false }, now: 1 });
  rec = joinGame(rec, 'friend-uid', '朋友', 2);
  rec = setSecret(rec, 'guest-uid', '123', 3, () => 0.1);
  const moved = reassignPlayer(rec, 'guest-uid', 'google-uid', 4);
  assert.equal(moved.pub.hostId, 'google-uid');
  assert.deepEqual(moved.pub.playerIds, ['google-uid', 'friend-uid']);
  assert.equal(moved.pub.players['google-uid'].name, '訪客');
  assert.equal(moved.priv['google-uid'].secret, '123');
  assert.equal('guest-uid' in moved.priv, false);
  assert.equal(JSON.stringify(moved.pub).includes('guest-uid'), false);
  // 沒在房間裡就不動；換成房間裡另一位玩家的帳號就拒絕
  assert.equal(reassignPlayer(rec, 'stranger', 'google-uid', 5), rec);
  assert.throws(() => reassignPlayer(rec, 'guest-uid', 'friend-uid', 5), (e: unknown) => e instanceof GameError && e.code === 'SAME_ACCOUNT');
});

test('rooms expire after a day without activity', () => {
  const rec = createGameRecord({ id: 'ABC234', uid: 'host', name: '房主', settings: { mode: 'ab', digits: 3, repeat: false }, now: 1000 });
  assert.doesNotThrow(() => assertRoomActive(rec.pub, 'someone', 1000 + ROOM_IDLE_MS));
  assert.throws(() => assertRoomActive(rec.pub, 'someone', 1001 + ROOM_IDLE_MS), /邀請連結已經過期/);
  assert.throws(() => assertRoomActive(rec.pub, 'host', 1001 + ROOM_IDLE_MS), /已經關閉/);
  const closed = leaveGame(rec, 'host', 2000);
  assert.doesNotThrow(() => assertRoomActive(closed.pub, 'someone', 2000 + 10 * ROOM_IDLE_MS));
});

test('chat: quick lines, typed text, pokes and rate limits', () => {
  const isCode = (code: string) => (e: unknown) => e instanceof GameError && e.code === code;
  let rec = createGameRecord({ id: 'ABC234', uid: 'a', name: '小美', settings: { mode: 'ab', digits: 3, repeat: false }, now: 0 });
  assert.throws(() => say(rec, 'a', { line: 'win' }, 10), isCode('WRONG_PHASE'));
  rec = joinGame(rec, 'b', '小華', 100);
  assert.throws(() => say(rec, 'c', { line: 'win' }, 200), isCode('NOT_PLAYER'));
  assert.throws(() => say(rec, 'a', { line: 'dance' }, 200), isCode('BAD_REQUEST'));

  rec = say(rec, 'a', { line: 'slow' }, 1000);
  assert.throws(() => say(rec, 'a', { line: 'win' }, 1500), isCode('TOO_FAST'));
  rec = say(rec, 'b', { text: '  別催\n我在想  ' }, 1500); // 對方不受我的冷卻影響
  assert.equal(rec.pub.chat!.at(-1)!.text, '別催 我在想');
  assert.throws(() => say(rec, 'a', { line: 'slow' }, 3000), /剛剛才催過/);
  rec = say(rec, 'a', { line: 'win' }, 3000);
  rec = say(rec, 'a', { line: 'slow' }, 6500);
  assert.deepEqual(
    rec.pub.chat!.map((m) => m.n),
    [1, 2, 3, 4],
  );
  assert.throws(() => say(rec, 'b', { text: '   ' }, 9000), /先打點字/);
  assert.throws(() => say(rec, 'b', { text: '字'.repeat(41) }, 9000), /最多 40 個字/);
  assert.equal(rec.pub.updatedAt, 6500);

  for (let i = 0; i < 40; i++) rec = say(rec, i % 2 ? 'a' : 'b', { text: `第${i}句` }, 10000 + i * 2000);
  assert.equal(rec.pub.chat!.length, CHAT_KEEP);
  assert.equal(rec.pub.chat!.at(-1)!.n, 44);
});

test('plane auto-mark: deduce found planes from your own shots', async () => {
  const { deduceFoundPlanes } = await import('../src/index.js');
  const mini = { name: '迷你機', cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }] };
  const settings = { mode: 'plane' as const, size: 7, planes: 2, shape: mini };
  const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;

  // 一架飛機時找到機頭就贏了，不推理
  assert.deepEqual(deduceFoundPlanes({ ...settings, planes: 1 }, [{ x: 3, y: 3, r: 'head' }]), []);

  // 機頭貼著左邊：只有機頭朝左（機身往右延伸）放得下
  const [edge] = deduceFoundPlanes(settings, [{ x: 0, y: 3, r: 'head' }]);
  assert.equal(edge.known?.plane.dir, 'left');
  const empty = new Set(edge.empty.map(key));
  assert.ok(empty.has('0,2') && empty.has('3,3') && empty.has('2,1'));
  assert.ok(!empty.has('1,3') && !empty.has('0,3'), '飛機自己的格子不是空的');

  // 中間的機頭：四個方向都可能 → 不確定；沒打中的格子把其他三個方向排除掉
  const [mid] = deduceFoundPlanes(settings, [{ x: 3, y: 3, r: 'head' }]);
  assert.equal(mid.options.length, 4);
  assert.equal(mid.known, null);
  const [solved] = deduceFoundPlanes(settings, [
    { x: 3, y: 3, r: 'head' },
    { x: 3, y: 4, r: 'miss' },
    { x: 3, y: 2, r: 'miss' },
    { x: 4, y: 3, r: 'miss' },
  ]);
  assert.equal(solved.known?.plane.dir, 'right');
  assert.ok(solved.empty.every((c) => !(c.x === 3 && c.y === 4)), '打過的格子不用再標');

  // 打中的機身貼在某個方向旁邊（但不是那個方向的機身）→ 那個方向不可能
  const [byBody] = deduceFoundPlanes(settings, [
    { x: 3, y: 3, r: 'head' },
    { x: 3, y: 4, r: 'body' }, // 機頭正下方是機身：只有朝上（機身在下面）說得通
  ]);
  assert.equal(byBody.known?.plane.dir, 'up');
});
