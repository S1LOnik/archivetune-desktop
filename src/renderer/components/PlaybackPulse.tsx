import React, { memo } from 'react';
import { usePlayerStore } from '../store';

export default memo(function PlaybackPulse() {
  const startedAt = usePlayerStore((state) => state.playbackStartAt);
  const elapsed = Math.max(0, performance.now() - startedAt);

  if (!startedAt || elapsed >= 600) return null;
  return (
    <span
      key={startedAt}
      className="playback-pulse"
      style={{ animationDelay: `-${elapsed}ms` }}
      aria-hidden="true"
    />
  );
});
