import { useDraggable } from '@dnd-kit/core';
import type { Place } from '../types';
import { libraryDragId } from './dnd';

interface Props {
  place: Place;
  children: React.ReactNode;
}

/**
 * Wraps a library card with a drag handle. The handle only shows from the
 * medium breakpoint up: on a phone the add button is the way in, and a
 * draggable card would fight the scroll.
 */
export default function DraggablePlaceCard({ place, children }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: libraryDragId(place.id),
    data: { type: 'place', place },
  });

  return (
    <div ref={setNodeRef} className="relative" style={{ opacity: isDragging ? 0.4 : 1 }}>
      {children}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`拖动 Drag ${place.nameEn} onto a day`}
        className="absolute top-1/2 -left-3 hidden h-10 w-6 -translate-y-1/2 items-center justify-center text-[12px] md:flex"
        style={{ cursor: 'grab', touchAction: 'none', color: 'var(--line)' }}
      >
        ⣿
      </button>
    </div>
  );
}
