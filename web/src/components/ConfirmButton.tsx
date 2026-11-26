import { useEffect, useState } from 'react';

/** 第一次點擊先變成「確定？」，3 秒內再點一次才執行（避免誤觸，也不用跳出 alert） */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'btn btn--quiet',
  needConfirm = true,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm(): void;
  className?: string;
  needConfirm?: boolean;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      className={`${className}${armed ? ' is-armed' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (!needConfirm || armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
