import { useEffect, useRef } from 'react';

interface Props {
  titleZh: string;
  titleEn: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  titleZh,
  titleEn,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(18,33,31,.45)' }}
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={titleEn}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm border p-4"
        style={{ background: 'var(--card)', borderColor: 'var(--line)', borderRadius: 2 }}
      >
        <h2 className="zh text-[20px] font-semibold">{titleZh}</h2>
        <p className="eyebrow mb-3">{titleEn}</p>
        <p className="mb-4 text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
          {body}
        </p>
        <div className="flex gap-2">
          <button
            ref={cancel}
            type="button"
            onClick={onCancel}
            className="flex-1 border text-[14px]"
            style={{ minHeight: 44, borderRadius: 2, borderColor: 'var(--line)' }}
          >
            取消 Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 text-[14px] font-semibold text-white"
            style={{ minHeight: 44, borderRadius: 2, background: 'var(--plum)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
