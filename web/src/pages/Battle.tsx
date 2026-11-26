import { useMemo, useState } from 'react';
import {
  cellKey,
  coordLabel,
  deduceFoundPlanes,
  opponentOf,
  pieceShapes,
  shipName,
  surroundingCells,
  type Cell,
  type GameDoc,
  type PrivateDoc,
  type BoardSettings,
  type Shot,
} from '@planehunt/shared';
import { Board, type ActivateInfo } from '../components/Board';
import { EmptyHint, Highlight, PencilMark, PieceShape, ShotMark } from '../components/marks';
import { ConfirmButton } from '../components/ConfirmButton';
import { Legend } from '../components/Legend';
import { ShapePreview } from '../components/ShapePreview';
import { FleetStatus } from '../components/Fleet';
import { TurnBanner, shortName, type TurnEvent, type TurnKind } from '../components/TurnBanner';
import { RematchActions, ResultModal, useResultModal } from '../components/ResultModal';
import { PokeButton } from '../components/Chat';
import { useCoarsePointer, useLocalState, useSessionState } from '../lib/util';
import type { Act } from './Room';

/** 一發的結果文字；onMe = 這一發是打在我的棋盤上 */
export function resultText(shot: Pick<Shot, 'r' | 'k'>, settings: BoardSettings, onMe = false): string {
  const your = onMe ? '你的' : '';
  switch (shot.r) {
    case 'head':
      return `命中${your}機頭！`;
    case 'body':
      return '打中機身';
    case 'hit':
      return '打中了';
    case 'sunk':
      return settings.mode === 'ship' && shot.k !== undefined
        ? `擊沉${your}${shipName(settings.fleet[shot.k])}！`
        : '擊沉！';
    default:
      return '沒打中';
  }
}

/** 找到機頭、擊沉船：要讓人一眼看出來的大事 */
const isBigHit = (r: Shot['r']) => r === 'head' || r === 'sunk';

interface Props {
  game: GameDoc;
  me: PrivateDoc | null;
  uid: string;
  act: Act;
  onLeave(): void;
  /** 「房號 ABC234」或「跟電腦練習」 */
  roomLabel: string;
}

function HeadTally({ found, total, label }: { found: number; total: number; label: string }) {
  const dots = [];
  for (let i = 0; i < total; i++) {
    dots.push(
      <svg key={i} viewBox="0 0 1 1" className={`tally-dot${i < found ? ' is-found' : ''}`} aria-hidden="true">
        <circle cx={0.5} cy={0.5} r={0.42} />
        {i < found && (
          <text x={0.5} y={0.71} textAnchor="middle">
            頭
          </text>
        )}
      </svg>,
    );
  }
  return (
    <div className="tally">
      <span className="tally-label">{label}</span>
      <span className="tally-dots" role="img" aria-label={`${found} / ${total}`}>
        {dots}
      </span>
    </div>
  );
}

export function Battle({ game, me, uid, act, onLeave, roomLabel }: Props) {
  const coarse = useCoarsePointer();
  const opp = opponentOf(game, uid)!;
  const oppName = game.players[opp]?.name ?? '對手';
  const myName = game.players[uid]?.name ?? '你';
  const settings = game.settings as BoardSettings; // Room 只會在飛機版、海戰棋時用這個畫面
  const { size, mode } = settings;
  const isShip = mode === 'ship';
  const shapes = pieceShapes(settings);
  const total = shapes.length;
  const area = isShip ? '海域' : '空域';
  const noun = isShip ? '船' : '飛機';
  const playing = game.status === 'playing';
  const finished = game.status === 'finished';
  const myTurn = playing && game.turn === uid;

  const myShots = game.shots[uid] ?? [];
  const oppShots = game.shots[opp] ?? [];
  const shotAt = useMemo(() => new Map(myShots.map((s) => [cellKey(s.x, s.y), s])), [myShots]);

  const [hover, setHover] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell | null>(null);
  const [firing, setFiring] = useState(false);
  const [markMode, setMarkMode] = useState(false);
  // 飛機版：找到機頭後，自動推理那架飛機的位置並標出周圍一定是空的格子（偏好記在這台裝置上）
  const [autoMark, setAutoMark] = useLocalState('planehunt.autoMark', true);
  const canAutoMark = settings.mode === 'plane' && total > 1;
  // 推理筆記只存在自己的瀏覽器分頁，不會傳給伺服器
  const [marks, setMarks] = useSessionState<string[]>(`planehunt.marks.${game.id}.${game.round}`, []);
  const markSet = new Set(marks);
  const markKey = (c: Cell) => `${c.x},${c.y}`;

  const toggleMark = (c: Cell) => {
    if (shotAt.has(cellKey(c.x, c.y))) return;
    const k = markKey(c);
    setMarks(markSet.has(k) ? marks.filter((m) => m !== k) : [...marks, k]);
  };

  const onActivate = async (c: Cell, info: ActivateInfo) => {
    if (!playing) return;
    if (info.secondary || markMode) {
      toggleMark(c);
      return;
    }
    if (!myTurn || firing) return;
    if (shotAt.has(cellKey(c.x, c.y))) return;
    if (info.pointer === 'touch' && (!cursor || cursor.x !== c.x || cursor.y !== c.y)) {
      setCursor(c); // 觸控：第一下瞄準，第二下開火
      return;
    }
    setFiring(true);
    const ok = await act('fire', { x: c.x, y: c.y });
    setFiring(false);
    if (ok) setCursor(null);
  };

  const aim = myTurn && !markMode ? (hover ?? cursor) : null;
  const aimValid = aim && !shotAt.has(cellKey(aim.x, aim.y));
  const lastN = game.last?.n;

  // ---- 回合色帶 ----
  const oppShort = shortName(oppName);
  const won = finished && game.winner === uid;
  let kind: TurnKind;
  let status: string;
  if (finished) {
    kind = won ? 'win' : 'lose';
    status = won ? '你贏了！' : '這局輸了';
  } else if (myTurn) {
    kind = 'mine';
    status = '輪到你開火';
  } else {
    kind = 'theirs';
    status = `${oppShort}瞄準中…`;
  }

  let detail = '';
  let event: TurnEvent = null;
  if (game.last) {
    const byMe = game.last.by === uid;
    detail = `${byMe ? '你' : oppShort}打 ${coordLabel(game.last.x, game.last.y)}：${resultText(game.last, settings, !byMe)}`;
    if (isBigHit(game.last.r)) event = byMe ? 'good' : 'bad';
  } else if (playing) {
    detail = `這局${game.turn === uid ? '你' : oppShort}先攻`;
  }

  // ---- 勝負彈窗 ----
  const result = useResultModal(game);
  let reason = '';
  if (finished) {
    if (game.endReason === 'forfeit') reason = won ? `${oppName}離開了，這局算你贏。` : '你離開了這局。';
    else if (isShip) reason = won ? `你擊沉了${oppName}全部 ${total} 艘船。` : `${oppName}先擊沉了你的整支艦隊。`;
    else reason = won ? `你找齊了${oppName}的 ${total} 個機頭。` : `${oppName}先找齊了你的 ${total} 個機頭。`;
  }
  const myHits = myShots.filter((s) => s.r !== 'miss').length;

  const log = useMemo(() => {
    const all: Array<Shot & { by: string }> = [
      ...myShots.map((s) => ({ ...s, by: uid })),
      ...oppShots.map((s) => ({ ...s, by: opp })),
    ];
    return all.sort((a, b) => b.n - a.n).slice(0, 12);
  }, [myShots, oppShots, uid, opp]);

  const enemyReveal = finished ? (game.reveal?.[opp] ?? []) : [];

  // 海戰棋：我擊沉的船（位置已公開）與它們周圍一定是空的格子
  const mySunk = isShip ? (game.sunk?.[uid] ?? []) : [];
  const oppSunk = isShip ? (game.sunk?.[opp] ?? []) : [];
  const sunkPlaced = mySunk.map((p) => ({ plane: p, shape: shapes[p.k] }));
  const deduced = useMemo(
    () => (canAutoMark && autoMark && settings.mode === 'plane' ? deduceFoundPlanes(settings, myShots) : []),
    [canAutoMark, autoMark, settings, myShots],
  );
  const knownPlanes = finished ? [] : deduced.flatMap((d) => (d.known ? [d.known] : []));
  const emptyAround =
    isShip && total > 1
      ? surroundingCells(sunkPlaced, size).filter((c) => !shotAt.has(cellKey(c.x, c.y)))
      : finished
        ? []
        : [...new Map(deduced.flatMap((d) => d.empty).map((c) => [cellKey(c.x, c.y), c])).values()];

  return (
    <section className="battle">
      <header className="room-head">
        <div>
          <p className="scoreline">
            <span className="score-name">{myName}</span>
            <span className="score-num">{game.players[uid]?.wins ?? 0}</span>
            <span className="score-sep">:</span>
            <span className="score-num">{game.players[opp]?.wins ?? 0}</span>
            <span className="score-name">{oppName}</span>
          </p>
          <p className="room-sub">
            <span>第 {game.round} 局</span>
            <span>{roomLabel}</span>
          </p>
        </div>
        {!finished && <ConfirmButton label="離開房間" confirmLabel="確定離開？這局會判你輸" onConfirm={onLeave} />}
      </header>

      <TurnBanner
        kind={kind}
        status={status}
        detail={detail}
        event={event}
        eventKey={game.last?.n}
        action={<PokeButton game={game} uid={uid} act={act} inline />}
      />
      {finished && !result.open && (
        <RematchActions
          game={game}
          uid={uid}
          act={act}
          onLeave={onLeave}
          extra={
            <button type="button" className="btn btn--outline" onClick={result.reopen}>
              看結果
            </button>
          }
        />
      )}
      <ResultModal
        game={game}
        uid={uid}
        act={act}
        onLeave={onLeave}
        reason={reason}
        open={result.open}
        onClose={result.close}
      >
        {myShots.length > 0 && (
          <p className="result-stats">
            你開了 {myShots.length} 砲，打中 {myHits} 砲
          </p>
        )}
      </ResultModal>

      <div className="battle-grid">
        <div className="enemy">
          <div className="board-caption">
            <h2>
              {oppName}的{area}
            </h2>
            {playing && (
              <button
                type="button"
                className={`chip${markMode ? ' is-on' : ''}`}
                aria-pressed={markMode}
                onClick={() => setMarkMode((m) => !m)}
              >
                {markMode ? '標記模式：開' : '標記模式'}
              </button>
            )}
            {playing && canAutoMark && (
              <button
                type="button"
                className={`chip${autoMark ? ' is-on' : ''}`}
                aria-pressed={autoMark}
                title="找到機頭後，推得出位置的飛機會框起來，周圍一定是空的格子會標上淡淡的點"
                onClick={() => setAutoMark(!autoMark)}
              >
                {autoMark ? '自動標記：開' : '自動標記：關'}
              </button>
            )}
          </div>
          <Board
            size={size}
            label={`${oppName}的${area}，${myTurn ? '輪到你開火' : '等待對手'}`}
            interactive={playing}
            cursor={cursor}
            onCursorChange={setCursor}
            onHover={setHover}
            onActivate={onActivate}
            describeCell={(c) => {
              const s = shotAt.get(cellKey(c.x, c.y));
              return s ? `已打過，${resultText(s, settings)}` : markSet.has(markKey(c)) ? '有你的筆記' : '尚未開火';
            }}
          >
            {enemyReveal.map((p, i) =>
              mySunk.some((sp) => sp.k === i) ? null : (
                <PieceShape key={`r${i}`} mode={mode} plane={p} shape={shapes[i]} variant="reveal" />
              ),
            )}
            {sunkPlaced.map((sp, i) => (
              <PieceShape key={`s${i}`} mode={mode} plane={sp.plane} shape={sp.shape} variant="sunk" />
            ))}
            {knownPlanes.map((kp, i) => (
              <PieceShape key={`k${i}`} mode={mode} plane={kp.plane} shape={kp.shape} variant="sunk" headLabel={false} />
            ))}
            {emptyAround.map((c) => (
              <EmptyHint key={`e${c.x},${c.y}`} cell={c} />
            ))}
            {aim && <Highlight cell={aim} kind={aimValid ? 'aim' : 'blocked'} />}
            {marks.map((k) => {
              const [x, y] = k.split(',').map(Number);
              return shotAt.has(cellKey(x, y)) ? null : <PencilMark key={k} cell={{ x, y }} />;
            })}
            {myShots.map((s) => (
              <ShotMark key={s.n} shot={s} fresh={s.n === lastN} />
            ))}
          </Board>
          <p className="hint">
            {playing
              ? coarse
                ? `點一下瞄準，再點同一格開火。開「標記模式」可以記下你覺得沒有${noun}的格子。`
                : `點格子開火。右鍵可以做記號，幫自己推理。${
                    isShip && total > 1
                      ? '擊沉的船周圍會自動標上淡淡的點，那些格子一定是空的。'
                      : canAutoMark && autoMark
                        ? '找到機頭後會自動推理：推得出位置的飛機會用紅筆框起來，淡淡的點是一定空的格子。'
                        : ''
                  }`
              : finished
                ? `紅色虛線是${oppName}藏${noun}的位置。`
                : ''}
          </p>
        </div>

        <aside className="mine">
          <div className="board-caption">
            <h2>我的{area}</h2>
          </div>
          <Board size={size} label={`我的${area}`} variant="side">
            {(me?.planes ?? []).map((p, i) => (
              <PieceShape
                key={i}
                mode={mode}
                plane={p}
                shape={shapes[i]}
                variant={oppSunk.some((sp) => sp.k === i) ? 'sunk' : 'mine'}
              />
            ))}
            {game.last && game.last.by === opp && <Highlight cell={game.last} kind="last" />}
            {oppShots.map((s) => (
              <ShotMark key={s.n} shot={s} fresh={s.n === lastN} />
            ))}
          </Board>

          {settings.mode === 'ship' ? (
            <>
              <FleetStatus fleet={settings.fleet} sunk={new Set(mySunk.map((p) => p.k))} label={`${oppName}的艦隊`} />
              <FleetStatus fleet={settings.fleet} sunk={new Set(oppSunk.map((p) => p.k))} label="我的艦隊" />
            </>
          ) : (
            <>
              <div className="shape-ref">
                <ShapePreview shape={settings.shape} className="shape-preview--sm" />
                <p>
                  對手藏了 {total} 架「{settings.shape.name}」
                  <span className="muted">每架 {settings.shape.cells.length} 格，可以朝四個方向擺</span>
                </p>
              </div>
              <HeadTally found={game.found?.[uid] ?? 0} total={total} label="你找到的機頭" />
              <HeadTally found={game.found?.[opp] ?? 0} total={total} label={`${oppName}找到的機頭`} />
            </>
          )}

          <div className="log">
            <h3>戰況紀錄</h3>
            {log.length === 0 ? (
              <p className="muted">還沒有人開火。</p>
            ) : (
              <ol>
                {log.map((s) => (
                  <li key={s.n} className={`log-item log-item--${s.r}`}>
                    <span className="log-who">{s.by === uid ? '你' : oppName}</span>
                    <span className="log-at">{coordLabel(s.x, s.y)}</span>
                    <span className="log-res">{resultText(s, settings, s.by !== uid)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>

      <Legend mode={mode} />
    </section>
  );
}
