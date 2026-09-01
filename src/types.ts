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
}

export interface District {
  id: string;
  city: City;
  nameZh: string;
  nameEn: string;
  accentColor: string;
}

export interface ItineraryItem {
  id: string; // unique per item, not the place id
  placeId?: string; // omit for custom entries like "Nap"
  customTitle?: string;
  startTime?: string; // "14:00" — when it starts. Stops have no end time.
  note?: string;
  estCostMin?: number;
  estCostMax?: number;
}

export interface Day {
  id: string;
  date?: string; // ISO, optional
  label: string; // "Day 1"
  items: ItineraryItem[];
}

export interface Itinerary {
  name: string;
  days: Day[];
}
