export type City = 'shanghai' | 'hangzhou';
export type Category = 'food' | 'sight' | 'activity' | 'shopping';

export interface Place {
  id: string;
  nameZh: string; // primary display name
  nameEn: string; // secondary
  city: City;
  district: string; // district id
  category: Category;
  description: string;
  tags: string[];
  priceMin?: number; // RMB per person
  priceMax?: number;
  addressZh?: string;
  metro?: string; // e.g. "Line 1 · Hubin"
  durationMinutes?: number; // typical time needed, used as a default
  /** 'user' for one added in the app, otherwise the guide file it came from. */
  source?: string;
  /**
   * Who added it. Null on every seeded place, which is what makes those
   * undeletable: no policy can match `created_by = auth.uid()` against null.
   */
  createdBy?: string | null;
}

export interface District {
  id: string;
  city: City;
  nameZh: string;
  nameEn: string;
  accentColor: string;
}

export type TravelMode = 'flight' | 'train';

/**
 * A flight or a train a stop *is*, rather than a stop that happens to be at an
 * airport. The departure is the stop's own start time, so only the arrival is
 * kept here: a booked leg is the one thing on a trip that genuinely has an end
 * time, because someone else decided it.
 */
export interface Travel {
  mode: TravelMode;
  number?: string; // "HO1576", "G7538"
  carrier?: string; // "Juneyao Air", "China Railway"
  from?: string; // "Singapore Changi T2", "Hangzhou East"
  to?: string; // "Shanghai Pudong T1"
  arrive?: string; // "05:15", scheduled
  seat?: string; // "32A", "Car 5 seat 12F"
  ref?: string; // booking reference, PNR, ticket number
}

export interface ItineraryItem {
  id: string; // unique per item, not the place id
  placeId?: string; // omit for custom entries like "Nap"
  customTitle?: string;
  startTime?: string; // "14:00" — when it starts. Stops have no end time.
  note?: string;
  estCostMin?: number;
  estCostMax?: number;
  /** Set when this stop is a booked flight or train. */
  travel?: Travel;
}

/**
 * Where you sleep at the end of a day. This hangs off the day rather than off
 * a stop, because a hotel is not something you do at 15:00 — it is the answer
 * to "where am I tonight", which a day either has or has not got.
 */
export interface Stay {
  name: string;
  address?: string;
  phone?: string;
  ref?: string; // booking reference
  checkIn?: string; // "15:00"
}

export interface Day {
  id: string;
  date?: string; // ISO, optional
  label: string; // "Day 1"
  items: ItineraryItem[];
  /** The hotel for this night. Absent on the night you fly home. */
  stay?: Stay;
}

export interface Itinerary {
  name: string;
  days: Day[];
}
