import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { GameError, normalizeRoomCode, viewFor } from '@planehunt/shared';
import type { ApiConfig } from './config.js';
import type { Authenticator } from './auth/index.js';
import { corsHeaders, createApi } from './core/http.js';
import { isObservable, type GameStore } from './store/types.js';

export interface ServerDeps {
  config: ApiConfig;
  store: GameStore;
  auth: Authenticator;
}

function readBody(req: IncomingMessage, limit = 32 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new GameError('BAD_REQUEST', '請求內容太大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * SSE 即時推播（只在本機模式使用；上線時改由前端直接監聽 Firestore）。
 * EventSource 不能帶 header，所以 token 放在 query string。
 */
async function handleStream(deps: ServerDeps, req: IncomingMessage, res: ServerResponse, url: URL) {
  const cors = corsHeaders(deps.config, req.headers.origin);
  const { store } = deps;
  const fail = (status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
    res.end(JSON.stringify({ error: { message } }));
  };
  if (!isObservable(store)) return fail(400, 'Firebase 模式請直接監聽 Firestore');

  let uid: string;
  let gameId: string;
  try {
    gameId = normalizeRoomCode(url.searchParams.get('gameId'));
    uid = (await deps.auth.verifyToken(url.searchParams.get('token') ?? '')).uid;
  } catch (e) {
    return fail(e instanceof GameError ? 400 : 500, (e as Error).message);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...cors,
  });
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const rec = await store.get(gameId);
  if (!rec) {
    send('gone', { message: '找不到這個房間，可能已過期或伺服器重新啟動過' });
    res.end();
    return;
  }
  send('view', viewFor(rec, uid));

  const unsubscribe = store.subscribe(gameId, (next) => send('view', viewFor(next, uid)));
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

/** VMware、VirtualBox、Hyper-V、WSL、Docker 這類虛擬網卡，手機連不到 */
const VIRTUAL_NIC = /vmware|virtualbox|vbox|vethernet|hyper-v|wsl|docker|loopback|bluetooth|藍牙/i;

/** 這台電腦在區網上的 IPv4 位址（給同一個 Wi-Fi 的手機連線用），排除虛擬網卡，Wi-Fi 排前面 */
export function lanAddresses(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const found: Array<{ ip: string; wifi: boolean }> = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL_NIC.test(name)) continue;
    for (const n of list ?? []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      // 192.168.56.x 是 VirtualBox 預設的 host-only 網段；169.254.x 是沒拿到 IP 時的自動位址
      if (n.address.startsWith('192.168.56.') || n.address.startsWith('169.254.')) continue;
      found.push({ ip: n.address, wifi: /wi-?fi|wlan|wireless|無線/i.test(name) });
    }
  }
  return found.sort((a, b) => Number(b.wifi) - Number(a.wifi)).map((f) => f.ip);
}

export function startServer(deps: ServerDeps, port: number, host = '0.0.0.0'): Promise<Server> {
  const api = createApi(deps.config, deps);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/api\/([a-z]+)\/?$/i.exec(url.pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('絕對機密 API：請使用 /api/<action>');
      return;
    }
    const action = match[1];

    if (action === 'stream' && req.method === 'GET') {
      await handleStream(deps, req, res, url);
      return;
    }

    if (action === 'health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(deps.config, req.headers.origin) });
      res.end(JSON.stringify({ ok: true, mode: deps.config.mode, lan: lanAddresses() }));
      return;
    }

    let rawBody = '';
    try {
      rawBody = req.method === 'POST' ? await readBody(req) : '';
    } catch {
      res.writeHead(413);
      res.end();
      return;
    }
    const out = await api({
      method: req.method ?? 'GET',
      action,
      authorization: req.headers.authorization,
      origin: req.headers.origin,
      rawBody,
    });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
