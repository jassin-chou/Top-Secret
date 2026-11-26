/**
 * Vercel Function 入口：所有 /api/<動作> 的請求都進到這裡。
 * 由 scripts/build-vercel.mjs 打包成 .vercel/output/functions/api.func。
 *
 * 需要的環境變數（在 Vercel 專案的 Settings → Environment Variables 設定）：
 *   FIREBASE_SERVICE_ACCOUNT  Firebase 服務帳戶金鑰（JSON 原文或 base64）
 *   ALLOWED_ORIGINS           （選填）允許其他網域呼叫 API；前後端同網域時不用設
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FirebaseAuth } from './auth/index.js';
import { createApi } from './core/http.js';
import { FirestoreStore } from './store/firestore.js';

// 前端和 API 在同一個網域，瀏覽器不需要 CORS；只有明確設定時才開放其他網域
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

let api: ReturnType<typeof createApi> | undefined;
function getApi() {
  api ??= createApi({ mode: 'firebase', allowedOrigins }, { store: new FirestoreStore(), auth: new FirebaseAuth() });
  return api;
}

const MAX_BODY = 64 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** /api/create → create；路由設定也會把動作名稱放在 ?action= */
export function actionFrom(url: string | undefined): string {
  const u = new URL(url ?? '/', 'http://localhost');
  const fromQuery = u.searchParams.get('action');
  if (fromQuery) return fromQuery;
  const m = /^\/api\/([^/?]+)/.exec(u.pathname);
  return m ? decodeURIComponent(m[1]) : '';
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const method = req.method ?? 'GET';
    const rawBody = method === 'POST' ? await readBody(req) : '';
    const out = await getApi()({
      method,
      action: actionFrom(req.url),
      authorization: req.headers.authorization,
      origin: req.headers.origin,
      rawBody,
    });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  } catch (e) {
    console.error('[vercel] 處理請求失敗', e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' } }));
  }
}
