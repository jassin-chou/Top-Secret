import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

let cached: App | undefined;

/**
 * 初始化 firebase-admin。
 * - 上線：設定 FIREBASE_SERVICE_ACCOUNT（服務帳戶 JSON 原文或 base64）
 * - 模擬器：設定 FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST，不需要金鑰
 */
export function adminApp(): App {
  if (cached) return cached;
  const existing = getApps();
  if (existing.length) return (cached = existing[0]);

  const sa = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (sa) {
    const json = JSON.parse(sa.startsWith('{') ? sa : Buffer.from(sa, 'base64').toString('utf8'));
    cached = initializeApp({ credential: cert(json), projectId: json.project_id });
  } else {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'demo-planehunt';
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      console.warn('[firebase] 沒有設定 FIREBASE_SERVICE_ACCOUNT，也沒有連模擬器；將嘗試使用預設憑證');
    }
    cached = initializeApp({ projectId });
  }
  return cached;
}
