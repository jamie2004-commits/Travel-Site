import type { Day, Stay } from '../types';

/** Two nights are the same hotel when they name the same one. */
function sameHotel(a: Stay, b: Stay): boolean {
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

export interface StayBlock {
  stay: Stay;
  /** Day indexes this hotel covers, inclusive. */
  from: number;
  to: number;
  nights: number;
  days: Day[];
}

/**
 * The trip's hotels, with consecutive nights in the same one run together.
 * Four nights at one hotel is one booking and one line, not four lines that
 * happen to say the same thing.
 */
export function stayBlocks(days: Day[]): StayBlock[] {
  const out: StayBlock[] = [];
  days.forEach((day, i) => {
    const stay = day.stay;
    if (!stay?.name.trim()) return;
    const last = out[out.length - 1];
    if (last && last.to === i - 1 && sameHotel(last.stay, stay)) {
      last.to = i;
      last.nights += 1;
      last.days.push(day);
      return;
    }
    out.push({ stay, from: i, to: i, nights: 1, days: [day] });
  });
  return out;
}

/**
 * "Night 3" or "Nights 3–6". Nights are numbered off the same offset as the
 * days, so a trip that opens on Day 0 does not have its beds disagree with
 * the days they belong to.
 */
export function nightsLabel(block: StayBlock, offset: 0 | 1 = 1): string {
  return block.from === block.to
    ? `Night ${block.from + offset}`
    : `Nights ${block.from + offset}\u2013${block.to + offset}`;
}

/** "Ref ABC123 · +86 571 1234 5678" — the bits worth carrying, in one line. */
export function stayDetails(stay: Stay): string {
  return [
    stay.checkIn && `Check in ${stay.checkIn}`,
    stay.phone,
    stay.ref && `Ref ${stay.ref}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
