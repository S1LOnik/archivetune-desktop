/**
 * desktop.ts — Native Desktop Integration:
 * 1) Linux MPRIS2 D-Bus (`mpris-service`) for KDE Plasma / GNOME / Lockscreen Media Widget
 * 2) ListenBrainz Scrobbler (`submit-listens`)
 * 3) Discord Rich Presence over Local IPC Socket
 * 4) Global Media Keys + Tray + Close-to-Tray + Always-on-Top Mini PiP Mode
 * 5) Optional Local HTTP Status/Control API (`127.0.0.1:26538`)
 */

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray } from 'electron';
import net from 'net';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb, updateSettings } from './db';

const DISCORD_CLIENT_ID = '1219655712830816306';

interface TrackPresenceInfo {
  id?: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail?: string;
  duration: number;
  position: number;
  isPlaying: boolean;
  source?: string;
  qualityLabel?: string;
}

class DiscordRpcClient {
  private socket: net.Socket | null = null;
  private handshakeDone = false;

  private encodePacket(op: number, payload: unknown): Buffer {
    const json = Buffer.from(JSON.stringify(payload), 'utf-8');
    const buf = Buffer.alloc(8 + json.length);
    buf.writeInt32LE(op, 0);
    buf.writeInt32LE(json.length, 4);
    json.copy(buf, 8);
    return buf;
  }

  private findIpcSocketPath(): string | null {
    if (process.platform === 'win32') return '\\\\.\\pipe\\discord-ipc-0';
    const xdg = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`;
    const candidates = [
      path.join(xdg, 'discord-ipc-0'),
      path.join(xdg, 'app/com.discordapp.Discord/discord-ipc-0'),
      '/tmp/discord-ipc-0',
    ];
    for (const p of candidates) if (fs.existsSync(p)) return p;
    return null;
  }

  public connect(): void {
    if (this.socket && !this.socket.destroyed) return;
    const sockPath = this.findIpcSocketPath();
    if (!sockPath) return;
    try {
      this.socket = net.createConnection(sockPath, () => {
        this.socket?.write(this.encodePacket(0, { v: 1, client_id: DISCORD_CLIENT_ID }));
      });
      this.socket.on('data', () => { this.handshakeDone = true; });
      this.socket.on('error', () => { this.disconnect(); });
      this.socket.on('close', () => {
        this.handshakeDone = false;
        this.socket = null;
      });
    } catch { /* ignore */ }
  }

  public updateActivity(info: TrackPresenceInfo): void {
    if (!getDb().settings.discordRpc) return;
    if (!this.socket || this.socket.destroyed) {
      this.connect();
      return;
    }
    if (!this.handshakeDone) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const activity: Record<string, any> = {
      details: `${info.title}`.slice(0, 128),
      state: `by ${info.artist}${info.qualityLabel ? ` • ${info.qualityLabel}` : ''}`.slice(0, 128),
      type: 2,
      assets: {
        large_image: info.thumbnail || 'archivetune_logo',
        large_text: info.album || 'ArchiveTune Desktop',
        small_image: info.isPlaying ? 'play_icon' : 'pause_icon',
        small_text: info.isPlaying ? 'Listening' : 'Paused',
      },
    };
    if (info.isPlaying && info.duration > 0) {
      activity.timestamps = {
        start: Math.floor(nowSec - info.position),
        end: Math.floor(nowSec - info.position + info.duration),
      };
    }
    try {
      this.socket.write(this.encodePacket(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: `${Date.now()}` }));
    } catch { /* ignore */ }
  }

  public disconnect(): void {
    try { this.socket?.destroy(); } catch { /* ignore */ }
    this.socket = null;
    this.handshakeDone = false;
  }
}

function submitListenBrainz(listenType: 'playing_now' | 'single', info: TrackPresenceInfo): void {
  const settings = getDb().settings;
  if (!settings.listenBrainzEnabled || !settings.listenBrainzToken?.trim()) return;

  const payload = {
    listen_type: listenType,
    payload: [
      {
        ...(listenType === 'single' ? { listened_at: Math.floor(Date.now() / 1000) } : {}),
        track_metadata: {
          artist_name: info.artist,
          track_name: info.title,
          release_name: info.album || undefined,
          additional_info: {
            media_player: 'ArchiveTune Desktop V2',
            duration: Math.round(info.duration || 0),
          },
        },
      },
    ],
  };

  const bodyStr = JSON.stringify(payload);
  const req = https.request(
    'https://api.listenbrainz.org/1/submit-listens',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${settings.listenBrainzToken.trim()}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    },
    (res) => res.resume()
  );
  req.on('error', () => {});
  req.write(bodyStr);
  req.end();
}

export async function extractPaletteFromArtwork(urlOrPath: string): Promise<{
  primary: string;
  secondary: string;
  surface: string;
  isMonochrome: boolean;
} | null> {
  try {
    if (!urlOrPath) return null;
    let buf: Buffer | null = null;
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      const res = await fetch(urlOrPath, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) ArchiveTune/2.0' },
      });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      buf = Buffer.from(ab);
    } else if (urlOrPath.startsWith('file://')) {
      const clean = fileURLToPath(urlOrPath);
      if (fs.existsSync(clean)) buf = fs.readFileSync(clean);
    } else if (fs.existsSync(urlOrPath)) {
      buf = fs.readFileSync(urlOrPath);
    }
    if (!buf || buf.length === 0) return null;

    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const thumb = img.resize({ width: 32, height: 32, quality: 'good' });
    const raw = thumb.getBitmap();

    let bestR = 203;
    let bestG = 185;
    let bestB = 245;
    let maxSaturation = -1;
    let totalLuminance = 0;
    let validPixels = 0;

    for (let i = 0; i < raw.length; i += 4) {
      const b = raw[i];
      const g = raw[i + 1];
      const r = raw[i + 2];
      const a = raw[i + 3];
      if (a < 128) continue;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      const lum = (max + min) / 510;
      const sat = max === 0 ? 0 : delta / max;

      totalLuminance += lum;
      validPixels++;

      if (lum > 0.15 && lum < 0.88 && sat > maxSaturation) {
        maxSaturation = sat;
        bestR = r;
        bestG = g;
        bestB = b;
      }
    }

    const isMonochrome = maxSaturation < 0.12;

    if (isMonochrome) {
      const avgLum = validPixels > 0 ? totalLuminance / validPixels : 0.5;
      const primary = avgLum > 0.5 ? '#cbd5e1' : '#94a3b8';
      const secondary = '#64748b';
      const surface = '#0f172a';
      return { primary, secondary, surface, isMonochrome: true };
    }

    const boostR = Math.min(255, Math.round(bestR * 1.05 + 15));
    const boostG = Math.min(255, Math.round(bestG * 1.05 + 15));
    const boostB = Math.min(255, Math.round(bestB * 1.05 + 15));
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    const primary = `#${toHex(boostR)}${toHex(boostG)}${toHex(boostB)}`;
    const secondary = `#${toHex(Math.round(bestR * 0.75))}${toHex(Math.round(bestG * 0.75))}${toHex(Math.round(bestB * 0.75))}`;
    const surface = `#${toHex(Math.round(bestR * 0.12))}${toHex(Math.round(bestG * 0.12))}${toHex(Math.round(bestB * 0.12))}`;

    return { primary, secondary, surface, isMonochrome: false };
  } catch {
    return null;
  }
}

export class DesktopIntegration {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private discord = new DiscordRpcClient();
  private mprisPlayer: any = null;
  private localApiServer: http.Server | null = null;
  private lastPresence: TrackPresenceInfo | null = null;
  private isMiniMode = false;
  private normalBounds: Electron.Rectangle | null = null;
  private isQuitting = false;

  public init(win: BrowserWindow): void {
    this.mainWindow = win;
    this.setupTray();
    this.setupGlobalShortcuts();
    this.setupCloseToTray();
    this.setupMpris();
    if (getDb().settings.discordRpc) this.discord.connect();
    if (getDb().settings.localApiEnabled) this.startLocalApiServer();
  }

  private setupMpris(): void {
    if (process.platform !== 'linux' || !getDb().settings.mprisEnabled) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const MprisPlayer = require('mpris-service');
      this.mprisPlayer = MprisPlayer({
        name: 'archivetune',
        identity: 'ArchiveTune Desktop',
        desktopEntry: 'archivetune-desktop',
        supportedInterfaces: ['player'],
        supportedUriSchemes: ['file', 'https'],
        supportedMimeTypes: ['audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4'],
      });
      this.mprisPlayer.on('playpause', () => this.mainWindow?.webContents.send('shortcut:media', 'playPause'));
      this.mprisPlayer.on('play', () => this.mainWindow?.webContents.send('shortcut:media', 'playPause'));
      this.mprisPlayer.on('pause', () => this.mainWindow?.webContents.send('shortcut:media', 'playPause'));
      this.mprisPlayer.on('next', () => this.mainWindow?.webContents.send('shortcut:media', 'next'));
      this.mprisPlayer.on('previous', () => this.mainWindow?.webContents.send('shortcut:media', 'prev'));
      this.mprisPlayer.on('raise', () => {
        this.mainWindow?.show();
        this.mainWindow?.focus();
      });
      this.mprisPlayer.on('quit', () => {
        this.isQuitting = true;
        app.quit();
      });
    } catch (err) {
      console.warn('[MPRIS] Failed to initialize mpris-service:', err);
    }
  }

  public startLocalApiServer(): void {
    if (this.localApiServer) return;
    try {
      this.localApiServer = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'GET' && req.url === '/api/v1/status') {
          res.end(JSON.stringify(this.lastPresence || { isPlaying: false }));
          return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/api/v1/control/')) {
          const cmd = req.url.split('/').pop();
          if (cmd === 'playpause') this.mainWindow?.webContents.send('shortcut:media', 'playPause');
          if (cmd === 'next') this.mainWindow?.webContents.send('shortcut:media', 'next');
          if (cmd === 'prev') this.mainWindow?.webContents.send('shortcut:media', 'prev');
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
      });
      this.localApiServer.listen(26538, '127.0.0.1');
    } catch { /* ignore port conflict */ }
  }

  public stopLocalApiServer(): void {
    if (this.localApiServer) {
      try { this.localApiServer.close(); } catch { /* ignore */ }
      this.localApiServer = null;
    }
  }

  private setupTray(): void {
    try {
      const iconPath = path.join(__dirname, '../../assets/icon.png');
      const img = fs.existsSync(iconPath)
        ? nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 })
        : nativeImage.createEmpty();
      this.tray = new Tray(img);
      this.tray.setToolTip('ArchiveTune Desktop');
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Show ArchiveTune', click: () => { this.mainWindow?.show(); this.mainWindow?.focus(); } },
          { label: 'Toggle Mini PiP Mode', click: () => this.toggleMiniMode() },
          { type: 'separator' },
          { label: 'Play / Pause', click: () => this.mainWindow?.webContents.send('shortcut:media', 'playPause') },
          { label: 'Next Track', click: () => this.mainWindow?.webContents.send('shortcut:media', 'next') },
          { label: 'Previous Track', click: () => this.mainWindow?.webContents.send('shortcut:media', 'prev') },
          { type: 'separator' },
          { label: 'Quit', click: () => { this.isQuitting = true; app.quit(); } },
        ])
      );
      this.tray.on('click', () => {
        if (!this.mainWindow) return;
        if (this.mainWindow.isVisible()) this.mainWindow.focus();
        else this.mainWindow.show();
      });
    } catch { /* headless fallback */ }
  }

  private setupGlobalShortcuts(): void {
    try {
      globalShortcut.register('MediaPlayPause', () => this.mainWindow?.webContents.send('shortcut:media', 'playPause'));
      globalShortcut.register('MediaNextTrack', () => this.mainWindow?.webContents.send('shortcut:media', 'next'));
      globalShortcut.register('MediaPreviousTrack', () => this.mainWindow?.webContents.send('shortcut:media', 'prev'));
    } catch { /* wayland portal handles media keys via MPRIS */ }
  }

  private setupCloseToTray(): void {
    app.on('before-quit', () => { this.isQuitting = true; });
    this.mainWindow?.on('close', (e) => {
      if (!this.isQuitting && getDb().settings.closeToTray) {
        e.preventDefault();
        this.mainWindow?.hide();
      }
    });
  }

  public toggleMiniMode(): boolean {
    if (!this.mainWindow) return false;
    this.isMiniMode = !this.isMiniMode;
    if (this.isMiniMode) {
      this.normalBounds = this.mainWindow.getBounds();
      this.mainWindow.setMinimumSize(360, 110);
      this.mainWindow.setSize(390, 120);
      this.mainWindow.setAlwaysOnTop(true, 'floating');
    } else {
      this.mainWindow.setAlwaysOnTop(false);
      this.mainWindow.setMinimumSize(940, 620);
      if (this.normalBounds) this.mainWindow.setBounds(this.normalBounds);
      else this.mainWindow.setSize(1280, 820);
    }
    this.mainWindow.webContents.send('window:miniModeChanged', this.isMiniMode);
    return this.isMiniMode;
  }

  public updatePresence(info: TrackPresenceInfo): void {
    this.lastPresence = info;
    this.discord.updateActivity(info);

    if (this.mprisPlayer) {
      try {
        this.mprisPlayer.playbackStatus = info.isPlaying ? 'Playing' : 'Paused';
        this.mprisPlayer.getPosition = () => Math.round((info.position || 0) * 1e6);
        this.mprisPlayer.metadata = {
          'mpris:trackid': this.mprisPlayer.objectPath(`track/${(info.id || '0').replace(/[^a-zA-Z0-9]/g, '')}`),
          'mpris:length': Math.round((info.duration || 0) * 1e6),
          'mpris:artUrl': info.thumbnail || '',
          'xesam:title': info.title || 'ArchiveTune',
          'xesam:album': info.album || 'ArchiveTune',
          'xesam:artist': [info.artist || 'Unknown'],
        };
      } catch { /* ignore */ }
    }
  }

  public setupIPC(): void {
    ipcMain.handle('window:toggleMiniMode', () => this.toggleMiniMode());
    ipcMain.handle('desktop:updatePresence', (_e, info: TrackPresenceInfo) => this.updatePresence(info));
    ipcMain.handle('desktop:listenBrainzNowPlaying', (_e, info: TrackPresenceInfo) => {
      submitListenBrainz('playing_now', info);
      return true;
    });
    ipcMain.handle('desktop:listenBrainzScrobble', (_e, info: TrackPresenceInfo) => {
      submitListenBrainz('single', info);
      return true;
    });
    ipcMain.handle('desktop:extractPalette', async (_e, imageUrl: string) => {
      return extractPaletteFromArtwork(imageUrl);
    });
    ipcMain.handle('desktop:toggleLocalApi', (_e, enabled: boolean) => {
      updateSettings({ localApiEnabled: enabled });
      if (enabled) this.startLocalApiServer();
      else this.stopLocalApiServer();
      return enabled;
    });
  }

  public destroy(): void {
    globalShortcut.unregisterAll();
    this.discord.disconnect();
    this.stopLocalApiServer();
    try { this.tray?.destroy(); } catch { /* ignore */ }
  }
}

export const desktopIntegration = new DesktopIntegration();
