/**
 * 大廳（分步驟）：
 *   1. StartStep   取暱稱，選「開新房間」或「加入朋友的房間」
 *   2. ModeStep    選玩法（飛機版 / 海戰棋），旁邊可以看「怎麼玩？」
 *   3. SetupStep   這個玩法的細項設定，開房間或跟電腦練習
 *   2'. JoinStep   輸入房號加入
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CLASSIC_SHAPE, CODE_RE, type BotLevel, type GameMode, type GameView, type Settings } from '@planehunt/shared';
import type { Backend } from '../net/backend';
import { practiceBackend } from '../net/practiceBackend';
import { APP_NAME, APP_NAME_EN, loadName, saveName } from '../lib/util';
import { useToast } from '../components/Toasts';
import { PlaneExample } from '../components/Examples';
import { HowToPlay } from '../components/HowToPlay';
import { ShapePreview } from '../components/ShapePreview';
import { ShipIcon } from '../components/Fleet';
import { CreateRoom } from './CreateRoom';

interface LobbyProps {
  backend: Backend | null;
  bootError: string | null;
  navigate(path: string): void;
}

export const MODE_NAME: Record<GameMode, string> = { plane: '飛機版', ship: '海戰棋', ab: '幾A幾B' };

/** 步驟標題：返回、目前在第幾步 */
function StepHeader({
  steps,
  current,
  back,
  title,
  aside,
  navigate,
}: {
  steps: string[];
  current: number;
  back: string;
  title: string;
  aside?: ReactNode;
  navigate(p: string): void;
}) {
  return (
    <header className="step-head">
      <div className="step-nav">
        <button type="button" className="btn btn--quiet btn--small step-back" onClick={() => navigate(back)}>
          返回
        </button>
        <ol className="step-trail" aria-label="步驟">
          {steps.map((s, i) => (
            <li key={s} className={i === current ? 'is-current' : i < current ? 'is-done' : ''} aria-current={i === current ? 'step' : undefined}>
              {s}
            </li>
          ))}
        </ol>
      </div>
      <div className="step-title-row">
        <h1 className="step-title">{title}</h1>
        {aside}
      </div>
    </header>
  );
}

/** 後面幾步需要先有暱稱；沒有的話回到第一步 */
function useRequireName(navigate: (p: string) => void) {
  const toast = useToast();
  const name = loadName().trim();
  useEffect(() => {
    if (!name) {
      toast('先取個暱稱，對手才知道你是誰', 'info');
      navigate('/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return name;
}

// ---------------------------------------------------------------------------

export function StartStep({ navigate }: LobbyProps) {
  const toast = useToast();
  const [name, setName] = useState(loadName);

  const go = (path: string) => {
    const n = name.trim();
    if (!n) {
      toast('先取個暱稱，對手才知道你是誰');
      document.getElementById('nickname')?.focus();
      return;
    }
    saveName(n);
    navigate(path);
  };

  return (
    <section className="step step--start">
      <div className="start-hero">
        <div>
          <h1 className="title">
            <span className="title-zh">{APP_NAME}</span>
            <span className="title-stamp" lang="en">
              {APP_NAME_EN}
            </span>
          </h1>
          <p className="lede">藏好你的機密：幾架飛機、一支艦隊，或一組數字密碼。跟朋友輪流猜，看誰先破解對方。</p>
        </div>
        <div className="start-board">
          <PlaneExample />
        </div>
      </div>

      <div className="field field--big">
        <label htmlFor="nickname">先取個暱稱</label>
        <input
          id="nickname"
          value={name}
          maxLength={12}
          autoComplete="nickname"
          placeholder="例如：阿明"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="choice-grid">
        <button type="button" className="choice-card" onClick={() => go('/new')}>
          <span className="choice-art" aria-hidden="true">
            <ShapePreview shape={CLASSIC_SHAPE} decorative />
            <span className="choice-ships">
              <ShipIcon len={3} />
              <ShipIcon len={2} />
            </span>
          </span>
          <span className="choice-title">開新房間</span>
          <span className="choice-desc">選飛機版、海戰棋或幾A幾B，邀朋友來玩，也可以先跟電腦練習</span>
        </button>
        <button type="button" className="choice-card" onClick={() => go('/join')}>
          <span className="choice-art choice-art--code" aria-hidden="true">
            ABC
            <br />
            234
          </span>
          <span className="choice-title">加入朋友的房間</span>
          <span className="choice-desc">輸入朋友給你的 6 碼房號</span>
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

export function ModeStep({ navigate }: LobbyProps) {
  const name = useRequireName(navigate);
  const [help, setHelp] = useState<GameMode | null>(null);

  const modes: Array<{ mode: GameMode; desc: string; art: ReactNode }> = [
    {
      mode: 'plane',
      desc: '藏好飛機，先找出對方所有機頭的人獲勝。可以選飛機形狀，也能自己畫。',
      art: <ShapePreview shape={CLASSIC_SHAPE} decorative />,
    },
    {
      mode: 'ship',
      desc: '擺好艦隊，先擊沉對方所有船的人獲勝。可以選艦隊，也能自己配。',
      art: (
        <span className="mode-big-ships">
          <ShipIcon len={4} />
          <ShipIcon len={3} />
          <ShipIcon len={2} />
        </span>
      ),
    },
    {
      mode: 'ab',
      desc: '各自設一組數字密碼，輪流猜「幾A幾B」，先猜中對方密碼的人獲勝。',
      art: (
        <span className="mode-big-ab">
          <span className="code-tiles code-tiles--sm">
            {['1', 'A', '2', 'B'].map((c, i) => (
              <span key={i} className={`code-tile${i % 2 ? ' is-letter' : ''}`}>
                {c}
              </span>
            ))}
          </span>
        </span>
      ),
    },
  ];

  return (
    <section className="step">
      <StepHeader
        steps={['暱稱', '玩法', '設定']}
        current={1}
        back="/"
        title={name ? `${name}，想玩哪一種？` : '想玩哪一種？'}
        navigate={navigate}
      />
      <div className="mode-grid">
        {modes.map(({ mode, desc, art }) => (
          <div key={mode} className="mode-option">
            <button type="button" className="mode-big" onClick={() => navigate(`/new/${mode}`)}>
              <span className="mode-big-art" aria-hidden="true">
                {art}
              </span>
              <span className="mode-big-name">{MODE_NAME[mode]}</span>
              <span className="mode-big-desc">{desc}</span>
            </button>
            <button type="button" className="help-btn" onClick={() => setHelp(mode)}>
              <span aria-hidden="true">?</span>
              {MODE_NAME[mode]}怎麼玩
            </button>
          </div>
        ))}
      </div>
      <HowToPlay mode={help} onClose={() => setHelp(null)} />
    </section>
  );
}

// ---------------------------------------------------------------------------

export function SetupStep({ mode, backend, bootError, navigate }: LobbyProps & { mode: GameMode }) {
  const toast = useToast();
  const name = useRequireName(navigate);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<GameMode | null>(null);

  const create = async (settings: Settings) => {
    if (!backend) {
      toast(bootError ? `連不上遊戲伺服器，暫時不能開房間。可以先跟電腦練習。` : '正在連線伺服器，請稍等一下再試');
      return;
    }
    setBusy(true);
    try {
      const v = await backend.call<GameView>('create', { name, settings });
      navigate(`/r/${v.game.id}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 跟電腦練習完全在瀏覽器裡執行，不需要伺服器
  const practice = async (settings: Settings, level: BotLevel) => {
    try {
      const v = await practiceBackend().call<GameView>('create', { name, settings, level });
      navigate(`/p/${v.game.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <section className="step step--setup">
      <StepHeader
        steps={['暱稱', '玩法', '設定']}
        current={2}
        back="/new"
        title={`${MODE_NAME[mode]}設定`}
        aside={
          <button type="button" className="help-btn" onClick={() => setHelp(mode)}>
            <span aria-hidden="true">?</span>
            怎麼玩
          </button>
        }
        navigate={navigate}
      />
      {bootError && <p className="conn-warning">連不上遊戲伺服器，暫時只能跟電腦練習。</p>}
      <CreateRoom key={mode} mode={mode} busy={busy} onCreate={create} onPractice={practice} />
      <HowToPlay mode={help} onClose={() => setHelp(null)} />
    </section>
  );
}

// ---------------------------------------------------------------------------

export function JoinStep({ backend, bootError, navigate }: LobbyProps) {
  const toast = useToast();
  const name = useRequireName(navigate);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[\s-]/g, '');
    if (!CODE_RE.test(c)) {
      toast('房號是 6 碼英數字，請再確認一次');
      return;
    }
    if (!backend) {
      toast(bootError ? '連不上遊戲伺服器，暫時不能加入房間' : '正在連線伺服器，請稍等一下再試');
      return;
    }
    setBusy(true);
    try {
      await backend.call('join', { gameId: c, name });
      navigate(`/r/${c}`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="step step--join">
      <StepHeader steps={['暱稱', '加入房間']} current={1} back="/" title="加入朋友的房間" navigate={navigate} />
      <form className="join-form" onSubmit={join}>
        <div className="field field--big">
          <label htmlFor="room-code">房號</label>
          <input
            id="room-code"
            className="code-input"
            value={code}
            maxLength={7}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABC234"
            autoFocus
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn--big" disabled={busy}>
          {busy ? '加入中…' : '加入房間'}
        </button>
      </form>
      <p className="hint">朋友傳的是邀請連結的話，直接打開連結就可以，不用輸入房號。</p>
    </section>
  );
}
