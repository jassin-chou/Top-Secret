import { useState } from 'react';
import type { Account } from '../net/backend';
import { IN_APP_NAME, detectInAppBrowser, inAppHelp } from '../lib/util';
import { useToast } from './Toasts';

/** Google 的「G」標誌（登入按鈕用） */
export function GoogleIcon() {
  return (
    <svg className="google-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** 大頭貼：Google 照片，沒有的話用名字第一個字 */
export function Avatar({ account, size = 32 }: { account: Account; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (account.name ?? account.email ?? '?').trim().charAt(0).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.46 }} aria-hidden="true">
      {account.photo && !broken ? (
        <img src={account.photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        initial
      )}
    </span>
  );
}

/** 「用 Google 登入」按鈕：處理忙碌狀態與錯誤訊息 */
export function GoogleButton({
  onSignIn,
  className = 'btn btn--google',
  label = '用 Google 登入',
}: {
  onSignIn(): Promise<Account | null>;
  className?: string;
  label?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        const inApp = detectInAppBrowser();
        if (inApp) {
          // Google 會擋 App 內建瀏覽器的登入（403 disallowed_useragent），直接告訴使用者怎麼改用瀏覽器
          toast(`${IN_APP_NAME[inApp]} 內建瀏覽器不能用 Google 登入：${inAppHelp(inApp)}`);
          return;
        }
        setBusy(true);
        try {
          const acc = await onSignIn();
          if (acc && !acc.guest) toast(`已登入：${acc.name ?? acc.email ?? 'Google 帳號'}`, 'info');
        } catch (e) {
          toast((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <GoogleIcon />
      <span>{busy ? '登入中…' : label}</span>
    </button>
  );
}
