/**
 * 排行榜與獎牌：#/leaderboard
 * - 只計算跟真人的對戰；用 Google 登入、打滿 MIN_RANKED_GAMES 場才會上榜
 * - 名字是 Gmail 的 @ 前面那段，後面接著拿到的獎牌（越稀有越前面）
 */
import { useEffect, useMemo, useState } from 'react';
import { MEDALS, MIN_RANKED_GAMES, medalById, TIER_NAME, type BoardScope, type MedalId } from '@planehunt/shared';
import type { Account, Backend } from '../net/backend';
import { GoogleButton } from '../components/Account';
import { Medal } from '../components/Medal';
import { useToast } from '../components/Toasts';
import type { LeaderRowView, MyStats } from '../lib/api';
import { MODE_NAME } from './Lobby';

interface Props {
  backend: Backend;
  account: Account | null;
  onSignIn(): Promise<Account | null>;
}

interface Data {
  boards: Record<BoardScope, LeaderRowView[]>;
  me: MyStats;
}

const SCOPES: BoardScope[] = ['all', 'plane', 'ship', 'ab'];
const SHOW_MEDALS = 5;

function MedalStrip({ ids }: { ids: MedalId[] }) {
  const toast = useToast();
  if (!ids.length) return null;
  const shown = ids.slice(0, SHOW_MEDALS);
  return (
    <span className="lb-medals">
      {shown.map((id) => {
        const m = medalById(id)!;
        return (
          <button key={id} type="button" className="medal-btn" onClick={() => toast(`${m.name}（${TIER_NAME[m.tier]}）：${m.desc}`, 'info')}>
            <Medal id={id} size={24} />
          </button>
        );
      })}
      {ids.length > SHOW_MEDALS && <span className="lb-more">+{ids.length - SHOW_MEDALS}</span>}
    </span>
  );
}

function when(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function LeaderboardPage({ backend, account, onSignIn }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<BoardScope>('all');

  const load = async () => {
    setError(null);
    try {
      setData(await backend.call<Data>('leaderboard'));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    setData(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.uid, account?.guest]);

  const rows = data?.boards[scope] ?? [];
  const me = data?.me;
  const myRank = data?.boards.all.find((r) => r.me)?.rank;
  const earned = useMemo(() => new Set(Object.keys(me?.medals ?? {})), [me]);
  const guest = !account || account.guest;

  return (
    <section className="leaderboard">
      <header className="history-head">
        <h1 className="room-title">排行榜</h1>
        <p className="hint">只算跟真人的對戰，跟電腦練習不算。用 Google 登入、跟真人打滿 {MIN_RANKED_GAMES} 場就會上榜。</p>
      </header>

      {guest ? (
        <div className="account-card account-card--guest">
          <div>
            <h2>登入 Google 才會上榜</h2>
            <p>排行榜上的名字會用你 Gmail 的 @ 前面那段。訪客打的局，登入後也會一起算進去。</p>
          </div>
          <GoogleButton onSignIn={onSignIn} />
        </div>
      ) : (
        me && (
          <div className="lb-me">
            <p>
              你在排行榜上叫 <strong>{me.name ?? '（讀取中）'}</strong>
            </p>
            <p className="lb-me-record">
              跟真人 {me.games} 場、贏 {me.wins} 場
              {me.games > 0 && `，勝率 ${Math.round((me.wins / me.games) * 100)}%`}
              {me.games >= MIN_RANKED_GAMES
                ? myRank
                  ? `，目前第 ${myRank} 名`
                  : ''
                : `。再打 ${MIN_RANKED_GAMES - me.games} 場就會上榜`}
            </p>
          </div>
        )
      )}

      <div className="history-filters" role="group" aria-label="依玩法看排行">
        {SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            className={`filter-chip${scope === s ? ' is-on' : ''}`}
            aria-pressed={scope === s}
            onClick={() => setScope(s)}
          >
            {s === 'all' ? '全部' : MODE_NAME[s]}
          </button>
        ))}
      </div>

      {error ? (
        <div className="history-empty">
          <p>{error}</p>
          <button type="button" className="btn btn--outline" onClick={load}>
            再試一次
          </button>
        </div>
      ) : !data ? (
        <p className="loading">讀取排行榜中…</p>
      ) : rows.length === 0 ? (
        <p className="history-empty">
          {scope === 'all' ? '還沒有人上榜。' : `${MODE_NAME[scope]}還沒有人上榜。`}找朋友打滿 {MIN_RANKED_GAMES} 場，你就是第一名！
        </p>
      ) : (
        <ol className="lb-list">
          {rows.map((r) => (
            <li key={`${r.rank}-${r.name}`} className={`lb-row${r.me ? ' is-me' : ''}`}>
              <span className={`lb-rank${r.rank <= 3 ? ` lb-rank--${r.rank}` : ''}`} aria-label={`第 ${r.rank} 名`}>
                {r.rank}
              </span>
              <span className="lb-who">
                <span className="lb-name">
                  {r.name}
                  {r.me && <span className="lb-you">你</span>}
                </span>
                <MedalStrip ids={r.medals} />
              </span>
              <span className="lb-record">
                {r.wins} 勝 {r.games - r.wins} 敗
              </span>
              <span className="lb-rate">
                {r.rate}
                <small>%</small>
              </span>
            </li>
          ))}
        </ol>
      )}

      <section className="medal-book" aria-labelledby="medal-book-title">
        <header className="medal-book-head">
          <h2 id="medal-book-title">獎牌</h2>
          <span className="muted">
            已獲得 {earned.size} / {MEDALS.length}
          </span>
        </header>
        <ul className="medal-grid">
          {MEDALS.map((m) => {
            const got = me?.medals[m.id];
            return (
              <li key={m.id} className={`medal-card medal-card--t${m.tier}${got ? ' is-earned' : ''}`}>
                <Medal id={m.id} size={56} locked={!got} label={false} />
                <span className="medal-card-name">{m.name}</span>
                <span className="medal-card-tier">{TIER_NAME[m.tier]}</span>
                <span className="medal-card-desc">{m.desc}</span>
                {got && <span className="medal-card-date">{when(got.at)} 獲得</span>}
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
