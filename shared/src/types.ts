import type { QuickLineId } from './chat.js';
/** 朝向（飛機：機頭朝哪邊；船：從錨點往哪邊延伸） */
export type Dir = 'up' | 'right' | 'down' | 'left';

/**
 * 棋盤上的一個棋子（飛機或船）：錨點格 + 朝向。
 * 飛機的錨點是機頭；船的錨點是船的一端。
 * 名稱沿用 Plane 是因為最早只有飛機版。
 */
export interface Plane {
  x: number;
  y: number;
  dir: Dir;
}

export type Part = 'head' | 'body';

export interface Cell {
  x: number;
  y: number;
}

export interface PlaneCell extends Cell {
  part: Part;
}

/**
 * 開火結果
 * - 飛機版：head 機頭 / body 機身 / miss 沒打中
 * - 海戰棋：hit 打中 / sunk 打中而且整艘船沉了 / miss 沒打中
 */
export type ShotResult = 'head' | 'body' | 'miss' | 'hit' | 'sunk';

export interface Shot extends Cell {
  r: ShotResult;
  /** 全局序號，用來排序與標示「最新一發」 */
  n: number;
  /** 只有 sunk 才有：沉掉的是艦隊裡第幾艘（對應 settings.fleet 的索引） */
  k?: number;
}

export type GameStatus = 'waiting' | 'placing' | 'playing' | 'finished' | 'closed';

/**
 * 棋子形狀：以錨點為原點 (0,0) 的相對座標（y 向下），代表朝向 up 時的樣子。
 * 飛機版 cells[0] 是機頭；海戰棋的船是一直線。
 */
export interface ShapeDef {
  name: string;
  cells: Cell[];
}

export type GameMode = 'plane' | 'ship' | 'ab';

/** 飛機版：每人 planes 架一樣形狀的飛機，找齊所有機頭獲勝 */
export interface PlaneSettings {
  mode: 'plane';
  /** 棋盤邊長（5 = 5×5） */
  size: number;
  planes: number;
  shape: ShapeDef;
}

/** 海戰棋：每人一支艦隊（fleet = 每艘船的長度），擊沉全部船隻獲勝 */
export interface ShipSettings {
  mode: 'ship';
  size: number;
  fleet: number[];
}

/** 幾A幾B：各自設一組 digits 位數的密碼，先猜中對方的人獲勝 */
export interface AbSettings {
  mode: 'ab';
  /** 密碼位數 */
  digits: number;
  /** 數字可不可以重複 */
  repeat: boolean;
}

/** 有棋盤的玩法（飛機版、海戰棋） */
export type BoardSettings = PlaneSettings | ShipSettings;

export type Settings = BoardSettings | AbSettings;

/** 幾A幾B 的一次猜測：g 猜的數字、a 位置和數字都對、b 數字對但位置不對 */
export interface Guess {
  g: string;
  a: number;
  b: number;
  n: number;
}

export interface PlayerInfo {
  name: string;
  ready: boolean;
  left: boolean;
  wins: number;
}

export interface LastShot extends Cell {
  by: string;
  r: ShotResult;
  n: number;
  k?: number;
}

/** 被擊沉的船（打中的每一格都已公開，所以位置也可以公開） */
export interface SunkPiece extends Plane {
  k: number;
}

/**
 * 公開棋局狀態（Firestore: games/{id}）。雙方都看得到，絕不能放棋子位置。
 * 注意：Firestore 不接受 undefined，選填欄位要嘛不寫、要嘛用 null。
 */
export interface GameDoc {
  id: string;
  status: GameStatus;
  settings: Settings;
  hostId: string;
  playerIds: string[];
  players: Record<string, PlayerInfo>;
  /** 目前輪到誰開火 */
  turn: string | null;
  /** 本局先攻者（下一局換對方先攻） */
  firstTurn: string | null;
  /** shots[uid] = uid 打出去的每一發 */
  shots: Record<string, Shot[]>;
  /** found[uid] = uid 已經解決的目標數（飛機版：找到的機頭；海戰棋：擊沉的船） */
  found: Record<string, number>;
  /** sunk[uid] = uid 擊沉的船（只有海戰棋） */
  sunk: Record<string, SunkPiece[]>;
  winner: string | null;
  endReason: 'cleared' | 'forfeit' | null;
  /** 結束後公開雙方棋子位置 */
  reveal: Record<string, Plane[]> | null;
  /** 幾A幾B：guesses[uid] = uid 猜過的每一次 */
  guesses: Record<string, Guess[]>;
  lastGuess: (Guess & { by: string }) | null;
  /** 幾A幾B：結束後公開雙方密碼 */
  codes: Record<string, string> | null;
  rematch: string[];
  round: number;
  seq: number;
  last: LastShot | null;
  /** 聊天（最近 30 則）；舊的房間可能沒有這個欄位 */
  chat?: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** 一則聊天：快捷句（line）或自己打的字（text）二選一 */
export interface ChatMessage {
  /** 流水號，越後面越大 */
  n: number;
  by: string;
  line?: QuickLineId;
  text?: string;
  at: number;
}

/** 私密資料（Firestore: games/{id}/private/{uid}），只有本人與後端讀得到 */
export interface PrivateDoc {
  planes: Plane[] | null;
  /** 幾A幾B 的密碼 */
  secret: string | null;
}

/** 後端在一次交易中處理的完整資料 */
export interface GameRecord {
  pub: GameDoc;
  priv: Record<string, PrivateDoc>;
}

/** 推給單一玩家看的視角 */
export interface GameView {
  game: GameDoc;
  me: PrivateDoc | null;
}
