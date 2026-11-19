/**
 * db.ts — Persistent Database & State Engine for ArchiveTune Desktop V2
 *
 * Provides transactional persistence across restarts (mirroring Android Room + DataStore):
 * - Multi-Source Routing & Quality Preferences (Tidal, Qobuz, Deezer, JioSaavn, Apple Music, YTM, SoundCloud, Spotify)
 * - Smart DJ Automix, Dual-Deck Crossfade & DSP Chain settings
 * - Local Library tracks, Liked Songs, Custom Playlists with Tags, Play History, Persistent Queue
 * - Detailed Listening Stats & Wrapped Telemetry
 * - Shazam Music Recognition History, Blocked Artists, Integration Tokens (Spotify/Last.fm/ListenBrainz)
 * - Full Backup / Restore (.json) + SQLite mirror (archivetune.db)
 */

import { app, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

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

export interface PersistedTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
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
}

export interface PersistedPlaylist {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  source: 'local' | 'spotify' | 'youtube' | 'soundcloud' | 'imported';
  externalId?: string;
  tags?: string[];
  trackCount: number;
  tracks: PersistedTrack[];
  updatedAt: number;
}

export interface TrackListenStat {
  id: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail?: string;
  source: string;
  count: number;
  totalSec: number;
  lastPlayedAt: number;
}

export interface ListeningStats {
  totalPlays: number;
  totalSeconds: number;
  tracks: Record<string, TrackListenStat>;
  dailyMinutes: Record<string, number>; // YYYY-MM-DD -> minutes
  hourlyCounts: number[]; // 24 buckets
}

export interface RecognitionHistoryItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail?: string;
  timestamp: number;
  source: 'shazam';
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
  pitchSemitones: number; // -12 to +12
  repeat: 'none' | 'one' | 'all';
  shuffle: boolean;
  normalization: boolean;
  bassBoost: number; // 0 to 12 dB
  stereoWidener: number; // 0 to 1.0
  crossfade: number; // 0 to 20 seconds
  smartDjAutomix: boolean;
  automixMode: AutomixMode;
  gaplessAlbum: boolean;
  silenceSkip: boolean;
  audioDevice: string; // 'auto' or specific mpv audio device name
  eqEnabled: boolean;
  eqPreset: string;
  eqBands: number[]; // 10 bands: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k

  // Smart Multi-Source Routing & Integrations
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

  // SponsorBlock
  sponsorBlockEnabled: boolean;
  sponsorBlockCategories: string[];

  // Lyrics & Canvas
  canvasEnabled: boolean;
  lyricsOffset: number;
  lyricsFontSize: 'small' | 'medium' | 'large';
  lyricsWordByWord: boolean;
  lyricsRomanize: boolean;
  lyricsTranslate: boolean;
  lyricsTranslateLang: string;

  // Downloads
  downloadFormat: 'mp3' | 'flac' | 'opus';
  downloadPath: string;
  playbackCacheMB: number;
  nativeSpotifyEnabled: boolean;
  embedMetadataAndLyrics: boolean;

  // Desktop & Social Integrations
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

  // Notifications & Audio UX + Granular Customizations
  showSmartSwitchToasts: boolean;
  exponentialVolume: boolean;
  audioCompressor: boolean;
  aiContentFilter: boolean;
  poToken: string;
  webClientPoTokenEnabled: boolean;
  autoSwitchThreshold: number; // 70..98% match threshold for smart auto-switch
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

export interface SavedYouTubeAccount {
  id: string;
  name: string;
  email: string;
  channelHandle: string;
  avatarUrl?: string;
  cookie: string;
  visitorData?: string;
  dataSyncId?: string;
  ytmSync: boolean;
  addedAt: number;
}

export interface SoundCloudAccountState {
  oauthToken: string;
  user: {
    id: number;
    username: string;
    fullName?: string;
    avatarUrl?: string;
    followersCount?: number;
  } | null;
  scSyncEnabled: boolean;
}

export interface DatabaseSchema {
  version: number;
  settings: AppSettings;
  directories: string[];
  localTracks: PersistedTrack[];
  likedSongs: PersistedTrack[];
  playlists: PersistedPlaylist[];
  history: PersistedTrack[];
  blockedArtists: string[];
  recognitionHistory: RecognitionHistoryItem[];
  stats: ListeningStats;
  youtubeAuth: {
    activeAccountId: string | null;
    savedAccounts: SavedYouTubeAccount[];
  };
  soundcloudAuth: SoundCloudAccountState;
  queueState: {
    currentTrack: PersistedTrack | null;
    queue: PersistedTrack[];
    originalQueue: PersistedTrack[];
    queueIndex: number;
    position: number;
  };
}

export const DEFAULT_SOURCE_ORDER: AudioSourceId[] = [
  'spotify',
  'youtube',
  'soundcloud',
  'tidal',
  'qobuz',
  'deezer',
  'jiosaavn',
  'apple',
];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  seedColor: '#cbb9f5',
  dynamicColorFromArt: true,
  uiScale: 1.0,
  playerStyle: 'flamingo',
  visualizerEnabled: true,
  visualizerStyle: 'bars',
  volume: 0.85,
  speed: 1.0,
  pitchSemitones: 0,
  repeat: 'none',
  shuffle: false,
  normalization: false,
  bassBoost: 0,
  stereoWidener: 0,
  crossfade: 6,
  smartDjAutomix: true,
  automixMode: 'auto',
  gaplessAlbum: true,
  silenceSkip: false,
  audioDevice: 'auto',
  eqEnabled: false,
  eqPreset: 'Flat',
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

  preferredAudioSource: 'auto',
  sourceOrder: [...DEFAULT_SOURCE_ORDER],
  enabledSources: {
    tidal: true,
    qobuz: true,
    deezer: true,
    jiosaavn: true,
    apple: true,
    youtube: true,
    soundcloud: true,
    spotify: true,
  },
  universalFallback: true,
  autoUpgradeLossless: true,
  tidalQuality: 'LOSSLESS',
  qobuzQuality: 'LOSSLESS',
  deezerQuality: 'FLAC',
  saavnQuality: '320',
  soundcloudQuality: 'MP3_128',
  tidalToken: '',
  qobuzToken: '',
  deezerArl: '',
  soundcloudToken: '',
  youtubeCookie: '',

  sponsorBlockEnabled: true,
  sponsorBlockCategories: ['sponsor', 'intro', 'outro', 'selfpromo', 'music_offtopic'],

  canvasEnabled: true,
  lyricsOffset: 0,
  lyricsFontSize: 'medium',
  lyricsWordByWord: true,
  lyricsRomanize: true,
  lyricsTranslate: false,
  lyricsTranslateLang: 'ru',

  downloadFormat: 'flac',
  downloadPath: '',
  playbackCacheMB: 512,
  nativeSpotifyEnabled: false,
  embedMetadataAndLyrics: true,

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
  exponentialVolume: true,
  audioCompressor: false,
  aiContentFilter: false,
  poToken: '',
  webClientPoTokenEnabled: false,
  autoSwitchThreshold: 88,
  preferLosslessOverExact: true,
  autoSyncSpotify: true,
  autoSyncYtm: true,
  autoSyncSc: true,
  autoRadioOnQueueEnd: true,
  prebufferNextTrack: true,
  compactTrackRows: false,
  ambientBackgroundBlur: true,
  reduceInterfaceMotion: false,
  interfaceMotionPreset: 'balanced',
  glassEffect: 'soft',
  replayGainMode: 'track',
  targetLoudnessLufs: -14,
  keyboardShortcutsEnabled: true,
};

const DEFAULT_STATS: ListeningStats = {
  totalPlays: 0,
  totalSeconds: 0,
  tracks: {},
  dailyMinutes: {},
  hourlyCounts: new Array(24).fill(0),
};

const DEFAULT_DB: DatabaseSchema = {
  version: 3,
  settings: { ...DEFAULT_SETTINGS },
  directories: [],
  localTracks: [],
  likedSongs: [],
  playlists: [],
  history: [],
  blockedArtists: [],
  recognitionHistory: [],
  stats: { ...DEFAULT_STATS, hourlyCounts: new Array(24).fill(0) },
  youtubeAuth: {
    activeAccountId: null,
    savedAccounts: [],
  },
  soundcloudAuth: {
    oauthToken: '',
    user: null,
    scSyncEnabled: false,
  },
  queueState: {
    currentTrack: null,
    queue: [],
    originalQueue: [],
    queueIndex: -1,
    position: 0,
  },
};

let dbCache: DatabaseSchema | null = null;
let saveDebounceTimer: NodeJS.Timeout | null = null;
let sqliteSyncedOnce = false;
let sqliteSavePending = false;

function getDataDir(): string {
  try {
    return app.getPath('userData');
  } catch {
    return path.join(os.homedir(), '.config', 'archivetune-desktop');
  }
}

function getDbJsonPath(): string {
  return path.join(getDataDir(), 'archivetune-state.json');
}

function getSqlitePath(): string {
  return path.join(getDataDir(), 'archivetune.db');
}

export function getDb(): DatabaseSchema {
  if (dbCache) return dbCache;
  const jsonPath = getDbJsonPath();
  try {
    if (fs.existsSync(jsonPath)) {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      dbCache = {
        ...DEFAULT_DB,
        ...raw,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(raw.settings || {}),
          enabledSources: {
            ...DEFAULT_SETTINGS.enabledSources,
            ...(raw.settings?.enabledSources || {}),
          },
          sourceOrder:
            Array.isArray(raw.settings?.sourceOrder) && raw.settings.sourceOrder.length > 0
              ? raw.settings.sourceOrder
              : [...DEFAULT_SOURCE_ORDER],
        },
        stats: {
          ...DEFAULT_STATS,
          ...(raw.stats || {}),
          hourlyCounts:
            Array.isArray(raw.stats?.hourlyCounts) && raw.stats.hourlyCounts.length === 24
              ? raw.stats.hourlyCounts
              : new Array(24).fill(0),
        },
        youtubeAuth: {
          ...DEFAULT_DB.youtubeAuth,
          ...(raw.youtubeAuth || {}),
          savedAccounts: Array.isArray(raw.youtubeAuth?.savedAccounts)
            ? raw.youtubeAuth.savedAccounts
            : [],
        },
        soundcloudAuth: {
          ...DEFAULT_DB.soundcloudAuth,
          ...(raw.soundcloudAuth || {}),
        },
        queueState: {
          ...DEFAULT_DB.queueState,
          ...(raw.queueState || {}),
        },
      };
      return dbCache!;
    }
  } catch (err) {
    console.warn('[DB] Failed to read state JSON, using defaults:', err);
  }
  dbCache = JSON.parse(JSON.stringify(DEFAULT_DB));
  return dbCache!;
}

function sqlEscape(str: string | undefined | null): string {
  return `'${String(str ?? '').replace(/'/g, "''")}'`;
}

function syncToSqlite(db: DatabaseSchema): void {
  const sqliteFile = getSqlitePath();
  const statements: string[] = [];
  if (!sqliteSyncedOnce) {
    statements.push(
      `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`,
      `CREATE TABLE IF NOT EXISTS liked_songs (id TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT, thumbnail TEXT, duration INTEGER, source TEXT, liked_at INTEGER);`,
      `CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT, source TEXT, track_count INTEGER, updated_at INTEGER, data TEXT);`,
      `CREATE TABLE IF NOT EXISTS history (pos INTEGER PRIMARY KEY, id TEXT, title TEXT, artist TEXT, source TEXT, data TEXT);`,
      `CREATE TABLE IF NOT EXISTS stats_tracks (id TEXT PRIMARY KEY, title TEXT, artist TEXT, count INTEGER, total_sec INTEGER, last_played_at INTEGER);`
    );
    sqliteSyncedOnce = true;
  }

  statements.push(
    `BEGIN IMMEDIATE TRANSACTION;`,
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('app_settings', ${sqlEscape(JSON.stringify(db.settings))});`,
    `DELETE FROM liked_songs;`
  );

  for (const t of db.likedSongs.slice(0, 1500)) {
    statements.push(
      `INSERT OR REPLACE INTO liked_songs (id, title, artist, album, thumbnail, duration, source, liked_at) VALUES (${sqlEscape(t.id)}, ${sqlEscape(t.title)}, ${sqlEscape(t.artist)}, ${sqlEscape(t.album)}, ${sqlEscape(t.thumbnail)}, ${Math.round(t.duration || 0)}, ${sqlEscape(t.source)}, ${t.likedAt || Date.now()});`
    );
  }

  statements.push(`DELETE FROM playlists;`);
  for (const pl of db.playlists.slice(0, 300)) {
    statements.push(
      `INSERT OR REPLACE INTO playlists (id, name, source, track_count, updated_at, data) VALUES (${sqlEscape(pl.id)}, ${sqlEscape(pl.name)}, ${sqlEscape(pl.source)}, ${pl.tracks.length}, ${pl.updatedAt || Date.now()}, ${sqlEscape(JSON.stringify(pl))});`
    );
  }

  statements.push(`COMMIT;`);
  try {
    const child = spawn('sqlite3', [sqliteFile], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(statements.join('\n'));
  } catch {
    /* ignore */
  }
}

function persistDb(updateSqlite: boolean): void {
  if (!dbCache) return;
  try {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const target = getDbJsonPath();
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dbCache, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
    if (updateSqlite || (!sqliteSyncedOnce && !fs.existsSync(getSqlitePath()))) {
      syncToSqlite(dbCache);
    }
  } catch (err) {
    console.error('[DB] Failed to save DB:', err);
  }
}

export function saveDbImmediate(): void {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = null;
  sqliteSavePending = false;
  persistDb(true);
}

function scheduleSaveDb(delayMs: number, updateSqlite = true): void {
  sqliteSavePending ||= updateSqlite;
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    const shouldUpdateSqlite = sqliteSavePending;
    sqliteSavePending = false;
    persistDb(shouldUpdateSqlite);
  }, delayMs);
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const db = getDb();
  db.settings = {
    ...db.settings,
    ...partial,
    enabledSources: partial.enabledSources
      ? { ...db.settings.enabledSources, ...partial.enabledSources }
      : db.settings.enabledSources,
  };
  scheduleSaveDb(120);
  return db.settings;
}

export function upsertLikedSongsBatch(tracks: PersistedTrack[], replaceAll = false): PersistedTrack[] {
  const db = getDb();
  if (replaceAll) {
    db.likedSongs = tracks.map((t, idx) => ({ ...t, likedAt: t.likedAt || Date.now() - idx * 1000 }));
  } else {
    // When incoming batch is from a single platform (e.g. all 'youtube' or all 'spotify'),
    // replace existing tracks of that source with the authoritative ordered list from that platform,
    // and keep other sources intact!
    const sources = new Set(tracks.map((t) => t.source).filter(Boolean));
    if (sources.size === 1) {
      const src = Array.from(sources)[0];
      const otherTracks = db.likedSongs.filter((t) => t.source !== src);
      const freshSourceTracks = tracks.map((t, idx) => ({
        ...t,
        likedAt: t.likedAt || Date.now() - idx * 1000,
      }));
      db.likedSongs = [...freshSourceTracks, ...otherTracks];
    } else {
      const map = new Map<string, PersistedTrack>();
      for (const t of tracks) {
        map.set(t.id, { ...t, likedAt: t.likedAt || Date.now() });
      }
      for (const existing of db.likedSongs) {
        if (!map.has(existing.id)) map.set(existing.id, existing);
      }
      db.likedSongs = Array.from(map.values());
    }
  }
  saveDbImmediate();
  return db.likedSongs;
}

export function toggleLikeSong(track: PersistedTrack): { liked: boolean; likedSongs: PersistedTrack[] } {
  const db = getDb();
  const idx = db.likedSongs.findIndex((t) => t.id === track.id);
  if (idx >= 0) {
    db.likedSongs.splice(idx, 1);
    saveDbImmediate();
    return { liked: false, likedSongs: db.likedSongs };
  }
  db.likedSongs.unshift({ ...track, likedAt: Date.now() });
  saveDbImmediate();
  return { liked: true, likedSongs: db.likedSongs };
}

export function recordTrackPlayStats(track: PersistedTrack, secondsListened?: number): ListeningStats {
  const db = getDb();
  const sec = Math.max(0, Math.round(secondsListened ?? (track.duration > 0 ? Math.min(track.duration, 180) : 30)));
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const hour = now.getHours();

  db.stats.totalPlays += 1;
  db.stats.totalSeconds += sec;
  db.stats.dailyMinutes[dayKey] = (db.stats.dailyMinutes[dayKey] || 0) + Math.round(sec / 60);
  db.stats.hourlyCounts[hour] = (db.stats.hourlyCounts[hour] || 0) + 1;

  const existing = db.stats.tracks[track.id];
  db.stats.tracks[track.id] = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    thumbnail: track.thumbnail,
    source: track.source,
    count: (existing?.count || 0) + 1,
    totalSec: (existing?.totalSec || 0) + sec,
    lastPlayedAt: Date.now(),
  };

  scheduleSaveDb(500, false);
  return db.stats;
}

export function addRecognitionHistory(item: RecognitionHistoryItem): RecognitionHistoryItem[] {
  const db = getDb();
  db.recognitionHistory = [
    item,
    ...db.recognitionHistory.filter((x) => !(x.title === item.title && x.artist === item.artist)),
  ].slice(0, 100);
  saveDbImmediate();
  return db.recognitionHistory;
}

export const addRecognitionResult = addRecognitionHistory;
export const saveDb = saveDbImmediate;

export function setupDatabaseIPC(): void {
  ipcMain.handle('db:getInitialState', () => {
    return getDb();
  });

  ipcMain.handle('db:updateSettings', (_e, partial: Partial<AppSettings>) => {
    return updateSettings(partial);
  });

  ipcMain.handle('db:saveQueueState', (_e, queueState: DatabaseSchema['queueState']) => {
    const db = getDb();
    db.queueState = {
      currentTrack: queueState.currentTrack,
      queue: queueState.queue.slice(0, 500),
      originalQueue: queueState.originalQueue.slice(0, 500),
      queueIndex: queueState.queueIndex,
      position: queueState.position,
    };
    scheduleSaveDb(800, false);
    return true;
  });

  ipcMain.handle('db:saveHistory', (_e, history: PersistedTrack[]) => {
    const db = getDb();
    db.history = history.slice(0, 200);
    scheduleSaveDb(500, false);
    return true;
  });

  ipcMain.handle('db:saveLocalLibrary', (_e, directories: string[], localTracks: PersistedTrack[]) => {
    const db = getDb();
    db.directories = directories;
    db.localTracks = localTracks;
    saveDbImmediate();
    return true;
  });

  ipcMain.handle('db:toggleLike', (_e, track: PersistedTrack) => {
    return toggleLikeSong(track);
  });

  ipcMain.handle('db:upsertLikedBatch', (_e, tracks: PersistedTrack[], replaceAll = false) => {
    return upsertLikedSongsBatch(tracks, replaceAll);
  });

  ipcMain.handle('db:savePlaylist', (_e, playlist: PersistedPlaylist) => {
    const db = getDb();
    const idx = db.playlists.findIndex((p) => p.id === playlist.id);
    const existing = idx >= 0 ? db.playlists[idx] : null;
    const tracks =
      playlist.tracks && playlist.tracks.length > 0
        ? playlist.tracks
        : existing?.tracks && existing.tracks.length > 0
          ? existing.tracks
          : [];
    const trackCount =
      tracks.length > 0 ? tracks.length : playlist.trackCount || existing?.trackCount || 0;
    const updated = { ...playlist, tracks, trackCount, updatedAt: Date.now() };
    if (idx >= 0) db.playlists[idx] = updated;
    else db.playlists.unshift(updated);
    saveDbImmediate();
    return db.playlists;
  });

  ipcMain.handle('db:deletePlaylist', (_e, playlistId: string) => {
    const db = getDb();
    db.playlists = db.playlists.filter((p) => p.id !== playlistId);
    saveDbImmediate();
    return db.playlists;
  });

  ipcMain.handle('db:toggleBlockArtist', (_e, artistName: string) => {
    const db = getDb();
    const norm = artistName.trim().toLowerCase();
    if (!norm) return db.blockedArtists;
    if (db.blockedArtists.includes(norm)) {
      db.blockedArtists = db.blockedArtists.filter((a) => a !== norm);
    } else {
      db.blockedArtists.push(norm);
    }
    saveDbImmediate();
    return db.blockedArtists;
  });

  ipcMain.handle('db:recordStats', (_e, track: PersistedTrack, seconds?: number) => {
    return recordTrackPlayStats(track, seconds);
  });

  ipcMain.handle('db:getStats', () => {
    return getDb().stats;
  });

  ipcMain.handle('db:resetStats', () => {
    const db = getDb();
    db.stats = {
      totalPlays: 0,
      totalSeconds: 0,
      tracks: {},
      dailyMinutes: {},
      hourlyCounts: new Array(24).fill(0),
    };
    saveDbImmediate();
    return db.stats;
  });

  ipcMain.handle('db:exportBackup', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export ArchiveTune Backup',
      defaultPath: `archivetune-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'ArchiveTune Backup JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(getDb(), null, 2), 'utf-8');
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('db:importBackup', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import ArchiveTune Backup',
      properties: ['openFile'],
      filters: [{ name: 'ArchiveTune Backup JSON', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    try {
      const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.settings) {
        return { ok: false, error: 'Invalid backup file schema' };
      }
      const cur = getDb();
      dbCache = {
        ...cur,
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      };
      saveDbImmediate();
      return { ok: true, state: dbCache };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Import failed' };
    }
  });
}
