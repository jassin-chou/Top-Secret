import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  linkWithPopup,
  setPersistence,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signOut as fbSignOut,
  updateCurrentUser,
  type User,
} from 'firebase/auth';
import { connectFirestoreEmulator, doc, getFirestore, onSnapshot } from 'firebase/firestore';
import type { GameDoc, PrivateDoc } from '@planehunt/shared';
import { callApi, type Account, type Backend } from './backend';

export function createFirebaseBackend(apiBase: string): Backend {
  const env = import.meta.env;
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  const auth = getAuth(app);
  const db = getFirestore(app);

  if (env.VITE_USE_EMULATORS === 'true') {
    // 用目前網址的主機名稱，這樣區網內的手機也連得到電腦上的模擬器
    const host = location.hostname;
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
  }

  const currentUser = () => {
    if (!auth.currentUser) throw new Error('尚未登入');
    return auth.currentUser;
  };

  const toAccount = (u: User): Account => {
    const google = u.providerData.find((p) => p.providerId === 'google.com');
    return {
      uid: u.uid,
      guest: u.isAnonymous,
      name: u.displayName ?? google?.displayName ?? null,
      email: u.email ?? google?.email ?? null,
      photo: u.photoURL ?? google?.photoURL ?? null,
    };
  };

  /** 使用者自己關掉或重複點登入視窗，不用顯示錯誤 */
  const QUIET = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);
  const MESSAGES: Record<string, string> = {
    'auth/popup-blocked': '瀏覽器擋住了登入視窗，請允許這個網站開啟彈出式視窗後再試一次',
    'auth/network-request-failed': '網路連線不穩，請稍後再試',
    'auth/unauthorized-domain': '這個網址還沒加到 Firebase 的授權網域，請到 Firebase 主控台設定',
    'auth/operation-not-allowed': 'Firebase 還沒開啟 Google 登入，請到 Firebase 主控台設定',
  };

  return {
    mode: 'firebase',
    async init() {
      await auth.authStateReady();
      const u = auth.currentUser;
      if (u && !u.isAnonymous) {
        // Google 帳號：記在這台裝置上，所有分頁共用，關掉瀏覽器也不用重新登入
        await setPersistence(auth, browserLocalPersistence);
      } else {
        // 訪客：每個分頁獨立身分（sessionStorage）；重新整理不會換人
        await setPersistence(auth, browserSessionPersistence);
        if (!auth.currentUser) await signInAnonymously(auth);
      }
      return currentUser().uid;
    },
    account() {
      return toAccount(currentUser());
    },
    async signInWithGoogle(ctx) {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cur = auth.currentUser;
      try {
        // 先開視窗（要在點擊當下開，才不會被瀏覽器擋），成功後再改成長期記住
        if (cur?.isAnonymous) await linkWithPopup(cur, provider);
        else await signInWithPopup(auth, provider);
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
          // 這個 Google 帳號以前就登入過：切換過去，再請後端把訪客的座位和紀錄搬到帳號底下
          const cred = GoogleAuthProvider.credentialFromError(e as never);
          if (!cred) throw new Error('登入失敗，請再試一次');
          const guest = auth.currentUser?.isAnonymous ? auth.currentUser : null;
          const guestToken = guest ? await guest.getIdToken() : null;
          await signInWithCredential(auth, cred);
          if (guest && guestToken) {
            try {
              await callApi(apiBase, await currentUser().getIdToken(), 'merge', { guestToken, gameId: ctx?.gameId });
            } catch (err) {
              // 搬不過去（例如這個帳號就是房間裡的對手）：換回原本的訪客身分，這一局不受影響
              await updateCurrentUser(auth, guest);
              await setPersistence(auth, browserSessionPersistence);
              throw err;
            }
          }
        } else if (QUIET.has(code)) {
          return toAccount(currentUser());
        } else {
          throw new Error(MESSAGES[code] ?? `登入失敗（${code || (e as Error).message}）`);
        }
      }
      await setPersistence(auth, browserLocalPersistence);
      // 換發 token，讓後端拿到最新的登入資訊
      await currentUser().getIdToken(true);
      return toAccount(currentUser());
    },
    async signOut() {
      await fbSignOut(auth);
      await setPersistence(auth, browserSessionPersistence);
      await signInAnonymously(auth);
      return toAccount(currentUser());
    },
    async call(action, body) {
      const token = await currentUser().getIdToken();
      return callApi(apiBase, token, action, body);
    },
    watch(gameId, { onView, onFatal, onConnection }) {
      const uid = currentUser().uid;
      const stopGame = onSnapshot(
        doc(db, 'games', gameId),
        (snap) => {
          if (!snap.exists()) return onFatal('找不到這個房間，可能已經過期了');
          const { expireAt: _ignored, ...game } = snap.data();
          onConnection?.(snap.metadata.fromCache ? 'reconnecting' : 'online');
          onView({ game: game as GameDoc });
        },
        (err) => onFatal(`無法讀取房間：${err.message}`),
      );
      const stopMe = onSnapshot(
        doc(db, 'games', gameId, 'private', uid),
        (snap) => onView({ me: snap.exists() ? (snap.data() as PrivateDoc) : { planes: null, secret: null } }),
        () => onView({ me: null }),
      );
      return () => {
        stopGame();
        stopMe();
      };
    },
  };
}
