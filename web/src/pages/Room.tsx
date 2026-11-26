import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { isRoomExpired, opponentOf, type GameDoc, type GameView, type PrivateDoc, type Settings } from '@planehunt/shared';
import { ShapePreview } from '../components/ShapePreview';
import { ChatWidget } from '../components/Chat';
import { FleetPreview } from '../components/Fleet';
import type { Backend, ConnectionState } from '../net/backend';
import { copyText, inviteLink, loadName, prettyCode, saveName } from '../lib/util';
import { useToast } from '../components/Toasts';
import { ConfirmButton } from '../components/ConfirmButton';
import { Placement } from './Placement';
import { Battle } from './Battle';
import { CodeBattle, CodeSetup } from './CodeGame';

export type Act = (action: string, body?: object) => Promise<boolean>;

interface RoomProps {
  backend: Backend;
  uid: string;
  code: string;
  navigate(p: string): void;
}

export function Room({ backend, uid, code, navigate }: RoomProps) {
  const toast = useToast();
  const [game, setGame] = useState<GameDoc | null>(null);
  const [me, setMe] = useState<PrivateDoc | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnectionState>('online');

  const applyGame = useCallback((next: GameDoc) => {
    // 動作的回應與即時推播可能先後抵達，只接受較新的狀態
    setGame((prev) => (prev && prev.updatedAt > next.updatedAt ? prev : next));
  }, []);

  useEffect(() => {
    return backend.watch(code, {
      onView: (p) => {
        if (p.game) applyGame(p.game);
        if (p.me !== undefined) setMe(p.me);
      },
      onFatal: setFatal,
      onConnection: setConn,
    });
  }, [backend, code, applyGame]);

  const act: Act = useCallback(
    async (action, body = {}) => {
      try {
        const v = await backend.call<GameView>(action, { gameId: code, ...body });
        if (v?.game) applyGame(v.game);
        if (v?.me !== undefined) setMe(v.me);
        return true;
      } catch (e) {
        toast((e as Error).message);
        return false;
      }
    },
    [backend, code, applyGame, toast],
  );

  const leave = async () => {
    if (game && game.playerIds.includes(uid) && game.status !== 'closed') await act('leave');
    navigate('/');
  };

  const roomLabel = backend.mode === 'practice' ? '跟電腦練習' : `房號 ${code}`;

  if (fatal) {
    return (
      <section className="notice">
        <h1 className="notice-title">{backend.mode === 'practice' ? '找不到這場練習' : `進不了房間 ${prettyCode(code)}`}</h1>
        <p>{fatal}</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          回首頁
        </button>
      </section>
    );
  }
  if (!game) return <p className="loading">讀取房間 {prettyCode(code)}…</p>;

  const isPlayer = game.playerIds.includes(uid);
  const reconnecting = conn === 'reconnecting' && <p className="conn-warning">連線中斷，正在重新連線…</p>;

  if (!isPlayer) {
    if (game.status === 'waiting') return <JoinPrompt game={game} act={act} />;
    return (
      <section className="notice">
        <h1 className="notice-title">{game.status === 'closed' ? '這個房間已經關閉了' : '這個房間已經有兩位玩家了'}</h1>
        <p>請朋友重新開一個房間，再把新的連結傳給你。</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          回首頁
        </button>
      </section>
    );
  }

  if (game.status === 'closed') {
    return (
      <section className="notice">
        <h1 className="notice-title">房間已經關閉</h1>
        <p>雙方都離開了，開一個新房間再玩一局吧。</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          回首頁
        </button>
      </section>
    );
  }

  if (game.status === 'waiting') {
    return (
      <>
        {reconnecting}
        <Waiting game={game} backend={backend} onLeave={leave} />
      </>
    );
  }

  const chatOn = game.playerIds.length === 2;
  return (
    <>
      {reconnecting}
      {game.settings.mode === 'ab' ? (
        game.status === 'placing' ? (
          <CodeSetup game={game} me={me} uid={uid} act={act} onLeave={leave} roomLabel={roomLabel} />
        ) : (
          <CodeBattle game={game} me={me} uid={uid} act={act} onLeave={leave} roomLabel={roomLabel} />
        )
      ) : game.status === 'placing' ? (
        <Placement game={game} me={me} uid={uid} act={act} onLeave={leave} roomLabel={roomLabel} />
      ) : (
        <Battle game={game} me={me} uid={uid} act={act} onLeave={leave} roomLabel={roomLabel} />
      )}
      {chatOn && <ChatWidget game={game} uid={uid} act={act} />}
    </>
  );
}

function Waiting({ game, backend, onLeave }: { game: GameDoc; backend: Backend; onLeave(): void }) {
  const toast = useToast();
  const link = inviteLink(game.id);
  const [lanLink, setLanLink] = useState<string | null>(null);

  // 用 localhost 開的連結，手機點了會連到手機自己；改給一個用區網 IP 的連結
  useEffect(() => {
    const onLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (!onLocalhost || !backend.lanHosts) return;
    backend.lanHosts().then((ips) => {
      if (ips[0]) setLanLink(`${location.protocol}//${ips[0]}:${location.port}${location.pathname}#/r/${game.id}`);
    });
  }, [backend, game.id]);

  const copy = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? '已複製邀請連結，貼給朋友就可以了' : '無法自動複製，請手動選取連結', ok ? 'info' : 'error');
  };
  return (
    <section className="waiting">
      <p className="waiting-label">房號</p>
      <p className="room-code" aria-label={`房號 ${game.id.split('').join(' ')}`}>
        {prettyCode(game.id)}
      </p>
      <RuleSummary settings={game.settings} />
      <div className="invite">
        <input className="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="邀請連結" />
        <button type="button" className="btn" onClick={() => copy(link)}>
          複製邀請連結
        </button>
      </div>
      {lanLink && (
        <div className="lan-invite">
          <p className="hint">
            上面的連結只有這台電腦能開。同一個 Wi-Fi 的手機或其他電腦，請用這個：
          </p>
          <div className="invite">
            <input className="invite-link" readOnly value={lanLink} onFocus={(e) => e.currentTarget.select()} aria-label="區網邀請連結" />
            <button type="button" className="btn btn--outline" onClick={() => copy(lanLink)}>
              複製手機用連結
            </button>
          </div>
        </div>
      )}
      <p className="waiting-status">
        <span className="pulse" aria-hidden="true" />
        等朋友加入中。對方打開連結、輸入暱稱就會進來，你不用重新整理。
      </p>
      <ConfirmButton label="取消房間" confirmLabel="確定取消？" onConfirm={onLeave} />
    </section>
  );
}

function JoinPrompt({ game, act }: { game: GameDoc; act: Act }) {
  const [name, setName] = useState(loadName);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const host = game.players[game.hostId]?.name ?? '朋友';
  if (isRoomExpired(game, Date.now())) {
    return (
      <div className="join-prompt">
        <h1 className="notice-title">這個邀請已經過期了</h1>
        <p className="muted">房間超過 24 小時沒有動靜就會關閉。請{host}重新開一間房間，再傳新的連結給你。</p>
        <a className="btn" href="#/">
          回首頁
        </a>
      </div>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return toast('先取個暱稱，對手才知道你是誰');
    saveName(n);
    setBusy(true);
    await act('join', { name: n });
    setBusy(false);
  };
  return (
    <form className="join-prompt" onSubmit={submit}>
      <h1 className="notice-title">
        {host}找你來玩{game.settings.mode === 'ship' ? '海戰棋' : game.settings.mode === 'ab' ? '幾A幾B' : '尋機頭'}
      </h1>
      <RuleSummary settings={game.settings} />
      <div className="field">
        <label htmlFor="join-name">你的暱稱</label>
        <input id="join-name" value={name} maxLength={12} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? '加入中…' : '加入房間'}
      </button>
    </form>
  );
}

export function opponentName(game: GameDoc, uid: string): string {
  const opp = opponentOf(game, uid);
  return (opp && game.players[opp]?.name) || '對手';
}

/** 這個房間的規則：飛機形狀圖或艦隊 + 棋盤大小 */
export function RuleSummary({ settings }: { settings: Settings }) {
  if (settings.mode === 'ab') {
    return (
      <div className="rule-summary">
        <span className="code-tiles code-tiles--sm" aria-hidden="true">
          {Array.from({ length: settings.digits }, (_, i) => (
            <span key={i} className="code-tile is-empty">
              ?
            </span>
          ))}
        </span>
        <p>
          <span className="rule-line">幾A幾B：猜 {settings.digits} 位數密碼</span>
          <span className="rule-line muted">{settings.repeat ? '數字可以重複' : '數字不重複'}，0 可以放第一位</span>
        </p>
      </div>
    );
  }
  if (settings.mode === 'ship') {
    const { size, fleet } = settings;
    return (
      <div className="rule-summary rule-summary--ship">
        <FleetPreview fleet={fleet} />
        <p>
          <span className="rule-line">
            海戰棋：{size}×{size} 方格，每人 {fleet.length} 艘船
          </span>
          <span className="rule-line muted">
            船長 {fleet.join('、')} 格{fleet.length > 1 ? '，船之間要完全分開' : ''}
          </span>
        </p>
      </div>
    );
  }
  const { size, planes, shape } = settings;
  return (
    <div className="rule-summary">
      <ShapePreview shape={shape} className="shape-preview--md" />
      <p>
        <span className="rule-line">
          飛機版：{size}×{size} 方格，每人 {planes} 架「{shape.name}」
        </span>
        <span className="rule-line muted">
          每架 {shape.cells.length} 格{planes > 1 ? '，飛機之間要完全分開' : ''}
        </span>
      </p>
    </div>
  );
}
