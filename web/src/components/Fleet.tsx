import { shipName } from '@planehunt/shared';

/** 一艘小船圖示（長度 len 格） */
export function ShipIcon({ len, state = 'normal' }: { len: number; state?: 'normal' | 'sunk' | 'placed' | 'active' }) {
  return (
    <svg viewBox={`0 0 ${len} 1`} className={`ship-icon ship-icon--${state}`} style={{ width: `${len * 14}px` }} aria-hidden="true">
      <rect x={0.08} y={0.12} width={len - 0.16} height={0.76} rx={0.38} className="ship-icon-hull" />
      {Array.from({ length: len }, (_, i) => (
        <circle key={i} cx={i + 0.5} cy={0.5} r={0.1} className="ship-icon-window" />
      ))}
      {state === 'sunk' && <line x1={0.1} y1={0.5} x2={len - 0.1} y2={0.5} className="ship-icon-strike" />}
    </svg>
  );
}

/** 整支艦隊的小圖（開房選艦隊、等待室、規則摘要） */
export function FleetPreview({ fleet }: { fleet: number[] }) {
  return (
    <span className="fleet-preview" role="img" aria-label={`艦隊：${fleet.join('、')} 格`}>
      {fleet.map((len, i) => (
        <ShipIcon key={i} len={len} />
      ))}
    </span>
  );
}

/** 對戰時的艦隊狀態：哪幾艘已經沉了 */
export function FleetStatus({ fleet, sunk, label }: { fleet: number[]; sunk: Set<number>; label: string }) {
  return (
    <div className="fleet-status">
      <p className="fleet-status-label">
        {label}
        <span className="muted">
          {' '}
          {sunk.size} / {fleet.length} 艘
        </span>
      </p>
      <ul>
        {fleet.map((len, i) => (
          <li key={i} className={sunk.has(i) ? 'is-sunk' : ''}>
            <ShipIcon len={len} state={sunk.has(i) ? 'sunk' : 'normal'} />
            <span>{shipName(len)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
