import type { ReactNode } from 'react';
import { shipShape, type GameMode } from '@planehunt/shared';
import { PencilMark, ShipShape, ShotMark } from './marks';

function Swatch({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const w = wide ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${w} 1`} className={`legend-swatch${wide ? ' legend-swatch--wide' : ''}`} aria-hidden="true">
      <rect x={0} y={0} width={w} height={1} className="grid-paper" />
      <rect x={0} y={0} width={w} height={1} className="legend-frame" />
      {children}
    </svg>
  );
}

export function Legend({ mode = 'plane', showPencil = true }: { mode?: GameMode; showPencil?: boolean }) {
  return (
    <ul className="legend">
      <li>
        <Swatch>
          <ShotMark shot={{ x: 0, y: 0, r: 'miss', n: 0 }} />
        </Swatch>
        沒打中
      </li>
      {mode === 'ship' ? (
        <>
          <li>
            <Swatch>
              <ShotMark shot={{ x: 0, y: 0, r: 'hit', n: 0 }} />
            </Swatch>
            打中船
          </li>
          <li>
            <Swatch wide>
              <ShipShape plane={{ x: 0, y: 0, dir: 'left' }} shape={shipShape(2)} variant="sunk" />
              <ShotMark shot={{ x: 0, y: 0, r: 'hit', n: 0 }} />
              <ShotMark shot={{ x: 1, y: 0, r: 'sunk', n: 0 }} />
            </Swatch>
            擊沉（整艘船框起來）
          </li>
        </>
      ) : (
        <>
          <li>
            <Swatch>
              <ShotMark shot={{ x: 0, y: 0, r: 'body', n: 0 }} />
            </Swatch>
            打中機身
          </li>
          <li>
            <Swatch>
              <ShotMark shot={{ x: 0, y: 0, r: 'head', n: 0 }} />
            </Swatch>
            打中機頭
          </li>
        </>
      )}
      {showPencil && (
        <li>
          <Swatch>
            <PencilMark cell={{ x: 0, y: 0 }} />
          </Swatch>
          你的筆記（右鍵或標記模式）
        </li>
      )}
    </ul>
  );
}
