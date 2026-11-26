import { getFirestore, Timestamp, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { GameError, normalizeStats, type GameDoc, type GameRecord, type HistoryEntry, type PlayerStats, type PrivateDoc } from '@planehunt/shared';
import { adminApp } from '../firebase-admin.js';
import type { GameStore } from './types.js';

/** 房間在最後一次動作後保留多久（可搭配 Firestore TTL 政策自動刪除 expireAt 過期的文件） */
const KEEP_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Firestore 資料結構：
 *   games/{roomCode}                 公開狀態（雙方即時監聽）
 *   games/{roomCode}/private/{uid}   該玩家的飛機位置（security rules 只允許本人讀取）
 *   users/{uid}/history/{entryId}    對戰紀錄（只透過後端讀寫）
 *   players/{uid}                    戰績、獎牌、排行榜名字（只透過後端讀寫）
 * 所有寫入都由後端以 Admin SDK 進行，前端沒有任何寫入權限。
 */
export class FirestoreStore implements GameStore {
  private db: Firestore;

  constructor(db?: Firestore) {
    this.db = db ?? getFirestore(adminApp());
    try {
      this.db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // 已經設定過（同一個 Functions instance 重複載入時）就略過
    }
  }

  private gameRef(id: string) {
    return this.db.collection('games').doc(id);
  }

  private privRef(game: DocumentReference, uid: string) {
    return game.collection('private').doc(uid);
  }

  private toDoc(pub: GameDoc) {
    return { ...pub, expireAt: Timestamp.fromMillis(pub.updatedAt + KEEP_MS) };
  }

  private fromDoc(data: DocumentData): GameDoc {
    const { expireAt: _ignored, ...pub } = data;
    return pub as GameDoc;
  }

  private historyCol(uid: string) {
    return this.db.collection('users').doc(uid).collection('history');
  }

  async addHistory(uid: string, entry: HistoryEntry): Promise<void> {
    await this.historyCol(uid).doc(entry.id).set(entry);
  }

  async listHistory(uid: string, limit: number): Promise<HistoryEntry[]> {
    const snap = await this.historyCol(uid).orderBy('finishedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data() as HistoryEntry);
  }

  private playerRef(uid: string) {
    return this.db.collection('players').doc(uid);
  }

  async getStats(uid: string): Promise<PlayerStats | null> {
    const snap = await this.playerRef(uid).get();
    return snap.exists ? normalizeStats(snap.data() as PlayerStats) : null;
  }

  async updateStats(uid: string, fn: (s: PlayerStats | null) => PlayerStats): Promise<PlayerStats> {
    const ref = this.playerRef(uid);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = fn(snap.exists ? normalizeStats(snap.data() as PlayerStats) : null);
      tx.set(ref, next);
      return next;
    });
  }

  async listRankedPlayers(): Promise<Array<{ uid: string; stats: PlayerStats }>> {
    const snap = await this.db.collection('players').where('google', '==', true).limit(2000).get();
    return snap.docs.map((d) => ({ uid: d.id, stats: normalizeStats(d.data() as PlayerStats) }));
  }

  async create(rec: GameRecord): Promise<boolean> {
    const ref = this.gameRef(rec.pub.id);
    const batch = this.db.batch();
    batch.create(ref, this.toDoc(rec.pub));
    for (const [uid, p] of Object.entries(rec.priv)) batch.set(this.privRef(ref, uid), p);
    try {
      await batch.commit();
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === 6 /* ALREADY_EXISTS */) return false;
      throw e;
    }
  }

  async get(id: string): Promise<GameRecord | null> {
    const ref = this.gameRef(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const pub = this.fromDoc(snap.data()!);
    const priv: Record<string, PrivateDoc> = {};
    const refs = pub.playerIds.map((uid) => this.privRef(ref, uid));
    const snaps = refs.length ? await this.db.getAll(...refs) : [];
    snaps.forEach((s, i) => (priv[pub.playerIds[i]] = (s.exists ? s.data() : { planes: null }) as PrivateDoc));
    return { pub, priv };
  }

  async update(id: string, fn: (rec: GameRecord) => GameRecord): Promise<GameRecord> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.gameRef(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new GameError('NOT_FOUND', '找不到這個房間');
      const pub = this.fromDoc(snap.data()!);

      const refs = pub.playerIds.map((uid) => this.privRef(ref, uid));
      const snaps = refs.length ? await tx.getAll(...refs) : [];
      const priv: Record<string, PrivateDoc> = {};
      const before: Record<string, string> = {};
      snaps.forEach((s, i) => {
        const uid = pub.playerIds[i];
        priv[uid] = (s.exists ? s.data() : { planes: null }) as PrivateDoc;
        before[uid] = s.exists ? JSON.stringify(priv[uid]) : '';
      });

      const next = fn({ pub, priv });
      tx.set(ref, this.toDoc(next.pub));
      // 私密文件只有變動時才寫，省 Firestore 寫入額度
      for (const [uid, p] of Object.entries(next.priv)) {
        if (JSON.stringify(p) !== before[uid]) tx.set(this.privRef(ref, uid), p);
      }
      // 座位換給別的身分後（訪客改用 Google 帳號），舊身分的私密文件刪掉
      for (const uid of pub.playerIds) {
        if (!(uid in next.priv)) tx.delete(this.privRef(ref, uid));
      }
      return next;
    });
  }
}
