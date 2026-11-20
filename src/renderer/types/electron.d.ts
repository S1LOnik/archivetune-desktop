export type PlayerStyleId =
  | 'flamingo'
  | 'v8_immersive'
  | 'v10_expressive'
  | 'bitchord'
  | 'simpmusic'
  | 'spatialflow'
  | 'tiktok'
  | 'classic';

export type AudioSourceId =
  | 'tidal'
  | 'qobuz'
  | 'deezer'
  | 'jiosaavn'
  | 'apple'
  | 'youtube'
  | 'soundcloud'
  | 'spotify';

export type AutomixMode = 'auto' | 'dj_blend' | 'filter_ride' | 'equal_power' | 'gapless';

export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  thumbnail?: string;
  duration: number;
  source: AudioSourceId | 'local';
  path?: string;
  spotifyUri?: string;
  isrc?: string;
  likedAt?: number;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  lossless?: boolean;
  resolvedFrom?: string;
  qualityLabel?: string;
  qualityBadge?: string;
}

export interface PlaylistItem {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  source: 'local' | 'spotify' | 'youtube' | 'soundcloud' | 'imported';
  externalId?: string;
  tags?: string[];
  trackCount: number;
  tracks: Track[];
  updatedAt: number;
}

export interface MultiTrackCandidate {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  thumbnail?: string;
  source: AudioSourceId;
  qualityLabel: string;
  codec?: string;
  lossless?: boolean;
  matchScore?: number;
  externalId?: string;
}

export interface ProviderLatencyInfo {
  source: AudioSourceId;
  name: string;
  latencyMs: number | null;
  status: 'healthy' | 'degraded' | 'offline';
  checkedAt: number;
}

export interface SmartStreamResolution {
  streamUrl: string | null;
  spotifyId?: string;
  headers?: Record<string, string>;
  actualSource: AudioSourceId | 'local';
  originalSource: string;
  qualityLabel: string;
  lossless: boolean;
  switched: boolean;
  switchedReason?: string;
  error?: string;
}

export interface AutoMixPlan {
  style: 'DJ_BLEND' | 'FILTER_RIDE' | 'EQUAL_POWER' | 'GAPLESS';
  fadeMs: number;
  transitionEndMs: number;
  cueInMs: number;
  speedRatio: number;
  bassSwap: boolean;
  filterSweep: boolean;
  compatibilityScore: number;
  reason: string;
}

export interface AcousticAuditResult {
  codec: string;
  sampleRate: number;
  bitDepth: number;
  bitrateKbps: number;
  declaredLossless: boolean;
  cutoffHz: number;
  rollOffHz: number;
  verdict: 'VERIFIED_LOSSLESS' | 'HIGH_QUALITY_LOSSY' | 'SUSPECTED_TRANSCODE' | 'UNKNOWN';
  summary: string;
}

export interface SavedYouTubeAccountPublic {
  id: string;
  name: string;
  email: string;
  channelHandle: string;
  avatarUrl?: string;
  ytmSync: boolean;
  hasDataSyncId: boolean;
}

export interface TogetherState {
  role: 'idle' | 'host' | 'guest';
  roomCode: string;
  roomUrl: string;
  displayName: string;
  participants: Array<{ id: string; name: string; role: string; rttMs: number }>;
  chat: Array<{ id: string; sender: string; text: string; timestamp: number }>;
  syncedTrack?: Track | null;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'amoled';
  seedColor: string;
  dynamicColorFromArt: boolean;
  uiScale: number;
  playerStyle: PlayerStyleId;
  visualizerEnabled: boolean;
  visualizerStyle: 'bars' | 'wave' | 'circular';
  volume: number;
  speed: number;
  pitchSemitones: number;
  repeat: 'none' | 'one' | 'all';
  shuffle: boolean;
  normalization: boolean;
  bassBoost: number;
  stereoWidener: number;
  crossfade: number;
  smartDjAutomix: boolean;
  automixMode: AutomixMode;
  gaplessAlbum: boolean;
  silenceSkip: boolean;
  audioDevice: string;
  eqEnabled: boolean;
  eqPreset: string;
  eqBands: number[];
  preferredAudioSource: 'auto' | AudioSourceId;
  sourceOrder: AudioSourceId[];
  enabledSources: Record<AudioSourceId, boolean>;
  universalFallback: boolean;
  autoUpgradeLossless: boolean;
  tidalQuality: 'HI_RES_LOSSLESS' | 'LOSSLESS' | 'HIGH';
  qobuzQuality: 'HI_RES_192' | 'LOSSLESS' | 'MP3_320';
  deezerQuality: 'FLAC' | 'MP3_320' | 'MP3_128';
  saavnQuality: '320' | '160';
  soundcloudQuality: 'OPUS_160' | 'MP3_128';
  tidalToken: string;
  qobuzToken: string;
  deezerArl: string;
  soundcloudToken: string;
  youtubeCookie: string;
  sponsorBlockEnabled: boolean;
  sponsorBlockCategories: string[];
  canvasEnabled: boolean;
  lyricsOffset: number;
  lyricsFontSize: 'small' | 'medium' | 'large';
  lyricsWordByWord: boolean;
  lyricsRomanize: boolean;
  lyricsTranslate: boolean;
  lyricsTranslateLang: string;
  downloadFormat: 'mp3' | 'flac' | 'opus';
  downloadPath: string;
  playbackCacheMB: number;
  nativeSpotifyEnabled: boolean;
  embedMetadataAndLyrics: boolean;
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
  exponentialVolume: boolean;
  audioCompressor: boolean;
  aiContentFilter: boolean;
  poToken: string;
  webClientPoTokenEnabled: boolean;
  autoSwitchThreshold: number;
  preferLosslessOverExact: boolean;
  autoSyncSpotify: boolean;
  autoSyncYtm: boolean;
  autoSyncSc: boolean;
  autoRadioOnQueueEnd: boolean;
  prebufferNextTrack: boolean;
  compactTrackRows: boolean;
  ambientBackgroundBlur: boolean;
  reduceInterfaceMotion: boolean;
  interfaceMotionPreset: 'balanced' | 'snappy' | 'bouncy' | 'smooth';
  glassEffect: 'off' | 'soft' | 'full';
  replayGainMode: 'off' | 'track' | 'album';
  targetLoudnessLufs: number;
  keyboardShortcutsEnabled: boolean;
}

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      onMediaShortcut: (cb: (action: 'playPause' | 'play' | 'pause' | 'next' | 'prev') => void) => () => void;
      updateDiscordPresence: (trackInfo: object | null) => Promise<{ ok: boolean }>;
      openExternal: (url: string) => void;
      onMediaSeek: (cb: (event: { position?: number; offset?: number }) => void) => () => void;
      desktop: {
        updatePlaybackMode: (mode: { shuffle: boolean; repeat: string }) => void;
        onPlaybackMode: (cb: (mode: { shuffle?: boolean; repeat?: 'none' | 'one' | 'all' }) => void) => () => void;
        updateLyrics: (trackId: string, lines: Array<{ time: number; text: string }>) => void;
        updatePosition: (position: number, seeked?: boolean, trackId?: string) => void;
        updatePresence: (trackInfo: object | null) => Promise<{ ok: boolean }>;
        listenBrainzNowPlaying: (trackInfo: object) => Promise<{ ok: boolean }>;
        listenBrainzScrobble: (trackInfo: object) => Promise<{ ok: boolean }>;
        toggleLocalApi: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>;
        readArtworkThumbnail: (imageUrl: string) => Promise<string | null>;
      };
      db: {
        getInitialState: () => Promise<any>;
        updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
        saveQueueState: (queueState: object) => Promise<{ ok: boolean }>;
        saveHistory: (history: Track[]) => Promise<{ ok: boolean }>;
        saveLocalLibrary: (directories: string[], localTracks: Track[]) => Promise<{ ok: boolean }>;
        toggleLike: (track: Track) => Promise<{ liked: boolean; likedSongs: Track[] }>;
        upsertLikedBatch: (tracks: Track[], replaceAll?: boolean) => Promise<Track[]>;
        savePlaylist: (playlist: PlaylistItem) => Promise<PlaylistItem[]>;
        deletePlaylist: (playlistId: string) => Promise<PlaylistItem[]>;
        toggleBlockArtist: (artistName: string) => Promise<string[]>;
        recordStats: (track: Track, seconds?: number) => Promise<any>;
        getStats: () => Promise<any>;
        resetStats: () => Promise<any>;
        exportBackup: () => Promise<{ ok: boolean; filePath?: string }>;
        importBackup: () => Promise<{ ok: boolean; state?: any }>;
      };
      playbackCache: {
        info: () => Promise<{ bytes: number; count: number; limitMB: number }>;
        configure: (limitMB: number) => Promise<{ bytes: number; count: number; limitMB: number }>;
        clear: () => Promise<{ bytes: number; count: number; limitMB: number }>;
      };
      offline: {
        find: (id: string) => Promise<{ filePath: string; track?: Track } | null>;
        list: () => Promise<Array<{ track: Track; filePath: string; bytes: number; savedAt: number }>>;
        save: (track: Track) => Promise<{ ok: boolean; error?: string }>;
        remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
      };
      player: {
        play: (url: string, meta: object) => Promise<{ ok: boolean; error?: string }>;
        prebufferNext: (nextData: object | null) => Promise<{ ok: boolean }>;
        pause: () => Promise<void>;
        resume: () => Promise<void>;
        stop: () => Promise<void>;
        seek: (seconds: number) => Promise<void>;
        setVolume: (vol: number) => Promise<void>;
        setSpeed: (speed: number) => Promise<void>;
        setNormalization: (enabled: boolean) => Promise<void>;
        setDsp: (opts: object) => Promise<void>;
        setCrossfade: (seconds: number) => Promise<void>;
        setSmartDjAutomix: (enabled: boolean) => Promise<void>;
        setAutomixConfig: (opts: object) => Promise<void>;
        setEqualizer: (config: { enabled: boolean; bands: number[]; preset?: string }) => Promise<void>;
        getAudioDevices: () => Promise<Array<{ id: string; description: string }>>;
        setAudioDevice: (device: string) => Promise<void>;
        setSleepTimer: (minutes: number | null, afterTrack?: boolean) => Promise<void>;
        setAbLoop: (a: number | null, b: number | null) => Promise<{ a: number | null; b: number | null }>;
        auditQuality: (urlOrPath?: string) => Promise<AcousticAuditResult | null>;
        downloadTrack: (track: Track & { format?: 'mp3' | 'flac' | 'opus'; lrc?: string }) => Promise<{ ok: boolean; filePath?: string; error?: string; warning?: string }>;
        getStatus: () => Promise<any>;
        onRecovery: (cb: (info: { trackId: string; loading: boolean; error?: string; source?: string; badge?: string; lossless?: boolean; spotifyId?: string }) => void) => () => void;
        onProgress: (cb: (info: any) => void) => () => void;
        onEnded: (cb: (info?: { trackId?: string | null; revision?: number }) => void) => () => void;
        onAutomixTransition: (cb: (info: { fromTrackId?: string; nextTrackId: string; spotifyId?: string; revision?: number }) => void) => () => void;
        onAutomixPlan: (cb: (plan: AutoMixPlan | null) => void) => () => void;
        onSmartToast: (cb: (toast: { message: string; kind: string; timestamp: number }) => void) => () => void;
        onSleepTimerUpdate: (cb: (info: { remainingSec: number; afterTrack: boolean }) => void) => () => void;
      };
      ytmusic: {
        search: (query: string) => Promise<Track[]>;
        searchAll: (query: string) => Promise<{ songs: Track[]; albums: any[]; artists: any[]; playlists: any[] }>;
        getSuggestions: (query: string) => Promise<string[]>;
        getStreamUrl: (videoId: string) => Promise<string | null>;
        getHome: (chipParams?: string, forceRefresh?: boolean) => Promise<any>;
        getExplore: () => Promise<{ charts: Track[]; moods: Array<{ title: string; query: string }>; newReleases: any[] }>;
        getCategory: (category: string, forceRefresh?: boolean) => Promise<Track[]>;
        getAlbum: (albumId: string) => Promise<{ title: string; artist: string; thumbnail: string; year?: string; tracks: Track[] } | null>;
        getArtist: (artistId: string) => Promise<{ name: string; thumbnail: string; subscribers?: string; songs: Track[]; albums: any[] } | null>;
        getPlaylist: (playlistId: string) => Promise<{ title: string; author?: string; thumbnail: string; tracks: Track[] } | null>;
        getSuggested: (videoId: string) => Promise<Track[]>;
      };
      providers: {
        searchMulti: (query: string, source?: string) => Promise<MultiTrackCandidate[]>;
        resolveUniversal: (track: object, forceSource?: AudioSourceId, options?: { priority?: 'playback' | 'prebuffer' }) => Promise<SmartStreamResolution>;
        findAlternatives: (track: object) => Promise<MultiTrackCandidate[]>;
        checkLatencies: () => Promise<ProviderLatencyInfo[]>;
      };
      recognition: {
        recognizeLive: (mode?: 'mic' | 'system') => Promise<{ result: any; error?: string }>;
        pickAndRecognizeFile: () => Promise<{ canceled: boolean; result: any }>;
        recognizeFile: (filePath: string) => Promise<any>;
        getHistory: () => Promise<any[]>;
        clearHistory: () => Promise<any[]>;
        topGlobal: (limit?: number) => Promise<any[]>;
        onStatus: (cb: (status: { phase: string; mode: string }) => void) => () => void;
      };
      together: {
        getState: () => Promise<TogetherState>;
        createRoom: (displayName: string, port?: number) => Promise<TogetherState>;
        joinRoom: (url: string, displayName: string, code: string) => Promise<{ ok: boolean; error?: string; state?: TogetherState }>;
        leaveRoom: () => Promise<{ ok: boolean }>;
        syncHostState: (update: object) => Promise<void>;
        sendChat: (text: string, senderName?: string) => Promise<void>;
        onState: (cb: (state: TogetherState) => void) => () => void;
        onSyncPlayback: (cb: (payload: any) => void) => () => void;
      };
      playlists: {
        importFromUrl: (rawUrl: string, customName?: string) => Promise<{ ok: boolean; playlist?: PlaylistItem; error?: string }>;
        importFromFile: () => Promise<{ ok: boolean; canceled?: boolean; playlist?: PlaylistItem; error?: string }>;
        export: (playlistId: string, format: 'm3u8' | 'json') => Promise<{ ok: boolean; filePath?: string; error?: string }>;
        onUpdated: (cb: (playlists: PlaylistItem[]) => void) => () => void;
      };
      spotify: {
        nativeConnect: () => Promise<{ok:boolean;error?:string}>;
        nativeDisable: () => Promise<{ok:boolean}>;
        nativeStatus: () => Promise<{ enabled: boolean; connected: boolean; lastError: string; bundled: boolean }>;
        getStatus: () => Promise<{ connected: boolean; user?: any }>;
        login: () => Promise<{ ok: boolean; user?: any; error?: string }>;
        connectManual: (spDc: string) => Promise<{ ok: boolean; user?: any; error?: string }>;
        disconnect: () => Promise<{ ok: boolean }>;
        getLikedSongs: (limit?: number, offset?: number) => Promise<Track[]>;
        getPlaylists: (limit?: number) => Promise<any[]>;
        getPlaylistTracks: (playlistId: string) => Promise<Track[]>;
        getSavedAlbums: (limit?: number) => Promise<any[]>;
        getFollowedArtists: (limit?: number) => Promise<any[]>;
        getTopTracks: (limit?: number) => Promise<Track[]>;
        toggleLike: (spotifyTrackId: string, like: boolean) => Promise<{ ok: boolean }>;
        search: (query: string, limit?: number) => Promise<Track[]>;
        resolveTrack: (track: object) => Promise<any>;
        getPersonalizedHome: (forceRefresh?: boolean) => Promise<Track[]>;
      };
      ytmAuth: {
        getStatus: () => Promise<{
          connected: boolean;
          activeAccount: SavedYouTubeAccountPublic | null;
          savedAccounts: SavedYouTubeAccountPublic[];
        }>;
        login: () => Promise<{ ok: boolean; account?: SavedYouTubeAccountPublic; error?: string }>;
        connectManualCookie: (cookie: string) => Promise<{ ok: boolean; account?: any; error?: string }>;
        switchAccount: (accountId: string) => Promise<{ ok: boolean; account?: any; error?: string }>;
        toggleSync: (enabled: boolean) => Promise<{ ok: boolean; ytmSync: boolean }>;
        logout: (accountId?: string) => Promise<{ ok: boolean }>;
        getLikedSongs: (mergeIntoLibrary?: boolean) => Promise<Track[]>;
        getLibraryPlaylists: () => Promise<Array<{ id: string; title: string; name?: string; trackCount?: number; subtitle?: string; thumbnail?: string }>>;
        getSubscriptions: () => Promise<Array<{ id: string; name: string; subtitle?: string; thumbnail?: string }>>;
        setLike: (videoId: string, like: boolean) => Promise<{ ok: boolean }>;
      };
      soundcloud: {
        getStatus: () => Promise<{ connected: boolean; user: any; scSyncEnabled: boolean }>;
        login: () => Promise<{ ok: boolean; user?: any; error?: string }>;
        connectManual: (token: string) => Promise<{ ok: boolean; user?: any; error?: string }>;
        logout: () => Promise<{ ok: boolean }>;
        refreshClientId: () => Promise<{ ok: boolean; clientId?: string }>;
        getLikedTracks: (limit?: number) => Promise<Track[]>;
        getPlaylists: (limit?: number) => Promise<any[]>;
        getFollowingFeed: (limit?: number) => Promise<Track[]>;
        getGenreCharts: (genre?: string, limit?: number) => Promise<Track[]>;
        toggleLike: (scTrackId: string, like: boolean) => Promise<{ ok: boolean }>;
      };
      tagEditor: {
        read: (filePath: string) => Promise<any>;
        pickCover: () => Promise<string | null>;
        write: (filePath: string, tags: object) => Promise<{ ok: boolean; error?: string }>;
      };
      library: {
        scan: (dir: string) => Promise<Track[]>;
        addDirectory: () => Promise<string | null>;
        addFiles: () => Promise<string[]>;
        getMetadata: (filePath: string) => Promise<Track | null>;
      };
      lyrics: {
        get: (title: string, artist: string, duration: number, trackId?: string, spotifyId?: string) => Promise<any>;
        searchCandidates: (query: string) => Promise<any[]>;
      };
      canvas: {
        get: (track: { id: string; title: string; artist: string }) => Promise<any>;
      };
      scrobble: {
        configure: (apiKey: string, apiSecret: string, sessionKey: string) => Promise<{ ok: boolean }>;
        updateNowPlaying: (track: object) => Promise<{ ok: boolean }>;
        scrobble: (track: object) => Promise<{ ok: boolean }>;
      };
    };
  }
}
