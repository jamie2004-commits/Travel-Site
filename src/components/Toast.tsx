import { useEffect } from 'react';

interface Props {
  message: string | null;
  onDone: () => void;
}

/** Brief confirmation after adding from the library. Does not move the user. */
export default function Toast({ message, onDone }: Props) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDone, 2200);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <p
        className="zh px-4 py-2 text-[14px] text-white shadow-lg"
        style={{ borderRadius: 2, background: 'var(--ink)' }}
      >
        {message}
      </p>
    </div>
  );
}
