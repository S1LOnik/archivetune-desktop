/**
 * recognition.ts — Shazam Music Recognition Engine (`node-shazam` + `ffmpeg` mic/monitor capture)
 *
 * Ports S1LOnik/ArchiveTune's `shazamkit` module to Linux/Desktop:
 * - Recognize from an audio/video file (`fromFilePath` / `fromVideoFile` / `recognise`)
 * - Recognize live system output (PulseAudio/PipeWire monitor) or microphone via `ffmpeg` 7-second capture
 * - Saves results to `db.recognitionHistory` and supports deleting/clearing history
 * - Fetches Shazam Global Top 50 tracks via `node-shazam`
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Shazam } from 'node-shazam';
import { addRecognitionResult, getDb, saveDb } from './db';

export interface ShazamTrackResult {
  id: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail?: string;
  genre?: string;
  releaseDate?: string;
  shazamUrl?: string;
}

const shazam = new Shazam();

function parseShazamRoot(raw: any): ShazamTrackResult | null {
  if (!raw) return null;
  const track = raw.track ?? raw;
  if (!track || !track.title) return null;

  const title = String(track.title);
  const artist = String(track.subtitle || track.artist || 'Unknown Artist');
  const images = track.images || {};
  const thumbnail = images.coverarthq || images.coverart || images.background || undefined;

  let album: string | undefined = typeof track.album === 'string' ? track.album : undefined;
  let releaseDate: string | undefined = typeof track.year === 'string' ? track.year : undefined;

  if (Array.isArray(track.sections)) {
    for (const sec of track.sections) {
      if (Array.isArray(sec.metadata)) {
        for (const meta of sec.metadata) {
          if (meta.title === 'Album' && meta.text) album = String(meta.text);
          if (meta.title === 'Released' && meta.text) releaseDate = String(meta.text);
        }
      }
    }
  }

  return {
    id: `shazam_${track.key || Date.now()}`,
    title,
    artist,
    album,
    thumbnail,
    genre: track.genres?.primary,
    releaseDate,
    shazamUrl: track.url,
  };
}

export async function recognizeFromFile(filePath: string): Promise<ShazamTrackResult | null> {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    // Convert to 16-bit 44.1kHz mono WAV snippet (first 12s) if needed so ffmpeg formats always work smoothly
    const tmpWav = path.join(os.tmpdir(), `at_shazam_${Date.now()}.wav`);
    await new Promise<void>((resolve, reject) => {
      execFile(
        'ffmpeg',
        ['-y', '-i', filePath, '-t', '12', '-ac', '1', '-ar', '44100', '-f', 'wav', tmpWav],
        { timeout: 15000 },
        (err) => (err ? reject(err) : resolve())
      );
    }).catch(() => {});

    const target = fs.existsSync(tmpWav) ? tmpWav : filePath;
    const raw = await shazam.recognise(target, 'en-US', false);
    if (fs.existsSync(tmpWav)) {
      fs.unlink(tmpWav, () => {});
    }
    const parsed = parseShazamRoot(raw);
    if (parsed) {
      addRecognitionResult({
        id: parsed.id,
        title: parsed.title,
        artist: parsed.artist,
        album: parsed.album,
        thumbnail: parsed.thumbnail,
        timestamp: Date.now(),
        source: 'shazam',
      });
    }
    return parsed;
  } catch (err) {
    console.warn('[recognition] file recognition failed:', (err as Error).message);
    return null;
  }
}

async function detectAudioCaptureSource(mode: 'mic' | 'system'): Promise<{ format: string; input: string }> {
  if (mode === 'system') {
    // Check default sink monitor in PulseAudio / PipeWire-Pulse via pactl
    const monitor = await new Promise<string | null>((resolve) => {
      execFile('pactl', ['get-default-sink'], { timeout: 2500 }, (err, stdout) => {
        if (!err && stdout.trim()) {
          resolve(`${stdout.trim()}.monitor`);
        } else {
          resolve(null);
        }
      });
    });
    if (monitor) {
      return { format: 'pulse', input: monitor };
    }
  }
  return { format: 'pulse', input: 'default' };
}

export async function recognizeFromLiveAudio(
  mode: 'mic' | 'system' = 'system',
  durationSec = 7
): Promise<{ result: ShazamTrackResult | null; error?: string }> {
  const tmpWav = path.join(os.tmpdir(), `at_shazam_live_${Date.now()}.wav`);
  try {
    const cap = await detectAudioCaptureSource(mode);
    await new Promise<void>((resolve, reject) => {
      execFile(
        'ffmpeg',
        [
          '-y',
          '-f',
          cap.format,
          '-i',
          cap.input,
          '-t',
          String(Math.max(4, Math.min(12, durationSec))),
          '-ac',
          '1',
          '-ar',
          '44100',
          '-f',
          'wav',
          tmpWav,
        ],
        { timeout: (durationSec + 6) * 1000 },
        (err) => (err ? reject(err) : resolve())
      );
    });

    if (!fs.existsSync(tmpWav) || fs.statSync(tmpWav).size < 4096) {
      return { result: null, error: 'Captured audio buffer is empty.' };
    }

    const raw = await shazam.recognise(tmpWav, 'en-US', false);
    const parsed = parseShazamRoot(raw);
    if (parsed) {
      addRecognitionResult({
        id: parsed.id,
        title: parsed.title,
        artist: parsed.artist,
        album: parsed.album,
        thumbnail: parsed.thumbnail,
        timestamp: Date.now(),
        source: 'shazam',
      });
    }
    return { result: parsed };
  } catch (err) {
    return { result: null, error: (err as Error).message };
  } finally {
    if (fs.existsSync(tmpWav)) {
      fs.unlink(tmpWav, () => {});
    }
  }
}

export async function fetchShazamTopGlobal(limit = 25): Promise<ShazamTrackResult[]> {
  try {
    const raw = (await shazam.top_tracks_global('en-US', 'US', String(limit), '0')) as any;
    const list = Array.isArray(raw?.tracks) ? raw.tracks : Array.isArray(raw?.data) ? raw.data : [];
    const results: ShazamTrackResult[] = [];
    for (const item of list) {
      if (item?.title) {
        const parsed = parseShazamRoot(item);
        if (parsed) results.push(parsed);
      } else if (item?.attributes?.name) {
        const attr = item.attributes;
        const thumb = attr.artwork?.url
          ? String(attr.artwork.url).replace('{w}', '400').replace('{h}', '400')
          : undefined;
        results.push({
          id: `shazam_${item.id || results.length}`,
          title: String(attr.name),
          artist: String(attr.artistName || 'Unknown Artist'),
          album: attr.albumName ? String(attr.albumName) : undefined,
          thumbnail: thumb,
          genre: Array.isArray(attr.genreNames) ? attr.genreNames[0] : undefined,
          releaseDate: attr.releaseDate,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function setupRecognitionIPC(mainWindow?: BrowserWindow): void {
  ipcMain.handle('recognition:recognizeLive', async (_e, mode: 'mic' | 'system' = 'system') => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recognition:status', { phase: 'listening', mode });
    }
    const res = await recognizeFromLiveAudio(mode, 7);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recognition:status', { phase: 'idle', mode });
    }
    return res;
  });

  ipcMain.handle('recognition:pickAndRecognizeFile', async () => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Media', extensions: ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus', 'mp4', 'webm', 'mkv'] }],
    });
    const file = picked.filePaths[0];
    if (!file) return { canceled: true, result: null };
    const result = await recognizeFromFile(file);
    return { canceled: false, result };
  });

  ipcMain.handle('recognition:recognizeFile', async (_e, filePath: string) => {
    return recognizeFromFile(filePath);
  });

  ipcMain.handle('recognition:getHistory', () => {
    return getDb().recognitionHistory;
  });

  ipcMain.handle('recognition:clearHistory', () => {
    const db = getDb();
    db.recognitionHistory = [];
    saveDb();
    return [];
  });

  ipcMain.handle('recognition:topGlobal', async (_e, limit = 25) => {
    return fetchShazamTopGlobal(limit);
  });
}
