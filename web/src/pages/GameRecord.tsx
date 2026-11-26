/**
 * 一局的詳細紀錄：#/history/<紀錄編號>
 * - 飛機版、海戰棋：雙方棋盤 + 一步一步重播（可以拖、可以自動播放），點戰況紀錄跳到那一步
 * - 幾A幾B：雙方的密碼與每一次猜測
 * 加入這個功能之前打的局沒有逐步紀錄，只顯示摘要。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  BOT_LEVEL_NAME,
  coordLabel,
  isBoardSettings,
  pieceShapes,
  type BoardSettings,
  type GameDetail,
  type HistoryEntry,
  type Shot,
} from '@planehunt/shared';
import type { Backend } from '../net/backend';
import { Board } from '../components/Board';
import { PieceShape, ShotMark } from '../components/marks';
import { Legend } from '../components/Legend';
import { shortName } from '../components/TurnBanner';
import { MODE_NAME } from './Lobby';
import { resultText } from './Battle';
import { GuessTable } from './CodeGame';

interface Props {
  backend: Backend;
  id: string;
  navigate(path: string): void;
}

function fullTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function GameRecordPage({ backend, id, navigate }: Props) {
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    setEntry(null);
    setError(null);
    backend
      .call<{ entry: HistoryEntry }>('historyEntry', { id })
      .then((r) => !stop && setEntry(r.entry))
      .catch((e) => !stop && setError((e as Error).message));
    return () => {
      stop = true;
    };
  }, [backend, id]);

  const back = (
    <button type="button" className="btn btn--quiet btn--small step-back" onClick={() => navigate('/history')}>
      返回對戰紀錄
    </button>
  );

  if (error) {
    return (
      <section className="record">
        {back}
        <div className="history-empty">
          <p>{error}</p>
        </div>
      </section>
    );
  }
  if (!entry) {
    return (
      <section className="record">
        {back}
        <p className="loading">讀取這局的紀錄中…</p>
      </section>
    );
  }

  const opp = entry.vs === 'bot' ? shortName(entry.oppName) : entry.oppName;
  const won = entry.result === 'win';
  const d = entry.detail;

  return (
    <section className="record">
      {back}
      <header className={`record-head history-item--${entry.result}`}>
        <span className="history-stamp record-stamp" aria-label={won ? '贏' : '輸'}>
          {won ? '勝' : '敗'}
        </span>
        <div>
          <h1 className="room-title">
            {MODE_NAME[entry.mode]}　對 {opp}
          </h1>
          <p className="history-meta">
            {fullTime(entry.finishedAt)}・{entry.summary}
            {entry.vs === 'bot' && `・跟電腦練習${entry.level ? `（${BOT_LEVEL_NAME[entry.level]}）` : ''}`}
            {entry.endReason === 'forfeit' && (
              <span className="history-forfeit">{won ? '對手中途離開' : '你中途離開'}</span>
            )}
          </p>
        </div>
      </header>

      {!d ? (
        <p className="record-missing">這局是在「詳細紀錄」功能上線之前打的，只留下勝負和摘要，沒有逐步紀錄。</p>
      ) : isBoardSettings(d.settings) ? (
        <BoardReplay detail={d} settings={d.settings} myName={entry.myName || '你'} oppName={opp} />
      ) : (
        <AbRecord detail={d} oppName={opp} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

type Step = Shot & { by: 'me' | 'opp' };

function BoardReplay({
  detail,
  settings,
  myName,
  oppName,
}: {
  detail: GameDetail;
  settings: BoardSettings;
  myName: string;
  oppName: string;
}) {
  const mode = settings.mode;
  const shapes = pieceShapes(settings);
  const area = mode === 'ship' ? '海域' : '空域';

  const steps: Step[] = useMemo(
    () =>
      [
        ...(detail.me.shots ?? []).map((s) => ({ ...s, by: 'me' as const })),
        ...(detail.opp.shots ?? []).map((s) => ({ ...s, by: 'opp' as const })),
      ].sort((a, b) => a.n - b.n),
    [detail],
  );
  const total = steps.length;
  const [step, setStep] = useState(total);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 700);
    return () => clearTimeout(t);
  }, [playing, step, total]);

  const shown = steps.slice(0, step);
  const current = step > 0 ? steps[step - 1] : null;
  const myShots = shown.filter((s) => s.by === 'me');
  const oppShots = shown.filter((s) => s.by === 'opp');
  // 海戰棋：到這一步為止被擊沉的船
  const sunkBy = (shots: Step[]) => new Set(shots.filter((s) => s.r === 'sunk' && s.k !== undefined).map((s) => s.k!));
  const oppSunk = sunkBy(myShots);
  const mySunk = sunkBy(oppShots);

  const go = (n: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(total, n)));
  };
  const play = () => {
    if (step >= total) setStep(0);
    setPlaying((p) => !p);
  };

  const caption = current
    ? `${current.by === 'me' ? '你' : oppName}打 ${coordLabel(current.x, current.y)}：${resultText(current, settings, current.by === 'opp')}`
    : total
      ? '開局：雙方都藏好了，還沒有人開火'
      : '這局還沒有人開火就結束了';

  return (
    <div className="replay">
      {total > 0 && (
        <div className="replay-controls">
          <div className="replay-buttons">
            <button type="button" className="btn btn--outline btn--small" onClick={() => go(0)} disabled={step === 0} aria-label="回到開局">
              ⏮
            </button>
            <button type="button" className="btn btn--outline btn--small" onClick={() => go(step - 1)} disabled={step === 0} aria-label="上一步">
              ◀
            </button>
            <button type="button" className="btn btn--small replay-play" onClick={play}>
              {playing ? '暫停' : step >= total ? '從頭播放' : '播放'}
            </button>
            <button type="button" className="btn btn--outline btn--small" onClick={() => go(step + 1)} disabled={step === total} aria-label="下一步">
              ▶
            </button>
            <button type="button" className="btn btn--outline btn--small" onClick={() => go(total)} disabled={step === total} aria-label="跳到最後">
              ⏭
            </button>
          </div>
          <label className="replay-slider">
            <span className="replay-count">
              第 <b>{step}</b> / {total} 步
            </span>
            <input type="range" min={0} max={total} value={step} onChange={(e) => go(Number(e.target.value))} aria-label="拖曳到第幾步" />
          </label>
        </div>
      )}
      <p className={`replay-caption${current ? ` replay-caption--${current.r}` : ''}`} aria-live="polite">
        {caption}
      </p>

      <div className="replay-boards">
        <figure className="replay-board">
          <figcaption>
            {oppName}的{area}
            <span className="muted">你打的 {myShots.length} 砲</span>
          </figcaption>
          <Board size={settings.size} label={`${oppName}的${area}`}>
            {(detail.opp.pieces ?? []).map((p, i) => (
              <PieceShape key={i} mode={mode} plane={p} shape={shapes[i]} variant={oppSunk.has(i) ? 'sunk' : 'reveal'} />
            ))}
            {myShots.map((s) => (
              <ShotMark key={s.n} shot={s} fresh={s.n === current?.n} />
            ))}
          </Board>
        </figure>
        <figure className="replay-board">
          <figcaption>
            {myName === '你' ? '你' : `你（${myName}）`}的{area}
            <span className="muted">
              {oppName}打的 {oppShots.length} 砲
            </span>
          </figcaption>
          <Board size={settings.size} label={`你的${area}`}>
            {(detail.me.pieces ?? []).map((p, i) => (
              <PieceShape key={i} mode={mode} plane={p} shape={shapes[i]} variant={mySunk.has(i) ? 'sunk' : 'mine'} />
            ))}
            {oppShots.map((s) => (
              <ShotMark key={s.n} shot={s} fresh={s.n === current?.n} />
            ))}
          </Board>
        </figure>
      </div>
      <p className="hint">
        紅色虛線是{oppName}藏{mode === 'ship' ? '船' : '飛機'}的位置；藍色是你的。{detail.meFirst ? '這局你先攻。' : `這局${oppName}先攻。`}
      </p>

      {total > 0 && (
        <div className="log replay-log">
          <h3>戰況紀錄（點一下跳到那一步）</h3>
          <ol>
            {steps.map((s, i) => (
              <li key={s.n}>
                <button
                  type="button"
                  className={`log-item log-item--${s.r}${i + 1 === step ? ' is-current' : ''}`}
                  aria-current={i + 1 === step ? 'step' : undefined}
                  onClick={() => go(i + 1)}
                >
                  <span className="log-no">{i + 1}</span>
                  <span className="log-who">{s.by === 'me' ? '你' : oppName}</span>
                  <span className="log-at">{coordLabel(s.x, s.y)}</span>
                  <span className="log-res">{resultText(s, settings, s.by === 'opp')}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      <Legend mode={mode} showPencil={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function AbRecord({ detail, oppName }: { detail: GameDetail; oppName: string }) {
  const mine = detail.me.guesses ?? [];
  const theirs = detail.opp.guesses ?? [];
  return (
    <div className="ab-record">
      <dl className="ab-codes">
        <div>
          <dt>你的密碼</dt>
          <dd className="guess-code">{detail.me.code ?? '（還沒設定）'}</dd>
        </div>
        <div>
          <dt>{oppName}的密碼</dt>
          <dd className="guess-code">{detail.opp.code ?? '（還沒設定）'}</dd>
        </div>
      </dl>
      <p className="hint">{detail.meFirst ? '這局你先猜。' : `這局${oppName}先猜。`}</p>
      <div className="ab-record-tables">
        <GuessTable guesses={mine} label={`你猜${oppName}的密碼`} empty="你還沒猜就結束了。" />
        <GuessTable guesses={theirs} label={`${oppName}猜你的密碼`} empty={`${oppName}還沒猜就結束了。`} />
      </div>
    </div>
  );
}
