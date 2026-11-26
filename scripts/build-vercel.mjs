// 產生 Vercel 部署用的檔案（Build Output API v3）：.vercel/output/
//
//   static/              前端網頁（web 的 Vite 建置結果）
//   functions/api.func/  後端 API（一個 Vercel Function，處理所有 /api/<動作>）
//   config.json          路由：/api/create → /api?action=create
//
// Vercel 部署時會自動執行（vercel.json 的 buildCommand），也可以在本機跑：npm run vercel-build
// 需要的環境變數見 DEPLOY.md；缺少時會直接停下來告訴你少了哪一個。
import { build } from 'esbuild';
import { nodeFileTrace } from '@vercel/nft';
import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel/output');
const fnTmp = join(root, 'server/.vercel-fn');
const NODE_RUNTIME = 'nodejs22.x';
// 函式執行的機房：預設香港（離台灣的 Firestore asia-east1 最近）。設成 none 就交給 Vercel 專案設定決定
const REGION = (process.env.VERCEL_FUNCTION_REGION ?? 'hkg1').trim();

function fail(lines) {
  console.error('\n✗ 無法建置 Vercel 部署檔：');
  for (const l of [].concat(lines)) console.error('  ' + l);
  console.error('  詳細設定方式請看 DEPLOY.md。\n');
  process.exit(1);
}

// ---------- 1. 檢查環境變數 ----------
const env = { ...process.env };
// 前端固定用 Firebase 模式，API 跟網頁在同一個網域
env.VITE_BACKEND = 'firebase';
env.VITE_API_BASE = '/api';
env.VITE_USE_EMULATORS = 'false';
if (!env.VITE_FIREBASE_AUTH_DOMAIN?.trim() && env.VITE_FIREBASE_PROJECT_ID?.trim()) {
  env.VITE_FIREBASE_AUTH_DOMAIN = `${env.VITE_FIREBASE_PROJECT_ID.trim()}.firebaseapp.com`;
}

const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'FIREBASE_SERVICE_ACCOUNT'];
const missing = required.filter((k) => !env[k]?.trim());
if (missing.length) {
  fail([
    `缺少環境變數：${missing.join('、')}`,
    '請到 Vercel 專案 → Settings → Environment Variables 新增（Production 要勾），存好後重新部署。',
  ]);
}

let sa;
try {
  const raw = env.FIREBASE_SERVICE_ACCOUNT.trim();
  sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
} catch {
  fail('FIREBASE_SERVICE_ACCOUNT 不是合法的 JSON：請把下載的金鑰檔「整個內容」貼上（從第一個 { 到最後一個 }）。');
}
if (!sa?.private_key || !sa?.client_email || !sa?.project_id) {
  fail('FIREBASE_SERVICE_ACCOUNT 看起來不是服務帳戶金鑰：裡面應該要有 project_id、client_email、private_key。');
}
if (sa.project_id !== env.VITE_FIREBASE_PROJECT_ID.trim()) {
  fail(`專案 ID 對不起來：金鑰是「${sa.project_id}」，VITE_FIREBASE_PROJECT_ID 是「${env.VITE_FIREBASE_PROJECT_ID}」。`);
}

// ---------- 2. 前端 ----------
console.log('▸ 建置前端（web）…');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const web = spawnSync(npm, ['run', 'build', '-w', 'web'], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
if (web.status !== 0) fail('前端建置失敗，請看上面的錯誤訊息。');

// ---------- 3. 後端：打包成一個檔案，再把 firebase-admin 等執行期需要的檔案一起複製進去 ----------
console.log('▸ 打包後端（server → Vercel Function）…');
await rm(out, { recursive: true, force: true });
await rm(fnTmp, { recursive: true, force: true });
await mkdir(fnTmp, { recursive: true });

const entry = join(fnTmp, 'index.cjs');
await build({
  // 包一層 CommonJS：module.exports 直接就是 handler，Vercel 的 Node 啟動器最穩定
  stdin: {
    contents: "const m = require('../src/vercel.ts');\nmodule.exports = m.default;\nmodule.exports.default = m.default;\n",
    resolveDir: fnTmp,
    sourcefile: 'vercel-entry.cjs',
    loader: 'js',
  },
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // firebase-admin 內含 gRPC 與 protobuf 定義檔，不打包，改用 nft 追蹤後原樣複製
  external: ['firebase-admin', 'firebase-admin/*'],
  logLevel: 'warning',
});

const { fileList, warnings } = await nodeFileTrace([entry], { base: root });
for (const w of warnings) {
  // 只是提醒、不影響執行的警告就略過
  if (!/Failed to resolve dependency/.test(String(w?.message ?? w))) continue;
  console.warn('  (nft)', String(w?.message ?? w));
}

const funcDir = join(out, 'functions/api.func');
let copied = 0;
for (const rel of fileList) {
  const src = join(root, rel);
  const dst = join(funcDir, rel);
  await mkdir(dirname(dst), { recursive: true });
  try {
    await copyFile(src, dst); // copyFile 會跟著符號連結複製實際內容
    copied++;
  } catch (e) {
    if (e.code !== 'EISDIR') throw e;
  }
}

// ---------- 3b. 只有 ES Module 的套件轉成 CommonJS ----------
// Vercel 的 Node 執行環境不允許用 require() 載入 ES Module（本機的 Node 22 可以，所以本機測不出來）。
// firebase-admin → jwks-rsa 會 require('jose')，而 jose 6 只有 ES Module，所以在函式資料夾裡的副本改成 CommonJS。
const ESM_ONLY = ['jose'];
for (const rel of fileList) {
  const m = /(?:^|\/)node_modules\/([^/]+)\/package\.json$/.exec(rel);
  if (!m || !ESM_ONLY.includes(m[1])) continue;
  const pkgDir = join(funcDir, dirname(rel));
  const pkgFile = join(pkgDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgFile, 'utf8'));
  const dot = pkg.exports?.['.'];
  const entryRel = typeof dot === 'string' ? dot : (dot?.require ?? dot?.node ?? dot?.default ?? dot?.import ?? pkg.main);
  await build({
    entryPoints: [join(pkgDir, entryRel)],
    outfile: join(pkgDir, 'dist/vercel-cjs/index.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'warning',
  });
  pkg.main = './dist/vercel-cjs/index.cjs';
  pkg.exports = { '.': './dist/vercel-cjs/index.cjs', './package.json': './package.json' };
  delete pkg.module;
  await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  ${m[1]} ${pkg.version} → CommonJS`);
}

const vcConfig = {
  runtime: NODE_RUNTIME,
  handler: 'server/.vercel-fn/index.cjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  maxDuration: 10,
};
if (REGION && REGION !== 'none') vcConfig.regions = [REGION];
await writeFile(join(funcDir, '.vc-config.json'), JSON.stringify(vcConfig, null, 2) + '\n');

// ---------- 4. 靜態檔案與路由 ----------
await cp(join(root, 'web/dist'), join(out, 'static'), { recursive: true });
await writeFile(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Vite 產生的檔名帶雜湊，可以放心長期快取
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        // /api/create → api.func，動作名稱放在 ?action=
        { src: '^/api/([^/]+)/?$', dest: '/api?action=$1' },
        { handle: 'filesystem' },
      ],
    },
    null,
    2,
  ) + '\n',
);

await rm(fnTmp, { recursive: true, force: true });

// ---------- 5. 自我檢查：用跟 Vercel 一樣「不能 require ES Module」的條件把函式載入一次 ----------
// 複製到暫存資料夾再跑，避免 Node 往上層找到專案的 node_modules、蓋掉缺檔的問題
console.log('▸ 檢查 API 函式在 Vercel 上載不載得起來…');
const checkDir = await mkdtemp(join(tmpdir(), 'vercel-fn-check-'));
await cp(funcDir, checkDir, { recursive: true });
const checkScript = `
const done = (ok, msg) => { console.log(msg); process.exit(ok ? 0 : 1); };
process.on('uncaughtException', (e) => done(false, String((e && e.stack) || e)));
const handler = require('./${vcConfig.handler}');
if (typeof handler !== 'function') done(false, 'handler 不是函式');
const { initializeApp } = require('firebase-admin/app');
require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
// 連到不存在的 Firestore 模擬器：只為了讓 gRPC 與 proto 檔真的載入一次
const db = getFirestore(initializeApp({ projectId: 'build-check' }));
const bad = (e) => /ERR_REQUIRE_ESM|ERR_REQUIRE_ASYNC_MODULE|Cannot find module|ENOENT/.test(String(e && (e.code + ' ' + e.message)));
setTimeout(() => done(true, 'ok'), 3000);
db.doc('check/x').get().then(() => done(true, 'ok'), (e) => (bad(e) ? done(false, String(e.stack || e)) : done(true, 'ok')));
`;
const flags = process.allowedNodeEnvironmentFlags.has('--no-experimental-require-module') ? ['--no-experimental-require-module'] : [];
const check = spawnSync(process.execPath, [...flags, '-e', checkScript], {
  cwd: checkDir,
  env: { PATH: process.env.PATH, FIRESTORE_EMULATOR_HOST: '127.0.0.1:9', GOOGLE_CLOUD_PROJECT: 'build-check' },
  encoding: 'utf8',
  timeout: 30000,
});
await rm(checkDir, { recursive: true, force: true });
if (check.status !== 0) {
  console.error(check.stdout, check.stderr);
  fail('API 函式在 Vercel 的執行環境會載入失敗（上面是錯誤訊息）。請把這段訊息貼給開發者。');
}

console.log(`✓ Vercel 部署檔已產生：.vercel/output（API 函式含 ${copied} 個檔案，機房 ${vcConfig.regions?.[0] ?? '依專案設定'}）`);
