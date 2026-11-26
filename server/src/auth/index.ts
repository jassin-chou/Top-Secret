import { createHash } from 'node:crypto';
import { GameError } from '@planehunt/shared';

/** 驗證後知道的身分 */
export interface Identity {
  uid: string;
  /** 用 Google 登入時的 Email（排行榜名字用它的 @ 前面那段） */
  email: string | null;
  google: boolean;
}

/** 驗證請求帶來的 token，回傳玩家身分 */
export interface Authenticator {
  verifyToken(token: string): Promise<Identity>;
}

export function bearerToken(header: string | null | undefined): string {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  if (!m) throw new GameError('UNAUTHENTICATED', '缺少登入資訊，請重新整理頁面');
  return m[1];
}

/**
 * 本機模式：前端在 sessionStorage 產生一組隨機密鑰當 token，
 * uid = sha256(token) 的前綴。公開狀態裡只會出現 uid，對手拿不到你的 token，無法冒充你。
 */
export class LocalAuth implements Authenticator {
  async verifyToken(token: string): Promise<Identity> {
    // 本機模擬的 Google 帳號：token 後面接「|Email」（uid 只看前面的密鑰，所以登入前後是同一個人）
    const [secret, email] = token.split('|');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(secret) || (email !== undefined && !/^[^\s@|]{1,64}@[^\s@|]{1,190}$/.test(email))) {
      throw new GameError('UNAUTHENTICATED', '登入資訊格式不正確，請重新整理頁面');
    }
    return {
      uid: 'p_' + createHash('sha256').update(secret).digest('base64url').slice(0, 20),
      email: email ?? null,
      google: email !== undefined,
    };
  }
}

/** Firebase 模式：驗證 Firebase Auth（匿名登入）發的 ID token */
export class FirebaseAuth implements Authenticator {
  async verifyToken(token: string): Promise<Identity> {
    const { getAuth } = await import('firebase-admin/auth');
    const { adminApp } = await import('../firebase-admin.js');
    try {
      const decoded = await getAuth(adminApp()).verifyIdToken(token);
      // 訪客升級成 Google 帳號後，identities 裡會有 google.com
      const google = !!decoded.email && !!decoded.firebase?.identities?.['google.com'];
      return { uid: decoded.uid, email: decoded.email ?? null, google };
    } catch {
      throw new GameError('UNAUTHENTICATED', '登入已失效，請重新整理頁面');
    }
  }
}
