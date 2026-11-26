import { GameError, HTTP_STATUS } from '@planehunt/shared';
import type { ApiConfig } from '../config.js';
import type { Authenticator } from '../auth/index.js';
import { bearerToken } from '../auth/index.js';
import type { GameStore } from '../store/types.js';
import { isAction, runAction } from './actions.js';

export interface ApiRequest {
  method: string;
  action: string;
  authorization: string | null | undefined;
  origin: string | null | undefined;
  rawBody: string;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const MAX_BODY = 16 * 1024;

export function corsHeaders(config: ApiConfig, origin: string | null | undefined): Record<string, string> {
  const base = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (config.allowedOrigins.includes('*')) return { ...base, 'Access-Control-Allow-Origin': '*' };
  if (origin && config.allowedOrigins.includes(origin.replace(/\/$/, ''))) {
    return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  return { Vary: 'Origin' };
}

function json(status: number, data: unknown, extra: Record<string, string>): ApiResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
    body: JSON.stringify(data),
  };
}

/** 與框架無關的 HTTP 處理：dev server 與 Azure Functions 都轉成這個格式呼叫 */
export function createApi(config: ApiConfig, deps: { store: GameStore; auth: Authenticator }) {
  return async function handle(req: ApiRequest): Promise<ApiResponse> {
    const cors = corsHeaders(config, req.origin);
    const method = req.method.toUpperCase();

    if (method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
    if (method === 'GET' && req.action === 'health') return json(200, { ok: true, mode: config.mode }, cors);

    try {
      if (method !== 'POST') throw new GameError('BAD_REQUEST', '請使用 POST');
      if (!isAction(req.action)) throw new GameError('NOT_FOUND', `沒有 ${req.action} 這個動作`);
      if (req.rawBody.length > MAX_BODY) throw new GameError('BAD_REQUEST', '請求內容太大');

      let body: Record<string, unknown> = {};
      if (req.rawBody.trim()) {
        try {
          const parsed = JSON.parse(req.rawBody);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
        } catch {
          throw new GameError('BAD_REQUEST', '請求內容不是合法的 JSON');
        }
      }

      const me = await deps.auth.verifyToken(bearerToken(req.authorization));
      const result = await runAction({ store: deps.store, auth: deps.auth, me }, me.uid, req.action, body);
      return json(200, result, cors);
    } catch (e) {
      if (e instanceof GameError) {
        return json(HTTP_STATUS[e.code], { error: { code: e.code, message: e.message } }, cors);
      }
      console.error('[api] 未預期的錯誤', e);
      return json(500, { error: { code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' } }, cors);
    }
  };
}
