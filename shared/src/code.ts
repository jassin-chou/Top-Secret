/** 幾A幾B 的規則 */
import type { AbSettings } from './types.js';

export const MIN_DIGITS = 3;
export const MAX_DIGITS = 5;
export const DEFAULT_AB: AbSettings = { mode: 'ab', digits: 4, repeat: false };

/**
 * 計分：A = 數字和位置都對；B = 數字對但位置不對。
 * 數字可以重複時，同一個數字最多算到雙方都有的次數（例如密碼 1123、猜 1111 → 2A0B）。
 */
export function abScore(secret: string, guess: string): { a: number; b: number } {
  let a = 0;
  const cs = new Array(10).fill(0);
  const cg = new Array(10).fill(0);
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) a++;
    cs[secret.charCodeAt(i) - 48]++;
    cg[guess.charCodeAt(i) - 48]++;
  }
  let common = 0;
  for (let d = 0; d < 10; d++) common += Math.min(cs[d], cg[d]);
  return { a, b: common - a };
}

/** 驗證密碼或猜測。回傳 [整理後的字串, null] 或 [null, 錯誤訊息] */
export function checkCode(input: unknown, settings: AbSettings): [string, null] | [null, string] {
  if (typeof input !== 'string') return [null, `請輸入 ${settings.digits} 位數字`];
  const code = input.replace(/\s/g, '');
  if (!/^\d+$/.test(code)) return [null, '只能輸入 0 到 9 的數字'];
  if (code.length !== settings.digits) return [null, `要剛好 ${settings.digits} 位數`];
  if (!settings.repeat && new Set(code).size !== code.length) return [null, '這一局數字不能重複'];
  return [code, null];
}

export function randomCode(settings: AbSettings, rng: () => number = Math.random): string {
  const pool = '0123456789'.split('');
  let out = '';
  for (let i = 0; i < settings.digits; i++) {
    const j = Math.floor(rng() * pool.length);
    out += pool[j];
    if (!settings.repeat) pool.splice(j, 1);
  }
  return out;
}

/** 這個設定下所有可能的密碼（最多 5 位可重複 = 10 萬組） */
const allCache = new Map<string, string[]>();
export function allCodes(settings: AbSettings): string[] {
  const key = `${settings.digits}-${settings.repeat}`;
  const hit = allCache.get(key);
  if (hit) return hit;
  const out: string[] = [];
  const max = 10 ** settings.digits;
  for (let n = 0; n < max; n++) {
    const s = String(n).padStart(settings.digits, '0');
    if (settings.repeat || new Set(s).size === s.length) out.push(s);
  }
  allCache.set(key, out);
  return out;
}
