/**
 * 幾A幾B 的兩個畫面：
 *   CodeSetup   設定自己的密碼（對應飛機版的擺放階段）
 *   CodeBattle  輪流猜對方的密碼
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { checkCode, opponentOf, randomCode, type AbSettings, type GameDoc, type Guess, type PrivateDoc } from '@planehunt/shared';
import { ConfirmButton } from '../components/ConfirmButton';
import { useToast } from '../components/Toasts';
import { useSessionState } from '../lib/util';
import { TurnBanner, shortName, type TurnEvent, type TurnKind } from '../components/TurnBanner';
import { RematchActions, ResultModal, useResultModal } from '../components/ResultModal';
import { PokeButton } from '../components/Chat';
import type { Act } from './Room';

interface Props {
  game: GameDoc;
  me: PrivateDoc | null;
  uid: string;
  act: Act;
  onLeave(): void;
  roomLabel: string;
}

/** 一格一格的數字（密碼、揭曉） */
export function CodeTiles({ code, digits, hidden = false }: { code: string | null; digits: number; hidden?: boolean }) {
  const chars = Array.from({ length: digits }, (_, i) => (hidden ? '' : (code?.[i] ?? '')));
  return (
    <span className="code-tiles" aria-label={hidden || !code ? '密碼' : `密碼 ${code.split('').join(' ')}`}>
      {chars.map((c, i) => (
        <span key={i} className={`code-tile${c ? '' : ' is-empty'}`} aria-hidden="true">
          {c || (hidden ? '?' : '')}
        </span>
      ))}
    </span>
  );
}

const abText = (g: Pick<Guess, 'a' | 'b'>) => `${g.a}A${g.b}B`;

function ruleText(s: AbSettings) {
  return `${s.digits} 位數字，${s.repeat ? '數字可以重複' : '每個數字都不一樣'}，0 也可以放第一位`;
}

function onlyDigits(v: string, max: number) {
  return v.replace(/\D/g, '').slice(0, max);
}

// ---------------------------------------------------------------------------

export function CodeSetup({ game, me, uid, act, onLeave, roomLabel }: Props) {
  const settings = game.settings as AbSettings; // Room 只會在幾A幾B 時用這個畫面
  const { digits } = settings;
  const ready = game.players[uid].ready;
  const opp = opponentOf(game, uid);
  const oppInfo = opp ? game.players[opp] : null;
  const [code, setCode] = useState(me?.secret ?? '');
  const touched = useRef(false);
  const [busy, setBusy] = useState(false);

  // Firebase 模式下私密文件可能晚一點才到；上一局的密碼會被帶進來當預設
  useEffect(() => {
    if (!touched.current && me?.secret) setCode(me.secret);
  }, [me]);

  const [valid, err] = checkCode(code, settings);
  const showErr = code.length === digits && !valid;

  const update = (v: string) => {
    touched.current = true;
    setCode(onlyDigits(v, digits));
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    setBusy(true);
    await act('secret', { secret: valid });
    setBusy(false);
  };

  const cancelReady = async () => {
    setBusy(true);
    await act('unready');
    setBusy(false);
  };

  const oppStatus = !oppInfo ? '等待對手' : oppInfo.ready ? `${oppInfo.name}已經設好密碼了` : `${oppInfo.name}還在想密碼`;

  return (
    <section className="placement code-setup">
      <header className="room-head">
        <div>
          <h1 className="room-title">設定你的密碼</h1>
          <p className="room-sub">
            <span>第 {game.round} 局</span>
            <span>{roomLabel}</span>
          </p>
        </div>
        <ConfirmButton label="離開房間" confirmLabel="確定離開？對手會直接獲勝" onConfirm={onLeave} />
      </header>

      {!ready ? (
        <form className="code-form" onSubmit={submit}>
          <p className="hint">請輸入 {ruleText(settings)}。對手會來猜這組數字。</p>
          <input
            className="code-field"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={digits}
            value={code}
            placeholder={'0'.repeat(digits)}
            aria-label={`你的密碼（${digits} 位數）`}
            autoFocus
            onChange={(e) => update(e.target.value)}
          />
          <p className={`code-error${showErr ? '' : ' is-hidden'}`} role="status">
            {showErr ? err : ' '}
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn--quiet" onClick={() => update(randomCode(settings))}>
              隨機產生
            </button>
          </div>
          <button type="submit" className="btn btn--wide code-submit" disabled={!valid || busy}>
            {busy ? '送出中…' : code.length < digits ? `還差 ${digits - code.length} 位` : '就用這組密碼'}
          </button>
        </form>
      ) : (
        <div className="code-form">
          <p className="hint">你的密碼</p>
          <CodeTiles code={me?.secret ?? code} digits={digits} />
          <p className="ready-note">{oppInfo?.ready ? '馬上開始！' : '等對手設好密碼就會自動開始。'}</p>
          <PokeButton game={game} uid={uid} act={act} inline />
          <button type="button" className="btn btn--outline" disabled={busy} onClick={cancelReady}>
            我要改密碼
          </button>
        </div>
      )}

      <p className={`opp-status${oppInfo?.ready ? ' is-ready' : ''}`}>{oppStatus}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------

type Note = 'no' | 'yes';
const NOTE_NEXT: Record<string, Note | undefined> = { none: 'no', no: 'yes', yes: undefined };
const NOTE_LABEL: Record<string, string> = { none: '', no: '確定沒有', yes: '確定有' };

function GuessTable({ guesses, label, empty, highlight }: { guesses: Guess[]; label: string; empty: string; highlight?: number }) {
  return (
    <div className="guess-table">
      <h3>{label}</h3>
      {guesses.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ol>
          {guesses.map((g, i) => (
            <li key={g.n} className={g.n === highlight ? 'is-fresh' : ''}>
              <span className="guess-no">{i + 1}</span>
              <span className="guess-code">{g.g}</span>
              <span className={`guess-ab${g.a === 0 && g.b === 0 ? ' is-zero' : ''}`}>
                <b>{g.a}</b>A<b>{g.b}</b>B
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function CodeBattle({ game, me, uid, act, onLeave, roomLabel }: Props) {
  const toast = useToast();
  const settings = game.settings as AbSettings;
  const { digits } = settings;
  const opp = opponentOf(game, uid)!;
  const oppName = game.players[opp]?.name ?? '對手';
  const myName = game.players[uid]?.name ?? '你';
  const playing = game.status === 'playing';
  const finished = game.status === 'finished';
  const myTurn = playing && game.turn === uid;

  const myGuesses = game.guesses?.[uid] ?? [];
  const oppGuesses = game.guesses?.[opp] ?? [];
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // 數字筆記：只存在自己的分頁
  const [notes, setNotes] = useSessionState<Record<string, Note>>(`planehunt.notes.${game.id}.${game.round}`, {});

  const [valid, err] = checkCode(input, settings);
  const repeated = !!valid && myGuesses.some((g) => g.g === valid);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!myTurn || busy) return;
    if (!valid) return toast(err ?? '請輸入數字');
    if (repeated) return toast('這個數字已經猜過了', 'info');
    setBusy(true);
    const ok = await act('guess', { guess: valid });
    setBusy(false);
    if (ok) setInput('');
  };

  const cycleNote = (d: string) => {
    const cur = notes[d] ?? 'none';
    const next = NOTE_NEXT[cur];
    const copy = { ...notes };
    if (next) copy[d] = next;
    else delete copy[d];
    setNotes(copy);
  };

  // ---- 回合色帶 ----
  const oppShort = shortName(oppName);
  const oppCode = game.codes?.[opp] ?? null;
  const won = finished && game.winner === uid;
  let kind: TurnKind;
  let status: string;
  if (finished) {
    kind = won ? 'win' : 'lose';
    status = won ? '你贏了！' : '這局輸了';
  } else if (myTurn) {
    kind = 'mine';
    status = '輪到你猜';
  } else {
    kind = 'theirs';
    status = `${oppShort}想一想…`;
  }
  const lg = game.lastGuess;
  let detail = '';
  let event: TurnEvent = null;
  if (lg) {
    const byMe = lg.by === uid;
    detail = `${byMe ? '你' : oppShort}猜 ${lg.g}：${abText(lg)}`;
    // 只差一個數字就猜中，也算大事
    if (lg.a >= digits - 1) event = byMe ? 'good' : 'bad';
  } else if (playing) {
    detail = `這局${game.turn === uid ? '你' : oppShort}先猜`;
  }

  // ---- 勝負彈窗 ----
  const result = useResultModal(game);
  let reason = '';
  if (finished) {
    if (game.endReason === 'forfeit') reason = won ? `${oppName}離開了，這局算你贏。` : '你離開了這局。';
    else reason = won ? `你猜了 ${myGuesses.length} 次，猜中${oppName}的密碼。` : `${oppName}猜了 ${oppGuesses.length} 次，先猜中你的密碼。`;
  }

  return (
    <section className="battle code-battle">
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
        eventKey={lg?.n}
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
        closeLabel="看紀錄"
        open={result.open}
        onClose={result.close}
      >
        {oppCode && (
          <div className="result-code">
            <span className="muted">{oppName}的密碼是</span>
            <CodeTiles code={oppCode} digits={digits} />
          </div>
        )}
      </ResultModal>

      <div className="code-grid">
        <div className="code-main">
          <h2>猜{oppName}的密碼</h2>
          <p className="hint">{ruleText(settings)}。</p>
          {finished && oppCode ? (
            <div className="code-reveal">
              <span className="muted">{oppName}的密碼是</span>
              <CodeTiles code={oppCode} digits={digits} />
            </div>
          ) : (
            <form className="guess-form" onSubmit={submit}>
              <input
                className="code-field code-field--guess"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={digits}
                value={input}
                placeholder={'0'.repeat(digits)}
                disabled={!myTurn}
                aria-label={`猜一組 ${digits} 位數`}
                onChange={(e) => setInput(onlyDigits(e.target.value, digits))}
              />
              <button type="submit" className="btn btn--big" disabled={!myTurn || !valid || repeated || busy}>
                {busy ? '…' : '猜'}
              </button>
            </form>
          )}
          <p className={`code-error${input.length === digits && (!valid || repeated) ? '' : ' is-hidden'}`}>
            {repeated ? '這個數字已經猜過了' : input.length === digits && !valid ? err : ' '}
          </p>

          <GuessTable guesses={myGuesses} label="你猜過的" empty="還沒猜過，先隨便猜一組試試看。" highlight={lg?.by === uid ? lg.n : undefined} />

          <div className="digit-notes">
            <h3>數字筆記</h3>
            <p className="hint">點數字做記號：點一下是「確定沒有」，再點一下是「確定有」，第三下取消。只有你看得到。</p>
            <div className="digit-row">
              {'0123456789'.split('').map((d) => {
                const state = notes[d] ?? 'none';
                return (
                  <button
                    key={d}
                    type="button"
                    className={`digit-note digit-note--${state}`}
                    aria-label={`數字 ${d}${NOTE_LABEL[state] ? `：${NOTE_LABEL[state]}` : ''}`}
                    onClick={() => cycleNote(d)}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="code-side">
          <h2>我的密碼</h2>
          <CodeTiles code={me?.secret ?? null} digits={digits} />
          <GuessTable
            guesses={oppGuesses}
            label={`${oppName}猜你的紀錄`}
            empty="對手還沒猜過。"
            highlight={lg?.by === opp ? lg.n : undefined}
          />
        </aside>
      </div>
    </section>
  );
}
