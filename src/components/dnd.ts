import type { Place } from '../types';

/** What a draggable carries. Droppables read this in the drop handler. */
export type DragData =
  | { type: 'place'; place: Place }
  | { type: 'item'; dayId: string; itemId: string; index: number };

export type DropData = { type: 'day'; dayId: string } | (DragData & { type: 'item' });

export const libraryDragId = (placeId: string) => `lib:${placeId}`;
export const itemDragId = (itemId: string) => `item:${itemId}`;
export const dayDropId = (dayId: string) => `day:${dayId}`;
