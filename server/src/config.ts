export type BackendMode = 'local' | 'firebase';

export interface ApiConfig {
  /** local：記憶體 + 本機 token；firebase：Firestore + Firebase Auth */
  mode: BackendMode;
  /** 允許的前端來源，逗號分隔；* 代表全部 */
  allowedOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, fallback: BackendMode = 'local'): ApiConfig {
  const raw = (env.BACKEND_MODE ?? fallback).trim().toLowerCase();
  if (raw !== 'local' && raw !== 'firebase') {
    throw new Error(`BACKEND_MODE 只能是 local 或 firebase，目前是 "${raw}"`);
  }
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return { mode: raw, allowedOrigins };
}
