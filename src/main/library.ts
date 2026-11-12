/**
 * library.ts — Local Music Scanner powered by `music-metadata`
 *
 * Scans directories recursively for audio files (.mp3, .flac, .opus, .m4a, .wav, .ogg, .alac, .wv),
 * parses ID3/Vorbis/MP4/FLAC tags + ReplayGain + audio stream properties (codec, bitDepth, sampleRate, bitrate),
 * and caches extracted embedded cover artwork to userData/artwork-cache/<hash>.jpg.
 */

import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string
) => Promise<T>;

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.wma', '.ape', '.wv', '.alac', '.aiff',
]);

export interface TrackMeta {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre?: string;
  trackNumber: number;
  duration: number;
  year: number;
  thumbnail?: string;
  format: string;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  lossless?: boolean;
  source: 'local';
}

function getArtworkCacheDir(): string {
  try {
    return path.join(app.getPath('userData'), 'artwork-cache');
  } catch {
    return path.join(os.tmpdir(), 'archivetune-artwork');
  }
}

function scanDirectory(dirPath: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) results.push(fullPath);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

async function getMetadata(filePath: string): Promise<TrackMeta> {
  const id = `local-${crypto.createHash('md5').update(filePath).digest('hex').slice(0, 14)}`;
  const ext = path.extname(filePath).slice(1).toUpperCase();
  const baseTitle = path.basename(filePath, path.extname(filePath));

  try {
    const mm = await dynamicImport<typeof import('music-metadata')>('music-metadata');
    const metadata = await mm.parseFile(filePath, { duration: true, skipCovers: false });
    const common = metadata.common;
    const format = metadata.format;

    let thumbnail: string | undefined;
    const pic = common.picture?.[0];
    if (pic && pic.data && pic.data.length > 0) {
      const cacheDir = getArtworkCacheDir();
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      const picHash = crypto.createHash('md5').update(pic.data).digest('hex');
      const imgExt = pic.format?.includes('png') ? 'png' : 'jpg';
      const imgPath = path.join(cacheDir, `${picHash}.${imgExt}`);
      if (!fs.existsSync(imgPath)) {
        fs.writeFileSync(imgPath, pic.data);
      }
      thumbnail = `file://${imgPath}`;
    }

    return {
      id,
      path: filePath,
      title: common.title?.trim() || baseTitle,
      artist: common.artist?.trim() || common.albumartist?.trim() || 'Unknown Artist',
      album: common.album?.trim() || 'Unknown Album',
      albumArtist: common.albumartist?.trim() || common.artist?.trim() || 'Unknown Artist',
      genre: common.genre?.[0],
      trackNumber: common.track?.no ?? 0,
      duration: Math.round(format.duration ?? 0),
      year: common.year ?? 0,
      thumbnail,
      format: ext,
      codec: format.codec || ext,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
      sampleRate: format.sampleRate,
      bitDepth: format.bitsPerSample,
      lossless: Boolean(format.lossless),
      source: 'local',
    };
  } catch {
    return {
      id,
      path: filePath,
      title: baseTitle,
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      albumArtist: 'Unknown Artist',
      trackNumber: 0,
      duration: 0,
      year: 0,
      format: ext,
      source: 'local',
    };
  }
}

export function setupLibraryIPC(): void {
  ipcMain.handle('library:scan', async (_e, dirPath: string) => {
    if (!fs.existsSync(dirPath)) return [];
    const files = scanDirectory(dirPath);
    const BATCH = 16;
    const results: TrackMeta[] = [];
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const metas = await Promise.all(batch.map(getMetadata));
      results.push(...metas);
    }
    return results;
  });

  ipcMain.handle('library:getMetadata', async (_e, filePath: string) => {
    return getMetadata(filePath);
  });
}
