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

export type { Track, PlaylistItem, PlayerStyleId, AudioSourceId, AutomixMode, AutoMixPlan };

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
  isScrubbing: boolean;
  automixing: boolean;
  automixPlan: AutoMixPlan | null;
  position: number;
  duration: number;
  trackStartTimeSec: number;
  resolvedSourceBadge: string;
  resolvedSourceId: AudioSourceId | 'local' | null;
  isLosslessActive: boolean;
  volume: number;
  repeat: 'none' | 'one' | 'all';
  shuffle: boolean;
  loading: boolean;
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
  setIsScrubbing: (scrubbing: boolean) => void;
  setAutomixing: (automixing: boolean) => void;
  setAutomixPlan: (plan: AutoMixPlan | null) => void;
  setPosition: (pos: number) => void;
  setDuration: (dur: number) => void;
  setTrackStartTimeSec: (sec: number) => void;
  setResolvedStreamMeta: (badge: string, sourceId: AudioSourceId | 'local', lossless: boolean) => void;
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

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  originalQueue: [],
  queueIndex: -1,
  isPlaying: false,
  isScrubbing: false,
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
    set({ currentTrack: track, position: 0, abLoopA: null, abLoopB: null });
    window.electronAPI?.player?.setAbLoop?.(null, null);
    persistQueueState(get());
  },

  setQueue: (tracks, startIndex = 0) => {
    const blocked = new Set(get().blockedArtists.map((a) => a.toLowerCase()));
    const filtered = tracks.filter(
      (t) => !blocked.has((t.artist || '').toLowerCase())
    );
    const list = filtered.length > 0 ? filtered : tracks;
    const clampedIdx = Math.max(0, Math.min(startIndex, list.length - 1));
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
      const nextQueue = [...s.queue];
      nextQueue.splice(index, 1);
      let nextIndex = s.queueIndex;
      if (index < s.queueIndex) nextIndex = Math.max(0, s.queueIndex - 1);
      if (nextIndex >= nextQueue.length) nextIndex = nextQueue.length - 1;
      return { queue: nextQueue, queueIndex: nextIndex };
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
      const newCurrentIdx = s.currentTrack
        ? next.findIndex((t) => t.id === s.currentTrack?.id)
        : s.queueIndex;
      return { queue: next, queueIndex: newCurrentIdx >= 0 ? newCurrentIdx : s.queueIndex };
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
  setIsScrubbing: (isScrubbing) => set({ isScrubbing }),
  setAutomixing: (automixing) => set({ automixing }),
  setAutomixPlan: (automixPlan) => set({ automixPlan }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
  setTrackStartTimeSec: (trackStartTimeSec) => set({ trackStartTimeSec }),
  setResolvedStreamMeta: (resolvedSourceBadge, resolvedSourceId, isLosslessActive) =>
    set({ resolvedSourceBadge, resolvedSourceId, isLosslessActive }),

  setVolume: (volume) => {
    set({ volume });
    window.electronAPI?.db?.updateSettings({ volume });
  },

  setRepeat: (repeat) => {
    set({ repeat });
    window.electronAPI?.db?.updateSettings({ repeat });
  },

  toggleShuffle: () => {
    const { shuffle, queue, originalQueue, currentTrack } = get();
    const nextShuffle = !shuffle;
    if (nextShuffle && queue.length > 1) {
      const rest = queue.filter((t) => t.id !== currentTrack?.id);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      const newQ = currentTrack ? [currentTrack, ...rest] : rest;
      set({ shuffle: true, queue: newQ, queueIndex: currentTrack ? 0 : -1 });
    } else if (!nextShuffle && originalQueue.length > 0) {
      const idx = originalQueue.findIndex((t) => t.id === currentTrack?.id);
      set({
        shuffle: false,
        queue: [...originalQueue],
        queueIndex: idx >= 0 ? idx : 0,
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
    if (repeat === 'one') {
      return queue[queueIndex] ?? null;
    }
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
    return get().likedSongs.some((t) => t.id === track.id);
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
  results: Track[];
  albums: any[];
  artists: any[];
  playlists: any[];
  sourceFilter: 'all' | AudioSourceId;
  suggestions: string[];
  searching: boolean;
  setQuery: (q: string) => void;
  setResults: (results: Track[]) => void;
  setSearchAllResults: (res: { songs: Track[]; albums: any[]; artists: any[]; playlists: any[] }) => void;
  setSourceFilter: (s: 'all' | AudioSourceId) => void;
  setSuggestions: (s: string[]) => void;
  setSearching: (s: boolean) => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  results: [],
  albums: [],
  artists: [],
  playlists: [],
  sourceFilter: 'all',
  suggestions: [],
  searching: false,
  setQuery: (query) => set({ query }),
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
  uiScale: number;
  playerStyle: PlayerStyleId;
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
  setActiveArtColor: (c: string | null) => void;
  setUiScale: (scale: number, persist?: boolean) => void;
  setPlayerStyle: (style: PlayerStyleId, persist?: boolean) => void;
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

export function applyThemeCssVars(theme: 'dark' | 'light' | 'amoled', seedHex: string) {
  const root = document.documentElement;
  const hex = seedHex.replace(/^#/, '');
  const r = parseInt(hex.slice(0, 2), 16) || 203;
  const g = parseInt(hex.slice(2, 4), 16) || 185;
  const b = parseInt(hex.slice(4, 6), 16) || 245;

  root.style.setProperty('--md-primary', seedHex);
  root.style.setProperty('--md-primary-rgb', `${r}, ${g}, ${b}`);
  root.style.setProperty('--md-primary-container', `rgba(${r}, ${g}, ${b}, 0.25)`);
  root.style.setProperty('--md-on-primary-container', seedHex);
  root.style.setProperty('--player-glow-accent', `rgba(${r}, ${g}, ${b}, 0.35)`);
  root.style.setProperty('--player-bg-tint', `rgba(${r}, ${g}, ${b}, 0.12)`);

  if (theme === 'light') {
    root.style.setProperty('--md-surface', '#f6f3f8');
    root.style.setProperty('--md-surface-container', '#ece8f0');
    root.style.setProperty('--md-surface-container-high', '#e2dde8');
    root.style.setProperty('--md-surface-container-highest', '#d7d1df');
    root.style.setProperty('--md-on-surface', '#1d1b20');
    root.style.setProperty('--md-on-surface-variant', '#49454f');
    root.style.setProperty('--md-outline', '#79747e');
    root.style.setProperty('--md-outline-variant', '#cac4d0');
    root.style.setProperty('--md-on-primary', '#ffffff');
  } else if (theme === 'amoled') {
    root.style.setProperty('--md-surface', '#000000');
    root.style.setProperty('--md-surface-container', '#0a090d');
    root.style.setProperty('--md-surface-container-high', '#14121a');
    root.style.setProperty('--md-surface-container-highest', '#1e1b26');
    root.style.setProperty('--md-on-surface', '#f2edf5');
    root.style.setProperty('--md-on-surface-variant', '#cac4d0');
    root.style.setProperty('--md-outline', '#938f99');
    root.style.setProperty('--md-outline-variant', '#35313c');
    root.style.setProperty('--md-on-primary', '#1e0c4e');
  } else {
    root.style.setProperty('--md-surface', '#141218');
    root.style.setProperty('--md-surface-container', '#1e1b22');
    root.style.setProperty('--md-surface-container-high', '#2b2831');
    root.style.setProperty('--md-surface-container-highest', '#36343b');
    root.style.setProperty('--md-on-surface', '#e6e1e5');
    root.style.setProperty('--md-on-surface-variant', '#cac4d0');
    root.style.setProperty('--md-outline', '#938f99');
    root.style.setProperty('--md-outline-variant', '#49454f');
    root.style.setProperty('--md-on-primary', '#341e72');
  }
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'dark',
  seedColor: '#cbb9f5',
  dynamicColorFromArt: true,
  activeArtColor: null,
  uiScale: 1.0,
  playerStyle: 'flamingo',
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
    const seed = get().dynamicColorFromArt && get().activeArtColor ? get().activeArtColor! : get().seedColor;
    applyThemeCssVars(theme, seed);
    if (persist) window.electronAPI?.db?.updateSettings({ theme });
  },

  setSeedColor: (seedColor, persist = true) => {
    set({ seedColor });
    applyThemeCssVars(get().theme, seedColor);
    if (persist) window.electronAPI?.db?.updateSettings({ seedColor });
  },

  setDynamicColorFromArt: (dynamicColorFromArt) => {
    set({ dynamicColorFromArt });
    const color = dynamicColorFromArt && get().activeArtColor ? get().activeArtColor! : get().seedColor;
    applyThemeCssVars(get().theme, color);
    window.electronAPI?.db?.updateSettings({ dynamicColorFromArt });
  },

  setActiveArtColor: (activeArtColor) => {
    set({ activeArtColor });
    if (get().dynamicColorFromArt) {
      applyThemeCssVars(get().theme, activeArtColor || get().seedColor);
    }
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

export async function extractDominantColorFromImage(imageUrl: string): Promise<string | null> {
  if (!imageUrl) return null;
  // 1. Prefer native Electron extractor (bypasses CORS restrictions on CDNs like i.ytimg.com and scdn.co)
  if (window.electronAPI?.desktop?.extractPalette) {
    try {
      const pal = await window.electronAPI.desktop.extractPalette(imageUrl);
      if (pal?.primary) return pal.primary;
    } catch {
      /* fallback to DOM canvas */
    }
  }

  // 2. Fallback in-browser canvas with proper monochrome and lightness support
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data;
        let bestR = 203;
        let bestG = 185;
        let bestB = 245;
        let bestScore = -1;
        let totalSat = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const l = (max + min) / 510;
          const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
          totalSat += s;
          count++;

          if (l > 0.18 && l < 0.86 && s > bestScore) {
            bestScore = s;
            bestR = r;
            bestG = g;
            bestB = b;
          }
        }

        // If monochrome or grayscale artwork
        if (count > 0 && totalSat / count < 0.1) {
          return resolve('#94a3b8');
        }

        const mixR = Math.min(255, Math.round(bestR * 0.8 + 255 * 0.2));
        const mixG = Math.min(255, Math.round(bestG * 0.8 + 255 * 0.2));
        const mixB = Math.min(255, Math.round(bestB * 0.8 + 255 * 0.2));
        const hex = `#${[mixR, mixG, mixB].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
        resolve(hex);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
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
