import type { GameRecord, HistoryEntry, PlayerStats } from '@planehunt/shared';

export interface GameStore {
  /** 建立新房間；房號已存在時回傳 false */
  create(rec: GameRecord): Promise<boolean>;
  get(id: string): Promise<GameRecord | null>;
  /**
   * 原子性地讀取 → 套用規則 → 寫回。fn 必須是純函式（Firestore 交易衝突時會重跑）。
   * 房間不存在時丟出 NOT_FOUND。
   */
  update(id: string, fn: (rec: GameRecord) => GameRecord): Promise<GameRecord>;
  /** 寫入一筆對戰紀錄（同一個 entry.id 重複寫入會覆蓋） */
  addHistory(uid: string, entry: HistoryEntry): Promise<void>;
  /** 最新的在前面 */
  listHistory(uid: string, limit: number): Promise<HistoryEntry[]>;
  /** 一筆對戰紀錄（含逐步紀錄）；找不到回傳 null */
  getHistory(uid: string, id: string): Promise<HistoryEntry | null>;
  /** 戰績與獎牌；沒有資料時回傳 null */
  getStats(uid: string): Promise<PlayerStats | null>;
  /** 原子性地更新戰績（fn 必須是純函式） */
  updateStats(uid: string, fn: (s: PlayerStats | null) => PlayerStats): Promise<PlayerStats>;
  /** 所有用 Google 登入過的玩家（排行榜用） */
  listRankedPlayers(): Promise<Array<{ uid: string; stats: PlayerStats }>>;
}

/** 本機模式額外提供訂閱功能，給 SSE 推播使用 */
export interface ObservableStore extends GameStore {
  subscribe(id: string, listener: (rec: GameRecord) => void): () => void;
}

export function isObservable(store: GameStore): store is ObservableStore {
  return typeof (store as ObservableStore).subscribe === 'function';
}
