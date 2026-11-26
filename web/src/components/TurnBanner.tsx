/**
 * 對戰畫面上方的回合提示：一整條橫向橢圓色帶，一行顯示完。
 *
 *   輪到你   → 深藍底白字，左邊有會呼吸的小圓點
 *   輪到對手 → 淺灰底灰字
 *   贏 / 輸  → 螢光黃底紅字 / 淺灰底
 *
 * 右邊的小膠囊是「上一手」：一般結果是淡色；
 * 找到機頭、擊沉船時換成醒目的顏色（自己打到是黃色，被打到是紅色）。
 */
import type { ReactNode } from 'react';

export type TurnKind = 'mine' | 'theirs' | 'win' | 'lose';
export type TurnEvent = 'good' | 'bad' | null;

interface Props {
  kind: TurnKind;
  status: string;
  detail?: string;
  event?: TurnEvent;
  /** 換一手就換一個 key，讓重大事件的動畫重新播一次 */
  eventKey?: number | string;
  /** 色帶右邊的按鈕（例如「太慢了！」） */
  action?: ReactNode;
}

export function TurnBanner({ kind, status, detail, event = null, eventKey, action }: Props) {
  return (
    <div className={`banner banner--${kind}`} role="status" aria-live="polite">
      <div className={`banner-pill${detail ? '' : ' is-solo'}`} key={kind}>
        <span className="banner-dot" aria-hidden="true" />
        <span className="banner-main">{status}</span>
        {detail && (
          <span key={eventKey} className={`banner-sub${event ? ` banner-sub--${event}` : ''}`}>
            {event && (
              <span className="banner-burst" aria-hidden="true">
                {event === 'good' ? '★' : '!'}
              </span>
            )}
            <span className="banner-sub-text">{detail}</span>
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

/** 練習模式的電腦叫「電腦（普通）」，色帶上只寫「電腦」比較好塞進一行 */
export function shortName(name: string) {
  return name.replace(/（[^）]*）$/, '') || name;
}
