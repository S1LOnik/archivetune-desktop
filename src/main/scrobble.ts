/**
 * scrobble.ts — Last.fm Audioscrobbler 2.0 with Persistent Credentials
 */

import { ipcMain } from 'electron';
import crypto from 'crypto';
import https from 'https';
import querystring from 'querystring';
import { getDb, updateSettings } from './db';

interface ScrobbleConfig {
  apiKey: string;
  apiSecret: string;
  sessionKey: string;
}

function getConfig(): ScrobbleConfig | null {
  const s = getDb().settings;
  if (s.lastfmApiKey && s.lastfmSecret && s.lastfmSessionKey) {
    return {
      apiKey: s.lastfmApiKey,
      apiSecret: s.lastfmSecret,
      sessionKey: s.lastfmSessionKey,
    };
  }
  return null;
}

function md5(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex');
}

function sign(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return md5(sorted + secret);
}

function postLastfm(params: Record<string, string>): Promise<object> {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(params);
    const req = https.request(
      {
        hostname: 'ws.audioscrobbler.com',
        path: '/2.0/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'ArchiveTune-Desktop/16.2',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export function setupScrobbleIPC(): void {
  ipcMain.handle(
    'scrobble:configure',
    (_e, apiKey: string, apiSecret: string, sessionKey: string) => {
      updateSettings({
        lastfmApiKey: apiKey.trim(),
        lastfmSecret: apiSecret.trim(),
        lastfmSessionKey: sessionKey.trim(),
      });
      return { ok: true };
    }
  );

  ipcMain.handle(
    'scrobble:nowPlaying',
    async (
      _e,
      track: { artist: string; title?: string; track?: string; album?: string; duration?: number }
    ) => {
      const config = getConfig();
      if (!config) return { ok: false, error: 'not configured' };
      const trackName = track.title || track.track || '';
      if (!trackName || !track.artist) return { ok: false, error: 'missing metadata' };

      const params: Record<string, string> = {
        method: 'track.updateNowPlaying',
        artist: track.artist,
        track: trackName,
        api_key: config.apiKey,
        sk: config.sessionKey,
        format: 'json',
      };
      if (track.album) params.album = track.album;
      if (track.duration) params.duration = String(Math.round(track.duration));
      params.api_sig = sign(params, config.apiSecret);
      try {
        await postLastfm(params);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  ipcMain.handle(
    'scrobble:scrobble',
    async (
      _e,
      track: {
        artist: string;
        title?: string;
        track?: string;
        album?: string;
        timestamp: number;
        duration?: number;
      }
    ) => {
      const config = getConfig();
      if (!config) return { ok: false, error: 'not configured' };
      const trackName = track.title || track.track || '';
      if (!trackName || !track.artist) return { ok: false, error: 'missing metadata' };

      const ts =
        track.timestamp && track.timestamp > 1000000
          ? track.timestamp
          : Math.floor(Date.now() / 1000) - Math.round(track.duration || 120);

      const params: Record<string, string> = {
        method: 'track.scrobble',
        artist: track.artist,
        track: trackName,
        timestamp: String(ts),
        api_key: config.apiKey,
        sk: config.sessionKey,
        format: 'json',
      };
      if (track.album) params.album = track.album;
      if (track.duration) params.duration = String(Math.round(track.duration));
      params.api_sig = sign(params, config.apiSecret);
      try {
        await postLastfm(params);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );
}
