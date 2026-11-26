import { EventEmitter } from 'node:events';
import { GameError, type GameRecord, type HistoryEntry, type PlayerStats } from '@planehunt/shared';
import type { ObservableStore } from './types.js';

/** 本機測試用：資料存在記憶體，伺服器重啟就清空 */
export class MemoryStore implements ObservableStore {
  private games = new Map<string, GameRecord>();
  private history = new Map<string, Map<string, HistoryEntry>>();
  private stats = new Map<string, PlayerStats>();
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async create(rec: GameRecord): Promise<boolean> {
    if (this.games.has(rec.pub.id)) return false;
    this.games.set(rec.pub.id, structuredClone(rec));
    this.emitter.emit(rec.pub.id, structuredClone(rec));
    return true;
  }

  async get(id: string): Promise<GameRecord | null> {
    const rec = this.games.get(id);
    return rec ? structuredClone(rec) : null;
  }

  async update(id: string, fn: (rec: GameRecord) => GameRecord): Promise<GameRecord> {
    // fn 是同步的，JS 單執行緒下「讀 → 改 → 寫」不會被打斷，不需要額外上鎖
    const cur = this.games.get(id);
    if (!cur) throw new GameError('NOT_FOUND', '找不到這個房間');
    const next = fn(structuredClone(cur));
    this.games.set(id, next);
    this.emitter.emit(id, structuredClone(next));
    return structuredClone(next);
  }

  async addHistory(uid: string, entry: HistoryEntry): Promise<void> {
    let mine = this.history.get(uid);
    if (!mine) this.history.set(uid, (mine = new Map()));
    mine.set(entry.id, structuredClone(entry));
  }

  async listHistory(uid: string, limit: number): Promise<HistoryEntry[]> {
    const all = [...(this.history.get(uid)?.values() ?? [])];
    return structuredClone(all.sort((a, b) => b.finishedAt - a.finishedAt).slice(0, limit));
  }

  async getStats(uid: string): Promise<PlayerStats | null> {
    const s = this.stats.get(uid);
    return s ? structuredClone(s) : null;
  }

  async updateStats(uid: string, fn: (s: PlayerStats | null) => PlayerStats): Promise<PlayerStats> {
    const next = fn(await this.getStats(uid));
    this.stats.set(uid, structuredClone(next));
    return structuredClone(next);
  }

  async listRankedPlayers(): Promise<Array<{ uid: string; stats: PlayerStats }>> {
    return [...this.stats.entries()].filter(([, s]) => s.google).map(([uid, s]) => ({ uid, stats: structuredClone(s) }));
  }

  subscribe(id: string, listener: (rec: GameRecord) => void): () => void {
    this.emitter.on(id, listener);
    return () => this.emitter.off(id, listener);
  }

  /** 清掉太久沒動的房間 */
  sweep(maxIdleMs: number, now = Date.now()): number {
    let removed = 0;
    for (const [id, rec] of this.games) {
      if (now - rec.pub.updatedAt > maxIdleMs) {
        this.games.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
