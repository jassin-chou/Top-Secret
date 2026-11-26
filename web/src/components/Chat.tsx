/**
 * 對戰中的聊天：
 *   - 右下角的聊天按鈕：快捷句、自己打字、聊天紀錄
 *   - 對方說話時，畫面上方跳出對話泡泡；被「戳」的時候畫面會晃一下、手機會震動
 *   - 「太慢了！」按鈕（PokeButton）：輪到對方、或在等對方時才能按
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CHAT_MAX_LEN,
  POKE_GAP_MS,
  POKE_LINE,
  QUICK_LINES,
  opponentOf,
  quickLineText,
  type ChatMessage,
  type GameDoc,
} from '@planehunt/shared';
import type { Act } from '../pages/Room';
import { shortName } from './TurnBanner';

const MUTE_KEY = 'planehunt.chatMute';

/** 現在催對方合不合理：輪到對方、或我已經好了在等對方 */
export function canPoke(game: GameDoc, uid: string): boolean {
  const opp = opponentOf(game, uid);
  if (!opp || game.players[opp]?.left) return false;
  if (game.status === 'playing') return game.turn === opp;
  if (game.status === 'placing') return !!game.players[uid]?.ready && !game.players[opp]?.ready;
  if (game.status === 'finished') return game.rematch.includes(uid) && !game.rematch.includes(opp);
  return false;
}

function messageText(m: ChatMessage) {
  return m.line ? quickLineText(m.line) : (m.text ?? '');
}

function PokeIcon() {
  // 小鈴鐺：催一下
  return (
    <svg className="poke-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3.5a5 5 0 0 0-5 5v3c0 .9-.3 1.7-.9 2.3L5 15v1.5h14V15l-1.1-1.2a3.3 3.3 0 0 1-.9-2.3v-3a5 5 0 0 0-5-5z"
        fill="currentColor"
      />
      <path d="M10 18.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 「太慢了！」：戳對方一下（送出後幾秒內不能再按） */
export function PokeButton({ game, uid, act, inline = false }: { game: GameDoc; uid: string; act: Act; inline?: boolean }) {
  const [cooling, setCooling] = useState(false);
  if (!canPoke(game, uid)) return null;
  const opp = opponentOf(game, uid)!;
  const oppName = shortName(game.players[opp]?.name ?? '對手');
  return (
    <button
      type="button"
      // inline：放在色帶或等待區旁邊的那一顆；手機上改由畫面底部的聊天列提供
      className={`poke-btn${inline ? ' poke-btn--inline' : ''}`}
      disabled={cooling}
      aria-label={`戳${oppName}一下：${quickLineText(POKE_LINE)}`}
      onClick={async () => {
        setCooling(true);
        await act('say', { line: POKE_LINE });
        setTimeout(() => setCooling(false), POKE_GAP_MS);
      }}
    >
      <PokeIcon />
      <span>{cooling ? '催了！' : quickLineText(POKE_LINE)}</span>
    </button>
  );
}

interface Bubble {
  key: number;
  name: string;
  text: string;
  poke: boolean;
}

export function ChatWidget({ game, uid, act }: { game: GameDoc; uid: string; act: Act }) {
  const chat = game.chat ?? [];
  const lastN = chat[chat.length - 1]?.n ?? 0;
  const opp = opponentOf(game, uid);
  const oppName = shortName((opp && game.players[opp]?.name) || '對手');

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });
  // 進到這個畫面之前的訊息都算已讀、也不跳泡泡
  const [readN, setReadN] = useState(lastN);
  const seenN = useRef(lastN);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const logRef = useRef<HTMLOListElement>(null);

  const hidden = (m: ChatMessage) => muted && m.by !== uid && !!m.text;

  // 新訊息：對方的跳泡泡；被戳就晃一下、震動
  useEffect(() => {
    const fresh = chat.filter((m) => m.n > seenN.current);
    if (!fresh.length) return;
    seenN.current = lastN;
    for (const m of fresh) {
      if (m.by === uid || hidden(m)) continue;
      const poke = m.line === POKE_LINE;
      const bubble: Bubble = { key: m.n, name: oppName, text: messageText(m), poke };
      setBubbles((list) => [...list.slice(-2), bubble]);
      setTimeout(() => setBubbles((list) => list.filter((b) => b.key !== bubble.key)), 4500);
      if (poke) {
        const root = document.documentElement;
        root.classList.remove('is-poked');
        void root.offsetWidth; // 重新觸發動畫
        root.classList.add('is-poked');
        setTimeout(() => root.classList.remove('is-poked'), 700);
        navigator.vibrate?.([80, 60, 140]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastN]);

  // 打開聊天時全部算已讀，並捲到最新一則
  useEffect(() => {
    if (!open) return;
    setReadN(lastN);
    logRef.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [open, lastN]);

  // 有聊天按鈕時，提示訊息往上移，不要被按鈕擋住
  useEffect(() => {
    document.body.classList.add('has-chat');
    return () => document.body.classList.remove('has-chat');
  }, []);

  const unread = useMemo(
    () => (open ? 0 : chat.filter((m) => m.n > readN && m.by !== uid && !hidden(m)).length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, readN, open, uid, muted],
  );

  const pokeOk = canPoke(game, uid);
  // 底部聊天列顯示最新一則（被隱藏的字不顯示）
  const latest = [...chat].reverse().find((m) => !hidden(m));
  const dockPreview = open
    ? '收起聊天'
    : latest
      ? `${latest.by === uid ? '你' : oppName}：${messageText(latest)}`
      : `跟${oppName}聊天`;
  const send = async (body: { line?: string; text?: string }) => {
    setSending(true);
    const ok = await act('say', body);
    setSending(false);
    return ok;
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await send({ text })) setText('');
  };
  const toggleMute = (on: boolean) => {
    setMuted(on);
    try {
      localStorage.setItem(MUTE_KEY, on ? '1' : '0');
    } catch {
      // 不能存也沒關係
    }
  };

  return (
    <>
      <div className="chat-bubbles" role="status" aria-live="polite">
        {bubbles.map((b) => (
          <p key={b.key} className={`chat-bubble${b.poke ? ' chat-bubble--poke' : ''}`}>
            <span className="chat-bubble-who" aria-hidden="true">
              {b.name.charAt(0)}
            </span>
            <span>
              <span className="chat-bubble-name">{b.poke ? `${b.name}戳了你一下` : b.name}</span>
              {b.text}
            </span>
          </p>
        ))}
      </div>

      {open && (
        <section className="chat-panel" aria-label="聊天" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <header className="chat-head">
            <h2>跟{oppName}聊天</h2>
            <button type="button" className="chat-close" aria-label="關閉聊天" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>

          <ol className="chat-log" ref={logRef}>
            {chat.length === 0 && <li className="chat-empty">還沒有人說話。按下面的快捷句，或自己打字。</li>}
            {chat.map((m) => {
              const mine = m.by === uid;
              return (
                <li key={m.n} className={`chat-msg${mine ? ' chat-msg--mine' : ''}${m.line === POKE_LINE ? ' chat-msg--poke' : ''}`}>
                  {!mine && <span className="chat-msg-name">{oppName}</span>}
                  <span className="chat-msg-text">{hidden(m) ? '（已隱藏對方打的字）' : messageText(m)}</span>
                </li>
              );
            })}
          </ol>

          <div className="chat-quick" role="group" aria-label="快捷句">
            {QUICK_LINES.map((l) => {
              const poke = l.id === POKE_LINE;
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`chat-chip${poke ? ' chat-chip--poke' : ''}`}
                  disabled={sending || (poke && !pokeOk)}
                  title={poke && !pokeOk ? '輪到對方、或你在等對方時才能催' : undefined}
                  onClick={() => send({ line: l.id })}
                >
                  {l.text}
                </button>
              );
            })}
          </div>

          <form className="chat-form" onSubmit={submit}>
            <input
              aria-label="自己打字"
              placeholder="說點什麼…"
              value={text}
              maxLength={CHAT_MAX_LEN}
              autoComplete="off"
              enterKeyHint="send"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn btn--small" disabled={sending || !text.trim()}>
              送出
            </button>
          </form>
          <label className="chat-mute">
            <input type="checkbox" checked={muted} onChange={(e) => toggleMute(e.target.checked)} />
            隱藏對方打的字（快捷句還是看得到）
          </label>
        </section>
      )}

      <button
        type="button"
        className={`chat-fab${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={unread ? `聊天（${unread} 則新訊息）` : '聊天'}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z"
            fill="currentColor"
          />
        </svg>
        {unread > 0 && <span className="chat-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {/* 手機：畫面底部固定一條聊天列，不會蓋住棋盤或按鈕 */}
      <div className="chat-dock">
        <button
          type="button"
          className={`chat-dock-open${open ? ' is-open' : ''}`}
          aria-expanded={open}
          aria-label={unread ? `聊天（${unread} 則新訊息）` : '聊天'}
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z"
              fill="currentColor"
            />
          </svg>
          <span className="chat-dock-text">{dockPreview}</span>
          {unread > 0 && <span className="chat-badge chat-badge--dock">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <PokeButton game={game} uid={uid} act={act} />
      </div>
      <div className="chat-spacer" aria-hidden="true" />
    </>
  );
}
