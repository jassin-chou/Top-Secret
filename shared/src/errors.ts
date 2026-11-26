export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_CLOSED'
  | 'ROOM_EXPIRED'
  | 'SAME_ACCOUNT'
  | 'TOO_FAST'
  | 'NOT_PLAYER'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'ALREADY_SHOT'
  | 'INVALID_PLACEMENT'
  | 'OPPONENT_LEFT'
  | 'INTERNAL';

export class GameError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  INVALID_PLACEMENT: 400,
  UNAUTHENTICATED: 401,
  NOT_PLAYER: 403,
  NOT_FOUND: 404,
  ROOM_FULL: 409,
  ROOM_CLOSED: 409,
  ROOM_EXPIRED: 410,
  SAME_ACCOUNT: 409,
  TOO_FAST: 429,
  WRONG_PHASE: 409,
  NOT_YOUR_TURN: 409,
  ALREADY_SHOT: 409,
  OPPONENT_LEFT: 409,
  INTERNAL: 500,
};
