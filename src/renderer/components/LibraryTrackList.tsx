import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Tag } from 'lucide-react';
import { useUIStore } from '../store';
import type { Track } from '../types/electron';
import TrackRow from './TrackRow';

const OVERSCAN = 8;

interface Props {
  tracks: Track[];
  onEditTags?: (track: Track) => void;
}

export default memo(function LibraryTrackList({ tracks, onEditTags }: Props) {
  const compact = useUIStore(state => state.compactTrackRows);
  const listRef = useRef<HTMLDivElement>(null);
  const rem = Math.round(useUIStore(state => state.uiScale) * 16);
  const rowGap = rem / 4;
  // TrackRow uses a 2.5rem cover. In compact mode the two text lines can be taller than its 32px cover.
  const rowStep = compact ? Math.max(32, 2.25 * rem) + 6 + rowGap : 4 * rem;
  const [visible, setVisible] = useState({ start: 0, end: 24, focused: -1 });

  useLayoutEffect(() => {
    const list = listRef.current;
    const viewport = list?.closest('main.app-content');
    if (!list || !viewport) return;

    const measure = () => {
      const bounds = list.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      const scale = bounds.height / list.offsetHeight || 1;
      const top = (view.top - bounds.top) / scale;
      const bottom = (view.bottom - bounds.top) / scale;
      const start = Math.max(0, Math.min(tracks.length, Math.floor(top / rowStep) - OVERSCAN));
      const end = Math.max(start, Math.min(tracks.length, Math.ceil(bottom / rowStep) + OVERSCAN));
      const focusedRow = document.activeElement?.closest<HTMLElement>('[data-library-row]');
      const focused = focusedRow && list.contains(focusedRow) ? Number(focusedRow.dataset.libraryRow) : -1;
      setVisible(previous => previous.start === start && previous.end === end && previous.focused === focused
        ? previous : { start, end, focused });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(list);
    if (list.parentElement) observer.observe(list.parentElement);
    viewport.addEventListener('scroll', measure, { passive: true });

    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', measure);
    };
  }, [rowStep, tracks]);

  const { start, end, focused } = visible;
  const indices = Array.from({ length: Math.max(0, Math.min(end, tracks.length) - start) }, (_, offset) => start + offset);
  if (focused >= 0 && focused < start && focused < tracks.length) indices.unshift(focused);
  if (focused >= end && focused < tracks.length) indices.push(focused);

  return (
    <div
      ref={listRef}
      className="relative"
      style={{ height: Math.max(0, tracks.length * rowStep - rowGap) }}
    >
      {indices.map(index => {
        const track = tracks[index];
        return (
          <div
            key={`${track.id}-${index}`}
            data-library-row={index}
            className="absolute inset-x-0 flex items-center gap-2 group"
            style={{ top: index * rowStep }}
          >
            <div className="flex-1 min-w-0">
              <TrackRow track={track} index={index} showIndex queue={tracks} />
            </div>
            {onEditTags && track.path && (
              <button
                onClick={() => onEditTags(track)}
                title="Редактор тегов ID3 / FLAC"
                className="p-2 rounded-xl bg-surface-container hover:bg-primary/15 text-on-surface-variant hover:text-primary transition-colors opacity-70 group-hover:opacity-100"
              >
                <Tag size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});
