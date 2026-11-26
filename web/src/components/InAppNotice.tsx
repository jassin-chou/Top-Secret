/**
 * 在 LINE、Facebook、Instagram 等 App 的內建瀏覽器裡打開時，頁面上方的提醒。
 * 這些地方可以正常玩（訪客身分），只是 Google 登入會被 Google 擋下來。
 */
import { useState } from 'react';
import { IN_APP_NAME, copyText, detectInAppBrowser, externalBrowserUrl, inAppHelp } from '../lib/util';
import { useToast } from './Toasts';

const DISMISS_KEY = 'planehunt.inAppNotice';

export function InAppNotice() {
  const toast = useToast();
  const kind = detectInAppBrowser();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!kind || hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // 不能存也沒關係
    }
  };
  return (
    <div className="inapp-notice" role="note">
      <p>
        你正在 {IN_APP_NAME[kind]} 的內建瀏覽器裡。可以直接玩，但這裡<strong>不能用 Google 登入</strong>（對戰紀錄只會留在這個頁面）。想登入的話：{inAppHelp(kind)}。
      </p>
      <div className="inapp-actions">
        {kind === 'line' && (
          <a className="btn btn--small" href={externalBrowserUrl()}>
            用瀏覽器開啟
          </a>
        )}
        <button
          type="button"
          className="btn btn--small btn--outline"
          onClick={async () => toast((await copyText(location.href)) ? '已複製網址，貼到 Chrome 或 Safari 打開' : '複製失敗，請長按網址列複製', 'info')}
        >
          複製網址
        </button>
        <button type="button" className="inapp-close" aria-label="關閉提醒" onClick={hide}>
          ×
        </button>
      </div>
    </div>
  );
}
