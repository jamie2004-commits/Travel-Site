interface Props {
  sampleDays: number;
  sampleItems: number;
  onPick: (from: 'sample' | 'blank') => void;
}

/**
 * First visit only. The sample trip used to load silently, which left a new
 * arrival looking at eight full days with no idea whether they were theirs.
 */
export default function StartDialog({ sampleDays, sampleItems, onPick }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: 'rgba(18,33,31,.5)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Start a trip"
        className="w-full max-w-lg border p-5"
        style={{ background: 'var(--card)', borderColor: 'var(--line)', borderRadius: 2 }}
      >
        <p className="eyebrow">Itinerary Builder</p>
        <h2 className="mt-1 text-[26px] leading-tight font-black">Where to start</h2>
        <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
          Pick the day you are planning, browse the places, add them to it. Everything stays in
          this browser, so choose a starting point and come back to it whenever.
        </p>

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() => onPick('sample')}
            className="border p-3 text-left"
            style={{
              borderRadius: 2,
              borderColor: 'var(--accent)',
              background: 'var(--accent-soft)',
            }}
          >
            <span className="block text-[18px] font-semibold">Use the sample trip</span>
            <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--muted)' }}>
              Start from the {sampleDays} day Shanghai and Hangzhou trip, {sampleItems} stops
              already timed. Edit it into your own.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onPick('blank')}
            className="border p-3 text-left"
            style={{ borderRadius: 2, borderColor: 'var(--line)', background: 'var(--card)' }}
          >
            <span className="block text-[18px] font-semibold">Start from blank</span>
            <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--muted)' }}>
              Start blank, with one empty day. Add days as you go.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
