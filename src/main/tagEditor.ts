/**
 * tagEditor.ts — Local Audio Metadata & Cover Art Editor (ported from jeffvli/feishin)
 *
 * Uses `ffmpeg` (stream-copy `-c copy`) to atomically rewrite ID3v2 / Vorbis / MP4 tags
 * and embedded cover art without re-encoding lossless/lossy audio streams, then updates `db.localTracks`.
 */

import { ipcMain, dialog } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb, saveDbImmediate } from './db';

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string
) => Promise<T>;

export interface AudioTagPayload {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  trackNumber?: string;
  comment?: string;
  coverPath?: string;
}

export function setupTagEditorIPC(): void {
  ipcMain.handle('tagEditor:read', async (_e, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
      const mm = await dynamicImport<typeof import('music-metadata')>('music-metadata');
      const meta = await mm.parseFile(filePath, { skipCovers: false });
      const pic = meta.common.picture?.[0];
      return {
        filePath,
        title: meta.common.title || path.basename(filePath, path.extname(filePath)),
        artist: meta.common.artist || '',
        album: meta.common.album || '',
        year: meta.common.year ? String(meta.common.year) : '',
        genre: meta.common.genre?.[0] || '',
        trackNumber: meta.common.track?.no ? String(meta.common.track.no) : '',
        comment:
          typeof meta.common.comment?.[0] === 'string'
            ? meta.common.comment[0]
            : (meta.common.comment?.[0] as any)?.text || '',
        coverDataUrl: pic
          ? `data:${pic.format || 'image/jpeg'};base64,${Buffer.from(pic.data).toString('base64')}`
          : undefined,
        codec: meta.format.codec,
        sampleRate: meta.format.sampleRate,
        bitDepth: meta.format.bitsPerSample,
        bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : undefined,
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('tagEditor:pickCover', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    return res.filePaths[0] ?? null;
  });

  ipcMain.handle('tagEditor:write', async (_e, filePath: string, tags: AudioTagPayload) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'Audio file does not exist.' };
    }
    const ext = path.extname(filePath).toLowerCase();
    const tmpOut = path.join(
      path.dirname(filePath),
      `.archivetune_tag_${Date.now()}${ext}`
    );

    const args: string[] = ['-y', '-i', filePath];
    const hasCover = Boolean(tags.coverPath && fs.existsSync(tags.coverPath));
    if (hasCover && tags.coverPath) {
      args.push('-i', tags.coverPath, '-map', '0:a', '-map', '1:v', '-c:a', 'copy', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic');
    } else {
      args.push('-map', '0', '-c', 'copy');
    }

    if (ext === '.mp3') {
      args.push('-id3v2_version', '3');
    }
    if (tags.title !== undefined) args.push('-metadata', `title=${tags.title}`);
    if (tags.artist !== undefined) args.push('-metadata', `artist=${tags.artist}`);
    if (tags.album !== undefined) args.push('-metadata', `album=${tags.album}`);
    if (tags.year !== undefined) args.push('-metadata', `date=${tags.year}`);
    if (tags.genre !== undefined) args.push('-metadata', `genre=${tags.genre}`);
    if (tags.trackNumber !== undefined) args.push('-metadata', `track=${tags.trackNumber}`);
    if (tags.comment !== undefined) args.push('-metadata', `comment=${tags.comment}`);
    args.push(tmpOut);

    try {
      await new Promise<void>((resolve, reject) => {
        execFile('ffmpeg', args, { timeout: 25000 }, (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        });
      });

      fs.renameSync(tmpOut, filePath);

      // Update localTracks entry inside DB
      const db = getDb();
      const idx = db.localTracks.findIndex((t) => t.path === filePath);
      if (idx >= 0) {
        if (tags.title) db.localTracks[idx].title = tags.title;
        if (tags.artist) db.localTracks[idx].artist = tags.artist;
        if (tags.album !== undefined) db.localTracks[idx].album = tags.album || undefined;
        saveDbImmediate();
      }
      return { ok: true };
    } catch (err: any) {
      if (fs.existsSync(tmpOut)) fs.unlink(tmpOut, () => {});
      return { ok: false, error: err?.message || 'Failed to write audio tags' };
    }
  });
}
