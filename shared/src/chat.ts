/**
 * 對戰中的聊天：快捷句（含「戳一下」）與自己打的短訊息。
 * 訊息存在公開的棋局文件裡（最多留最近 30 則），雙方即時看得到。
 */
import { GameError } from './errors.js';

export const QUICK_LINES = [
  { id: 'slow', text: '太慢了！', poke: true },
  { id: 'win', text: '我會贏喔！' },
  { id: 'close', text: '好險！' },
  { id: 'nice', text: '厲害！' },
  { id: 'haha', text: '哈哈哈' },
  { id: 'argh', text: '可惡！' },
] as const;

export type QuickLineId = (typeof QUICK_LINES)[number]['id'];

/** 「戳一下」用的快捷句：對方會震動、畫面會晃一下 */
export const POKE_LINE: QuickLineId = 'slow';

export const CHAT_MAX_LEN = 40;
export const CHAT_KEEP = 30;
/** 同一個人兩則訊息至少隔多久 */
export const CHAT_GAP_MS = 1000;
/** 同一個人兩次「戳」至少隔多久 */
export const POKE_GAP_MS = 5000;

export function isQuickLine(id: unknown): id is QuickLineId {
  return QUICK_LINES.some((l) => l.id === id);
}

export function quickLineText(id: QuickLineId): string {
  return QUICK_LINES.find((l) => l.id === id)?.text ?? '';
}

/** 整理自己打的字：去掉控制字元、多餘空白，最多 40 個字 */
export function cleanChatText(raw: unknown): string {
  if (typeof raw !== 'string') throw new GameError('BAD_REQUEST', '訊息格式不正確');
  const text = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) throw new GameError('BAD_REQUEST', '先打點字再送出');
  const chars = Array.from(text);
  if (chars.length > CHAT_MAX_LEN) throw new GameError('BAD_REQUEST', `訊息最多 ${CHAT_MAX_LEN} 個字`);
  return text;
}
