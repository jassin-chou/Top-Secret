import type { GameDoc, PrivateDoc } from '@planehunt/shared';

export type ConnectionState = 'online' | 'reconnecting';

export interface ViewPatch {
  game?: GameDoc;
  me?: PrivateDoc | null;
}

/** 目前登入的身分：訪客（每個分頁一個）或 Google 帳號 */
export interface Account {
  uid: string;
  guest: boolean;
  name: string | null;
  email: string | null;
  photo: string | null;
}

export interface WatchHandlers {
  onView(patch: ViewPatch): void;
  /** 無法恢復的錯誤，例如房間不存在 */
  onFatal(message: string): void;
  onConnection?(state: ConnectionState): void;
}

/**
 * 前端與後端溝通的介面。
 * - local：HTTP 呼叫 + SSE 推播（npm run dev）
 * - firebase：HTTP 呼叫 Azure Functions + 直接監聽 Firestore
 */
export interface Backend {
  mode: 'local' | 'firebase' | 'practice';
  /** 登入並回傳自己的 uid */
  init(): Promise<string>;
  call<T = unknown>(action: string, body?: object): Promise<T>;
  watch(gameId: string, handlers: WatchHandlers): () => void;
  /** 本機模式：這台電腦的區網 IP（讓同 Wi-Fi 的手機加入） */
  lanHosts?(): Promise<string[]>;
  /** 目前身分（init 之後才有） */
  account?(): Account;
  /**
   * 用 Google 登入；訪客身分會直接升級成 Google 帳號，uid 不變。
   * 如果這個 Google 帳號以前就登入過，會切換過去，並把訪客在 gameId 房間的座位和對戰紀錄搬過去。
   */
  signInWithGoogle?(ctx?: { gameId?: string }): Promise<Account>;
  /** 登出後變回新的訪客 */
  signOut?(): Promise<Account>;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function callApi<T>(base: string, token: string, action: string, body: object = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK', '連不上伺服器，請確認後端有啟動', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 回應
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? 'HTTP_' + res.status, err?.message ?? `伺服器回應錯誤（${res.status}）`, res.status);
  }
  return data as T;
}

export async function createBackend(): Promise<Backend> {
  const env = import.meta.env;
  const apiBase = env.VITE_API_BASE || '/api';
  if (env.VITE_BACKEND === 'firebase') {
    const { createFirebaseBackend } = await import('./firebaseBackend');
    return createFirebaseBackend(apiBase);
  }
  const { createLocalBackend } = await import('./localBackend');
  return createLocalBackend(apiBase);
}
