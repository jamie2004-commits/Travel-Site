import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Day, ItineraryItem } from '../types';
import ItemRow from './ItemRow';
import { itemDragId } from './dnd';

interface Props {
  item: ItineraryItem;
  day: Day;
  index: number;
  onRemove: () => void;
  onChange: (patch: Partial<ItineraryItem>) => void;
}

export default function SortableItemRow({ item, day, index, onRemove, onChange }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemDragId(item.id),
    data: { type: 'item', dayId: day.id, itemId: item.id, index },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <ItemRow
        item={item}
        day={day}
        onRemove={onRemove}
        onChange={onChange}
        dragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}
