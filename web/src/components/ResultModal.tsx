/**
 * 一局結束時跳出的勝負彈窗。
 * 每一局只自動跳一次；關掉之後，色帶下方有「看結果」可以再打開。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { medalById, opponentOf, sortMedals, TIER_NAME, type GameDoc, type MedalId } from '@planehunt/shared';
import { useSessionState } from '../lib/util';
import { useMainBackend, type MyStats } from '../lib/api';
import { PRACTICE_ME } from '../net/practiceBackend';
import type { Act } from '../pages/Room';
import { PokeButton } from './Chat';
import { Medal } from './Medal';

interface Props {
  game: GameDoc;
  uid: string;
  act: Act;
  onLeave(): void;
  /** 怎麼贏、怎麼輸的一句話 */
  reason: string;
  /** 額外內容：統計、對手的密碼… */
  children?: ReactNode;
  /** 關閉彈窗的按鈕文字（看棋盤／看紀錄） */
  closeLabel?: string;
}

/** 再來一局／回首頁（彈窗和色帶下方共用） */
export function RematchActions({
  game,
  uid,
  act,
  onLeave,
  extra,
}: Pick<Props, 'game' | 'uid' | 'act' | 'onLeave'> & { extra?: ReactNode }) {
  const opp = opponentOf(game, uid)!;
  const oppName = game.players[opp]?.name ?? '對手';
  const oppLeft = game.players[opp]?.left;
  const iVoted = game.rematch.includes(uid);
  const oppVoted = game.rematch.includes(opp);
  return (
    <div className="result-actions">
      {oppLeft ? (
        <span className="muted">{oppName}已經離開房間</span>
      ) : (
        <button type="button" className="btn" disabled={iVoted} onClick={() => act('rematch')}>
          {iVoted ? `等${oppName}同意…` : oppVoted ? `${oppName}想再來一局，接受` : '再來一局'}
        </button>
      )}
      <PokeButton game={game} uid={uid} act={act} />
      {extra}
      <button type="button" className="btn btn--quiet" onClick={onLeave}>
        回首頁
      </button>
    </div>
  );
}

/**
 * 這局結束後拿到的新獎牌。戰績是伺服器在一局結束時（練習模式是送出紀錄後）才算，
 * 所以這裡隔一下再問幾次，直到伺服器的 recent 裡出現這一局為止。
 */
function useNewMedals(game: GameDoc, uid: string, active: boolean): MedalId[] {
  const backend = useMainBackend();
  const [ids, setIds] = useState<MedalId[]>([]);
  const entryId = `${uid === PRACTICE_ME ? 'p-' : ''}${game.id}-${game.round}`;
  useEffect(() => {
    setIds([]);
    if (!active || !backend) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async (tries: number) => {
      try {
        const { stats } = await backend.call<{ stats: MyStats }>('stats');
        if (stop) return;
        if (stats.recent.includes(entryId)) {
          const got = (Object.keys(stats.medals) as MedalId[]).filter((id) => stats.medals[id]?.game === entryId);
          setIds(sortMedals(got));
          return;
        }
      } catch {
        /* 沒有戰績也沒關係，只是不顯示新獎牌 */
      }
      if (!stop && tries > 1) timer = setTimeout(() => check(tries - 1), 1200);
    };
    timer = setTimeout(() => check(5), 600);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [backend, entryId, active]);
  return ids;
}

function NewMedals({ ids }: { ids: MedalId[] }) {
  if (!ids.length) return null;
  return (
    <div className="new-medals" role="status">
      <p className="new-medals-title">新獎牌！</p>
      <ul>
        {ids.map((id) => {
          const m = medalById(id)!;
          return (
            <li key={id}>
              <Medal id={id} size={52} label={false} />
              <span className="new-medal-name">{m.name}</span>
              <span className="new-medal-desc">
                {TIER_NAME[m.tier]}・{m.desc}
              </span>
            </li>
          );
        })}
      </ul>
      <a href="#/leaderboard" className="new-medals-link">
        到排行榜看全部獎牌
      </a>
    </div>
  );
}

export function useResultModal(game: GameDoc) {
  const finished = game.status === 'finished';
  const [closed, setClosed] = useSessionState<boolean>(`planehunt.result.${game.id}.${game.round}`, false);
  return { open: finished && !closed, close: () => setClosed(true), reopen: () => setClosed(false) };
}

export function ResultModal({
  game,
  uid,
  act,
  onLeave,
  reason,
  children,
  closeLabel = '看棋盤',
  open,
  onClose,
}: Props & { open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const won = game.winner === uid;
  const opp = opponentOf(game, uid)!;
  const myName = game.players[uid]?.name ?? '你';
  const oppName = game.players[opp]?.name ?? '對手';
  const newMedals = useNewMedals(game, uid, game.status === 'finished');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal result result--${won ? 'win' : 'lose'}`}
      aria-labelledby="result-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="result-body">
          <div className="result-stamp" aria-hidden="true">
            <span>{won ? '勝' : '敗'}</span>
          </div>
          <h2 id="result-title" className="result-title">
            {won ? '你贏了！' : '這局輸了'}
          </h2>
          <p className="result-reason">{reason}</p>
          <p className="result-score" aria-label={`比數 ${myName} ${game.players[uid]?.wins ?? 0} 比 ${oppName} ${game.players[opp]?.wins ?? 0}`}>
            <span className="result-name">{myName}</span>
            <span className="result-num">{game.players[uid]?.wins ?? 0}</span>
            <span className="result-sep">:</span>
            <span className="result-num">{game.players[opp]?.wins ?? 0}</span>
            <span className="result-name">{oppName}</span>
          </p>
          {children}
          <NewMedals ids={newMedals} />
          <RematchActions
            game={game}
            uid={uid}
            act={act}
            onLeave={onLeave}
            extra={
              <button type="button" className="btn btn--outline" onClick={onClose}>
                {closeLabel}
              </button>
            }
          />
        </div>
      )}
    </dialog>
  );
}
