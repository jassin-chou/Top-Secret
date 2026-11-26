/**
 * 「真正的」後端（本機伺服器或 Firebase），給不在乎目前是不是練習模式的元件用：
 * 例如結算彈窗要查「這局拿到哪些新獎牌」，練習模式的 backend 沒有戰績資料。
 */
import { createContext, useContext } from 'react';
import type { MedalId, PlayerStats } from '@planehunt/shared';
import type { Backend } from '../net/backend';

export const MainBackend = createContext<Backend | null>(null);

export function useMainBackend() {
  return useContext(MainBackend);
}

/** 後端回傳的自己戰績（對手只給人數） */
export type MyStats = Omit<PlayerStats, 'opponents' | 'medals'> & {
  opponentCount: number;
  medals: Partial<Record<MedalId, { at: number; game: string }>>;
};

export interface LeaderRowView {
  rank: number;
  name: string;
  games: number;
  wins: number;
  rate: number;
  bestStreak: number;
  medals: MedalId[];
  me: boolean;
}
