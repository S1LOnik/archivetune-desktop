import { app, ipcMain } from 'electron';
import path from 'path';
import { OfflineLibrary } from './offline';
import { getDb, updateSettings, PersistedTrack } from './db';

export class PlaybackCache {
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  constructor(private library: OfflineLibrary, private limit: () => number) {}
  private trim(): void {
    const entries = this.library.list().sort((a,b) => (a.lastAccessed || a.savedAt) - (b.lastAccessed || b.savedAt));
    let total = entries.reduce((n,e) => n + e.bytes, 0);
    for (const entry of entries) {
      if (total <= this.limit()) break;
      this.library.remove(entry.track.id); total -= entry.bytes;
    }
  }
  find(id: string) {
    if (this.limit() <= 0) return null;
    return this.library.touch(id);
  }
  info() {
    const entries = this.library.list();
    return { bytes: entries.reduce((n,e) => n + e.bytes, 0), count: entries.length, limitMB: this.limit() / 1024 / 1024 };
  }
  cancel(): void {
    ++this.revision;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
  }
  async store(track: PersistedTrack, url: string, headers?: Record<string,string>): Promise<void> {
    const revision = this.revision;
    if (this.limit() <= 0 || this.library.find(track.id)) return;
    const controller = new AbortController(); this.controller = controller;
    try {
      const entry = await this.library.save(track, url, headers, controller.signal);
      if (entry.bytes > this.limit()) { this.library.remove(track.id); return; }
      if (revision !== this.revision) {
        this.library.remove(track.id);
        return;
      }
      this.trim();
    } finally { if (this.controller === controller) this.controller = undefined; }
  }
  schedule(track: PersistedTrack, url: string, headers?: Record<string,string>): void {
    this.cancel();
    if (!url.startsWith('http') || this.limit() <= 0 || this.library.find(track.id)) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.store(track, url, headers).catch(() => { /* Cache failure never interrupts playback. */ });
    }, 1500);
  }
  async clear(): Promise<void> {
    this.cancel();
    // An aborted save removes its own temporary file; committed entries are independent.
    for (const entry of this.library.list()) this.library.remove(entry.track.id);
  }
  enforceLimit(): void { this.trim(); }
}
let instance: PlaybackCache | undefined;
export function getPlaybackCache() {
  return instance ??= new PlaybackCache(new OfflineLibrary(path.join(app.getPath('userData'), 'playback-cache')), () => Math.max(0, getDb().settings.playbackCacheMB ?? 512) * 1024 * 1024);
}
export function setupPlaybackCacheIPC(): void {
  ipcMain.handle('cache:info', () => getPlaybackCache().info());
  ipcMain.handle('cache:configure', async (_event, limitMB: number) => {
    if (![0,128,256,512,1024,2048].includes(limitMB)) throw new Error('Недопустимый размер кэша');
    const cache = getPlaybackCache(); cache.cancel();
    updateSettings({ playbackCacheMB: limitMB });
    cache.enforceLimit();
    return cache.info();
  });
  ipcMain.handle('cache:clear', async () => { const cache = getPlaybackCache(); await cache.clear(); return cache.info(); });
}
