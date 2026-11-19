import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';

interface SeekBarProps {
  duration: number;
  position: number;
  onSeek: (seconds: number) => Promise<void>;
  onPreview: (seconds: number | null) => void;
  className?: string;
}

export default function SeekBar({
  duration,
  position,
  onSeek,
  onPreview,
  className = 'text-primary',
}: SeekBarProps) {
  const input = useRef<HTMLInputElement>(null);
  const activePointer = useRef<number | null>(null);
  const available = Number.isFinite(duration) && duration > 0;
  const value = available ? Math.min(duration, Math.max(0, position)) : 0;

  useEffect(() => () => onPreview(null), [onPreview]);

  const getPosition = (event: PointerEvent<HTMLDivElement>) => {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - left) / width)) * duration;
  };

  const cancelScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    onPreview(null);
  };

  return (
    <div
      className={`seek-bar ${className}`}
      style={{ '--seek-progress': `${available ? (value / duration) * 100 : 0}%` } as CSSProperties}
      data-disabled={!available || undefined}
      onPointerDown={(event) => {
        if (!available || event.button !== 0 || activePointer.current !== null) return;
        event.preventDefault();
        input.current?.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        activePointer.current = event.pointerId;
        onPreview(getPosition(event));
      }}
      onPointerMove={(event) => {
        if (activePointer.current === event.pointerId && available) onPreview(getPosition(event));
      }}
      onPointerUp={(event) => {
        if (activePointer.current !== event.pointerId) return;
        if (available) void onSeek(getPosition(event));
        cancelScrub(event);
      }}
      onPointerCancel={cancelScrub}
      onLostPointerCapture={cancelScrub}
    >
      <input
        ref={input}
        type="range"
        min={0}
        max={available ? duration : 1}
        step="any"
        value={value}
        disabled={!available}
        aria-label="Перемотка трека"
        onChange={(event) => {
          if (activePointer.current === null) void onSeek(event.currentTarget.valueAsNumber);
        }}
      />
      <div className="seek-bar-rail" aria-hidden="true">
        <div className="seek-bar-fill" />
        <div className="seek-bar-thumb" />
      </div>
    </div>
  );
}
