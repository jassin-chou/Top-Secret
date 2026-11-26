import type { GameView } from '@planehunt/shared';
import { callApi, type Account, type Backend } from './backend';

const TOKEN_KEY = 'planehunt.localToken';
/** 本機模擬的「Google 帳號」：存在 localStorage，所以每個分頁都是同一個人 */
const ACCOUNT_KEY = 'planehunt.localAccount';

interface MockAccount {
  token: string;
  name: string;
  email: string;
}

function randomToken() {
  // getRandomValues 在非 https 的區網網址也能用（randomUUID 不行）
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function loadMock(): MockAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as MockAccount) : null;
  } catch {
    return null;
  }
}

/** 訪客：每個分頁一組身分（sessionStorage），所以同一台電腦開兩個分頁就能自己跟自己對戰 */
function guestToken(): string {
  let t = sessionStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = randomToken();
    sessionStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

export function createLocalBackend(apiBase: string): Backend {
  let mock = loadMock();
  let token = mock?.token ?? guestToken();
  let uid = '';

  /** 送給後端的 token：模擬的 Google 帳號會在後面接「|Email」，後端才知道排行榜名字 */
  const authToken = () => (mock ? `${token}|${mock.email}` : token);

  const account = (): Account => ({
    uid,
    guest: !mock,
    name: mock?.name ?? null,
    email: mock?.email ?? null,
    photo: null,
  });
  const whoami = async () => {
    uid = (await callApi<{ uid: string }>(apiBase, authToken(), 'whoami')).uid;
    return account();
  };

  return {
    mode: 'local',
    async init() {
      return (await whoami()).uid;
    },
    call(action, body) {
      return callApi(apiBase, authToken(), action, body);
    },
    account,
    async signInWithGoogle() {
      // 本機沒有真的 Google：沿用目前訪客的 token 當成「帳號」，就像 Firebase 把訪客升級成 Google 帳號一樣
      // 每個模擬帳號一個不同的 Email，排行榜上才分得出來
      const tag = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => b.toString(16).padStart(2, '0')).join('');
      mock = { token, name: '測試帳號', email: `tester${tag}@example.com` };
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(mock));
      return whoami();
    },
    async signOut() {
      mock = null;
      localStorage.removeItem(ACCOUNT_KEY);
      token = randomToken();
      sessionStorage.setItem(TOKEN_KEY, token);
      return whoami();
    },
    async lanHosts() {
      try {
        const res = await fetch(`${apiBase}/health`);
        const data = (await res.json()) as { lan?: string[] };
        return data.lan ?? [];
      } catch {
        return [];
      }
    },
    watch(gameId, { onView, onFatal, onConnection }) {
      const url = `${apiBase}/stream?gameId=${encodeURIComponent(gameId)}&token=${encodeURIComponent(authToken())}`;
      const es = new EventSource(url);
      let lastEvent = Date.now();
      let closed = false;
      es.addEventListener('view', (e) => {
        lastEvent = Date.now();
        onConnection?.('online');
        onView(JSON.parse((e as MessageEvent).data) as GameView);
      });
      es.addEventListener('gone', (e) => {
        es.close();
        onFatal(JSON.parse((e as MessageEvent).data).message);
      });
      es.onerror = () => {
        // EventSource 會自動重連；後端重啟後房間會消失，重連成功時會收到 gone
        onConnection?.('reconnecting');
      };

      // 保險：有些雲端開發環境（例如 Codespaces 的轉發網址）可能會延遲即時推播，
      // 幾秒沒收到推播就主動問一次最新狀態
      const poll = setInterval(async () => {
        if (closed || Date.now() - lastEvent < 4000) return;
        try {
          const v = await callApi<GameView>(apiBase, authToken(), 'state', { gameId });
          lastEvent = Date.now();
          onView(v);
        } catch (e) {
          if ((e as { code?: string }).code === 'NOT_FOUND') onFatal((e as Error).message);
        }
      }, 2000);

      return () => {
        closed = true;
        clearInterval(poll);
        es.close();
      };
    },
  };
}
