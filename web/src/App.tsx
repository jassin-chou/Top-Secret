import { useEffect, useState } from 'react';
import { createBackend, type Account, type Backend } from './net/backend';
import { APP_NAME, APP_NAME_EN, useRoute } from './lib/util';
import { Logo } from './components/Logo';
import { Avatar, GoogleButton } from './components/Account';
import { ToastProvider } from './components/Toasts';
import { InAppNotice } from './components/InAppNotice';
import { JoinStep, ModeStep, SetupStep, StartStep } from './pages/Lobby';
import { Room } from './pages/Room';
import { HistoryPage } from './pages/History';
import { LeaderboardPage } from './pages/Leaderboard';
import { GameRecordPage } from './pages/GameRecord';
import { MainBackend } from './lib/api';
import { NicknameProvider } from './components/Nickname';
import { PRACTICE_ME, practiceBackend, setPracticeRecorder } from './net/practiceBackend';

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [route, navigate] = useRoute();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await createBackend();
        const id = await b.init();
        if (!cancelled) {
          setBackend(b);
          setUid(id);
          setAccount(b.account?.() ?? null);
        }
      } catch (e) {
        if (!cancelled) setBootError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 跟電腦練習在瀏覽器裡跑；打完一局就把結果送到後端存進對戰紀錄
  useEffect(() => {
    if (!backend) return;
    setPracticeRecorder((entry) => void backend.call('record', { entry }).catch(() => {}));
    return () => setPracticeRecorder(null);
  }, [backend]);

  /** 登入或登出後更新身分；換了 uid 時房間畫面會用新身分重新載入（座位已經由後端搬過去） */
  const applyAccount = (acc: Account) => {
    setAccount(acc);
    if (acc.uid !== uid) setUid(acc.uid);
  };
  const signIn = async () => {
    if (!backend?.signInWithGoogle) return null;
    const acc = await backend.signInWithGoogle({ gameId: route.page === 'room' ? route.code : undefined });
    applyAccount(acc);
    return acc;
  };

  // 用 Google 登入的人：讓後端記下排行榜名字（Gmail 的 @ 前面那段）
  useEffect(() => {
    if (backend && account && !account.guest) void backend.call('profile').catch(() => {});
  }, [backend, account?.uid, account?.guest]);
  const signOut = async () => {
    if (!backend?.signOut) return;
    applyAccount(await backend.signOut());
  };

  const lobby = { backend, bootError, navigate };
  let body;
  if (route.page === 'practice') {
    // 練習模式完全在瀏覽器裡跑，不需要等伺服器
    body = <Room key={`p-${route.code}`} backend={practiceBackend()} uid={PRACTICE_ME} code={route.code} navigate={navigate} />;
  } else if (route.page === 'start') {
    body = <StartStep {...lobby} />;
  } else if (route.page === 'new') {
    body = <ModeStep {...lobby} />;
  } else if (route.page === 'setup') {
    body = <SetupStep {...lobby} mode={route.mode} />;
  } else if (route.page === 'join') {
    body = <JoinStep {...lobby} />;
  } else if (bootError) {
    body = (
      <section className="notice">
        <h1 className="notice-title">連不上遊戲伺服器</h1>
        <p>{bootError}</p>
        <p className="muted">本機測試時請確認在專案根目錄執行了 npm run dev，並且 API 有顯示「已啟動」。</p>
        <button type="button" className="btn" onClick={() => location.reload()}>
          重新連線
        </button>
      </section>
    );
  } else if (!backend || !uid) {
    body = <p className="loading">連線中…</p>;
  } else if (route.page === 'leaderboard') {
    body = <LeaderboardPage backend={backend} account={account} onSignIn={signIn} />;
  } else if (route.page === 'record') {
    body = <GameRecordPage key={route.id} backend={backend} id={route.id} navigate={navigate} />;
  } else if (route.page === 'history') {
    body = <HistoryPage backend={backend} account={account} onSignIn={signIn} onSignOut={signOut} navigate={navigate} />;
  } else {
    body = <Room key={`${route.code}:${uid}`} backend={backend} uid={uid} code={route.code} navigate={navigate} />;
  }

  return (
    <ToastProvider>
      <MainBackend.Provider value={backend}>
        <NicknameProvider>
          <div className={`page${['start', 'new', 'setup', 'join', 'history', 'record', 'leaderboard'].includes(route.page) ? ' page--lobby' : ''}`}>
            <header className="topbar">
              <div className="topbar-inner">
                <a href="#/" className="wordmark" aria-label={`${APP_NAME} ${APP_NAME_EN}，回首頁`}>
                  <span className="logo-tile">
                    <Logo />
                  </span>
                  <span className="wordmark-zh">{APP_NAME}</span>
                  <span className="wordmark-en" lang="en">
                    {APP_NAME_EN}
                  </span>
                </a>
                {backend?.mode === 'local' && <span className="mode-badge">本機測試模式</span>}
                {backend?.mode === 'firebase' && import.meta.env.VITE_USE_EMULATORS === 'true' && (
                  <span className="mode-badge">Firebase 模擬器</span>
                )}
                {account && (
                  <nav className="top-actions" aria-label="帳號">
                    <a href="#/leaderboard" className="top-link" aria-label="排行榜" aria-current={route.page === 'leaderboard' ? 'page' : undefined}>
                      排行<span className="top-link-long">榜</span>
                    </a>
                    <a href="#/history" className="top-link" aria-label="對戰紀錄" aria-current={route.page === 'history' || route.page === 'record' ? 'page' : undefined}>
                      <span className="top-link-long">對戰</span>紀錄
                    </a>
                    {account.guest ? (
                      <GoogleButton onSignIn={signIn} className="top-login" label="登入" />
                    ) : (
                      <a href="#/history" className="top-user" title={account.name ?? account.email ?? ''} aria-label="我的帳號">
                        <Avatar account={account} size={34} />
                      </a>
                    )}
                  </nav>
                )}
              </div>
            </header>
            <InAppNotice />
            <main className="content">{body}</main>
          </div>
        </NicknameProvider>
      </MainBackend.Provider>
    </ToastProvider>
  );
}
