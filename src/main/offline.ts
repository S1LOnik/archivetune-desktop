import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import type { PersistedTrack } from './db';
import { readArtwork } from './artwork';
import { pathToFileURL } from 'url';

export interface OfflineEntry { track: PersistedTrack; filePath: string; bytes: number; savedAt: number; lastAccessed?: number }

/** Only committed, complete files are visible. Explicit saves are never evicted automatically. */
export class OfflineLibrary {
  private entries: Record<string, OfflineEntry> = {};
  private pending = new Map<string, Promise<OfflineEntry>>();
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
    // Recover space from downloads interrupted by a previous process crash.
    for (const name of fs.readdirSync(root)) {
      if (/^[a-f0-9]{64}\.part\.mka$/.test(name)) fs.rmSync(path.join(root, name), { force: true });
    }
    try { this.entries = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8')); } catch { /* first run */ }
  }
  private key(id: string): string { return crypto.createHash('sha256').update(id).digest('hex'); }
  private persist(): void {
    const dest = path.join(this.root, 'index.json');
    fs.writeFileSync(dest + '.tmp', JSON.stringify(this.entries));
    fs.renameSync(dest + '.tmp', dest);
  }
  find(id: string): OfflineEntry | null {
    const entry = this.entries[this.key(id)];
    if (!entry || path.dirname(entry.filePath) !== this.root || !fs.existsSync(entry.filePath)) return null;
    return entry;
  }
  list(): OfflineEntry[] {
    return Object.values(this.entries).filter(e => this.find(e.track.id)).sort((a,b) => b.savedAt - a.savedAt);
  }
  async save(track: PersistedTrack, url: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<OfflineEntry> {
    const existing = this.find(track.id);
    if (existing) return existing;
    const key = this.key(track.id);
    const waiting = this.pending.get(key);
    if (waiting) return waiting;
    const task = (async () => {
      const filePath = path.join(this.root, key + '.mka');
      const temporary = path.join(this.root, key + '.part.mka');
      const coverPath = path.join(this.root, key + '.cover.png');
      try {
        const args = ['-nostdin', '-v', 'error', '-y'];
        if (headers && Object.keys(headers).length) args.push('-headers', Object.entries(headers).map(([k,v]) => `${k}: ${v}\r\n`).join(''));
        args.push('-i', url, '-map', '0:a:0', '-vn', '-c:a', 'copy', '-metadata', `title=${track.title}`, '-metadata', `artist=${track.artist}`, temporary);
        await new Promise<void>((resolve, reject) => execFile('ffmpeg', args, { timeout: 180000, signal }, err => err ? reject(new Error('Не удалось сохранить аудио офлайн')) : resolve()));
        let bytes = fs.statSync(temporary).size;
        if (!bytes) throw new Error('Аудиофайл пуст');
        const cover = track.thumbnail ? await readArtwork(track.thumbnail, signal) : null;
        if (signal?.aborted) throw new Error('Сохранение отменено');
        if (cover) { fs.writeFileSync(coverPath, cover); bytes += cover.length; }
        fs.renameSync(temporary, filePath);
        // Do not persist short-lived signed stream URLs or request headers.
        const metadata: PersistedTrack = { id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration, source: track.source, thumbnail: cover ? pathToFileURL(coverPath).href : track.thumbnail };
        const entry = { track: metadata, filePath, bytes, savedAt: Date.now() };
        this.entries[key] = entry;
        try { this.persist(); } catch (error) { delete this.entries[key]; fs.rmSync(filePath, { force: true }); fs.rmSync(coverPath, { force: true }); throw error; }
        return entry;
      } catch (error) {
        fs.rmSync(filePath, { force: true });
        fs.rmSync(coverPath, { force: true });
        throw error;
      } finally { fs.rmSync(temporary, { force: true }); }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  touch(id: string): OfflineEntry | null {
    const entry = this.find(id);
    if (entry) { entry.lastAccessed = Date.now(); this.persist(); }
    return entry;
  }
  remove(id: string): void {
    const key = this.key(id);
    if (this.pending.has(key)) throw new Error('Дождитесь завершения сохранения');
    const entry = this.entries[key];
    if (entry && path.dirname(entry.filePath) === this.root) fs.rmSync(entry.filePath, { force: true });
    fs.rmSync(path.join(this.root, key + '.cover.png'), { force: true });
    delete this.entries[key];
    this.persist();
  }
}
let instance: OfflineLibrary | undefined;
export const getOfflineLibrary = () => instance ??= new OfflineLibrary(path.join(app.getPath('userData'), 'offline-audio'));

export function setupOfflineIPC(resolve: (track: PersistedTrack) => Promise<{ streamUrl: string | null; headers?: Record<string,string> }>): void {
  ipcMain.handle('offline:find', async (_event, id: string) => getOfflineLibrary().find(id) || (await import('./playbackCache')).getPlaybackCache().find(id));
  ipcMain.handle('offline:list', () => getOfflineLibrary().list());
  ipcMain.handle('offline:remove', (_event, id: string) => {
    try { getOfflineLibrary().remove(id); return { ok: true }; } catch (error: any) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('offline:save', async (_event, track: PersistedTrack) => {
    try {
      const library = getOfflineLibrary();
      const existing = library.find(track.id);
      if (existing) return { ok: true, entry: existing };
      const stream = await resolve(track);
      if (!stream.streamUrl) throw new Error('Не найден доступный аудиопоток');
      return { ok: true, entry: await library.save(track, stream.streamUrl, stream.headers) };
    } catch (error: any) { return { ok: false, error: error.message }; }
  });
}
