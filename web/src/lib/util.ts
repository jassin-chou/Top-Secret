import { useEffect, useState } from 'react';

/** 網站名稱：要改名只改這裡（index.html 的 <title> 也要跟著改） */
export const APP_NAME = '絕對機密';
export const APP_NAME_EN = 'Top Secret';

const NAME_KEY = 'planehunt.name';

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // 無痕模式等情況忽略
  }
}

export type Route =
  | { page: 'start' }
  | { page: 'new' }
  | { page: 'setup'; mode: 'plane' | 'ship' | 'ab' }
  | { page: 'join' }
  | { page: 'room'; code: string }
  | { page: 'practice'; code: string }
  | { page: 'history' }
  | { page: 'record'; id: string }
  | { page: 'leaderboard' };

/**
 * 網址（hash）對應的畫面：
 *   #/            第一步：暱稱、選「開新房間」或「加入」
 *   #/new         選玩法
 *   #/new/plane   飛機版設定細項（#/new/ship 海戰棋）
 *   #/join        輸入房號加入
 *   #/r/房號      線上房間；#/p/代碼 跟電腦練習
 *   #/history     對戰紀錄與帳號
 *   #/history/編號 一局的詳細紀錄（重播）
 *   #/leaderboard 排行榜與獎牌
 */
export function parseRoute(hash: string): Route {
  const room = /^#\/(r|p)\/([A-Za-z0-9]+)/.exec(hash);
  if (room) return { page: room[1] === 'p' ? 'practice' : 'room', code: room[2].toUpperCase() };
  const setup = /^#\/new\/(plane|ship|ab)\b/.exec(hash);
  if (setup) return { page: 'setup', mode: setup[1] as 'plane' | 'ship' | 'ab' };
  if (/^#\/new\b/.test(hash)) return { page: 'new' };
  if (/^#\/join\b/.test(hash)) return { page: 'join' };
  const record = /^#\/history\/([A-Za-z0-9-]+)/.exec(hash);
  if (record) return { page: 'record', id: record[1] };
  if (/^#\/history\b/.test(hash)) return { page: 'history' };
  if (/^#\/leaderboard\b/.test(hash)) return { page: 'leaderboard' };
  return { page: 'start' };
}

export function useRoute(): [Route, (path: string) => void] {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = (path: string) => {
    location.hash = path;
  };
  return [route, navigate];
}

/**
 * 邀請連結。多帶 ?openExternalBrowser=1：在 LINE 聊天室點開時，LINE 會改用手機的預設瀏覽器開，
 * 不會用 LINE 內建瀏覽器（Google 不允許在 App 內建瀏覽器登入）。其他地方會忽略這個參數。
 */
export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?openExternalBrowser=1#/r/${code}`;
}

export type InAppBrowser = 'line' | 'facebook' | 'instagram' | 'wechat' | 'webview';

export const IN_APP_NAME: Record<InAppBrowser, string> = {
  line: 'LINE',
  facebook: 'Facebook／Messenger',
  instagram: 'Instagram',
  wechat: '微信',
  webview: 'App',
};

/** 是不是在聊天或社群 App 的內建瀏覽器裡（這些地方 Google 登入會被擋） */
export function detectInAppBrowser(ua: string = navigator.userAgent): InAppBrowser | null {
  if (/\bLine\//i.test(ua)) return 'line';
  if (/FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua)) return 'facebook';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/MicroMessenger/i.test(ua)) return 'wechat';
  if (/; wv\)/.test(ua)) return 'webview';
  return null;
}

/** 在 LINE 內建瀏覽器裡，打開這個網址會跳到手機的預設瀏覽器 */
export function externalBrowserUrl(): string {
  const u = new URL(location.href);
  u.searchParams.set('openExternalBrowser', '1');
  return u.toString();
}

/** 給使用者看的「怎麼改用瀏覽器開」說明 */
export function inAppHelp(kind: InAppBrowser): string {
  if (kind === 'line') return '按「用瀏覽器開啟」，或點右上角的 ⋯ 選「使用預設瀏覽器開啟」';
  return '點右上角（或右下角）的 ⋯ 選「在瀏覽器中開啟」，或複製網址貼到 Chrome／Safari';
}

/** 房號顯示成 ABC 234，比較好念 */
export function prettyCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 退回舊方法
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** 目前是否用觸控操作：先看裝置特性，之後依照實際最後一次的指標類型即時切換 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => window.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false);
  useEffect(() => {
    const onDown = (e: PointerEvent) => setCoarse(e.pointerType === 'touch');
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
  return coarse;
}

/** 存在 sessionStorage 的狀態（推理筆記用） */
export function useSessionState<T>(key: string, initial: T): [T, (v: T) => void] {
  const read = () => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    setValue(read());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (v: T) => {
    setValue(v);
    try {
      sessionStorage.setItem(key, JSON.stringify(v));
    } catch {
      // ignore
    }
  };
  return [value, set];
}
