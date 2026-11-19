import { create } from 'zustand';
import type {
  Track,
  PlaylistItem,
  PlayerStyleId,
  AudioSourceId,
  AutomixMode,
  AutoMixPlan,
  AppSettings,
  SavedYouTubeAccountPublic,
  TogetherState,
} from '../types/electron';
import { generateMaterialYouScheme, extractPaletteFromArtwork, hexToRgb } from '../lib/color';
import type { BackdropTonePalette, ExtractedArtworkResult } from '../lib/color';

export type { Track, PlaylistItem, PlayerStyleId, AudioSourceId, AutomixMode, AutoMixPlan };
export { generateMaterialYouScheme, extractPaletteFromArtwork, hexToRgb };
export type { BackdropTonePalette, ExtractedArtworkResult };

export interface SmartToast {
  id: string;
  message: string;
  kind: 'info' | 'switch' | 'lossless' | 'sponsorblock' | 'automix' | 'error' | string;
  timestamp: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  track: Track;
}

const DEFAULT_SOURCE_ORDER: AudioSourceId[] = [
  'tidal',
  'qobuz',
  'deezer',
  'jiosaavn',
  'youtube',
  'soundcloud',
  'apple',
  'spotify',
];

const DEFAULT_ENABLED_SOURCES: Record<AudioSourceId, boolean> = {
  tidal: true,
  qobuz: true,
  deezer: true,
  jiosaavn: true,
  apple: true,
  youtube: true,
  soundcloud: true,
  spotify: true,
};

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  originalQueue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  automixing: boolean;
  automixPlan: AutoMixPlan | null;
  position: number;
  duration: number;
  trackStartTimeSec: number;
  resolvedSourceBadge: string;
  resolvedSourceId: AudioSourceId | 'local' | null;
  resolvedSpotifyTrack?: { trackId: string; spotifyId: string };
  isLosslessActive: boolean;
  volume: number;
  repeat: 'none' | 'one' | 'all';
  shuffle: boolean;
  loading: boolean;
  playbackStartAt: number;
  speed: number;
  pitchSemitones: number;
  normalization: boolean;
  audioCompressor: boolean;
  exponentialVolume: boolean;
  bassBoost: number;
  stereoWidener: number;
  silenceSkip: boolean;
  audioDevice: string;
  crossfade: number;
  smartDjAutomix: boolean;
  prebufferNextTrack: boolean;
  autoRadioOnQueueEnd: boolean;
  automixMode: AutomixMode;
  gaplessAlbum: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqBands: number[];
  preferredAudioSource: 'auto' | AudioSourceId;
  sourceOrder: AudioSourceId[];
  enabledSources: Record<AudioSourceId, boolean>;
  universalFallback: boolean;
  autoUpgradeLossless: boolean;
  canvasEnabled: boolean;
  sleepTimerRemainingSec: number | null;
  sleepAfterTrack: boolean;
  abLoopA: number | null;
  abLoopB: number | null;
  history: Track[];
  likedSongs: Track[];
  playlists: PlaylistItem[];
  blockedArtists: string[];
  lyricsOffset: number;
  lyricsFontSize: 'small' | 'medium' | 'large';
  lyricsWordByWord: boolean;
  lyricsRomanize: boolean;
  lyricsTranslate: boolean;
  lyricsTranslateLang: string;
  sponsorBlockEnabled: boolean;
  sponsorBlockCategories: string[];
  aiContentFilter: boolean;

  setCurrentTrack: (track: Track) => void;
  setQueue: (tracks: Track[], startIndex?: number) => void;
  addToQueue: (track: Track) => void;
  insertNextInQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  setIsPlaying: (playing: boolean) => void;
  setAutomixing: (automixing: boolean) => void;
  setAutomixPlan: (plan: AutoMixPlan | null) => void;
  setPosition: (pos: number) => void;
  setDuration: (dur: number) => void;
  setTrackStartTimeSec: (sec: number) => void;
  setResolvedStreamMeta: (badge: string, sourceId: AudioSourceId | 'local' | null, lossless: boolean, spotifyId?: string) => void;
  setVolume: (vol: number) => void;
  setRepeat: (mode: 'none' | 'one' | 'all') => void;
  toggleShuffle: () => void;
  setLoading: (loading: boolean) => void;
  setSpeed: (speed: number) => void;
  setDspOption: (opts: Partial<AppSettings>) => void;
  setCrossfade: (seconds: number) => void;
  setSmartDjAutomix: (enabled: boolean) => void;
  setAutomixMode: (mode: AutomixMode) => void;
  setGaplessAlbum: (enabled: boolean) => void;
  setEqualizerState: (enabled: boolean, bands: number[], preset?: string) => void;
  setPreferredAudioSource: (src: 'auto' | AudioSourceId) => void;
  setSourceOrder: (order: AudioSourceId[]) => void;
  toggleSourceEnabled: (src: AudioSourceId, enabled: boolean) => void;
  setUniversalFallback: (enabled: boolean) => void;
  setAutoUpgradeLossless: (enabled: boolean) => void;
  setCanvasEnabled: (enabled: boolean) => void;
  setSleepTimer: (minutes: number | null, afterTrack?: boolean) => void;
  setSleepProgress: (remainingSec: number, afterTrack: boolean) => void;
  setAbLoop: (a: number | null, b: number | null) => void;
  nextTrack: () => Track | null;
  prevTrack: () => Track | null;
  addToHistory: (track: Track) => void;
  toggleLike: (track: Track) => void;
  upsertLikedSongs: (tracks: Track[]) => void;
  isTrackLiked: (track: Track | null | undefined) => boolean;
  savePlaylist: (playlist: PlaylistItem) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  deletePlaylist: (playlistId: string) => void;
  toggleBlockArtist: (artistName: string) => void;
  setLyricsSettings: (partial: Partial<AppSettings>) => void;
}

function persistQueueState(state: PlayerState) {
  window.electronAPI?.db
    ?.saveQueueState({
      currentTrack: state.currentTrack,
      queue: state.queue.slice(0, 300),
      originalQueue: state.originalQueue.slice(0, 300),
      queueIndex: state.queueIndex,
      position: state.position,
    })
    .catch(() => {});
}

let indexedLikedSongs: Track[] | undefined;
let likedTrackIds = new Set<string>();

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  originalQueue: [],
  queueIndex: -1,
  isPlaying: false,
  automixing: false,
  automixPlan: null,
  position: 0,
  duration: 0,
  trackStartTimeSec: 0,
  resolvedSourceBadge: '',
  resolvedSourceId: null,
  isLosslessActive: false,
  volume: 0.85,
  repeat: 'none',
  shuffle: false,
  loading: false,
  playbackStartAt: 0,
  speed: 1.0,
  pitchSemitones: 0,
  normalization: false,
  audioCompressor: false,
  exponentialVolume: true,
  bassBoost: 0,
  stereoWidener: 0,
  silenceSkip: false,
  audioDevice: 'auto',
  crossfade: 6,
  smartDjAutomix: true,
  prebufferNextTrack: true,
  autoRadioOnQueueEnd: true,
  automixMode: 'auto',
  gaplessAlbum: true,
  eqEnabled: false,
  eqPreset: 'Flat',
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  preferredAudioSource: 'auto',
  sourceOrder: [...DEFAULT_SOURCE_ORDER],
  enabledSources: { ...DEFAULT_ENABLED_SOURCES },
  universalFallback: true,
  autoUpgradeLossless: true,
  canvasEnabled: true,
  sleepTimerRemainingSec: null,
  sleepAfterTrack: false,
  abLoopA: null,
  abLoopB: null,
  history: [],
  likedSongs: [],
  playlists: [],
  blockedArtists: [],
  lyricsOffset: 0,
  lyricsFontSize: 'medium',
  lyricsWordByWord: true,
  lyricsRomanize: true,
  lyricsTranslate: false,
  lyricsTranslateLang: 'ru',
  sponsorBlockEnabled: true,
  sponsorBlockCategories: ['sponsor', 'intro', 'outro', 'selfpromo', 'music_offtopic'],
  aiContentFilter: false,

  setCurrentTrack: (track) => {
    set({ currentTrack: track, resolvedSpotifyTrack: undefined, position: 0, automixPlan: null, abLoopA: null, abLoopB: null });
    window.electronAPI?.player?.setAbLoop?.(null, null);
    persistQueueState(get());
  },

  setQueue: (tracks, startIndex = 0) => {
    const blocked = new Set(get().blockedArtists.map((a) => a.toLowerCase()));
    const filtered = tracks.filter(
      (t) => !blocked.has((t.artist || '').toLowerCase())
    );
    const list = filtered.length > 0 ? filtered : tracks;
    const requested = tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))];
    const requestedIndex = list === tracks || filtered.length === tracks.length
      ? startIndex
      : list.indexOf(requested);
    const clampedIdx = Math.max(0, Math.min(requestedIndex, list.length - 1));
    const current = list[clampedIdx] ?? null;

    if (get().shuffle && list.length > 1) {
      const rest = list.filter((_, i) => i !== clampedIdx);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      const shuffled = current ? [current, ...rest] : rest;
      set({
        originalQueue: list,
        queue: shuffled,
        queueIndex: current ? 0 : -1,
        currentTrack: current,
        position: 0,
      });
    } else {
      set({
        originalQueue: list,
        queue: list,
        queueIndex: current ? clampedIdx : -1,
        currentTrack: current,
        position: 0,
      });
    }
    persistQueueState(get());
  },

  addToQueue: (track) => {
    set((s) => ({
      queue: [...s.queue, track],
      originalQueue: [...s.originalQueue, track],
    }));
    persistQueueState(get());
  },

  insertNextInQueue: (track) => {
    set((s) => {
      const idx = Math.max(0, s.queueIndex + 1);
      const nextQueue = [...s.queue];
      nextQueue.splice(idx, 0, track);
      return { queue: nextQueue, originalQueue: [...s.originalQueue, track] };
    });
    persistQueueState(get());
  },

  removeFromQueue: (index) => {
    set((s) => {
      if (index < 0 || index >= s.queue.length) return s;
      const nextQueue = [...s.queue];
      const [removed] = nextQueue.splice(index, 1);
      // Preserve a single matching occurrence in the unshuffled queue.
      const nextOriginal = [...s.originalQueue];
      let originalIndex = nextOriginal.indexOf(removed);
      if (originalIndex < 0) originalIndex = nextOriginal.findIndex(t => t.id === removed.id);
      if (originalIndex >= 0) nextOriginal.splice(originalIndex, 1);
      const nextIndex = index <= s.queueIndex ? s.queueIndex - 1 : s.queueIndex;
      return {
        queue: nextQueue,
        originalQueue: nextOriginal,
        queueIndex: nextIndex,
      };
    });
    persistQueueState(get());
  },

  reorderQueue: (fromIndex, toIndex) => {
    set((s) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= s.queue.length || toIndex >= s.queue.length) {
        return s;
      }
      const next = [...s.queue];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      let newCurrentIdx = s.queueIndex;
      if (fromIndex === s.queueIndex) newCurrentIdx = toIndex;
      else if (fromIndex < s.queueIndex && toIndex >= s.queueIndex) newCurrentIdx--;
      else if (fromIndex > s.queueIndex && toIndex <= s.queueIndex) newCurrentIdx++;
      return { queue: next, queueIndex: newCurrentIdx };
    });
    persistQueueState(get());
  },

  clearQueue: () => {
    set((s) => ({
      queue: s.currentTrack ? [s.currentTrack] : [],
      originalQueue: s.currentTrack ? [s.currentTrack] : [],
      queueIndex: s.currentTrack ? 0 : -1,
    }));
    persistQueueState(get());
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setAutomixing: (automixing) => set({ automixing }),
  setAutomixPlan: (automixPlan) => set({ automixPlan }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
  setTrackStartTimeSec: (trackStartTimeSec) => set({ trackStartTimeSec }),
  setResolvedStreamMeta: (resolvedSourceBadge, resolvedSourceId, isLosslessActive, spotifyId) =>
    set((state) => ({
      resolvedSourceBadge, resolvedSourceId, isLosslessActive,
      resolvedSpotifyTrack: spotifyId && state.currentTrack
        ? { trackId: state.currentTrack.id, spotifyId }
        : undefined,
    })),

  setVolume: (volume) => {
    set({ volume });
    window.electronAPI?.db?.updateSettings({ volume });
  },

  setRepeat: (repeat) => {
    set({ repeat });
    window.electronAPI?.db?.updateSettings({ repeat });
  },

  toggleShuffle: () => {
    const { shuffle, queue, queueIndex, originalQueue, currentTrack } = get();
    const nextShuffle = !shuffle;
    if (nextShuffle && queue.length > 1) {
      const hasCurrent = queueIndex >= 0 && queueIndex < queue.length && queue[queueIndex]?.id === currentTrack?.id;
      const rest = queue.filter((_, index) => !hasCurrent || index !== queueIndex);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      const newQ = hasCurrent ? [queue[queueIndex], ...rest] : rest;
      set({ shuffle: true, queue: newQ, queueIndex: hasCurrent ? 0 : -1 });
    } else if (!nextShuffle && originalQueue.length > 0) {
      const queuedCurrent = queue[queueIndex];
      let idx = queuedCurrent ? originalQueue.indexOf(queuedCurrent) : -1;
      if (idx < 0 && queuedCurrent) {
        const occurrence = queue.slice(0, queueIndex).filter(t => t.id === queuedCurrent.id).length;
        const matches = originalQueue.map((t, i) => t.id === queuedCurrent.id ? i : -1).filter(i => i >= 0);
        idx = matches[Math.min(occurrence, matches.length - 1)] ?? -1;
      }
      set({
        shuffle: false,
        queue: [...originalQueue],
        queueIndex: idx,
      });
    } else {
      set({ shuffle: nextShuffle });
    }
    window.electronAPI?.db?.updateSettings({ shuffle: nextShuffle });
    persistQueueState(get());
  },

  setLoading: (loading) => set({ loading }),

  setSpeed: (speed) => {
    set({ speed });
    window.electronAPI?.player?.setSpeed(speed);
    window.electronAPI?.db?.updateSettings({ speed });
  },

  setDspOption: (opts) => {
    set((s) => ({ ...s, ...opts }));
    window.electronAPI?.player?.setDsp(opts);
    window.electronAPI?.db?.updateSettings(opts);
  },

  setCrossfade: (crossfade) => {
    set({ crossfade });
    window.electronAPI?.player?.setCrossfade(crossfade);
    window.electronAPI?.db?.updateSettings({ crossfade });
  },

  setSmartDjAutomix: (smartDjAutomix) => {
    set({ smartDjAutomix });
    window.electronAPI?.player?.setSmartDjAutomix(smartDjAutomix);
    window.electronAPI?.db?.updateSettings({ smartDjAutomix });
  },

  setAutomixMode: (automixMode) => {
    set({ automixMode });
    window.electronAPI?.player?.setAutomixConfig({ automixMode });
    window.electronAPI?.db?.updateSettings({ automixMode });
  },

  setGaplessAlbum: (gaplessAlbum) => {
    set({ gaplessAlbum });
    window.electronAPI?.player?.setAutomixConfig({ gaplessAlbum });
    window.electronAPI?.db?.updateSettings({ gaplessAlbum });
  },

  setEqualizerState: (eqEnabled, eqBands, preset = 'Custom') => {
    set({ eqEnabled, eqBands, eqPreset: preset });
    window.electronAPI?.player?.setEqualizer({ enabled: eqEnabled, bands: eqBands, preset });
    window.electronAPI?.db?.updateSettings({ eqEnabled, eqBands, eqPreset: preset });
  },

  setPreferredAudioSource: (preferredAudioSource) => {
    set({ preferredAudioSource });
    window.electronAPI?.db?.updateSettings({ preferredAudioSource });
  },

  setSourceOrder: (sourceOrder) => {
    set({ sourceOrder });
    window.electronAPI?.db?.updateSettings({ sourceOrder });
  },

  toggleSourceEnabled: (src, enabled) => {
    const enabledSources = { ...get().enabledSources, [src]: enabled };
    set({ enabledSources });
    window.electronAPI?.db?.updateSettings({ enabledSources });
  },

  setUniversalFallback: (universalFallback) => {
    set({ universalFallback });
    window.electronAPI?.db?.updateSettings({ universalFallback });
  },

  setAutoUpgradeLossless: (autoUpgradeLossless) => {
    set({ autoUpgradeLossless });
    window.electronAPI?.db?.updateSettings({ autoUpgradeLossless });
  },

  setCanvasEnabled: (canvasEnabled) => {
    set({ canvasEnabled });
    window.electronAPI?.db?.updateSettings({ canvasEnabled });
  },

  setSleepTimer: (minutes, afterTrack = false) => {
    window.electronAPI?.player?.setSleepTimer(minutes, afterTrack);
    set({
      sleepTimerRemainingSec: minutes !== null ? minutes * 60 : null,
      sleepAfterTrack: afterTrack,
    });
  },

  setSleepProgress: (remainingSec, afterTrack) => {
    set({
      sleepTimerRemainingSec: remainingSec > 0 ? remainingSec : null,
      sleepAfterTrack: afterTrack,
    });
  },

  setAbLoop: (abLoopA, abLoopB) => {
    set({ abLoopA, abLoopB });
    window.electronAPI?.player?.setAbLoop?.(abLoopA, abLoopB);
  },

  nextTrack: () => {
    const { queue, queueIndex, repeat } = get();
    if (queue.length === 0) return null;
    let next = queueIndex + 1;
    if (next >= queue.length) {
      if (repeat === 'all') next = 0;
      else return null;
    }
    const track = queue[next];
    if (track) {
      set({ queueIndex: next, currentTrack: track, position: 0, abLoopA: null, abLoopB: null });
      window.electronAPI?.player?.setAbLoop?.(null, null);
      persistQueueState(get());
    }
    return track ?? null;
  },

  prevTrack: () => {
    const { queue, queueIndex, position } = get();
    if (queue.length === 0) return null;
    if (position > 4) {
      set({ position: 0 });
      return queue[queueIndex] ?? null;
    }
    let prev = queueIndex - 1;
    if (prev < 0) prev = queue.length - 1;
    const track = queue[prev];
    if (track) {
      set({ queueIndex: prev, currentTrack: track, position: 0, abLoopA: null, abLoopB: null });
      window.electronAPI?.player?.setAbLoop?.(null, null);
      persistQueueState(get());
    }
    return track ?? null;
  },

  addToHistory: (track) => {
    const next = [track, ...get().history.filter((t) => t.id !== track.id)].slice(0, 150);
    set({ history: next });
    window.electronAPI?.db?.saveHistory(next);
  },

  toggleLike: (track) => {
    const currentLiked = get().likedSongs;
    const exists = currentLiked.some((t) => t.id === track.id);
    const updated = exists
      ? currentLiked.filter((t) => t.id !== track.id)
      : [{ ...track, likedAt: Date.now() }, ...currentLiked];
    set({ likedSongs: updated });
    window.electronAPI?.db?.toggleLike(track).then((res) => {
      if (res?.likedSongs) set({ likedSongs: res.likedSongs });
    });
    // Optional bidirectional YTM / Spotify sync
    if (track.source === 'youtube') {
      window.electronAPI?.ytmAuth?.setLike?.(track.id, !exists).catch(() => {});
    }
    if (track.source === 'spotify') {
      window.electronAPI?.spotify?.toggleLike?.(track.id, !exists).catch(() => {});
    }
    if (track.source === 'soundcloud') {
      window.electronAPI?.soundcloud?.toggleLike?.(track.id, !exists).catch(() => {});
    }
  },

  upsertLikedSongs: (tracks) => {
    window.electronAPI?.db?.upsertLikedBatch(tracks, false).then((merged) => {
      if (Array.isArray(merged)) set({ likedSongs: merged });
    });
  },

  isTrackLiked: (track) => {
    if (!track) return false;
    const { likedSongs } = get();
    if (indexedLikedSongs !== likedSongs) {
      indexedLikedSongs = likedSongs;
      likedTrackIds = new Set(likedSongs.map((song) => song.id));
    }
    return likedTrackIds.has(track.id);
  },

  savePlaylist: (playlist) => {
    const current = get().playlists;
    const idx = current.findIndex((p) => p.id === playlist.id);
    const next = [...current];
    if (idx >= 0) next[idx] = playlist;
    else next.unshift(playlist);
    set({ playlists: next });
    window.electronAPI?.db?.savePlaylist(playlist);
  },

  addTrackToPlaylist: (playlistId, track) => {
    const pl = get().playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    if (pl.tracks.some((t) => t.id === track.id)) return;
    const updated: PlaylistItem = {
      ...pl,
      tracks: [...pl.tracks, track],
      trackCount: pl.tracks.length + 1,
      updatedAt: Date.now(),
    };
    get().savePlaylist(updated);
  },

  deletePlaylist: (playlistId) => {
    set({ playlists: get().playlists.filter((p) => p.id !== playlistId) });
    window.electronAPI?.db?.deletePlaylist(playlistId);
  },

  toggleBlockArtist: (artistName) => {
    const norm = artistName.trim().toLowerCase();
    const current = get().blockedArtists;
    const exists = current.some((a) => a.toLowerCase() === norm);
    const next = exists
      ? current.filter((a) => a.toLowerCase() !== norm)
      : [artistName.trim(), ...current];
    set({ blockedArtists: next });
    window.electronAPI?.db?.toggleBlockArtist?.(artistName);
  },

  setLyricsSettings: (partial) => {
    set((s) => ({ ...s, ...partial }));
    window.electronAPI?.db?.updateSettings(partial);
  },
}));

// ===== Search & Discovery Store =====
interface SearchState {
  query: string;
  submittedQuery: string;
  searchError: boolean;
  results: Track[];
  albums: any[];
  artists: any[];
  playlists: any[];
  sourceFilter: 'all' | AudioSourceId;
  suggestions: string[];
  searching: boolean;
  setQuery: (q: string) => void;
  setSubmittedQuery: (q: string) => void;
  setSearchError: (error: boolean) => void;
  setResults: (results: Track[]) => void;
  setSearchAllResults: (res: { songs: Track[]; albums: any[]; artists: any[]; playlists: any[] }) => void;
  setSourceFilter: (s: 'all' | AudioSourceId) => void;
  setSuggestions: (s: string[]) => void;
  setSearching: (s: boolean) => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  submittedQuery: '',
  searchError: false,
  results: [],
  albums: [],
  artists: [],
  playlists: [],
  sourceFilter: 'all',
  suggestions: [],
  searching: false,
  setQuery: (query) => set({ query }),
  setSubmittedQuery: (submittedQuery) => set({ submittedQuery }),
  setSearchError: (searchError) => set({ searchError }),
  setResults: (results) => set({ results }),
  setSearchAllResults: (res) =>
    set({
      results: res.songs || [],
      albums: res.albums || [],
      artists: res.artists || [],
      playlists: res.playlists || [],
    }),
  setSourceFilter: (sourceFilter) => set({ sourceFilter }),
  setSuggestions: (suggestions) => set({ suggestions }),
  setSearching: (searching) => set({ searching }),
}));

// ===== Local Library Store =====
interface LibraryState {
  directories: string[];
  tracks: Track[];
  scanning: boolean;
  addDirectory: (dir: string) => void;
  setTracks: (tracks: Track[]) => void;
  setScanning: (scanning: boolean) => void;
  updateTrackLocalMeta: (filePath: string, patch: Partial<Track>) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  directories: [],
  tracks: [],
  scanning: false,
  addDirectory: (dir) => {
    const dirs = get().directories;
    if (!dirs.includes(dir)) {
      const nextDirs = [...dirs, dir];
      set({ directories: nextDirs });
      window.electronAPI?.db?.saveLocalLibrary(nextDirs, get().tracks);
    }
  },
  setTracks: (tracks) => {
    set({ tracks });
    window.electronAPI?.db?.saveLocalLibrary(get().directories, tracks);
  },
  setScanning: (scanning) => set({ scanning }),
  updateTrackLocalMeta: (filePath, patch) => {
    const next = get().tracks.map((t) => (t.path === filePath ? { ...t, ...patch } : t));
    set({ tracks: next });
    window.electronAPI?.db?.saveLocalLibrary(get().directories, next);
  },
}));

// ===== Accounts Store (Spotify + YouTube Music + SoundCloud) =====
interface AccountsState {
  spotifyConnected: boolean;
  spotifyUser: any | null;
  ytmConnected: boolean;
  ytmActiveAccount: SavedYouTubeAccountPublic | null;
  ytmSavedAccounts: SavedYouTubeAccountPublic[];
  scConnected: boolean;
  scUser: any | null;
  syncingAll: boolean;
  together: TogetherState;
  refreshAllStatuses: () => Promise<void>;
  syncAllPlatforms: (forceAll?: boolean) => Promise<void>;
  setTogetherState: (state: TogetherState) => void;
}

let initialAutoSyncTriggered = false;

export const useAccountsStore = create<AccountsState>((set, get) => ({
  spotifyConnected: false,
  spotifyUser: null,
  ytmConnected: false,
  ytmActiveAccount: null,
  ytmSavedAccounts: [],
  scConnected: false,
  scUser: null,
  syncingAll: false,
  together: {
    role: 'idle',
    roomCode: '',
    roomUrl: '',
    displayName: 'Listener',
    participants: [],
    chat: [],
  },
  setTogetherState: (together) => set({ together }),
  refreshAllStatuses: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const [sp, ytm, sc, tog] = await Promise.all([
      api.spotify?.getStatus?.().catch(() => ({ connected: false, user: null })),
      api.ytmAuth?.getStatus?.().catch(() => ({ connected: false, activeAccount: null, savedAccounts: [] })),
      api.soundcloud?.getStatus?.().catch(() => ({ connected: false, user: null })),
      api.together?.getState?.().catch(() => null),
    ]);
    set((s) => ({
      spotifyConnected: Boolean(sp?.connected),
      spotifyUser: sp?.user ?? null,
      ytmConnected: Boolean(ytm?.connected),
      ytmActiveAccount: ytm?.activeAccount ?? null,
      ytmSavedAccounts: ytm?.savedAccounts ?? [],
      scConnected: Boolean(sc?.connected),
      scUser: sc?.user ?? null,
      together: tog ?? s.together,
    }));

    if (!initialAutoSyncTriggered && (sp?.connected || ytm?.connected || sc?.connected)) {
      initialAutoSyncTriggered = true;
      void get().syncAllPlatforms(false);
    }
  },
  syncAllPlatforms: async (forceAll = false) => {
    const api = window.electronAPI;
    if (!api || get().syncingAll) return;
    set({ syncingAll: true });
    try {
      const db = await api.db?.getInitialState?.().catch(() => null);
      const settings = db?.settings || {};
      const playerStore = usePlayerStore.getState();
      const { spotifyConnected, ytmConnected, scConnected } = get();

      const tasks: Promise<void>[] = [];

      // 1. Spotify Unified Sync (Liked Songs + Playlists)
      if (spotifyConnected && (forceAll || settings.autoSyncSpotify !== false)) {
        tasks.push(
          (async () => {
            const [likes, pls] = await Promise.all([
              api.spotify?.getLikedSongs?.(400, 0).catch(() => []),
              api.spotify?.getPlaylists?.(50).catch(() => []),
            ]);
            if (Array.isArray(likes) && likes.length > 0) {
              playerStore.upsertLikedSongs(likes);
            }
            if (Array.isArray(pls) && pls.length > 0) {
              for (const p of pls) {
                const pid = `sp_pl_${p.id}`;
                const existing = usePlayerStore.getState().playlists.find((x) => x.id === pid);
                usePlayerStore.getState().savePlaylist({
                  id: pid,
                  externalId: p.id,
                  name: p.name || 'Spotify Playlist',
                  description: p.description || '',
                  thumbnail: p.thumbnail,
                  source: 'spotify',
                  tags: ['Spotify'],
                  trackCount: p.trackCount || existing?.trackCount || 0,
                  tracks: existing?.tracks || [],
                  updatedAt: Date.now(),
                });
              }
            }
          })()
        );
      }

      // 2. YouTube Music Unified Sync (Liked Songs + Playlists)
      if (ytmConnected && (forceAll || settings.autoSyncYtm !== false)) {
        tasks.push(
          (async () => {
            const [likes, pls] = await Promise.all([
              api.ytmAuth?.getLikedSongs?.(false).catch(() => []),
              api.ytmAuth?.getLibraryPlaylists?.().catch(() => []),
            ]);
            if (Array.isArray(likes) && likes.length > 0) {
              playerStore.upsertLikedSongs(likes);
            }
            if (Array.isArray(pls) && pls.length > 0) {
              for (const p of pls) {
                const rawId = String(p.id || '').replace(/^VL/, '');
                if (!rawId) continue;
                const pid = `yt_pl_${rawId}`;
                const existing = usePlayerStore.getState().playlists.find((x) => x.id === pid);
                usePlayerStore.getState().savePlaylist({
                  id: pid,
                  externalId: rawId,
                  name: p.title || p.name || 'YTM Playlist',
                  description: p.subtitle || '',
                  thumbnail: p.thumbnail,
                  source: 'youtube',
                  tags: ['YouTube Music'],
                  trackCount: p.trackCount || existing?.trackCount || 0,
                  tracks: existing?.tracks || [],
                  updatedAt: Date.now(),
                });
              }
            }
          })()
        );
      }

      // 3. SoundCloud Unified Sync (Liked Songs + Playlists)
      if (scConnected && (forceAll || settings.autoSyncSc !== false)) {
        tasks.push(
          (async () => {
            const [likes, pls] = await Promise.all([
              api.soundcloud?.getLikedTracks?.(100).catch(() => []),
              api.soundcloud?.getPlaylists?.(30).catch(() => []),
            ]);
            if (Array.isArray(likes) && likes.length > 0) {
              playerStore.upsertLikedSongs(likes);
            }
            if (Array.isArray(pls) && pls.length > 0) {
              for (const p of pls) {
                const pid = `sc_pl_${p.id}`;
                const existing = usePlayerStore.getState().playlists.find((x) => x.id === pid);
                usePlayerStore.getState().savePlaylist({
                  id: pid,
                  externalId: String(p.id),
                  name: p.title || p.name || 'SoundCloud Playlist',
                  thumbnail: p.thumbnail,
                  source: 'soundcloud',
                  tags: ['SoundCloud'],
                  trackCount: p.trackCount || p.tracks?.length || existing?.trackCount || 0,
                  tracks: Array.isArray(p.tracks) && p.tracks.length > 0 ? p.tracks : existing?.tracks || [],
                  updatedAt: Date.now(),
                });
              }
            }
          })()
        );
      }

      await Promise.allSettled(tasks);
      if (forceAll) {
        useUIStore.getState().pushToast('Библиотека синхронизирована (Spotify + YTM + SC)', 'info');
      }
    } finally {
      set({ syncingAll: false });
    }
  },
}));

// ===== UI & Modals Store =====
interface UIState {
  theme: 'dark' | 'light' | 'amoled';
  seedColor: string;
  dynamicColorFromArt: boolean;
  activeArtColor: string | null;
  activeArtGradientColors: string[];
  uiScale: number;
  playerStyle: PlayerStyleId;
  ambientBackgroundBlur: boolean;
  reduceInterfaceMotion: boolean;
  interfaceMotionPreset: AppSettings['interfaceMotionPreset'];
  compactTrackRows: boolean;
  glassEffect: AppSettings['glassEffect'];
  visualizerEnabled: boolean;
  visualizerStyle: 'bars' | 'wave' | 'circular';
  showNowPlaying: boolean;
  isMiniPipMode: boolean;
  queueDrawerOpen: boolean;
  sidebarCollapsed: boolean;
  toasts: SmartToast[];
  contextMenu: ContextMenuState | null;
  sourceSwitcherTrack: Track | null;
  auditTarget: { track: Track; urlOrPath?: string } | null;
  tagEditorTrack: Track | null;
  closeToTray: boolean;
  mprisEnabled: boolean;
  discordRpc: boolean;
  localApiEnabled: boolean;
  hardwareAcceleration: boolean;
  lastfmApiKey: string;
  lastfmSecret: string;
  lastfmSessionKey: string;
  listenBrainzEnabled: boolean;
  listenBrainzToken: string;
  showSmartSwitchToasts: boolean;
  downloadFormat: 'mp3' | 'flac' | 'opus';
  downloadPath: string;
  embedMetadataAndLyrics: boolean;

  setTheme: (t: 'dark' | 'light' | 'amoled', persist?: boolean) => void;
  setSeedColor: (c: string, persist?: boolean) => void;
  setDynamicColorFromArt: (enabled: boolean) => void;
  setActiveArtColor: (c: string | null, gradientColors?: string[]) => void;
  setUiScale: (scale: number, persist?: boolean) => void;
  setPlayerStyle: (style: PlayerStyleId, persist?: boolean) => void;
  setAppearance: (settings: Partial<Pick<AppSettings, 'ambientBackgroundBlur' | 'compactTrackRows' | 'glassEffect' | 'reduceInterfaceMotion' | 'interfaceMotionPreset'>>, persist?: boolean) => void;
  setVisualizer: (enabled: boolean, style?: 'bars' | 'wave' | 'circular') => void;
  setShowNowPlaying: (v: boolean) => void;
  setMiniPipMode: (v: boolean) => void;
  toggleQueueDrawer: () => void;
  setQueueDrawerOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  pushToast: (message: string, kind?: SmartToast['kind']) => void;
  dismissToast: (id: string) => void;
  setContextMenu: (menu: ContextMenuState | null) => void;
  setSourceSwitcherTrack: (track: Track | null) => void;
  setAuditTarget: (target: { track: Track; urlOrPath?: string } | null) => void;
  setTagEditorTrack: (track: Track | null) => void;
  setDesktopSetting: (partial: Partial<AppSettings>) => void;
}

let palettePropertiesRegistered = false;

export function applyThemeCssVars(
  theme: 'dark' | 'light' | 'amoled',
  seedHex: string,
  gradientColors: string[] = [],
  animateArtwork = false,
) {
  const root = document.documentElement;
  const scheme = generateMaterialYouScheme(seedHex, theme, gradientColors);
  const rgb = hexToRgb(scheme.primary);
  const colors = {
    '--md-primary': scheme.primary,
    '--md-on-primary': scheme.onPrimary,
    '--md-primary-container': scheme.primaryContainer,
    '--md-on-primary-container': scheme.onPrimaryContainer,
    '--md-secondary': scheme.secondary,
    '--md-on-secondary': scheme.onSecondary,
    '--md-secondary-container': scheme.secondaryContainer,
    '--md-on-secondary-container': scheme.onSecondaryContainer,
    '--md-tertiary': scheme.tertiary,
    '--md-on-tertiary': scheme.onTertiary,
    '--md-tertiary-container': scheme.tertiaryContainer,
    '--md-on-tertiary-container': scheme.onTertiaryContainer,
    '--md-surface': scheme.surface,
    '--md-surface-dim': scheme.surfaceDim,
    '--md-surface-bright': scheme.surfaceBright,
    '--md-surface-container-lowest': scheme.surfaceContainerLowest,
    '--md-surface-container-low': scheme.surfaceContainerLow,
    '--md-surface-container': scheme.surfaceContainer,
    '--md-surface-container-high': scheme.surfaceContainerHigh,
    '--md-surface-container-highest': scheme.surfaceContainerHighest,
    '--md-surface-variant': scheme.surfaceVariant,
    '--md-on-surface': scheme.onSurface,
    '--md-on-surface-variant': scheme.onSurfaceVariant,
    '--md-outline': scheme.outline,
    '--md-outline-variant': scheme.outlineVariant,
    '--md-error': scheme.error,
    '--md-on-error': scheme.onError,
    '--player-glow-accent': scheme.playerGlowAccent,
    '--player-bg-tint': scheme.playerBgTint,
    '--player-backdrop-top': scheme.backdropTop,
    '--player-backdrop-mid': scheme.backdropMid,
    '--player-backdrop-bottom': scheme.backdropBottom,
  };

  if (!palettePropertiesRegistered && typeof CSS !== 'undefined' && CSS.registerProperty) {
    for (const [name, initialValue] of Object.entries(colors)) {
      CSS.registerProperty({ name, syntax: '<color>', inherits: true, initialValue });
    }
    root.style.setProperty('--artwork-palette-properties', Object.keys(colors).join(', '));
    palettePropertiesRegistered = true;
  }

  root.toggleAttribute('data-artwork-palette-transition', animateArtwork && palettePropertiesRegistered);
  for (const [name, color] of Object.entries(colors)) root.style.setProperty(name, color);
  root.style.setProperty('--md-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'dark',
  seedColor: '#cbb9f5',
  dynamicColorFromArt: true,
  activeArtColor: null,
  activeArtGradientColors: [],
  uiScale: 1.0,
  playerStyle: 'flamingo',
  ambientBackgroundBlur: true,
  reduceInterfaceMotion: false,
  interfaceMotionPreset: 'balanced',
  compactTrackRows: false,
  glassEffect: 'soft',
  visualizerEnabled: true,
  visualizerStyle: 'bars',
  showNowPlaying: false,
  isMiniPipMode: false,
  queueDrawerOpen: false,
  sidebarCollapsed: false,
  toasts: [],
  contextMenu: null,
  sourceSwitcherTrack: null,
  auditTarget: null,
  tagEditorTrack: null,
  closeToTray: false,
  mprisEnabled: true,
  discordRpc: true,
  localApiEnabled: false,
  hardwareAcceleration: true,
  lastfmApiKey: '',
  lastfmSecret: '',
  lastfmSessionKey: '',
  listenBrainzEnabled: false,
  listenBrainzToken: '',
  showSmartSwitchToasts: true,
  downloadFormat: 'flac',
  downloadPath: '',
  embedMetadataAndLyrics: true,

  setTheme: (theme, persist = true) => {
    set({ theme });
    const { dynamicColorFromArt, activeArtColor, activeArtGradientColors, seedColor } = get();
    applyThemeCssVars(theme, (dynamicColorFromArt && activeArtColor) || seedColor,
      dynamicColorFromArt ? activeArtGradientColors : []);
    if (persist) window.electronAPI?.db?.updateSettings({ theme });
  },

  setSeedColor: (seedColor, persist = true) => {
    set({ seedColor });
    const { theme, dynamicColorFromArt, activeArtColor, activeArtGradientColors } = get();
    applyThemeCssVars(theme, (dynamicColorFromArt && activeArtColor) || seedColor,
      dynamicColorFromArt ? activeArtGradientColors : []);
    if (persist) window.electronAPI?.db?.updateSettings({ seedColor });
  },

  setDynamicColorFromArt: (dynamicColorFromArt) => {
    set({ dynamicColorFromArt, activeArtColor: null, activeArtGradientColors: [] });
    applyThemeCssVars(get().theme, get().seedColor);
    window.electronAPI?.db?.updateSettings({ dynamicColorFromArt });
  },

  setActiveArtColor: (activeArtColor, activeArtGradientColors = []) => {
    if (!get().dynamicColorFromArt) return;
    set({ activeArtColor, activeArtGradientColors });
    applyThemeCssVars(get().theme, activeArtColor || get().seedColor, activeArtGradientColors, true);
  },

  setUiScale: (uiScale, persist = true) => {
    const clamped = Math.max(0.85, Math.min(1.25, uiScale));
    set({ uiScale: clamped });
    document.documentElement.style.fontSize = `${Math.round(clamped * 16)}px`;
    if (persist) window.electronAPI?.db?.updateSettings({ uiScale: clamped });
  },

  setPlayerStyle: (playerStyle, persist = true) => {
    set({ playerStyle });
    if (persist) window.electronAPI?.db?.updateSettings({ playerStyle });
  },

  setAppearance: (settings, persist = true) => {
    set(settings);
    const root = document.documentElement;
    root.dataset.glassEffect = get().glassEffect;
    root.toggleAttribute('data-compact-tracks', get().compactTrackRows);
    root.toggleAttribute('data-reduced-motion', get().reduceInterfaceMotion);
    if (persist) void window.electronAPI?.db?.updateSettings(settings);
  },

  setVisualizer: (visualizerEnabled, visualizerStyle) => {
    const style = visualizerStyle ?? get().visualizerStyle;
    set({ visualizerEnabled, visualizerStyle: style });
    window.electronAPI?.db?.updateSettings({ visualizerEnabled, visualizerStyle: style });
  },

  setShowNowPlaying: (showNowPlaying) => set({ showNowPlaying }),
  setMiniPipMode: (isMiniPipMode) => set({ isMiniPipMode }),
  toggleQueueDrawer: () => set((s) => ({ queueDrawerOpen: !s.queueDrawerOpen })),
  setQueueDrawerOpen: (queueDrawerOpen) => set({ queueDrawerOpen }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  pushToast: (message, kind = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({
      toasts: [...s.toasts.slice(-4), { id, message, kind, timestamp: Date.now() }],
    }));
    setTimeout(() => {
      get().dismissToast(id);
    }, 4500);
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setContextMenu: (contextMenu) => set({ contextMenu }),
  setSourceSwitcherTrack: (sourceSwitcherTrack) => set({ sourceSwitcherTrack }),
  setAuditTarget: (auditTarget) => set({ auditTarget }),
  setTagEditorTrack: (tagEditorTrack) => set({ tagEditorTrack }),

  setDesktopSetting: (partial) => {
    set((s) => ({ ...s, ...partial }));
    if (partial.localApiEnabled !== undefined) {
      window.electronAPI?.desktop?.toggleLocalApi?.(partial.localApiEnabled);
    }
    window.electronAPI?.db?.updateSettings(partial);
  },
}));

export async function extractArtworkColors(imageUrl: string, seedColor: string) {
  let palette = await extractPaletteFromArtwork(imageUrl, seedColor);
  if (!palette) {
    const thumbnail = await window.electronAPI?.desktop?.readArtworkThumbnail?.(imageUrl);
    if (thumbnail) palette = await extractPaletteFromArtwork(thumbnail, seedColor);
  }
  return { color: palette?.seedHex ?? null, gradients: palette?.gradientColors ?? [] };
}

let hydrated = false;
export async function hydrateStoresFromDatabase(): Promise<void> {
  if (hydrated || !window.electronAPI?.db) return;
  hydrated = true;
  try {
    const db = await window.electronAPI.db.getInitialState();
    if (!db) return;

    const s: Partial<AppSettings> = db.settings || {};
    const ui = useUIStore.getState();
    ui.setTheme(s.theme || 'dark', false);
    ui.setSeedColor(s.seedColor || '#cbb9f5', false);
    ui.setUiScale(s.uiScale || 1.0, false);
    ui.setPlayerStyle(s.playerStyle || 'flamingo', false);
    ui.setAppearance({
      ambientBackgroundBlur: s.ambientBackgroundBlur ?? true,
      reduceInterfaceMotion: s.reduceInterfaceMotion ?? false,
      interfaceMotionPreset: s.interfaceMotionPreset ?? 'balanced',
      compactTrackRows: s.compactTrackRows ?? false,
      glassEffect: s.glassEffect ?? 'soft',
    }, false);
    useUIStore.setState({
      dynamicColorFromArt: s.dynamicColorFromArt ?? true,
      visualizerEnabled: s.visualizerEnabled ?? true,
      visualizerStyle: s.visualizerStyle ?? 'bars',
      closeToTray: s.closeToTray ?? false,
      mprisEnabled: s.mprisEnabled ?? true,
      discordRpc: s.discordRpc ?? true,
      localApiEnabled: s.localApiEnabled ?? false,
      hardwareAcceleration: s.hardwareAcceleration ?? true,
      lastfmApiKey: s.lastfmApiKey ?? '',
      lastfmSecret: s.lastfmSecret ?? '',
      lastfmSessionKey: s.lastfmSessionKey ?? '',
      listenBrainzEnabled: s.listenBrainzEnabled ?? false,
      listenBrainzToken: s.listenBrainzToken ?? '',
      showSmartSwitchToasts: s.showSmartSwitchToasts ?? true,
      downloadFormat: s.downloadFormat ?? 'flac',
      downloadPath: s.downloadPath ?? '',
      embedMetadataAndLyrics: s.embedMetadataAndLyrics ?? true,
    });

    usePlayerStore.setState({
      volume: s.volume ?? 0.85,
      speed: s.speed ?? 1.0,
      pitchSemitones: s.pitchSemitones ?? 0,
      repeat: s.repeat ?? 'none',
      shuffle: s.shuffle ?? false,
      normalization: s.normalization ?? false,
      audioCompressor: s.audioCompressor ?? false,
      exponentialVolume: s.exponentialVolume ?? true,
      bassBoost: s.bassBoost ?? 0,
      stereoWidener: s.stereoWidener ?? 0,
      silenceSkip: s.silenceSkip ?? false,
      audioDevice: s.audioDevice ?? 'auto',
      crossfade: s.crossfade ?? 6,
      smartDjAutomix: s.smartDjAutomix ?? true,
      prebufferNextTrack: s.prebufferNextTrack ?? true,
      autoRadioOnQueueEnd: s.autoRadioOnQueueEnd ?? true,
      automixMode: s.automixMode ?? 'auto',
      gaplessAlbum: s.gaplessAlbum ?? true,
      eqEnabled: s.eqEnabled ?? false,
      eqPreset: s.eqPreset ?? 'Flat',
      eqBands:
        Array.isArray(s.eqBands) && s.eqBands.length === 10
          ? s.eqBands
          : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preferredAudioSource: s.preferredAudioSource ?? 'auto',
      sourceOrder:
        Array.isArray(s.sourceOrder) && s.sourceOrder.length > 0
          ? s.sourceOrder
          : [...DEFAULT_SOURCE_ORDER],
      enabledSources: {
        ...DEFAULT_ENABLED_SOURCES,
        ...(s.enabledSources || {}),
      },
      universalFallback: s.universalFallback ?? true,
      autoUpgradeLossless: s.autoUpgradeLossless ?? true,
      canvasEnabled: s.canvasEnabled ?? true,
      lyricsOffset: s.lyricsOffset ?? 0,
      lyricsFontSize: s.lyricsFontSize ?? 'medium',
      lyricsWordByWord: s.lyricsWordByWord ?? true,
      lyricsRomanize: s.lyricsRomanize ?? true,
      lyricsTranslate: s.lyricsTranslate ?? false,
      lyricsTranslateLang: s.lyricsTranslateLang ?? 'ru',
      sponsorBlockEnabled: s.sponsorBlockEnabled ?? true,
      sponsorBlockCategories: s.sponsorBlockCategories ?? [
        'sponsor',
        'intro',
        'outro',
        'selfpromo',
        'music_offtopic',
      ],
      aiContentFilter: s.aiContentFilter ?? false,
      likedSongs: db.likedSongs ?? [],
      playlists: db.playlists ?? [],
      history: db.history ?? [],
      blockedArtists: db.blockedArtists ?? [],
      currentTrack: db.queueState?.currentTrack ?? null,
      queue: db.queueState?.queue ?? [],
      originalQueue: db.queueState?.originalQueue ?? [],
      queueIndex: db.queueState?.queueIndex ?? -1,
      position: db.queueState?.position ?? 0,
    });

    useLibraryStore.setState({
      directories: db.directories ?? [],
      tracks: db.localTracks ?? [],
    });

    await useAccountsStore.getState().refreshAllStatuses();
  } catch (err) {
    console.warn('Database hydration failed:', err);
  }
}
