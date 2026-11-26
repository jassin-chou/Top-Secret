/**
 * 本機開發伺服器
 *   npm run dev            → 記憶體模式（不需要任何雲端帳號）
 *   npm run dev:firebase   → 連到 Firebase 模擬器（讀 server/.env.firebase）
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { FirebaseAuth, LocalAuth, type Authenticator } from './auth/index.js';
import type { GameStore } from './store/types.js';
import { MemoryStore } from './store/memory.js';
import { startServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--firebase')) {
  const envFile = join(here, '..', '.env.firebase');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  process.env.BACKEND_MODE ??= 'firebase';
}

const config = loadConfig();
const port = Number(process.env.PORT ?? 8787);

let store: GameStore;
let auth: Authenticator;
if (config.mode === 'firebase') {
  const { FirestoreStore } = await import('./store/firestore.js');
  store = new FirestoreStore();
  auth = new FirebaseAuth();
} else {
  const mem = new MemoryStore();
  // 6 小時沒動作的房間自動清掉
  setInterval(() => mem.sweep(6 * 60 * 60 * 1000), 10 * 60 * 1000).unref();
  store = mem;
  auth = new LocalAuth();
}

await startServer({ config, store, auth }, port);
console.log(`\n  ✈  絕對機密 API 已啟動：http://localhost:${port}/api  （模式：${config.mode}）`);
if (config.mode === 'firebase') {
  console.log(`     Firestore 模擬器：${process.env.FIRESTORE_EMULATOR_HOST ?? '（未設定，將連線到正式環境！）'}`);
}
