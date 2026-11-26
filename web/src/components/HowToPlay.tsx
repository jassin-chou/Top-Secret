import { useEffect, useRef } from 'react';
import { NO_DIAGONAL_TOUCH, type GameMode } from '@planehunt/shared';
import { ModeExample } from './Examples';
import { Legend } from './Legend';

const APART = NO_DIAGONAL_TOUCH ? '完全分開：不能重疊、不能貼在一起，斜角也不能碰到' : '分開，不能貼在一起';

const RULES: Record<GameMode, { title: string; steps: string[] }> = {
  plane: {
    title: '飛機版怎麼玩',
    steps: [
      '開房的人決定飛機形狀（也可以自己畫）、格子數量和每人幾架。',
      `雙方各自在方格裡藏好飛機，可以朝上下左右四個方向擺。兩架以上時，飛機之間要${APART}。`,
      '輪流挑對方的一格開火，會知道打中機頭、打中機身，還是沒打中。',
      '機身只是線索，機頭才算數。先找出對方所有機頭的人獲勝。',
    ],
  },
  ab: {
    title: '幾A幾B怎麼玩',
    steps: [
      '開房的人決定幾位數（3 到 5 位），以及數字可不可以重複。',
      '雙方各自設定一組數字密碼，對手看不到。0 也可以放在第一位。',
      '輪流猜對方的密碼。每猜一次會得到「幾A幾B」：A 是數字和位置都對，B 是數字對但位置不對。',
      '先猜中對方密碼的人獲勝（4 位數就是猜到 4A0B）。',
    ],
  },
  ship: {
    title: '海戰棋怎麼玩',
    steps: [
      '開房的人決定艦隊（經典、大艦隊、小艦隊或自訂）和格子數量。',
      `雙方各自擺好艦隊，船只能橫放或直放。船之間要${APART}。`,
      '輪流挑對方的一格開火，會知道打中還是沒打中。一艘船的每一格都被打中時會宣告「擊沉」，並把整艘船框起來。',
      '擊沉的船周圍一定是空的，畫面會自動點上淡淡的小點。先擊沉對方所有船的人獲勝。',
    ],
  },
};

/** 「怎麼玩」說明彈窗（原生 dialog：按 Esc 或點外面都能關） */
export function HowToPlay({ mode, onClose }: { mode: GameMode | null; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (mode && !d.open) d.showModal();
    if (!mode && d.open) d.close();
  }, [mode]);

  const rules = RULES[mode ?? 'plane'];
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="howto-title"
      onClose={onClose}
      onClick={(e) => {
        // 點到內容以外（背景）就關閉
        if (e.target === ref.current) onClose();
      }}
    >
      {mode && (
        <div className="modal-body">
          <header className="modal-head">
            <h2 id="howto-title">{rules.title}</h2>
            <button type="button" className="modal-close" aria-label="關閉說明" onClick={onClose}>
              ×
            </button>
          </header>
          <div className={`howto${mode === 'ab' ? ' howto--stack' : ''}`}>
            <div className="howto-figure">
              <ModeExample mode={mode} />
            </div>
            <ol className="howto-steps">
              {rules.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          {mode === 'ab' ? (
            <p className="hint">對戰時可以用「數字筆記」把確定沒有、確定有的數字標起來，幫自己推理。</p>
          ) : (
            <>
              <Legend mode={mode} showPencil={false} />
              <p className="hint">對戰時可以在對手的棋盤按右鍵（手機用「標記模式」）點上鉛筆小點，幫自己記住推理。</p>
            </>
          )}
          <button type="button" className="btn" onClick={onClose}>
            知道了
          </button>
        </div>
      )}
    </dialog>
  );
}
