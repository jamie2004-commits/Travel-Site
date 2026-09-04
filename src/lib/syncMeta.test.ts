import { describe, it, expect } from 'vitest';
import { canonical } from './syncMeta';

/**
 * The comparison the whole conflict story rests on.
 *
 * A plain JSON.stringify was used first and was always unequal, because the
 * document round trips through Postgres jsonb, which sorts object keys. So the
 * "identical, say nothing" suppression never fired and every second save raised
 * a conflict bar about two copies that matched. Crying wolf was the default.
 */

describe('canonical', () => {
  it('ignores key order, which jsonb does not preserve', () => {
    expect(canonical({ name: 'Trip', days: [] })).toBe(canonical({ days: [], name: 'Trip' }));
  });

  it('sorts keys at every depth, not just the top', () => {
    const a = { days: [{ id: 'd1', label: 'Day 1', items: [{ id: 'i1', note: 'x' }] }] };
    const b = { days: [{ items: [{ note: 'x', id: 'i1' }], label: 'Day 1', id: 'd1' }] };
    expect(canonical(a)).toBe(canonical(b));
  });

  it('keeps array order, which is what days and stops depend on', () => {
    expect(canonical([1, 2, 3])).not.toBe(canonical([3, 2, 1]));
    const days = (ids: string[]) => ({ days: ids.map((id) => ({ id, items: [] })) });
    expect(canonical(days(['a', 'b']))).not.toBe(canonical(days(['b', 'a'])));
  });

  it('drops undefined values, which do not survive the round trip either', () => {
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
  });

  it('still tells genuinely different documents apart', () => {
    expect(canonical({ name: 'Trip', days: [] })).not.toBe(
      canonical({ name: 'Other', days: [] }),
    );
    const withDay = { name: 'Trip', days: [{ id: 'd1', items: [] }] };
    expect(canonical(withDay)).not.toBe(canonical({ name: 'Trip', days: [] }));
  });

  it('handles null and primitives without throwing', () => {
    expect(canonical(null)).toBe('null');
    expect(canonical(0)).toBe('0');
    expect(canonical('x')).toBe('"x"');
  });

  it('tells an empty trip from a real one, which is the case that matters', () => {
    // The document a first visit holds, against a real trip. If these ever
    // compared equal, the empty one would be pushed as "no change".
    const empty = { name: 'My Trip', days: [{ id: 'day-1', label: 'Day 1', items: [] }] };
    const real = {
      name: 'My Trip',
      days: [{ id: 'day-1', label: 'Day 1', items: [{ id: 'i1', placeId: 'west-lake' }] }],
    };
    expect(canonical(empty)).not.toBe(canonical(real));
  });
});
