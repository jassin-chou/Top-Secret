import { CLASSIC_SHAPE, shipShape, surroundingCells, type GameMode } from '@planehunt/shared';
import { Board } from './Board';
import { EmptyHint, PencilMark, PlaneShape, ShipShape, ShotMark } from './marks';

/** 飛機版示意：一架飛機，機頭已被找到 */
export function PlaneExample() {
  return (
    <Board size={6} label="示意圖：一架藏在方格裡的飛機，機頭已被找到" variant="side">
      <PlaneShape plane={{ x: 3, y: 1, dir: 'up' }} shape={CLASSIC_SHAPE} />
      <ShotMark shot={{ x: 5, y: 0, r: 'miss', n: 1 }} />
      <ShotMark shot={{ x: 0, y: 4, r: 'miss', n: 2 }} />
      <ShotMark shot={{ x: 1, y: 2, r: 'body', n: 3 }} />
      <ShotMark shot={{ x: 3, y: 4, r: 'body', n: 4 }} />
      <ShotMark shot={{ x: 3, y: 1, r: 'head', n: 5 }} />
      <PencilMark cell={{ x: 5, y: 4 }} />
      <PencilMark cell={{ x: 0, y: 5 }} />
    </Board>
  );
}

const SUNK = { plane: { x: 0, y: 0, dir: 'left' as const }, shape: shipShape(3) };

/** 海戰棋示意：一艘被擊沉（周圍自動標成空格），另一艘打中一格還沒沉 */
export function ShipExample() {
  return (
    <Board size={6} label="示意圖：海戰棋，一艘船已被擊沉，另一艘被打中一格" variant="side">
      <ShipShape plane={SUNK.plane} shape={SUNK.shape} variant="sunk" />
      {surroundingCells([SUNK], 6).map((c) => (
        <EmptyHint key={`${c.x},${c.y}`} cell={c} />
      ))}
      <ShotMark shot={{ x: 0, y: 0, r: 'hit', n: 1 }} />
      <ShotMark shot={{ x: 1, y: 0, r: 'hit', n: 2 }} />
      <ShotMark shot={{ x: 2, y: 0, r: 'sunk', n: 3 }} />
      <ShotMark shot={{ x: 4, y: 3, r: 'hit', n: 4 }} />
      <ShotMark shot={{ x: 5, y: 1, r: 'miss', n: 5 }} />
      <ShotMark shot={{ x: 1, y: 4, r: 'miss', n: 6 }} />
      <ShotMark shot={{ x: 3, y: 5, r: 'miss', n: 7 }} />
    </Board>
  );
}

/** 幾A幾B 示意：密碼 4817 被一步步猜中 */
export function AbExample() {
  const rows: Array<[string, string, string]> = [
    ['1234', '0A2B', '有 1 和 4，但位置都不對'],
    ['4871', '2A2B', '4、8 位置對；7、1 數字對但位置不對'],
    ['4817', '4A0B', '全對，猜中了！'],
  ];
  return (
    <div className="ab-example" role="img" aria-label="示意：對手的密碼是 4817，猜 1234 得到 0A2B，猜 4871 得到 2A2B，猜 4817 得到 4A0B">
      <p className="ab-example-secret">
        對手的密碼 <span className="code-tiles code-tiles--sm">{'4817'.split('').map((d) => <span key={d} className="code-tile">{d}</span>)}</span>
      </p>
      <ol>
        {rows.map(([g, r, note]) => (
          <li key={g}>
            <span className="guess-code">{g}</span>
            <span className="guess-ab">{r}</span>
            <span className="ab-example-note">{note}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ModeExample({ mode }: { mode: GameMode }) {
  if (mode === 'ab') return <AbExample />;
  return mode === 'ship' ? <ShipExample /> : <PlaneExample />;
}
