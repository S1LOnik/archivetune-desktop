/**
 * player.ts — Dual-Deck mpv IPC Audio Engine with Real AutoMix, DSP Chain,
 *             SponsorBlock, Audio Device Picker, Sleep Timer & FFmpeg Audio Tagger
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import { spawn, execFile, ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import {
  AutoMixAnalysis,
  AutoMixPlan,
  AutoMixPlanner,
  SmartDjAutomixManager,
  analyzeAudioForAutomix,
  auditTrackAcousticQuality,
} from './automix';
import { getDb, updateSettings } from './db';
import { resolveUniversalStream } from './providers';
import { setupOfflineIPC } from './offline';
import { getPlaybackCache, setupPlaybackCacheIPC } from './playbackCache';
import { setupNativeSpotifyIPC } from './spotifyNative';
import { getSpotifyAudioCredentials } from './spotify';

export interface PlayerStatus {
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  speed: number;
  pitchSemitones: number;
  currentUrl: string | null;
  currentTrackId: string | null;
  activeDeck: 'A' | 'B';
  standbyPrepared?: boolean;
  standbyTrackId?: string | null;
  automixing: boolean;
  automixPlan?: AutoMixPlan | null;
  sleepRemainingSec: number | null;
  sleepAfterTrack: boolean;
}

interface TrackPlayMeta {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  bpm?: number;
  duration?: number;
  source?: string;
  thumbnail?: string;
  headers?: Record<string, string>;
}

interface NextQueueTrackData {
  url: string;
  meta: TrackPlayMeta;
  headers?: Record<string, string>;
}

interface DeckInstance {
  id: 'A' | 'B';
  proc: ChildProcess | null;
  ipcPath: string;
  volume: number;
  bassCut: boolean;
  lowpassHz?: number;
  currentUrl: string | null;
  currentTrackId: string | null;
  position: number;
  duration: number;
  paused: boolean;
  persistentSocket: net.Socket | null;
  pendingRequests: Map<number, { resolve: (val: any) => void; timer: NodeJS.Timeout }>;
  nextReqId: number;
  socketBuffer: string;
  pendingLoad?: (error?: string) => void;
  prepared?: boolean;
}

const EQ_BAND_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost': [7, 5.5, 4, 2, 0, 0, 0, 0, 0.5, 1],
  Vocal: [-2, -1.5, 0, 2.5, 4.5, 4.5, 3, 1.5, 0, -1],
  Electronic: [5, 4, 1.5, 0, -2, 1, 2.5, 4, 5, 4.5],
  Rock: [4.5, 3, 1.5, -1, -1.5, 1, 3, 4, 4.5, 4],
  Acoustic: [3.5, 2.5, 1.5, 0.5, 2, 2, 3, 3.5, 2.5, 1.5],
  Harman: [4, 3, 1.5, 0, -0.5, 0.5, 2.5, 3, 2, 1],
};

function createSocketPath(deckId: 'A' | 'B'): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\archivetune-mpv-${process.pid}-${deckId}`
    : path.join(os.tmpdir(), `archivetune-mpv-${process.pid}-${deckId}.sock`);
}

function createEmptyDeck(id: 'A' | 'B'): DeckInstance {
  return {
    id,
    proc: null,
    ipcPath: createSocketPath(id),
    volume: 85,
    bassCut: false,
    currentUrl: null,
    currentTrackId: null,
    position: 0,
    duration: 0,
    paused: true,
    persistentSocket: null,
    pendingRequests: new Map(),
    nextReqId: 1,
    socketBuffer: '',
  };
}

class DualDeckMpvPlayer {
  private decks: Record<'A' | 'B', DeckInstance> = {
    A: createEmptyDeck('A'),
    B: createEmptyDeck('B'),
  };
  private activeDeckId: 'A' | 'B' = 'A';
  private masterVolume = 85;
  private currentSpeed = 1.0;
  private pitchSemitones = 0;
  private normalizationEnabled = false;
  private bassBoostDb = 0;
  private stereoWidener = 0;
  private silenceSkipEnabled = false;
  private crossfadeDurationSec = 6;
  private smartDjEnabled = true;
  private gaplessAlbum = true;
  private automixMode: 'auto' | 'dj_blend' | 'filter_ride' | 'equal_power' | 'gapless' = 'auto';
  private audioDevice = 'auto';
  private eqConfig = { enabled: false, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preset: 'Flat' };

  private activeMeta: TrackPlayMeta | null = null;
  private playbackRevision = 0;
  private recoveryRevision: number | null = null;
  private prebufferRevision = 0;
  private failedSources = new Set<string>();

  private notifyRecovery(state: { loading: boolean; error?: string; source?: string; badge?: string; lossless?: boolean }): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('player:recovery', { ...state, trackId: this.activeMeta?.id });
    }
  }

  private async recoverStream(revision: number, position: number): Promise<{ ok: boolean; error?: string }> {
    const meta = this.activeMeta;
    if (!meta || !meta.title || !meta.artist || meta.source === 'local' || this.recoveryRevision === revision) {
      if (revision === this.playbackRevision && this.recoveryRevision !== revision) {
        this.notifyRecovery({ loading: false, error: 'Аудиопоток недоступен' });
      }
      return { ok: false, error: 'Audio stream unavailable' };
    }
    this.recoveryRevision = revision;
    this.notifyRecovery({ loading: true });
    try {
      this.failedSources.add(meta.source || 'youtube');
      const replacement = await resolveUniversalStream({
        id: meta.id, title: meta.title, artist: meta.artist, album: meta.album,
        duration: meta.duration, source: meta.source || 'youtube',
      }, undefined, [...this.failedSources]);
      if (revision !== this.playbackRevision) return { ok: false, error: 'Playback cancelled' };
      if (!replacement.streamUrl) throw new Error('Доступные источники не смогли восстановить трек');
      const result = await this.playAttempt(replacement.streamUrl, {
        ...meta, source: replacement.actualSource, headers: replacement.headers,
      });
      if (revision !== this.playbackRevision) return { ok: false, error: 'Playback cancelled' };
      if (!result.ok) throw new Error(result.error);
      if (position > 1) await this.seek(position);
      this.notifyRecovery({ loading: false, source: replacement.actualSource,
        badge: `${replacement.actualSource.toUpperCase()} • ${replacement.qualityLabel}`, lossless: replacement.lossless });
      return { ok: true };
    } catch (error: any) {
      if (revision === this.playbackRevision) {
        this.getActiveDeck().paused = true;
        this.notifyRecovery({ loading: false, error: error.message });
      }
      return { ok: false, error: error.message };
    } finally {
      if (this.recoveryRevision === revision) this.recoveryRevision = null;
    }
  }
  private nextPrepared: NextQueueTrackData | null = null;
  private isAutomixing = false;
  private automixInterval: NodeJS.Timeout | null = null;
  private currentPlan: AutoMixPlan | null = null;

  private mainWindow: BrowserWindow | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private currentAnalysis: AutoMixAnalysis | null = null;
  private nextAnalysis: AutoMixAnalysis | null = null;

  // SponsorBlock
  private sponsorSegments: Array<{ start: number; end: number; category: string }> = [];
  private lastSkippedSponsorEnd = -1;

  // Sleep Timer
  private sleepTimerEndMs: number | null = null;
  private sleepAfterTrack = false;
  private sleepInterval: NodeJS.Timeout | null = null;

  // A-B Looper + AudioCompressor + Exponential Volume
  private abLoopA: number | null = null;
  private abLoopB: number | null = null;
  private compressorEnabled = false;
  private exponentialVolume = true;

  constructor() {
    const settings = getDb().settings;
    this.masterVolume = Math.round((settings.volume ?? 0.85) * 100);
    this.currentSpeed = settings.speed ?? 1.0;
    this.pitchSemitones = settings.pitchSemitones ?? 0;
    this.normalizationEnabled = settings.normalization ?? false;
    this.bassBoostDb = settings.bassBoost ?? 0;
    this.stereoWidener = settings.stereoWidener ?? 0;
    this.silenceSkipEnabled = settings.silenceSkip ?? false;
    this.compressorEnabled = settings.audioCompressor ?? false;
    this.exponentialVolume = settings.exponentialVolume ?? true;
    this.crossfadeDurationSec = settings.crossfade ?? 6;
    this.smartDjEnabled = settings.smartDjAutomix ?? true;
    this.gaplessAlbum = settings.gaplessAlbum ?? true;
    this.automixMode = settings.automixMode ?? 'auto';
    this.audioDevice = settings.audioDevice ?? 'auto';
    this.eqConfig = {
      enabled: settings.eqEnabled ?? false,
      bands: Array.isArray(settings.eqBands) && settings.eqBands.length === 10 ? [...settings.eqBands] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preset: settings.eqPreset ?? 'Flat',
    };
  }

  public setWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  private emitToast(message: string, kind: 'info' | 'upgrade' | 'fallback' | 'sponsorblock' | 'automix' = 'info'): void {
    if (!getDb().settings.showSmartSwitchToasts) return;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('player:smartToast', { message, kind, timestamp: Date.now() });
    }
  }

  private getActiveDeck(): DeckInstance {
    return this.decks[this.activeDeckId];
  }

  private getStandbyDeck(): DeckInstance {
    return this.decks[this.activeDeckId === 'A' ? 'B' : 'A'];
  }

  private connectPersistentSocket(deck: DeckInstance): Promise<boolean> {
    if (deck.persistentSocket && !deck.persistentSocket.destroyed) return Promise.resolve(true);
    deck.socketBuffer = '';
    for (const req of deck.pendingRequests.values()) {
      clearTimeout(req.timer);
      req.resolve(null);
    }
    deck.pendingRequests.clear();

    return new Promise((resolve) => {
      let isSettled = false;
      const sock = net.createConnection(deck.ipcPath);
      deck.persistentSocket = sock;

      sock.on('connect', () => {
        if (!isSettled) {
          isSettled = true;
          resolve(true);
        }
      });

      sock.on('data', (chunk) => {
        deck.socketBuffer += chunk.toString();
        const lines = deck.socketBuffer.split('\n');
        deck.socketBuffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.event === 'file-loaded') deck.pendingLoad?.();
            if (parsed.event === 'end-file' && parsed.reason === 'error') {
              if (deck.pendingLoad) deck.pendingLoad(parsed.file_error || 'mpv could not open the audio stream');
              else if (deck === this.getActiveDeck() && !deck.paused && this.recoveryRevision !== this.playbackRevision) {
                deck.paused = true;
                void this.recoverStream(this.playbackRevision, deck.position);
              }
            }
            if (typeof parsed.request_id === 'number') {
              const req = deck.pendingRequests.get(parsed.request_id);
              if (req) {
                clearTimeout(req.timer);
                deck.pendingRequests.delete(parsed.request_id);
                req.resolve(parsed.data !== undefined ? parsed.data : parsed.error === 'success' ? true : null);
              }
            }
          } catch { /* wait for more chunks */ }
        }
      });

      sock.on('error', () => {
        deck.persistentSocket = null;
        for (const req of deck.pendingRequests.values()) {
          clearTimeout(req.timer);
          req.resolve(null);
        }
        deck.pendingRequests.clear();
        if (!isSettled) {
          isSettled = true;
          resolve(false);
        }
      });

      sock.on('close', () => {
        deck.persistentSocket = null;
        for (const req of deck.pendingRequests.values()) {
          clearTimeout(req.timer);
          req.resolve(null);
        }
        deck.pendingRequests.clear();
        if (!isSettled) {
          isSettled = true;
          resolve(false);
        }
      });
    });
  }

  private sendDeckCommand(deck: DeckInstance, cmd: unknown[]): Promise<any> {
    return new Promise((resolve) => {
      if (!deck.proc || deck.proc.killed) return resolve(null);

      if (!deck.persistentSocket || deck.persistentSocket.destroyed) {
        this.connectPersistentSocket(deck);
      }

      const sock = deck.persistentSocket;
      if (!sock || sock.destroyed) return resolve(null);

      const reqId = deck.nextReqId++;
      if (deck.nextReqId > 1000000) deck.nextReqId = 1;

      const timer = setTimeout(() => {
        deck.pendingRequests.delete(reqId);
        resolve(null);
      }, 3000);

      deck.pendingRequests.set(reqId, { resolve, timer });

      try {
        sock.write(JSON.stringify({ command: cmd, request_id: reqId }) + '\n');
      } catch {
        clearTimeout(timer);
        deck.pendingRequests.delete(reqId);
        resolve(null);
      }
    });
  }

  private async loadDeckStream(
    deck: DeckInstance, url: string, headers?: Record<string, string>
  ): Promise<void> {
    if (headers && Object.keys(headers).length > 0) {
      await this.sendDeckCommand(deck, ['set_property', 'http-header-fields',
        Object.entries(headers).map(([name, value]) => `${name}: ${value}`)]);
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish('Audio stream loading timed out'), 20000);
      const finish = (error?: string) => {
        clearTimeout(timer);
        if (deck.pendingLoad === finish) deck.pendingLoad = undefined;
        if (error) reject(new Error(error));
        else resolve();
      };
      deck.pendingLoad?.('Playback superseded by another track');
      deck.pendingLoad = finish;
      void this.sendDeckCommand(deck, ['loadfile', url, 'replace']).then((result) => {
        if (result === null) finish('mpv rejected the load command');
      });
    });
  }

  private buildAudioFilterString(bassCut = false, lowpassHz?: number): string {
    const filters: string[] = [];

    // 1. Pitch Shift without changing speed (or standard speed/pitch)
    if (this.pitchSemitones !== 0) {
      const pitchRatio = Math.pow(2, this.pitchSemitones / 12);
      filters.push(`lavfi=[asetrate=44100*${pitchRatio.toFixed(4)},aresample=44100,atempo=${(1 / pitchRatio).toFixed(4)}]`);
    }

    // 2. Skip Silence
    if (this.silenceSkipEnabled) {
      filters.push('lavfi=[silenceremove=start_periods=1:start_silence=0.1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.45:stop_threshold=-45dB]');
    }

    // 3. Automix Bass Swap HPF + Filter Ride LPF
    if (bassCut) filters.push('lavfi=[highpass=f=220:p=2]');
    if (lowpassHz && lowpassHz < 19000) filters.push(`lavfi=[lowpass=f=${Math.max(400, lowpassHz)}]`);

    // 4. Bass Boost
    if (this.bassBoostDb > 0.2) {
      filters.push(`lavfi=[bass=g=${this.bassBoostDb.toFixed(1)}:f=95:w=0.6]`);
    }

    // 5. Stereo Widener
    if (this.stereoWidener > 0.05) {
      const m = (1 + this.stereoWidener * 1.4).toFixed(2);
      filters.push(`lavfi=[extrastereo=m=${m}]`);
    }

    // 6. 10-band Parametric Equalizer
    if (this.eqConfig.enabled) {
      const eqParts = EQ_BAND_FREQS.map((freq, idx) => {
        const gain = Math.max(-12, Math.min(12, this.eqConfig.bands[idx] ?? 0));
        return `equalizer=f=${freq}:t=q:w=1.41:g=${gain.toFixed(1)}`;
      }).join(',');
      filters.push(`lavfi=[${eqParts}]`);
    }

    // 7. Loudness Normalization & Audio Compressor (pear-desktop port)
    if (this.normalizationEnabled) {
      filters.push('lavfi=[dynaudnorm=f=150:g=15:p=0.95]');
    }
    if (this.compressorEnabled) {
      filters.push('lavfi=[acompressor=threshold=-18dB:ratio=3:attack=20:release=250:makeup=2]');
    }

    return filters.join(',');
  }

  private async applyFiltersToDeck(deck: DeckInstance): Promise<void> {
    const afStr = this.buildAudioFilterString(deck.bassCut, deck.lowpassHz);
    await this.sendDeckCommand(deck, ['set_property', 'af', afStr]);
  }

  private async ensureDeckSpawned(deck: DeckInstance): Promise<void> {
    if (deck.proc && !deck.proc.killed) return;
    if (process.platform !== 'win32' && fs.existsSync(deck.ipcPath)) {
      try { fs.unlinkSync(deck.ipcPath); } catch { /* ignore */ }
    }

    const args = [
      '--no-video',
      '--idle=yes',
      `--input-ipc-server=${deck.ipcPath}`,
      `--volume=${this.masterVolume}`,
      `--speed=${this.currentSpeed}`,
      '--audio-display=no',
      '--cache=yes',
      '--demuxer-max-bytes=50MiB',
      '--network-timeout=15',
      '--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_delay_max=5',
      '--force-seekable=yes',
      '--ytdl-format=bestaudio/best',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--really-quiet',
    ];
    if (this.audioDevice && this.audioDevice !== 'auto') {
      args.push(`--audio-device=${this.audioDevice}`);
    }

    const af = this.buildAudioFilterString(deck.bassCut);
    if (af) args.push(`--af=${af}`);

    deck.proc = spawn('mpv', args, { stdio: 'ignore' });
    deck.proc.on('exit', () => {
      deck.proc = null;
      if (deck.persistentSocket) {
        deck.persistentSocket.destroy();
        deck.persistentSocket = null;
      }
    });

    // Fast socket connection loop (retry every 10ms instead of 50ms polling + 80ms sleep)
    const startTime = Date.now();
    while (Date.now() - startTime < 2000) {
      if (process.platform === 'win32' || fs.existsSync(deck.ipcPath)) {
        const ok = await this.connectPersistentSocket(deck);
        if (ok) break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  private async loadSponsorBlockSegments(videoId: string): Promise<void> {
    this.sponsorSegments = [];
    this.lastSkippedSponsorEnd = -1;
    const settings = getDb().settings;
    if (!settings.sponsorBlockEnabled || !videoId || videoId.includes(':') || videoId.startsWith('local-')) return;

    const cats = JSON.stringify(settings.sponsorBlockCategories || ['sponsor', 'intro', 'outro', 'music_offtopic']);
    const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(cats)}`;
    https.get(url, { headers: { 'User-Agent': 'ArchiveTune-Desktop/2.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return; }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const arr = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (Array.isArray(arr)) {
            this.sponsorSegments = arr
              .filter((x: any) => Array.isArray(x.segment) && x.segment.length === 2)
              .map((x: any) => ({ start: x.segment[0], end: x.segment[1], category: x.category || 'segment' }));
          }
        } catch { /* ignore */ }
      });
    }).on('error', () => {});
  }

  public async play(url: string, meta: TrackPlayMeta): Promise<{ ok: boolean; error?: string }> {
    const revision = ++this.playbackRevision;
    ++this.prebufferRevision;
    getPlaybackCache().cancel();
    this.failedSources.clear();
    const result = await this.playAttempt(url, meta);
    if (result.ok || revision !== this.playbackRevision) return result;
    return this.recoverStream(revision, 0);
  }

  private async playAttempt(url: string, meta: TrackPlayMeta): Promise<{ ok: boolean; error?: string }> {
    const revision = this.playbackRevision;
    try {
      this.cancelAutomix();
      this.currentAnalysis = null;
      this.nextAnalysis = null;
      this.currentPlan = null;

      let active = this.getActiveDeck();
      const standby = this.getStandbyDeck();
      const prepared = standby.prepared && standby.currentTrackId === meta.id && standby.currentUrl === url;
      if (prepared) {
        await this.sendDeckCommand(active, ['stop']);
        if (revision !== this.playbackRevision) throw new Error('Playback cancelled');
        active.paused = true;
        this.activeDeckId = standby.id;
        active = standby;
        active.prepared = false;
      } else if (standby.proc) {
        standby.prepared = false;
        await this.sendDeckCommand(standby, ['stop']);
        if (revision !== this.playbackRevision) throw new Error('Playback cancelled');
      }
      this.nextPrepared = null;

      await this.ensureDeckSpawned(active);
      if (revision !== this.playbackRevision) throw new Error('Playback cancelled');
      active.currentUrl = url;
      active.currentTrackId = meta.id;
      active.position = 0;
      active.duration = meta.duration || 0;
      active.paused = false;
      active.bassCut = false;
      active.lowpassHz = undefined;
      active.volume = this.masterVolume;
      this.activeMeta = meta;

      // Pipeline deck properties without sequential awaiting
      void this.sendDeckCommand(active, ['set_property', 'volume', this.masterVolume]);
      void this.sendDeckCommand(active, ['set_property', 'speed', this.currentSpeed]);
      void this.applyFiltersToDeck(active);
      if (!prepared) await this.loadDeckStream(active, url, meta.headers);
      if (revision !== this.playbackRevision) throw new Error('Playback cancelled');
      // Explicitly unpause immediately after loadfile so network streams start playing without hanging
      await this.sendDeckCommand(active, ['set_property', 'pause', false]);
      if (revision !== this.playbackRevision) throw new Error('Playback cancelled');

      // Background BPM/Spectrum analysis for Automix + SponsorBlock lookup
      if (this.smartDjEnabled) {
        analyzeAudioForAutomix(meta.id, url, meta.duration || 180)
          .then((res) => {
            if (this.activeMeta?.id === meta.id && res) {
              this.currentAnalysis = res;
              this.recomputePlan();
            }
          })
          .catch(() => {});
      }
      this.loadSponsorBlockSegments(meta.id).catch(() => {});
      this.startProgressPolling();
      if (meta.title && meta.artist) getPlaybackCache().schedule({ ...meta, title: meta.title, artist: meta.artist, duration: meta.duration || 0, source: (meta.source || 'youtube') as any }, url, meta.headers);
      return { ok: true };
    } catch (err: any) {
      if (revision === this.playbackRevision) this.getActiveDeck().paused = true;
      return { ok: false, error: err?.message || 'mpv play error' };
    }
  }

  public async prebufferNext(nextData: NextQueueTrackData | null): Promise<{ ok: boolean }> {
    const revision = ++this.prebufferRevision;
    this.nextPrepared = nextData;
    this.nextAnalysis = null;
    if (!nextData || !getDb().settings.prebufferNextTrack) return { ok: true };

    const standby = this.getStandbyDeck();
    await this.ensureDeckSpawned(standby);
    if (revision !== this.prebufferRevision) return { ok: false };
    standby.prepared = false;
    standby.currentUrl = nextData.url;
    standby.currentTrackId = nextData.meta.id;
    standby.paused = true;
    standby.bassCut = false;
    standby.lowpassHz = undefined;

    await this.sendDeckCommand(standby, ['set_property', 'pause', true]);
    if (revision !== this.prebufferRevision) return { ok: false };
    await this.sendDeckCommand(standby, ['set_property', 'volume', 0]);
    if (revision !== this.prebufferRevision) return { ok: false };
    try {
      await this.loadDeckStream(standby, nextData.url, nextData.headers);
      if (revision !== this.prebufferRevision) return { ok: false };
      if (this.nextPrepared === nextData && standby.currentUrl === nextData.url) standby.prepared = true;
    } catch {
      return { ok: false };
    }

    if (this.smartDjEnabled) {
      analyzeAudioForAutomix(nextData.meta.id, nextData.url, nextData.meta.duration || 180)
        .then((res) => {
          if (this.nextPrepared?.meta.id === nextData.meta.id && res) {
            this.nextAnalysis = res;
            this.recomputePlan();
          }
        })
        .catch(() => {});
    }
    return { ok: true };
  }

  private recomputePlan(): void {
    if (!this.activeMeta || !this.nextPrepared) return;
    const durMs = (this.getActiveDeck().duration || this.activeMeta.duration || 180) * 1000;
    const sameAlbum =
      Boolean(this.gaplessAlbum) &&
      Boolean(this.activeMeta.album) &&
      this.activeMeta.album === this.nextPrepared.meta.album &&
      this.activeMeta.artist === this.nextPrepared.meta.artist;

    this.currentPlan = AutoMixPlanner.plan({
      current: this.currentAnalysis,
      next: this.nextAnalysis,
      outDurationMs: durMs,
      fallbackFadeMs: this.crossfadeDurationSec * 1000,
      gaplessAlbum: sameAlbum,
      preferredStyle: this.smartDjEnabled ? this.automixMode : 'equal_power',
    });

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('player:automixPlan', this.currentPlan);
    }
  }

  private startProgressPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      const deck = this.getActiveDeck();
      if (!deck.proc || deck.paused) return;

      const [pos, dur, idle, eof] = await Promise.all([
        this.sendDeckCommand(deck, ['get_property', 'time-pos']),
        this.sendDeckCommand(deck, ['get_property', 'duration']),
        this.sendDeckCommand(deck, ['get_property', 'core-idle']),
        this.sendDeckCommand(deck, ['get_property', 'eof-reached']),
      ]);

      if (typeof pos === 'number') {
        deck.position = pos;
      } else if (!deck.paused) {
        // Unstick any paused-for-cache or initial stalled state
        await this.sendDeckCommand(deck, ['set_property', 'pause', false]);
      }
      if (typeof dur === 'number' && dur > 0) deck.duration = dur;

      // SponsorBlock auto-skip check
      if (this.sponsorSegments.length > 0 && typeof pos === 'number') {
        const hit = this.sponsorSegments.find((s) => pos >= s.start && pos < s.end - 0.15);
        if (hit && Math.abs(hit.end - this.lastSkippedSponsorEnd) > 0.5) {
          this.lastSkippedSponsorEnd = hit.end;
          await this.sendDeckCommand(deck, ['set_property', 'time-pos', hit.end]);
          deck.position = hit.end;
          this.emitToast(`SponsorBlock: пропущено (${hit.category})`, 'sponsorblock');
        }
      }

      // A-B Looper check
      if (
        this.abLoopA !== null &&
        this.abLoopB !== null &&
        this.abLoopB > this.abLoopA + 0.5 &&
        typeof pos === 'number' &&
        pos >= this.abLoopB
      ) {
        await this.sendDeckCommand(deck, ['set_property', 'time-pos', this.abLoopA]);
        deck.position = this.abLoopA;
      }

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('player:progress', {
          position: deck.position,
          duration: deck.duration,
          isPlaying: !deck.paused,
          automixing: this.isAutomixing,
          automixPlan: this.currentPlan,
        });
      }

      // Check Automix / Crossfade trigger
      const effectiveFadeSec = this.currentPlan ? this.currentPlan.fadeMs / 1000 : this.crossfadeDurationSec;
      const audibleEndSec =
        this.currentPlan && deck.duration > 5
          ? Math.max(deck.duration * 0.55, this.currentPlan.transitionEndMs / 1000)
          : SmartDjAutomixManager.getAudibleEndMs(deck.currentTrackId || '', deck.duration * 1000) / 1000;

      const triggerPointSec = Math.max(1, audibleEndSec - effectiveFadeSec);

      if (
        !this.isAutomixing &&
        this.nextPrepared &&
        (effectiveFadeSec > 0.2 || this.currentPlan?.style === 'GAPLESS') &&
        deck.duration > 8 &&
        deck.position >= triggerPointSec
      ) {
        await this.beginDualDeckAutomix();
        return;
      }

      if ((eof === true || (idle === true && deck.duration > 1 && deck.position >= deck.duration - 1.5)) && !this.isAutomixing) {
        deck.paused = true;
        if (this.sleepAfterTrack) {
          this.sleepAfterTrack = false;
          this.emitSleepUpdate();
          return;
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('player:ended');
        }
      }
    }, 250);
  }

  private async beginDualDeckAutomix(): Promise<void> {
    if (!this.nextPrepared || !this.activeMeta || this.isAutomixing) return;
    if (this.sleepAfterTrack) return;

    this.isAutomixing = true;
    const outDeck = this.getActiveDeck();
    const inDeck = this.getStandbyDeck();
    const outMeta = this.activeMeta;
    const inData = this.nextPrepared;

    const plan =
      this.currentPlan ||
      AutoMixPlanner.plan({
        current: this.currentAnalysis,
        next: this.nextAnalysis,
        outDurationMs: (outDeck.duration || 180) * 1000,
        fallbackFadeMs: this.crossfadeDurationSec * 1000,
        preferredStyle: this.smartDjEnabled ? this.automixMode : 'equal_power',
      });

    this.emitToast(`Automix: ${plan.reason}`, 'automix');

    await this.ensureDeckSpawned(inDeck);
    if (inDeck.currentUrl !== inData.url) {
      await this.sendDeckCommand(inDeck, ['loadfile', inData.url, 'replace']);
      await new Promise((r) => setTimeout(r, 140));
    }

    inDeck.bassCut = plan.bassSwap && plan.style !== 'GAPLESS';
    inDeck.paused = false;
    await this.applyFiltersToDeck(inDeck);

    const cueSec = plan.incomingCueMs / 1000;
    if (cueSec > 0.1) await this.sendDeckCommand(inDeck, ['set_property', 'time-pos', cueSec]);
    if (plan.style === 'DJ_BLEND') {
      await this.sendDeckCommand(inDeck, ['set_property', 'speed', plan.incomingPlaybackRate]);
    }
    await this.sendDeckCommand(inDeck, ['set_property', 'volume', plan.style === 'GAPLESS' ? this.masterVolume : 0]);
    await this.sendDeckCommand(inDeck, ['set_property', 'pause', false]);

    const fadeMs = Math.max(150, plan.fadeMs);
    const startMs = Date.now();
    const outRhythm = SmartDjAutomixManager.resolveRhythmSync(outMeta.id, outMeta.title, outMeta.artist, outMeta.bpm);
    const inRhythm = SmartDjAutomixManager.resolveRhythmSync(inData.meta.id, inData.meta.title, inData.meta.artist, inData.meta.bpm);

    this.automixInterval = setInterval(async () => {
      const elapsed = Date.now() - startMs;
      const progress = Math.min(1, elapsed / fadeMs);
      const gains = SmartDjAutomixManager.calculateAutomixGains(progress, plan.bassSwapFraction, plan.style);

      await this.sendDeckCommand(outDeck, ['set_property', 'volume', Math.round(gains.outgoingGain * this.masterVolume)]);
      await this.sendDeckCommand(inDeck, ['set_property', 'volume', Math.round(gains.incomingGain * this.masterVolume)]);

      if (plan.style === 'DJ_BLEND' && this.smartDjEnabled) {
        const warp = SmartDjAutomixManager.calculateTempoWarpParameters(progress, outRhythm.bpm, inRhythm.bpm);
        await this.sendDeckCommand(outDeck, ['set_property', 'speed', warp.outgoingSpeed * this.currentSpeed]);
        await this.sendDeckCommand(inDeck, ['set_property', 'speed', warp.incomingSpeed * this.currentSpeed]);
      }

      if (gains.outgoingBassCut !== outDeck.bassCut || gains.outgoingLowpassHz !== outDeck.lowpassHz) {
        outDeck.bassCut = gains.outgoingBassCut;
        outDeck.lowpassHz = gains.outgoingLowpassHz;
        await this.applyFiltersToDeck(outDeck);
      }
      if (gains.incomingBassCut !== inDeck.bassCut) {
        inDeck.bassCut = gains.incomingBassCut;
        await this.applyFiltersToDeck(inDeck);
      }

      if (progress >= 1) {
        this.cancelAutomix();
        await this.sendDeckCommand(outDeck, ['stop']);
        outDeck.paused = true;
        outDeck.bassCut = false;
        outDeck.lowpassHz = undefined;

        inDeck.bassCut = false;
        await this.sendDeckCommand(inDeck, ['set_property', 'volume', this.masterVolume]);
        await this.sendDeckCommand(inDeck, ['set_property', 'speed', this.currentSpeed]);
        await this.applyFiltersToDeck(inDeck);

        this.activeDeckId = inDeck.id;
        this.activeMeta = inData.meta;
        this.currentAnalysis = this.nextAnalysis;
        this.nextPrepared = null;
        this.nextAnalysis = null;
        this.currentPlan = null;
        this.loadSponsorBlockSegments(inData.meta.id).catch(() => {});

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('player:automixTransition', { nextTrackId: inData.meta.id });
        }
      }
    }, 65);
  }

  private cancelAutomix(): void {
    if (this.automixInterval) {
      clearInterval(this.automixInterval);
      this.automixInterval = null;
    }
    this.isAutomixing = false;
  }

  public async pause(): Promise<void> {
    ++this.playbackRevision;
    ++this.prebufferRevision;
    this.cancelAutomix();
    const d = this.getActiveDeck();
    d.paused = true;
    await this.sendDeckCommand(d, ['set_property', 'pause', true]);
  }

  public async resume(): Promise<void> {
    const d = this.getActiveDeck();
    d.paused = false;
    await this.sendDeckCommand(d, ['set_property', 'pause', false]);
  }

  public async stop(): Promise<void> {
    getPlaybackCache().cancel();
    ++this.playbackRevision;
    ++this.prebufferRevision;
    this.cancelAutomix();
    this.nextPrepared = null;
    for (const id of ['A', 'B'] as const) {
      const d = this.decks[id];
      d.paused = true;
      d.position = 0;
      d.prepared = false;
      d.currentUrl = null;
      d.currentTrackId = null;
      await this.sendDeckCommand(d, ['stop']);
    }
  }

  public async seek(sec: number): Promise<void> {
    const d = this.getActiveDeck();
    d.position = Math.max(0, sec);
    await this.sendDeckCommand(d, ['set_property', 'time-pos', d.position]);
  }

  public async setVolume(vol0to1: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, vol0to1));
    const effective = this.exponentialVolume ? Math.pow(clamped, 1.65) : clamped;
    this.masterVolume = Math.round(effective * 100);
    if (!this.isAutomixing) await this.sendDeckCommand(this.getActiveDeck(), ['set_property', 'volume', this.masterVolume]);
  }

  public setAbLoop(a: number | null, b: number | null): { a: number | null; b: number | null } {
    this.abLoopA = a;
    this.abLoopB = b;
    return { a: this.abLoopA, b: this.abLoopB };
  }

  public async setSpeed(speed: number): Promise<void> {
    this.currentSpeed = Math.max(0.5, Math.min(2.0, speed));
    await this.sendDeckCommand(this.getActiveDeck(), ['set_property', 'speed', this.currentSpeed]);
  }

  public async setDspOptions(opts: {
    pitchSemitones?: number;
    bassBoost?: number;
    stereoWidener?: number;
    normalization?: boolean;
    silenceSkip?: boolean;
    audioCompressor?: boolean;
    exponentialVolume?: boolean;
  }): Promise<void> {
    if (opts.pitchSemitones !== undefined) this.pitchSemitones = opts.pitchSemitones;
    if (opts.bassBoost !== undefined) this.bassBoostDb = opts.bassBoost;
    if (opts.stereoWidener !== undefined) this.stereoWidener = opts.stereoWidener;
    if (opts.normalization !== undefined) this.normalizationEnabled = opts.normalization;
    if (opts.silenceSkip !== undefined) this.silenceSkipEnabled = opts.silenceSkip;
    if (opts.audioCompressor !== undefined) this.compressorEnabled = opts.audioCompressor;
    if (opts.exponentialVolume !== undefined) {
      this.exponentialVolume = opts.exponentialVolume;
      await this.setVolume(getDb().settings.volume ?? 0.85);
    }
    await this.applyFiltersToDeck(this.getActiveDeck());
  }

  public async setEqualizer(config: { enabled: boolean; bands: number[]; preset?: string }): Promise<void> {
    this.eqConfig = {
      enabled: config.enabled,
      bands: config.bands.slice(0, 10),
      preset: config.preset || 'Custom',
    };
    await this.applyFiltersToDeck(this.getActiveDeck());
    updateSettings({ eqEnabled: this.eqConfig.enabled, eqBands: this.eqConfig.bands, eqPreset: this.eqConfig.preset });
  }

  public setAutomixConfig(opts: { crossfade?: number; smartDjAutomix?: boolean; gaplessAlbum?: boolean; automixMode?: any }): void {
    if (opts.crossfade !== undefined) this.crossfadeDurationSec = Math.max(0, Math.min(20, opts.crossfade));
    if (opts.smartDjAutomix !== undefined) this.smartDjEnabled = opts.smartDjAutomix;
    if (opts.gaplessAlbum !== undefined) this.gaplessAlbum = opts.gaplessAlbum;
    if (opts.automixMode !== undefined) this.automixMode = opts.automixMode;
    this.recomputePlan();
  }

  public async setAudioDevice(device: string): Promise<void> {
    this.audioDevice = device || 'auto';
    updateSettings({ audioDevice: this.audioDevice });
    await this.sendDeckCommand(this.getActiveDeck(), ['set_property', 'audio-device', this.audioDevice]);
  }

  public listAudioDevices(): Promise<Array<{ id: string; description: string }>> {
    return new Promise((resolve) => {
      execFile('mpv', ['--audio-device=help'], { timeout: 5000 }, (_err, stdout) => {
        const lines = (stdout || '').split('\n');
        const devices: Array<{ id: string; description: string }> = [{ id: 'auto', description: 'System Default (Auto)' }];
        for (const line of lines) {
          const m = line.match(/^\s+'([^']+)'\s+\((.+)\)$/);
          if (m) devices.push({ id: m[1], description: m[2] });
        }
        resolve(devices);
      });
    });
  }

  // Sleep Timer
  private emitSleepUpdate(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const rem = this.sleepTimerEndMs ? Math.max(0, Math.round((this.sleepTimerEndMs - Date.now()) / 1000)) : null;
      this.mainWindow.webContents.send('player:sleepTimerUpdate', {
        remainingSec: rem,
        afterTrack: this.sleepAfterTrack,
      });
    }
  }

  public setSleepTimer(minutes: number | null, afterTrack = false): void {
    if (this.sleepInterval) {
      clearInterval(this.sleepInterval);
      this.sleepInterval = null;
    }
    this.sleepAfterTrack = afterTrack;
    this.sleepTimerEndMs = minutes && minutes > 0 ? Date.now() + minutes * 60 * 1000 : null;
    this.emitSleepUpdate();

    if (this.sleepTimerEndMs) {
      const origVol = this.masterVolume;
      this.sleepInterval = setInterval(async () => {
        if (!this.sleepTimerEndMs) return;
        const remMs = this.sleepTimerEndMs - Date.now();
        if (remMs <= 8000 && remMs > 0) {
          await this.sendDeckCommand(this.getActiveDeck(), ['set_property', 'volume', Math.round((remMs / 8000) * origVol)]);
        }
        if (remMs <= 0) {
          clearInterval(this.sleepInterval!);
          this.sleepInterval = null;
          this.sleepTimerEndMs = null;
          await this.pause();
          await this.sendDeckCommand(this.getActiveDeck(), ['set_property', 'volume', origVol]);
          this.emitToast('Таймер сна: воспроизведение остановлено', 'info');
        }
        this.emitSleepUpdate();
      }, 1000);
    }
  }

  public getStatus(): PlayerStatus {
    const d = this.getActiveDeck();
    const standby = this.getStandbyDeck();
    return {
      isPlaying: !d.paused,
      position: d.position,
      duration: d.duration,
      volume: this.masterVolume / 100,
      speed: this.currentSpeed,
      pitchSemitones: this.pitchSemitones,
      currentUrl: d.currentUrl,
      currentTrackId: d.currentTrackId,
      activeDeck: this.activeDeckId,
      standbyPrepared: standby.prepared,
      standbyTrackId: standby.prepared ? standby.currentTrackId : null,
      automixing: this.isAutomixing,
      automixPlan: this.currentPlan,
      sleepRemainingSec: this.sleepTimerEndMs ? Math.max(0, Math.round((this.sleepTimerEndMs - Date.now()) / 1000)) : null,
      sleepAfterTrack: this.sleepAfterTrack,
    };
  }

  public prewarm(): void {
    void this.ensureDeckSpawned(this.decks.A);
    void this.ensureDeckSpawned(this.decks.B);
  }

  public shutdown(): void {
    this.cancelAutomix();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.sleepInterval) clearInterval(this.sleepInterval);
    for (const id of ['A', 'B'] as const) {
      const d = this.decks[id];
      if (d.persistentSocket) {
        try { d.persistentSocket.destroy(); } catch { /* ignore */ }
        d.persistentSocket = null;
      }
      if (d.proc) {
        try { d.proc.kill('SIGTERM'); } catch { /* ignore */ }
      }
      if (process.platform !== 'win32' && fs.existsSync(d.ipcPath)) {
        try { fs.unlinkSync(d.ipcPath); } catch { /* ignore */ }
      }
    }
  }
}

export const playerInstance = new DualDeckMpvPlayer();

export function setupPlayerIPC(win?: BrowserWindow): void {
  setupOfflineIPC(track => resolveUniversalStream(track));
  setupPlaybackCacheIPC();
  setupNativeSpotifyIPC(getSpotifyAudioCredentials);
  if (win) playerInstance.setWindow(win);
  playerInstance.prewarm();
  ipcMain.handle('player:play', (_e, url: string, meta: TrackPlayMeta) => playerInstance.play(url, meta));
  ipcMain.handle('player:prebufferNext', (_e, nextData: NextQueueTrackData | null) => playerInstance.prebufferNext(nextData));
  ipcMain.handle('player:pause', () => playerInstance.pause());
  ipcMain.handle('player:resume', () => playerInstance.resume());
  ipcMain.handle('player:stop', () => playerInstance.stop());
  ipcMain.handle('player:seek', (_e, sec: number) => playerInstance.seek(sec));
  ipcMain.handle('player:setVolume', (_e, vol: number) => playerInstance.setVolume(vol));
  ipcMain.handle('player:setSpeed', (_e, speed: number) => playerInstance.setSpeed(speed));
  ipcMain.handle('player:setNormalization', (_e, enabled: boolean) => playerInstance.setDspOptions({ normalization: enabled }));
  ipcMain.handle('player:setDsp', (_e, opts: any) => playerInstance.setDspOptions(opts));
  ipcMain.handle('player:setCrossfade', (_e, sec: number) => playerInstance.setAutomixConfig({ crossfade: sec }));
  ipcMain.handle('player:setSmartDjAutomix', (_e, enabled: boolean) => playerInstance.setAutomixConfig({ smartDjAutomix: enabled }));
  ipcMain.handle('player:setAutomixConfig', (_e, opts: any) => playerInstance.setAutomixConfig(opts));
  ipcMain.handle('player:setEqualizer', (_e, cfg: any) => playerInstance.setEqualizer(cfg));
  ipcMain.handle('player:getAudioDevices', () => playerInstance.listAudioDevices());
  ipcMain.handle('player:setAudioDevice', (_e, dev: string) => playerInstance.setAudioDevice(dev));
  ipcMain.handle('player:setSleepTimer', (_e, minutes: number | null, afterTrack = false) => playerInstance.setSleepTimer(minutes, afterTrack));
  ipcMain.handle('player:setAbLoop', (_e, a: number | null, b: number | null) => playerInstance.setAbLoop(a, b));
  ipcMain.handle('player:getStatus', () => playerInstance.getStatus());
  ipcMain.handle('player:auditQuality', async (_e, urlOrPath?: string) => {
    const target = urlOrPath || playerInstance.getStatus().currentUrl;
    if (!target) return null;
    return auditTrackAcousticQuality(target);
  });

  // Download + FFmpeg Audio Tagger + .lrc writer
  ipcMain.handle('player:downloadTrack', async (_e, track: { id: string; title: string; artist: string; album?: string; thumbnail?: string; streamUrl?: string; lrc?: string }) => {
    const settings = getDb().settings;
    const dlDir = settings.downloadPath || path.join(app.getPath('music'), 'ArchiveTune Downloads');
    if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true });
    const safeName = `${track.artist} - ${track.title}`.replace(/[\\/:*?"<>|]/g, '_');
    const format = settings.downloadFormat || 'flac';
    const outPath = path.join(dlDir, `${safeName}.${format}`);

    if (track.lrc && settings.embedMetadataAndLyrics) {
      fs.writeFileSync(path.join(dlDir, `${safeName}.lrc`), track.lrc, 'utf-8');
    }

    const inputSource = track.streamUrl || `https://www.youtube.com/watch?v=${track.id}`;
    return new Promise((resolve) => {
      if (track.streamUrl) {
        const ffArgs = ['-y', '-i', track.streamUrl, '-vn', '-metadata', `title=${track.title}`, '-metadata', `artist=${track.artist}`];
        if (track.album) ffArgs.push('-metadata', `album=${track.album}`);
        if (format === 'mp3') ffArgs.push('-c:a', 'libmp3lame', '-b:a', '320k');
        else if (format === 'flac') ffArgs.push('-c:a', 'flac');
        else ffArgs.push('-c:a', 'libopus', '-b:a', '192k');
        ffArgs.push(outPath);
        execFile('ffmpeg', ffArgs, { timeout: 120000 }, (err) => {
          if (err) resolve({ ok: false, error: err.message });
          else resolve({ ok: true, filePath: outPath });
        });
      } else {
        execFile('yt-dlp', ['-x', '--audio-format', format, '--embed-thumbnail', '--add-metadata', '-o', path.join(dlDir, `${safeName}.%(ext)s`), inputSource], { timeout: 120000 }, (err) => {
          if (err) resolve({ ok: false, error: err.message });
          else resolve({ ok: true, filePath: outPath });
        });
      }
    });
  });
}
