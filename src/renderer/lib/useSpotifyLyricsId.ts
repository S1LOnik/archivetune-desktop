import { usePlayerStore } from '../store';
import type { Track } from '../types/electron';

export function useSpotifyLyricsId(track: Track | null) {
  const resolvedId = usePlayerStore((state) => {
    const resolved = state.resolvedSpotifyTrack;
    return resolved && resolved.trackId === track?.id ? resolved.spotifyId : undefined;
  });
  return resolvedId || track?.spotifyUri || (track?.source === 'spotify' ? track.id : undefined);
}
