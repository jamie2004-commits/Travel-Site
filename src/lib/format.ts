import type { Category } from '../types';

/** "¥100–130", "¥1500+", "免费 Free", or a dash when the source gave nothing. */
export function formatPrice(min?: number, max?: number): string {
  if (min === undefined && max === undefined) return '未列';
  if (min === 0 && max === 0) return '免费 Free';
  if (min !== undefined && max === undefined) return `¥${min}+`;
  if (min === undefined) return `¥${max}`;
  if (min === max) return `¥${min}`;
  return `¥${min}–${max}`;
}

export function formatDuration(minutes?: number): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "14:00" plus 90 minutes -> "15:30". Wraps past midnight. */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const CATEGORY_LABELS: Record<Category | 'all', { zh: string; en: string }> = {
  all: { zh: '全部', en: 'All' },
  food: { zh: '吃', en: 'Food' },
  sight: { zh: '景点', en: 'Sights' },
  activity: { zh: '玩', en: 'Activities' },
  shopping: { zh: '买', en: 'Shopping' },
};

export const CITY_LABELS: Record<string, { zh: string; en: string }> = {
  shanghai: { zh: '上海', en: 'Shanghai' },
  hangzhou: { zh: '杭州', en: 'Hangzhou' },
};

/**
 * Fallback length for a place with no duration in the source. Used only to
 * seed a new itinerary item, where it is editable straight away.
 */
export const DEFAULT_DURATION: Record<Category, number> = {
  food: 90,
  sight: 120,
  activity: 150,
  shopping: 90,
};
