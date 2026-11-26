/**
 * 暱稱：第一次進來用彈窗取一次，之後記在這台裝置上，不再佔首頁的位置。
 * 想改的話，選玩法／加入房間的頁面上有「改暱稱」。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { loadName, saveName } from '../lib/util';

interface NicknameApi {
  name: string;
  /** 打開彈窗；存好之後執行 then（例如接著換頁） */
  ask(then?: () => void): void;
  /** 直接存（例如邀請連結頁面上的輸入框） */
  set(name: string): void;
}

const Ctx = createContext<NicknameApi>({ name: '', ask: () => {}, set: () => {} });

export function useNickname() {
  return useContext(Ctx);
}

export function NicknameProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState(() => loadName().trim());
  const [open, setOpen] = useState(false);
  const after = useRef<(() => void) | null>(null);

  const ask = useCallback((then?: () => void) => {
    after.current = then ?? null;
    setOpen(true);
  }, []);

  const set = useCallback((n: string) => {
    saveName(n);
    setName(n);
  }, []);

  const save = (n: string) => {
    set(n);
    setOpen(false);
    const then = after.current;
    after.current = null;
    then?.();
  };

  return (
    <Ctx.Provider value={{ name, ask, set }}>
      {children}
      <NicknameDialog
        open={open}
        initial={name}
        first={!name}
        onSave={save}
        onClose={() => {
          after.current = null;
          setOpen(false);
        }}
      />
    </Ctx.Provider>
  );
}

function NicknameDialog({
  open,
  initial,
  first,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: string;
  first: boolean;
  onSave(name: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setValue(initial);
      setError(false);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, initial]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = value.trim();
    if (!n) {
      setError(true);
      return;
    }
    onSave(n);
  };

  return (
    <dialog
      ref={ref}
      className="modal modal--narrow"
      aria-labelledby="nickname-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <form className="modal-body nickname-form" onSubmit={submit}>
          <header className="modal-head">
            <h2 id="nickname-title">{first ? '先取個暱稱' : '改暱稱'}</h2>
            <button type="button" className="modal-close" aria-label="關閉" onClick={onClose}>
              ×
            </button>
          </header>
          <p className="muted">{first ? '對戰時對手會看到這個名字。只要取一次，之後都會記得。' : '之後開的房間會用新的暱稱。'}</p>
          <div className="field field--big">
            <label htmlFor="nickname">暱稱</label>
            <input
              id="nickname"
              value={value}
              maxLength={12}
              autoComplete="nickname"
              placeholder="例如：阿明"
              autoFocus
              aria-invalid={error || undefined}
              aria-describedby={error ? 'nickname-error' : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setError(false);
              }}
            />
            {error && (
              <span id="nickname-error" className="field-error">
                暱稱不能空白
              </span>
            )}
          </div>
          <button type="submit" className="btn">
            {first ? '開始玩' : '儲存'}
          </button>
        </form>
      )}
    </dialog>
  );
}

/** 標題旁的小按鈕：顯示目前暱稱，點了可以改 */
export function NicknameChip() {
  const { name, ask } = useNickname();
  if (!name) return null;
  return (
    <button type="button" className="nickname-chip" onClick={() => ask()} aria-label={`暱稱：${name}，點一下修改`}>
      <span className="nickname-chip-name">{name}</span>
      <span className="nickname-chip-edit">改暱稱</span>
    </button>
  );
}
