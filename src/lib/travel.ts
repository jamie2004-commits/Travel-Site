import type { ItineraryItem, Travel, TravelMode } from '../types';

export const TRAVEL_LABELS: Record<TravelMode, string> = {
  flight: 'Flight',
  train: 'Train',
};

/** A mark that survives a paste into a chat window and a printed page alike. */
export const TRAVEL_MARKS: Record<TravelMode, string> = {
  flight: '✈',
  train: '🚄',
};

/**
 * Arrival lands on the next day when it reads earlier than departure. An
 * overnight flight is the common case by a long way; anything stranger than
 * that belongs in the note, where a human can say what they mean.
 */
export function arrivesNextDay(depart?: string, arrive?: string): boolean {
  if (!depart || !arrive) return false;
  return arrive < depart;
}

/** "HO1576" / "Flight" — what to call the leg when it has no number. */
export function legName(travel: Travel): string {
  const label = TRAVEL_LABELS[travel.mode];
  if (!travel.number) return travel.carrier ? `${label} · ${travel.carrier}` : label;
  return travel.carrier ? `${travel.carrier} ${travel.number}` : `${label} ${travel.number}`;
}

/** "Changi T2 → Pudong T1", or one end of it, or nothing. */
export function legRoute(travel: Travel): string {
  if (travel.from && travel.to) return `${travel.from} → ${travel.to}`;
  if (travel.to) return `to ${travel.to}`;
  if (travel.from) return `from ${travel.from}`;
  return '';
}

/** "23:45 → 05:15 +1", falling back to whichever end is known. */
export function legTimes(item: ItineraryItem): string {
  const { startTime, travel } = item;
  const arrive = travel?.arrive;
  if (startTime && arrive) {
    return `${startTime} → ${arrive}${arrivesNextDay(startTime, arrive) ? ' +1' : ''}`;
  }
  if (arrive) return `arrives ${arrive}`;
  return startTime ?? '';
}

/** Every booked leg in the trip, in the order it is travelled. */
export function travelLegs(days: { id: string; label: string; date?: string; items: ItineraryItem[] }[]) {
  return days.flatMap((day) =>
    day.items.filter((item) => item.travel).map((item) => ({ day, item, travel: item.travel! })),
  );
}
