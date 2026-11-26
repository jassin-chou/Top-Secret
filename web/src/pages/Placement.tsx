import { useEffect, useMemo, useRef, useState } from 'react';
import {
  NO_DIAGONAL_TOUCH,
  cellKey,
  nextDir,
  occupancy,
  opponentOf,
  pieceShapes,
  placementConflict,
  randomPlacement,
  type Cell,
  type Conflict,
  type Dir,
  type GameDoc,
  type BoardSettings,
  type Placed,
  type Plane,
  type PrivateDoc,
} from '@planehunt/shared';
import { Board, type ActivateInfo } from '../components/Board';
import { PokeButton } from '../components/Chat';
import { PieceShape } from '../components/marks';
import { ShapePreview } from '../components/ShapePreview';
import { ShipIcon } from '../components/Fleet';
import { ConfirmButton } from '../components/ConfirmButton';
import { useToast } from '../components/Toasts';
import { useCoarsePointer } from '../lib/util';
import type { Act } from './Room';

const DIR_TEXT: Record<Dir, string> = { up: '原本的方向', right: '向右轉 90°', down: '轉 180°', left: '向左轉 90°' };

/** 船只分橫、直：left = 從游標往右延伸，up = 從游標往下延伸 */
const isHorizontal = (d: Dir) => d === 'left' || d === 'right';

interface Props {
  game: GameDoc;
  me: PrivateDoc | null;
  uid: string;
  act: Act;
  onLeave(): void;
  /** 「房號 ABC234」或「跟電腦練習」 */
  roomLabel: string;
}

type Draft = Array<Plane | null>;

export function Placement({ game, me, uid, act, onLeave, roomLabel }: Props) {
  const toast = useToast();
  const coarse = useCoarsePointer();
  const settings = game.settings as BoardSettings; // Room 只會在飛機版、海戰棋時用這個畫面
  const { size, mode } = settings;
  const isShip = mode === 'ship';
  const shapes = useMemo(() => pieceShapes(settings), [settings]);
  const n = shapes.length;
  const unit = isShip ? '艘' : '架';
  const noun = isShip ? '船' : '飛機';
  const ready = game.players[uid].ready;
  const opp = opponentOf(game, uid);
  const oppInfo = opp ? game.players[opp] : null;

  const fromSaved = (planes: Plane[] | null | undefined): Draft =>
    planes && planes.length === n ? planes : Array<Plane | null>(n).fill(null);
  const [draft, setDraft] = useState<Draft>(() => fromSaved(me?.planes));
  const touched = useRef(false);
  const [dir, setDir] = useState<Dir>(isShip ? 'left' : 'up');
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell | null>(null);
  const [busy, setBusy] = useState(false);

  // Firebase 模式下私密文件可能晚一點才到；上一局的擺法會被帶進來當預設
  useEffect(() => {
    if (!touched.current && me?.planes && me.planes.length === n) setDraft(me.planes);
  }, [me, n]);

  const update = (next: Draft) => {
    touched.current = true;
    setDraft(next);
  };

  const placedCount = draft.filter(Boolean).length;
  const full = placedCount === n;
  const firstEmpty = draft.findIndex((p) => !p);
  // 海戰棋可以自己選下一艘要擺哪一艘；飛機都一樣，就依序擺
  const active = isShip && selected !== null && !draft[selected] ? selected : firstEmpty;

  const placedList: Placed[] = draft.flatMap((p, i) => (p ? [{ plane: p, shape: shapes[i] }] : []));
  const occ = useMemo(() => occupancy(draft, shapes) ?? new Map(), [draft, shapes]);
  const anchor = hover ?? cursor;
  const anchorOnPiece = anchor ? occ.has(cellKey(anchor.x, anchor.y)) : false;
  const preview: Placed | null =
    anchor && !ready && active >= 0 && !anchorOnPiece ? { plane: { x: anchor.x, y: anchor.y, dir }, shape: shapes[active] } : null;
  const previewOk = preview ? placementConflict(settings, placedList, preview) === null : false;

  const conflictText: Record<Conflict, string> = {
    out: '這裡放不下：會超出棋盤',
    overlap: `這裡放不下：會跟其他${noun}重疊`,
    touch: NO_DIAGONAL_TOUCH ? `${noun}之間要完全分開，不能貼在一起（斜角也不行）` : `${noun}之間要分開，不能貼在一起`,
  };

  const rotate = () => setDir((d) => (isShip ? (isHorizontal(d) ? 'up' : 'left') : nextDir(d)));

  useEffect(() => {
    if (ready) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && !(e.target instanceof HTMLInputElement)) rotate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isShip]);

  const pickUp = (i: number) => {
    const p = draft[i];
    if (!p) return;
    setDir(isShip ? (isHorizontal(p.dir) ? 'left' : 'up') : p.dir);
    setSelected(i);
    update(draft.map((d, j) => (j === i ? null : d)));
  };

  const onActivate = (c: Cell, info: ActivateInfo) => {
    if (ready) return;
    if (info.secondary) {
      rotate();
      return;
    }
    const hit = occ.get(cellKey(c.x, c.y));
    if (hit) {
      // 拿起已經放好的棋子，方向保留，方便微調
      pickUp(hit.piece);
      return;
    }
    if (info.pointer === 'touch' && (!cursor || cursor.x !== c.x || cursor.y !== c.y)) {
      setCursor(c); // 觸控：第一下預覽，第二下放下
      return;
    }
    if (active < 0) {
      toast(`${noun}已經擺滿了。點一${unit}${noun}可以把它拿起來重擺`, 'info');
      return;
    }
    const cand = { plane: { x: c.x, y: c.y, dir }, shape: shapes[active] };
    const conflict = placementConflict(settings, placedList, cand);
    if (conflict) {
      toast(conflictText[conflict], 'info');
      return;
    }
    update(draft.map((d, j) => (j === active ? cand.plane : d)));
    setSelected(null);
    if (info.pointer === 'touch') setCursor(null);
  };

  const shuffle = () => {
    const next = randomPlacement(settings, full ? [] : draft);
    if (!next) return toast('找不到可以擺的位置，請重新整理再試一次');
    if (next.reset) toast(`剩下的空間放不下其他${noun}，已經整盤重新擺放`, 'info');
    setSelected(null);
    update(next.planes);
  };

  const submit = async () => {
    setBusy(true);
    await act('place', { planes: draft });
    setBusy(false);
  };

  const cancelReady = async () => {
    setBusy(true);
    await act('unready');
    setBusy(false);
  };

  const oppStatus = !oppInfo ? '等待對手' : oppInfo.ready ? `${oppInfo.name}已經擺好了` : `${oppInfo.name}還在擺${noun}`;
  const hint = isShip
    ? coarse
      ? '點一下格子預覽（那格是船頭），再點同一格放下。點已放好的船可以拿起來。'
      : '游標所在的格子是船頭，往右（橫）或往下（直）延伸。按 R 或右鍵切換橫直，點已放好的船可以拿起來。'
    : coarse
      ? '點一下格子預覽位置（那格是機頭），再點同一格放下。點已放好的飛機可以拿起來。'
      : '游標所在的格子就是機頭位置，點一下放下。按 R 或右鍵轉向，點已放好的飛機可以拿起來。';
  const apartHint = n > 1 ? (NO_DIAGONAL_TOUCH ? ` ${noun}之間要完全分開，斜角也不能碰到。` : ` ${noun}之間要分開。`) : '';

  return (
    <section className="placement">
      <header className="room-head">
        <div>
          <h1 className="room-title">{isShip ? '佈置你的艦隊' : '藏好你的飛機'}</h1>
          <p className="room-sub">
            <span>第 {game.round} 局</span>
            <span>{roomLabel}</span>
          </p>
        </div>
        <ConfirmButton label="離開房間" confirmLabel="確定離開？對手會直接獲勝" onConfirm={onLeave} />
      </header>

      <div className="placement-grid">
        <div className="placement-board">
          <Board
            size={size}
            label={`我方${isShip ? '海域' : '空域'}：擺放${noun}`}
            interactive={!ready}
            cursor={cursor}
            onCursorChange={setCursor}
            onHover={setHover}
            onActivate={onActivate}
            describeCell={(c) => (occ.has(cellKey(c.x, c.y)) ? `有${noun}，按 Enter 拿起` : `按 Enter 放下${noun}`)}
          >
            {draft.map((p, i) =>
              p ? <PieceShape key={`${i}-${p.x}-${p.y}-${p.dir}`} mode={mode} plane={p} shape={shapes[i]} /> : null,
            )}
            {preview && <PieceShape mode={mode} plane={preview.plane} shape={preview.shape} variant={previewOk ? 'ghost' : 'invalid'} />}
          </Board>
        </div>

        <aside className="placement-side">
          <p className="count">
            已擺 <strong>{placedCount}</strong> / {n} {unit}
          </p>

          {!ready ? (
            <>
              {isShip ? (
                <>
                  <ul className="ship-picker" aria-label="選擇要擺的船">
                    {shapes.map((s, i) => {
                      const placed = !!draft[i];
                      const state = placed ? 'placed' : i === active ? 'active' : 'normal';
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            className={`ship-pick ship-pick--${state}`}
                            aria-pressed={i === active}
                            onClick={() => (placed ? pickUp(i) : setSelected(i))}
                          >
                            <ShipIcon len={s.cells.length} state={state} />
                            <span>{s.name}</span>
                            <span className="muted">{placed ? '已擺（點一下拿起）' : `${s.cells.length} 格`}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="dir-row">
                    <button type="button" className="btn btn--outline" onClick={rotate}>
                      {isHorizontal(dir) ? '改成直的' : '改成橫的'}
                    </button>
                    <span className="dir-now">目前：{isHorizontal(dir) ? '橫放' : '直放'}</span>
                  </div>
                </>
              ) : (
                <div className="dir-row">
                  <ShapePreview shape={shapes[0]} dir={dir} className="shape-preview--md" label={`目前方向：${DIR_TEXT[dir]}`} />
                  <div className="dir-text">
                    <button type="button" className="btn btn--outline" onClick={rotate}>
                      轉向
                    </button>
                    <span className="dir-now">{DIR_TEXT[dir]}</span>
                  </div>
                </div>
              )}
              <p className="hint">
                {hint}
                {apartHint}
              </p>
              <div className="btn-row">
                <button type="button" className="btn btn--quiet" onClick={shuffle}>
                  {full ? '重新隨機' : '隨機擺放'}
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => {
                    setSelected(null);
                    update(Array<Plane | null>(n).fill(null));
                  }}
                  disabled={!placedCount}
                >
                  全部清除
                </button>
              </div>
              <button type="button" className="btn btn--wide" disabled={!full || busy} onClick={submit}>
                {busy ? '送出中…' : full ? '擺好了，準備開戰' : `還差 ${n - placedCount} ${unit}`}
              </button>
            </>
          ) : (
            <>
              <p className="ready-note">你已經擺好了。{oppInfo?.ready ? '馬上開始！' : '等對手擺完就會自動開始。'}</p>
              <PokeButton game={game} uid={uid} act={act} inline />
              <button type="button" className="btn btn--outline" disabled={busy} onClick={cancelReady}>
                我要改位置
              </button>
            </>
          )}

          <p className={`opp-status${oppInfo?.ready ? ' is-ready' : ''}`}>{oppStatus}</p>
        </aside>
      </div>
    </section>
  );
}
