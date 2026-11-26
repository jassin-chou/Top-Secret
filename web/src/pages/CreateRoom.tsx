import { useEffect, useMemo, useState } from 'react';
import {
  BOT_LEVELS,
  BOT_LEVEL_NAME,
  DEFAULT_AB,
  MAX_DIGITS,
  MIN_DIGITS,
  FLEET_PRESETS,
  MAX_PLANES,
  MAX_SHIPS,
  MAX_SHIP_LEN,
  MAX_SIZE,
  MIN_PLANES,
  MIN_SHIP_LEN,
  MIN_SIZE,
  NO_DIAGONAL_TOUCH,
  SHAPE_PRESETS,
  checkFleet,
  checkShape,
  isFeasible,
  maxFeasiblePlanes,
  shapeBounds,
  shapeTooBig,
  shipName,
  type BotLevel,
  type GameMode,
  type Settings,
  type ShapeDef,
} from '@planehunt/shared';
import { ShapePreview } from '../components/ShapePreview';
import { ShapeEditor } from '../components/ShapeEditor';
import { FleetPreview, ShipIcon } from '../components/Fleet';

const SETTINGS_KEY = 'planehunt.lastSettings';

interface Saved {
  mode: GameMode;
  choice: string;
  custom: ShapeDef | null;
  size: number;
  planes: number;
  level: BotLevel;
  fleetChoice: string;
  /** 自訂艦隊：每種長度幾艘（索引 = 長度） */
  counts: number[];
  digits: number;
  repeat: boolean;
}

const DEFAULT_COUNTS = [0, 0, 1, 2, 1, 1, 0]; // 經典艦隊：2、3、3、4、5

function loadSaved(): Saved {
  const fallback: Saved = {
    mode: 'plane',
    choice: 'classic',
    custom: null,
    size: 10,
    planes: 3,
    level: 'normal',
    fleetChoice: 'classic',
    counts: DEFAULT_COUNTS,
    digits: DEFAULT_AB.digits,
    repeat: DEFAULT_AB.repeat,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Saved>;
    const okInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
    return {
      mode: s.mode === 'ship' || s.mode === 'ab' ? s.mode : 'plane',
      choice: s.choice === 'custom' || SHAPE_PRESETS.some((p) => p.id === s.choice) ? s.choice! : 'classic',
      custom: s.custom ? checkShape(s.custom)[0] : null,
      size: okInt(s.size, MIN_SIZE, MAX_SIZE) ? s.size! : 10,
      planes: okInt(s.planes, MIN_PLANES, MAX_PLANES) ? s.planes! : 3,
      level: BOT_LEVELS.includes(s.level as BotLevel) ? s.level! : 'normal',
      fleetChoice: s.fleetChoice === 'custom' || FLEET_PRESETS.some((f) => f.id === s.fleetChoice) ? s.fleetChoice! : 'classic',
      counts:
        Array.isArray(s.counts) && s.counts.length === MAX_SHIP_LEN + 1 && s.counts.every((c) => okInt(c, 0, MAX_SHIPS))
          ? s.counts
          : DEFAULT_COUNTS,
      digits: okInt(s.digits, MIN_DIGITS, MAX_DIGITS) ? s.digits! : DEFAULT_AB.digits,
      repeat: typeof s.repeat === 'boolean' ? s.repeat : DEFAULT_AB.repeat,
    };
  } catch {
    return fallback;
  }
}

function countsToFleet(counts: number[]): number[] {
  const fleet: number[] = [];
  for (let len = MAX_SHIP_LEN; len >= MIN_SHIP_LEN; len--) for (let i = 0; i < counts[len]; i++) fleet.push(len);
  return fleet;
}

interface Props {
  mode: GameMode;
  busy: boolean;
  onCreate(settings: Settings): void;
  onPractice(settings: Settings, level: BotLevel): void;
}

/** 開房設定細項：飛機形狀或艦隊、格子數量、飛機數量；幾A幾B 是位數與可否重複 */
export function CreateRoom({ mode, busy, onCreate, onPractice }: Props) {
  const saved = useMemo(loadSaved, []);
  const [size, setSize] = useState(saved.size);
  const [level, setLevel] = useState<BotLevel>(saved.level);
  // 飛機版
  const [choice, setChoice] = useState(saved.choice);
  const [custom, setCustom] = useState<ShapeDef | null>(saved.custom);
  const [customError, setCustomError] = useState<string | null>(null);
  const [planes, setPlanes] = useState(saved.planes);
  // 海戰棋
  const [fleetChoice, setFleetChoice] = useState(saved.fleetChoice);
  const [counts, setCounts] = useState<number[]>(saved.counts);
  // 幾A幾B
  const [digits, setDigits] = useState(saved.digits);
  const [repeat, setRepeat] = useState(saved.repeat);

  // ----- 飛機版的計算 -----
  const preset = SHAPE_PRESETS.find((p) => p.id === choice);
  const shape: ShapeDef | null = preset ?? (customError ? null : custom);
  const planeTooBig = shape ? shapeTooBig(shape, size) : false;
  const maxPlanes = useMemo(
    () => (mode === 'plane' && shape && !planeTooBig ? maxFeasiblePlanes(size, shape) : 0),
    [mode, shape, size, planeTooBig],
  );
  const effectivePlanes = Math.min(planes, Math.max(maxPlanes, MIN_PLANES));

  // 換了形狀或棋盤後，如果原本的飛機數放不下，就自動調到放得下的最大值
  useEffect(() => {
    if (mode === 'plane' && maxPlanes >= MIN_PLANES && planes > maxPlanes) setPlanes(maxPlanes);
  }, [mode, maxPlanes, planes]);

  // ----- 海戰棋的計算 -----
  const fleetPreset = FLEET_PRESETS.find((f) => f.id === fleetChoice);
  const fleet = fleetPreset ? fleetPreset.fleet : countsToFleet(counts);
  const fleetError = checkFleet(fleet)[1];
  const fleetKey = fleet.join(',');
  const fleetFits = useMemo(
    () => mode === 'ship' && !fleetError && fleet[0] <= size && isFeasible({ mode: 'ship', size, fleet }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, fleetKey, size, fleetError],
  );
  const fleetCells = fleet.reduce((a, b) => a + b, 0);

  // ----- 狀態文字 -----
  const apart = NO_DIAGONAL_TOUCH ? '完全分開：不能重疊、不能貼在一起，斜角也不能碰到' : '分開，不能貼在一起';
  let status: { text: string; error: boolean };
  let settings: Settings | null = null;
  if (mode === 'ab') {
    let combos = 1;
    for (let i = 0; i < digits; i++) combos *= repeat ? 10 : 10 - i;
    status = {
      text: `猜 ${digits} 位數，${repeat ? '數字可以重複' : '數字不重複'}，總共有 ${combos.toLocaleString()} 種可能的密碼。`,
      error: false,
    };
    settings = { mode: 'ab', digits, repeat };
  } else if (mode === 'plane') {
    const minSize = shape ? Math.max(MIN_SIZE, shapeBounds(shape.cells).w, shapeBounds(shape.cells).h) : 0;
    if (!shape) status = { text: '自己畫的飛機還沒完成，請照畫布下方的提示修改', error: true };
    else if (planeTooBig) status = { text: `「${shape.name}」至少要 ${minSize}×${minSize} 的棋盤`, error: true };
    else if (maxPlanes < MIN_PLANES) status = { text: '這個棋盤放不下這種飛機，請把格子調大', error: true };
    else {
      status = {
        text: `${size}×${size} 方格，每人 ${effectivePlanes} 架「${shape.name}」（每架 ${shape.cells.length} 格）。這個大小最多放得下 ${maxPlanes} 架。`,
        error: false,
      };
      settings = { mode: 'plane', size, planes: effectivePlanes, shape };
    }
  } else if (fleetError) status = { text: fleetError, error: true };
  else if (fleet[0] > size) status = { text: `${shipName(fleet[0])}（${fleet[0]} 格）放不進 ${size}×${size} 的棋盤`, error: true };
  else if (!fleetFits) status = { text: `${size}×${size} 放不下這支艦隊（船之間要完全分開），請把格子調大或減少船隻`, error: true };
  else {
    status = { text: `${size}×${size} 方格，每人 ${fleet.length} 艘船，共 ${fleetCells} 格。`, error: false };
    settings = { mode: 'ship', size, fleet };
  }

  const canCreate = !!settings && !busy;

  const remember = () => {
    try {
      const data: Saved = { mode, choice, custom, size, planes: effectivePlanes, level, fleetChoice, counts, digits, repeat };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  };

  const create = () => {
    if (!settings || busy) return;
    remember();
    onCreate(settings);
  };

  const practice = () => {
    if (!settings || busy) return;
    remember();
    onPractice(settings, level);
  };

  const setCount = (len: number, delta: number) => {
    const next = [...counts];
    const total = next.reduce((a, b) => a + b, 0);
    if (delta > 0 && total >= MAX_SHIPS) return;
    next[len] = Math.max(0, next[len] + delta);
    setCounts(next);
  };

  const sizes = [];
  for (let s = MIN_SIZE; s <= MAX_SIZE; s++) sizes.push(s);
  const counts1to5 = [];
  for (let n = MIN_PLANES; n <= MAX_PLANES; n++) counts1to5.push(n);
  const sizeDim = (s: number) =>
    mode === 'plane' ? !!shape && shapeTooBig(shape, s) : fleet.length > 0 && (fleet[0] > s || fleetCells > s * s);

  return (
    <div className="create">
      {mode === 'ab' && (
        <>
          <fieldset className="setting">
            <legend>密碼幾位數</legend>
            <div className="chips">
              {Array.from({ length: MAX_DIGITS - MIN_DIGITS + 1 }, (_, i) => MIN_DIGITS + i).map((d) => (
                <label key={d} className={`chip-option${digits === d ? ' is-on' : ''}`}>
                  <input type="radio" name="digits" value={d} checked={digits === d} onChange={() => setDigits(d)} />
                  {d} 位{d === 4 ? '（經典）' : ''}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="setting">
            <legend>數字可以重複嗎</legend>
            <div className="chips">
              <label className={`chip-option${!repeat ? ' is-on' : ''}`}>
                <input type="radio" name="repeat" checked={!repeat} onChange={() => setRepeat(false)} />
                不可以（經典）
              </label>
              <label className={`chip-option${repeat ? ' is-on' : ''}`}>
                <input type="radio" name="repeat" checked={repeat} onChange={() => setRepeat(true)} />
                可以，例如 1123
              </label>
            </div>
          </fieldset>
        </>
      )}

      {mode === 'ab' ? null : mode === 'plane' ? (
        <fieldset className="setting">
          <legend>飛機形狀</legend>
          <div className="shape-cards">
            {SHAPE_PRESETS.map((p) => (
              <label key={p.id} className={`shape-card${choice === p.id ? ' is-on' : ''}`}>
                <input type="radio" name="shape" value={p.id} checked={choice === p.id} onChange={() => setChoice(p.id)} />
                <ShapePreview shape={p} decorative />
                <span className="shape-name">{p.name}</span>
                <span className="shape-cells">{p.cells.length} 格</span>
              </label>
            ))}
            <label className={`shape-card shape-card--draw${choice === 'custom' ? ' is-on' : ''}`}>
              <input type="radio" name="shape" value="custom" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
              {custom && !customError ? (
                <ShapePreview shape={custom} decorative />
              ) : (
                <svg viewBox="0 0 10 10" className="shape-preview" aria-hidden="true">
                  <path d="M2.5 7.5 L7 3 M6 2 L8 4 M2 8.2 L2.6 6.8 L3.2 7.4 Z" className="pencil-icon" />
                </svg>
              )}
              <span className="shape-name">自己畫</span>
              <span className="shape-cells">{custom && !customError ? `${custom.cells.length} 格` : '畫畫看'}</span>
            </label>
          </div>
          {choice === 'custom' && (
            <ShapeEditor
              initial={custom}
              onChange={(s, err) => {
                setCustom(s);
                setCustomError(err);
              }}
            />
          )}
        </fieldset>
      ) : (
        <fieldset className="setting">
          <legend>艦隊</legend>
          <div className="fleet-cards">
            {FLEET_PRESETS.map((f) => (
              <label key={f.id} className={`fleet-card${fleetChoice === f.id ? ' is-on' : ''}`}>
                <input type="radio" name="fleet" value={f.id} checked={fleetChoice === f.id} onChange={() => setFleetChoice(f.id)} />
                <span className="fleet-card-name">{f.name}</span>
                <FleetPreview fleet={f.fleet} />
                <span className="shape-cells">
                  {f.fleet.length} 艘，{f.note}
                </span>
              </label>
            ))}
            <label className={`fleet-card${fleetChoice === 'custom' ? ' is-on' : ''}`}>
              <input type="radio" name="fleet" value="custom" checked={fleetChoice === 'custom'} onChange={() => setFleetChoice('custom')} />
              <span className="fleet-card-name">自訂艦隊</span>
              {countsToFleet(counts).length ? <FleetPreview fleet={countsToFleet(counts)} /> : <span className="muted">還沒有船</span>}
              <span className="shape-cells">自己決定每種船幾艘</span>
            </label>
          </div>
          {fleetChoice === 'custom' && (
            <div className="fleet-editor">
              {Array.from({ length: MAX_SHIP_LEN }, (_, i) => MAX_SHIP_LEN - i).map((len) => (
                <div key={len} className="fleet-row">
                  <ShipIcon len={len} />
                  <span className="fleet-row-name">
                    {shipName(len)}
                    <span className="muted"> {len} 格</span>
                  </span>
                  <span className="stepper">
                    <button type="button" aria-label={`減少一艘${shipName(len)}`} onClick={() => setCount(len, -1)} disabled={counts[len] === 0}>
                      −
                    </button>
                    <span className="stepper-value" aria-live="polite">
                      {counts[len]}
                    </span>
                    <button type="button" aria-label={`增加一艘${shipName(len)}`} onClick={() => setCount(len, 1)}>
                      +
                    </button>
                  </span>
                </div>
              ))}
              <p className="hint">最多 {MAX_SHIPS} 艘船。</p>
            </div>
          )}
        </fieldset>
      )}

      {mode !== 'ab' && (
      <fieldset className="setting">
        <legend>格子數量</legend>
        <div className="chips">
          {sizes.map((s) => (
            <label key={s} className={`chip-option${size === s ? ' is-on' : ''}${sizeDim(s) ? ' is-dim' : ''}`}>
              <input type="radio" name="size" value={s} checked={size === s} onChange={() => setSize(s)} />
              {s}×{s}
            </label>
          ))}
        </div>
      </fieldset>
      )}

      {mode === 'plane' && (
        <fieldset className="setting">
          <legend>每人幾架飛機</legend>
          <div className="chips">
            {counts1to5.map((n) => {
              const disabled = n > maxPlanes;
              return (
                <label key={n} className={`chip-option${effectivePlanes === n && !disabled ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}>
                  <input
                    type="radio"
                    name="planes"
                    value={n}
                    disabled={disabled}
                    checked={effectivePlanes === n}
                    onChange={() => setPlanes(n)}
                  />
                  {n} 架
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {mode !== 'ab' && (
        <p className="hint">
          {mode === 'plane' ? `兩架以上時，飛機之間要${apart}。` : `船只能橫放或直放，船之間要${apart}。`}
        </p>
      )}

      <p className={`create-status${status.error ? ' is-error' : ''}`} role="status">
        {status.text}
      </p>
      <div className="create-actions">
        <button type="button" className="btn" onClick={create} disabled={!canCreate}>
          {busy ? '開房間中…' : '開房間'}
        </button>
        <div className="practice">
          <p className="practice-label">還沒有對手？用同樣的設定跟電腦練習</p>
          <div className="practice-row">
            <fieldset className="segmented segmented--small">
              <legend className="sr-only">電腦難度</legend>
              {BOT_LEVELS.map((l) => (
                <label key={l} className={level === l ? 'is-on' : ''}>
                  <input type="radio" name="bot-level" checked={level === l} onChange={() => setLevel(l)} />
                  {BOT_LEVEL_NAME[l]}
                </label>
              ))}
            </fieldset>
            <button type="button" className="btn btn--outline" onClick={practice} disabled={!canCreate}>
              跟電腦練習
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
