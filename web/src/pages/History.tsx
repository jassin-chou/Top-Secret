/**
 * 對戰紀錄與帳號：#/history
 * 訪客也看得到這個分頁的紀錄；用 Google 登入後會永久保存、換裝置也看得到。
 */
import { useEffect, useMemo, useState } from 'react';
import { BOT_LEVEL_NAME, type GameMode, type HistoryEntry } from '@planehunt/shared';
import type { Account, Backend } from '../net/backend';
import { Avatar, GoogleButton } from '../components/Account';
import { shortName } from '../components/TurnBanner';
import { useToast } from '../components/Toasts';
import { MODE_NAME } from './Lobby';

interface Props {
  backend: Backend;
  account: Account | null;
  onSignIn(): Promise<Account | null>;
  onSignOut(): Promise<void>;
  navigate(path: string): void;
}

type Filter = 'all' | GameMode;
const FILTERS: Filter[] = ['all', 'plane', 'ship', 'ab'];

function when(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `今天 ${time}`;
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? `${date} ${time}` : `${d.getFullYear()}/${date}`;
}

function statsText(e: HistoryEntry) {
  if (e.mode === 'ab') return `猜了 ${e.moves} 次`;
  return `開了 ${e.moves} 砲，打中 ${e.hits ?? 0} 砲`;
}

function forfeitText(e: HistoryEntry) {
  if (e.endReason !== 'forfeit') return null;
  return e.result === 'win' ? '對手中途離開' : '你中途離開';
}

function Tally({ entries }: { entries: HistoryEntry[] }) {
  const wins = entries.filter((e) => e.result === 'win').length;
  const rate = entries.length ? Math.round((wins / entries.length) * 100) : 0;
  return (
    <dl className="tally-board">
      <div>
        <dt>場數</dt>
        <dd>{entries.length}</dd>
      </div>
      <div>
        <dt>贏</dt>
        <dd className="is-win">{wins}</dd>
      </div>
      <div>
        <dt>輸</dt>
        <dd>{entries.length - wins}</dd>
      </div>
      <div>
        <dt>勝率</dt>
        <dd>
          {rate}
          <small>%</small>
        </dd>
      </div>
    </dl>
  );
}

export function HistoryPage({ backend, account, onSignIn, onSignOut, navigate }: Props) {
  const toast = useToast();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [signingOut, setSigningOut] = useState(false);
  const uid = account?.uid;

  const load = async () => {
    setError(null);
    try {
      const res = await backend.call<{ entries: HistoryEntry[] }>('history');
      setEntries(res.entries);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    setEntries(null);
    void load();
    // 換帳號時重新讀取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const shown = useMemo(
    () => (entries ?? []).filter((e) => filter === 'all' || e.mode === filter),
    [entries, filter],
  );

  const signOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
      toast('已登出，現在是訪客身分', 'info');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSigningOut(false);
    }
  };

  const guest = !account || account.guest;

  return (
    <section className="history">
      <header className="history-head">
        <h1 className="room-title">對戰紀錄</h1>
      </header>

      {guest ? (
        <div className="account-card account-card--guest">
          <div>
            <h2>你現在是訪客</h2>
            <p>
              訪客的紀錄只留在這個分頁，關掉就不見了。用 Google 登入後會永久保存，換手機或電腦登入也看得到；這個分頁已經打完的局也會一起保留。
            </p>
          </div>
          <GoogleButton onSignIn={onSignIn} />
        </div>
      ) : (
        <div className="account-card">
          <Avatar account={account!} size={52} />
          <div className="account-who">
            <strong>{account!.name ?? 'Google 帳號'}</strong>
            {account!.email && <span className="muted">{account!.email}</span>}
          </div>
          <button type="button" className="btn btn--quiet" disabled={signingOut} onClick={signOut}>
            {signingOut ? '登出中…' : '登出'}
          </button>
        </div>
      )}
      {backend.mode === 'local' && (
        <p className="hint">本機測試模式沒有真的 Google，按登入會用一個模擬的「測試帳號」。登入後每個分頁都是同一個人。</p>
      )}

      {error ? (
        <div className="history-empty">
          <p>{error}</p>
          <button type="button" className="btn btn--outline" onClick={load}>
            再試一次
          </button>
        </div>
      ) : !entries ? (
        <p className="loading">讀取紀錄中…</p>
      ) : entries.length === 0 ? (
        <div className="history-empty">
          <p>還沒有紀錄。打完一局就會記在這裡，跟電腦練習也算。</p>
          <button type="button" className="btn" onClick={() => navigate('/')}>
            去開一局
          </button>
        </div>
      ) : (
        <>
          <div className="history-filters" role="group" aria-label="依玩法篩選">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={`filter-chip${filter === f ? ' is-on' : ''}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? '全部' : MODE_NAME[f]}
              </button>
            ))}
          </div>

          <Tally entries={shown} />

          {shown.length === 0 ? (
            <p className="muted">這個玩法還沒有紀錄。</p>
          ) : (
            <ol className="history-list">
              {shown.map((e) => (
                <li key={e.id}>
                  <a href={`#/history/${e.id}`} className={`history-item history-item--${e.result}`}>
                    <span className="history-stamp" aria-label={e.result === 'win' ? '贏' : '輸'}>
                      {e.result === 'win' ? '勝' : '敗'}
                    </span>
                    <div className="history-main">
                      <p className="history-title">
                        <span className="history-mode">{MODE_NAME[e.mode]}</span>
                        <span>對 {e.vs === 'bot' ? shortName(e.oppName) : e.oppName}</span>
                        {e.vs === 'bot' && <span className="history-tag">練習{e.level ? `（${BOT_LEVEL_NAME[e.level]}）` : ''}</span>}
                      </p>
                      <p className="history-meta">
                        {e.summary}
                        {e.moves > 0 && `，${statsText(e)}`}
                        {forfeitText(e) && <span className="history-forfeit">{forfeitText(e)}</span>}
                      </p>
                    </div>
                    <time className="history-time" dateTime={new Date(e.finishedAt).toISOString()}>
                      {when(e.finishedAt)}
                    </time>
                    <span className="history-go" aria-hidden="true">
                      ›
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          )}
          {entries.length >= 100 && <p className="hint">只顯示最近 100 局。</p>}
        </>
      )}
    </section>
  );
}
