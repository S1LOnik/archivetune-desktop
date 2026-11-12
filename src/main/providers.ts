/**
 * providers.ts — 8-Platform Multi-Source Audio Matrix, Latency Monitor & Smart Routing Engine
 *
 * Ports S1LOnik/ArchiveTune's UniversalFallbackMatrix.kt, LatencyServerMonitor,
 * TidalAudioProvider, QobuzAudioProvider, DeezerAudioProvider, AppleMusicCatalog,
 * JioSaavn & SoundCloud into an intelligent parallel routing engine.
 */

import { ipcMain } from 'electron';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { AudioSourceId, getDb } from './db';
import { TitleMatch, TrackMatching } from './automix';
import { ytmusicSearchSongs, ytmusicGetStreamUrl } from './ytmusic';
import { getSoundCloudClientId, getStoredSoundCloudToken } from './soundcloudAuth';

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
  headers?: Record<string, string>;
  actualSource: AudioSourceId | 'local';
  originalSource: string;
  qualityLabel: string;
  lossless: boolean;
  switched: boolean;
  switchedReason?: string;
  error?: string;
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

export function httpRequestJson<T = any>(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(
        parsed,
        {
          method: opts?.method || 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            Accept: 'application/json, text/plain, */*',
            ...(opts?.headers || {}),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return httpRequestJson<T>(new URL(res.headers.location, url).toString(), opts).then(resolve);
          }
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            try {
              const txt = Buffer.concat(chunks).toString('utf-8');
              resolve(JSON.parse(txt) as T);
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.setTimeout(opts?.timeoutMs ?? 8000, () => {
        req.destroy();
        resolve(null);
      });
      if (opts?.body) req.write(opts.body);
      req.end();
    } catch {
      resolve(null);
    }
  });
}

function httpRequestText(url: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = https.get(
        url,
        { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        }
      );
      req.on('error', () => resolve(null));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

function measureLatency(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    try {
      const parsed = new URL(url);
      const req = https.request(
        parsed,
        { method: 'HEAD', headers: { 'User-Agent': 'ArchiveTune-Desktop/2.0' } },
        (res) => {
          res.resume();
          const elapsed = Date.now() - start;
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve(elapsed);
          } else {
            resolve(null);
          }
        }
      );
      req.on('error', () => resolve(null));
      req.setTimeout(3500, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    } catch {
      resolve(null);
    }
  });
}

// ─── 1. LatencyServerMonitor ──────────────────────────────────────────────────

const latencyCache = new Map<AudioSourceId, ProviderLatencyInfo>();

const HEALTH_ENDPOINTS: Array<{ source: AudioSourceId; name: string; url: string }> = [
  { source: 'tidal', name: 'Tidal Hi-Res', url: 'https://triton.squid.wtf/' },
  { source: 'qobuz', name: 'Qobuz Studio', url: 'https://dab.yeet.su/' },
  { source: 'deezer', name: 'Deezer HiFi', url: 'https://api.deezer.com/infos' },
  { source: 'jiosaavn', name: 'JioSaavn 320k', url: 'https://www.jiosaavn.com/' },
  { source: 'youtube', name: 'YouTube Music', url: 'https://music.youtube.com/generate_204' },
  { source: 'soundcloud', name: 'SoundCloud', url: 'https://api-v2.soundcloud.com/' },
  { source: 'apple', name: 'Apple Music Catalog', url: 'https://itunes.apple.com/' },
  { source: 'spotify', name: 'Spotify', url: 'https://api.spotify.com/v1/' },
];

export async function checkAllProviderLatencies(): Promise<ProviderLatencyInfo[]> {
  const results = await Promise.all(
    HEALTH_ENDPOINTS.map(async (ep) => {
      const ms = await measureLatency(ep.url);
      const info: ProviderLatencyInfo = {
        source: ep.source,
        name: ep.name,
        latencyMs: ms,
        status: ms === null ? 'offline' : ms < 750 ? 'healthy' : 'degraded',
        checkedAt: Date.now(),
      };
      latencyCache.set(ep.source, info);
      return info;
    })
  );
  return results;
}

// ─── 2. TIDAL LOSSLESS PROVIDER ───────────────────────────────────────────────

const TIDAL_HIFI_ENDPOINTS = [
  'https://triton.squid.wtf',
  'https://wolf.qqdl.site',
  'https://hifi.pw',
];

export async function searchTidal(query: string, limit = 10): Promise<MultiTrackCandidate[]> {
  for (const base of TIDAL_HIFI_ENDPOINTS) {
    const data = await httpRequestJson<any>(`${base}/search/?s=${encodeURIComponent(query)}`, { timeoutMs: 5500 });
    const items = data?.data?.items || data?.items || [];
    if (Array.isArray(items) && items.length > 0) {
      return items.slice(0, limit).map((item: any) => {
        const coverUuid = item.album?.cover;
        const thumbnail = coverUuid
          ? `https://resources.tidal.com/images/${String(coverUuid).replace(/-/g, '/')}/640x640.jpg`
          : undefined;
        return {
          id: `tidal:${item.id}`,
          externalId: String(item.id),
          title: item.title || 'Unknown',
          artist: item.artist?.name || item.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
          album: item.album?.title,
          duration: item.duration || 0,
          thumbnail,
          source: 'tidal' as const,
          qualityLabel: item.audioQuality === 'HI_RES_LOSSLESS' ? 'Tidal 24-bit FLAC' : 'Tidal FLAC',
          codec: 'FLAC',
          lossless: true,
        };
      });
    }
  }
  return [];
}

export async function resolveTidalStream(trackId: string, preferredQuality?: string): Promise<string | null> {
  const cleanId = trackId.replace(/^tidal:/, '');
  const quality = preferredQuality || getDb().settings.tidalQuality || 'LOSSLESS';
  const tryQualities = quality === 'HI_RES_LOSSLESS' ? ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH'] : [quality, 'HIGH'];

  for (const base of TIDAL_HIFI_ENDPOINTS) {
    for (const q of tryQualities) {
      const data = await httpRequestJson<any>(`${base}/track/?id=${cleanId}&quality=${q}`, { timeoutMs: 6500 });
      const manifestB64 = data?.data?.manifest || data?.manifest;
      if (manifestB64) {
        try {
          const decoded = Buffer.from(manifestB64, 'base64').toString('utf-8');
          const json = JSON.parse(decoded);
          if (Array.isArray(json.urls) && json.urls[0]) return json.urls[0];
        } catch { /* xml dash ignored unless direct */ }
      }
      if (Array.isArray(data)) {
        const urlObj = data.find((x: any) => x?.OriginalTrackUrl);
        if (urlObj?.OriginalTrackUrl) return urlObj.OriginalTrackUrl;
      }
      if (data?.OriginalTrackUrl) return data.OriginalTrackUrl;
    }
  }
  return null;
}

// ─── 3. QOBUZ STUDIO PROVIDER ─────────────────────────────────────────────────

const QOBUZ_ENDPOINTS = ['https://dab.yeet.su/api', 'https://qobuz.squid.wtf/api'];

export async function searchQobuz(query: string, limit = 8): Promise<MultiTrackCandidate[]> {
  for (const base of QOBUZ_ENDPOINTS) {
    const data = await httpRequestJson<any>(`${base}/get-music?q=${encodeURIComponent(query)}&offset=0&type=track`, {
      timeoutMs: 5500,
    });
    const tracks = data?.tracks?.items || data?.tracks || [];
    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks.slice(0, limit).map((t: any) => ({
        id: `qobuz:${t.id}`,
        externalId: String(t.id),
        title: t.title || 'Unknown',
        artist: t.performer?.name || t.artist?.name || 'Unknown',
        album: t.album?.title,
        duration: t.duration || 0,
        thumbnail: t.album?.image?.large || t.album?.image?.small,
        source: 'qobuz' as const,
        qualityLabel: (t.maximum_bit_depth || 16) >= 24 ? 'Qobuz 24-bit FLAC' : 'Qobuz FLAC',
        codec: 'FLAC',
        lossless: true,
      }));
    }
  }
  return [];
}

export async function resolveQobuzStream(trackId: string): Promise<string | null> {
  const cleanId = trackId.replace(/^qobuz:/, '');
  const qSetting = getDb().settings.qobuzQuality || 'LOSSLESS';
  const qualityCode = qSetting === 'HI_RES_192' ? '27' : qSetting === 'LOSSLESS' ? '6' : '5';

  for (const base of QOBUZ_ENDPOINTS) {
    const data = await httpRequestJson<any>(`${base}/download-music?track_id=${cleanId}&quality=${qualityCode}`, {
      timeoutMs: 6500,
    });
    if (data?.url) return data.url;
  }
  return null;
}

// ─── 4. DEEZER HIFI PROVIDER ──────────────────────────────────────────────────

const DEEZER_RESOLVERS = [
  'https://yesitworkssomehow-funny-deeza-api-and-yeah.hf.space/get_url',
  'https://api-number-2-poopo.onrender.com/get_url',
  'https://dzmedia-metrofuse.onrender.com/get_url',
];

export async function searchDeezer(query: string, limit = 10): Promise<MultiTrackCandidate[]> {
  const data = await httpRequestJson<any>(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  if (!data?.data) return [];
  return data.data.map((t: any) => ({
    id: `deezer:${t.id}`,
    externalId: String(t.id),
    title: t.title || 'Unknown',
    artist: t.artist?.name || 'Unknown',
    album: t.album?.title,
    duration: t.duration || 0,
    thumbnail: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium,
    source: 'deezer' as const,
    qualityLabel: getDb().settings.deezerQuality === 'FLAC' ? 'Deezer FLAC' : 'Deezer MP3 320k',
    codec: getDb().settings.deezerQuality === 'FLAC' ? 'FLAC' : 'MP3',
    lossless: getDb().settings.deezerQuality === 'FLAC',
  }));
}

export async function resolveDeezerStream(trackId: string): Promise<string | null> {
  const cleanId = trackId.replace(/^deezer:/, '');
  const format = getDb().settings.deezerQuality || 'FLAC';
  for (const resolver of DEEZER_RESOLVERS) {
    const res = await httpRequestJson<any>(`${resolver}?id=${cleanId}&format=${format}`, { timeoutMs: 6000 });
    if (res?.url) return res.url;
  }
  // Preview fallback is only 30s so only use as last resort if track duration <= 35s
  const trackInfo = await httpRequestJson<any>(`https://api.deezer.com/track/${cleanId}`);
  if (trackInfo?.duration && trackInfo.duration <= 35 && trackInfo.preview) return trackInfo.preview;
  return null;
}

// ─── 5. JIOSAAVN 320KBPS PROVIDER (Direct CDN M4A/AAC, No DRM) ─────────────────

function decryptSaavnMediaUrl(encryptedUrl: string): string | null {
  try {
    const key = Buffer.from('38346591', 'utf-8');
    const decipher = crypto.createDecipheriv('des-ecb', key, null);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encryptedUrl, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted.replace(/_96\.mp4/i, '_320.mp4').replace(/_160\.mp4/i, '_320.mp4').replace('http://', 'https://');
  } catch {
    return null;
  }
}

export async function searchJioSaavn(query: string, limit = 10): Promise<MultiTrackCandidate[]> {
  const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&q=${encodeURIComponent(query)}&n=${limit}&p=1`;
  const data = await httpRequestJson<any>(url, { timeoutMs: 5500 });
  const results = data?.results || [];
  if (!Array.isArray(results)) return [];

  return results.map((s: any) => {
    const artist =
      s.more_info?.artistMap?.primary_artists?.map((a: any) => a.name).join(', ') ||
      s.primary_artists ||
      s.singers ||
      'Unknown';
    return {
      id: `jiosaavn:${s.id}`,
      externalId: String(s.id),
      title: String(s.song || s.title || 'Unknown').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      artist: String(artist).replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      album: s.album ? String(s.album).replace(/&quot;/g, '"') : undefined,
      duration: parseInt(s.duration || s.more_info?.duration || '0', 10),
      thumbnail: typeof s.image === 'string' ? s.image.replace('150x150', '500x500') : undefined,
      source: 'jiosaavn' as const,
      qualityLabel: 'JioSaavn 320k AAC',
      codec: 'AAC',
      lossless: false,
    };
  });
}

export async function resolveJioSaavnStream(trackId: string): Promise<string | null> {
  const cleanId = trackId.replace(/^jiosaavn:/, '');
  const url = `https://www.jiosaavn.com/api.php?__call=song.getDetails&_format=json&_marker=0&pids=${encodeURIComponent(cleanId)}`;
  const data = await httpRequestJson<any>(url, { timeoutMs: 5500 });
  const songObj = data?.songs?.[0] || data?.[cleanId];
  const enc = songObj?.more_info?.encrypted_media_url || songObj?.encrypted_media_url;
  if (enc) {
    const dec = decryptSaavnMediaUrl(enc);
    if (dec) {
      if (getDb().settings.saavnQuality === '160') {
        return dec.replace('_320.mp4', '_160.mp4');
      }
      return dec;
    }
  }
  return null;
}

// ─── 6. APPLE MUSIC CATALOG PROVIDER ──────────────────────────────────────────

export async function searchAppleMusic(query: string, limit = 10): Promise<MultiTrackCandidate[]> {
  const data = await httpRequestJson<any>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}`
  );
  if (!Array.isArray(data?.results)) return [];
  return data.results.map((r: any) => ({
    id: `apple:${r.trackId}`,
    externalId: String(r.trackId),
    title: r.trackName || 'Unknown',
    artist: r.artistName || 'Unknown',
    album: r.collectionName,
    duration: Math.round((r.trackTimeMillis || 0) / 1000),
    thumbnail: typeof r.artworkUrl100 === 'string' ? r.artworkUrl100.replace('/100x100bb.jpg', '/600x600bb.jpg') : undefined,
    source: 'apple' as const,
    qualityLabel: 'Apple Catalog',
    codec: 'ALAC/Virtual',
    lossless: false,
  }));
}

// ─── 7. SOUNDCLOUD API v2 PROVIDER ────────────────────────────────────────────

export async function searchSoundCloud(query: string, limit = 10): Promise<MultiTrackCandidate[]> {
  const clientId = (await getSoundCloudClientId()) || 'fDoItMDbsbZz8dY16ZzARC3zd5C2iA67';
  const data = await httpRequestJson<any>(
    `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=${limit}`
  );
  if (!data?.collection) return [];
  return data.collection.map((t: any) => ({
    id: `soundcloud:${t.id}`,
    externalId: String(t.id),
    title: t.title || 'Unknown',
    artist: t.user?.username || 'Unknown',
    duration: Math.round((t.duration || 0) / 1000),
    thumbnail: typeof t.artwork_url === 'string' ? t.artwork_url.replace('-large', '-t500x500') : t.user?.avatar_url,
    source: 'soundcloud' as const,
    qualityLabel: 'SoundCloud Stream',
    codec: 'Opus/MP3',
    lossless: false,
  }));
}

export async function resolveSoundCloudStream(trackId: string): Promise<string | null> {
  const cleanId = trackId.replace(/^soundcloud:/, '');
  const clientId = (await getSoundCloudClientId()) || 'fDoItMDbsbZz8dY16ZzARC3zd5C2iA67';
  const headers: Record<string, string> = {};
  const userTok = getStoredSoundCloudToken().trim();
  if (userTok) headers.Authorization = userTok.startsWith('OAuth ') ? userTok : `OAuth ${userTok}`;

  const track = await httpRequestJson<any>(
    `https://api-v2.soundcloud.com/tracks/${cleanId}?client_id=${clientId}`,
    { headers }
  );
  const transcodings: any[] = track?.media?.transcodings || [];
  const progressive =
    transcodings.find((t) => t.format?.protocol === 'progressive') ||
    transcodings.find((t) => t.format?.protocol === 'hls');
  if (!progressive?.url) return null;
  const streamMeta = await httpRequestJson<any>(`${progressive.url}?client_id=${clientId}`, { headers });
  return streamMeta?.url || null;
}

// ─── 8. UNIVERSAL AUDIO FALLBACK & AUTO-UPGRADE ENGINE ────────────────────────

export async function findAlternativeSources(track: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}): Promise<MultiTrackCandidate[]> {
  const query = `${track.title} ${track.artist}`.trim();
  const wantedDurMs = track.duration ? track.duration * 1000 : undefined;

  const [tidal, qobuz, deezer, saavn, ytm, sc] = await Promise.all([
    searchTidal(query, 4).catch(() => []),
    searchQobuz(query, 4).catch(() => []),
    searchDeezer(query, 4).catch(() => []),
    searchJioSaavn(query, 4).catch(() => []),
    ytmusicSearchSongs(query, 4).catch(() => []),
    searchSoundCloud(query, 3).catch(() => []),
  ]);

  const ytmCandidates: MultiTrackCandidate[] = ytm.map((y) => ({
    id: y.id,
    externalId: y.id,
    title: y.title,
    artist: y.artist,
    album: y.album,
    duration: y.duration,
    thumbnail: y.thumbnail,
    source: 'youtube',
    qualityLabel: 'YouTube Music Opus',
    codec: 'Opus',
    lossless: false,
  }));

  const all = [...tidal, ...qobuz, ...deezer, ...saavn, ...ytmCandidates, ...sc];
  const scored: MultiTrackCandidate[] = [];

  for (const cand of all) {
    const evalRes = TitleMatch.evaluate({
      wantedTitle: track.title,
      wantedArtists: [track.artist],
      wantedAlbum: track.album,
      wantedDurationMs: wantedDurMs,
      candidateTitle: cand.title,
      candidateArtist: cand.artist,
      candidateAlbum: cand.album,
      candidateDurationMs: cand.duration ? cand.duration * 1000 : undefined,
    });
    if (evalRes.accepted || evalRes.score >= 0.65) {
      scored.push({ ...cand, matchScore: Math.round(evalRes.score * 100) });
    }
  }

  return scored.sort((a, b) => {
    if (Boolean(b.lossless) !== Boolean(a.lossless)) return b.lossless ? 1 : -1;
    return (b.matchScore || 0) - (a.matchScore || 0);
  });
}

async function resolveBySourceId(
  source: AudioSourceId,
  track: { id: string; title: string; artist: string; album?: string; duration?: number },
  settings: ReturnType<typeof getDb>['settings']
): Promise<{ url: string; qualityLabel: string; lossless: boolean } | null> {
  const query = `${track.title} ${track.artist}`.trim();
  const wantedDurMs = track.duration ? track.duration * 1000 : undefined;

  const pickBest = (candidates: MultiTrackCandidate[]): MultiTrackCandidate | null => {
    let best: MultiTrackCandidate | null = null;
    let bestScore = 0.72;
    for (const c of candidates) {
      const res = TitleMatch.evaluate({
        wantedTitle: track.title,
        wantedArtists: [track.artist],
        wantedAlbum: track.album,
        wantedDurationMs: wantedDurMs,
        candidateTitle: c.title,
        candidateArtist: c.artist,
        candidateAlbum: c.album,
        candidateDurationMs: c.duration ? c.duration * 1000 : undefined,
      });
      if (res.accepted && res.score > bestScore) {
        bestScore = res.score;
        best = c;
      }
    }
    if (best) return best;
    // Fallback to TrackMatching
    const legacy = TrackMatching.best(
      { title: track.title, artists: [track.artist], durationMs: wantedDurMs },
      candidates.map((c) => ({
        id: c.id,
        title: c.title,
        artists: [c.artist],
        durationMs: c.duration ? c.duration * 1000 : undefined,
        payload: c,
      }))
    );
    return legacy?.payload ?? null;
  };

  if (source === 'tidal') {
    if (track.id.startsWith('tidal:')) {
      const url = await resolveTidalStream(track.id, settings.tidalQuality);
      if (url) return { url, qualityLabel: settings.tidalQuality === 'HI_RES_LOSSLESS' ? 'Tidal 24-bit FLAC' : 'Tidal FLAC', lossless: true };
    } else {
      const match = pickBest(await searchTidal(query, 6));
      if (match) {
        const url = await resolveTidalStream(match.id, settings.tidalQuality);
        if (url) return { url, qualityLabel: match.qualityLabel, lossless: true };
      }
    }
  } else if (source === 'qobuz') {
    if (track.id.startsWith('qobuz:')) {
      const url = await resolveQobuzStream(track.id);
      if (url) return { url, qualityLabel: 'Qobuz FLAC', lossless: true };
    } else {
      const match = pickBest(await searchQobuz(query, 5));
      if (match) {
        const url = await resolveQobuzStream(match.id);
        if (url) return { url, qualityLabel: match.qualityLabel, lossless: true };
      }
    }
  } else if (source === 'deezer') {
    if (track.id.startsWith('deezer:')) {
      const url = await resolveDeezerStream(track.id);
      if (url) return { url, qualityLabel: settings.deezerQuality === 'FLAC' ? 'Deezer FLAC' : 'Deezer MP3 320k', lossless: settings.deezerQuality === 'FLAC' };
    } else {
      const match = pickBest(await searchDeezer(query, 5));
      if (match) {
        const url = await resolveDeezerStream(match.id);
        if (url) return { url, qualityLabel: match.qualityLabel, lossless: Boolean(match.lossless) };
      }
    }
  } else if (source === 'jiosaavn') {
    if (track.id.startsWith('jiosaavn:')) {
      const url = await resolveJioSaavnStream(track.id);
      if (url) return { url, qualityLabel: 'JioSaavn 320k AAC', lossless: false };
    } else {
      const match = pickBest(await searchJioSaavn(query, 5));
      if (match) {
        const url = await resolveJioSaavnStream(match.id);
        if (url) return { url, qualityLabel: 'JioSaavn 320k AAC', lossless: false };
      }
    }
  } else if (source === 'soundcloud') {
    if (track.id.startsWith('soundcloud:')) {
      const url = await resolveSoundCloudStream(track.id);
      if (url) return { url, qualityLabel: 'SoundCloud Stream', lossless: false };
    } else {
      const match = pickBest(await searchSoundCloud(query, 5));
      if (match) {
        const url = await resolveSoundCloudStream(match.id);
        if (url) return { url, qualityLabel: 'SoundCloud Stream', lossless: false };
      }
    }
  } else if (source === 'youtube') {
    if (!track.id.includes(':')) {
      const url = await ytmusicGetStreamUrl(track.id);
      if (url) return { url, qualityLabel: 'YouTube Music Opus', lossless: false };
    } else {
      const ytm = await ytmusicSearchSongs(query, 5);
      const cands: MultiTrackCandidate[] = ytm.map((y) => ({
        id: y.id,
        title: y.title,
        artist: y.artist,
        duration: y.duration,
        source: 'youtube',
        qualityLabel: 'YouTube Music Opus',
      }));
      const match = pickBest(cands) || cands[0];
      if (match) {
        const url = await ytmusicGetStreamUrl(match.id);
        if (url) return { url, qualityLabel: 'YouTube Music Opus', lossless: false };
      }
    }
  }
  return null;
}

async function resolveCandidateDirectStream(
  cand: MultiTrackCandidate,
  settings: ReturnType<typeof getDb>['settings']
): Promise<{ url: string; qualityLabel: string; lossless: boolean } | null> {
  if (cand.source === 'tidal') {
    const url = await resolveTidalStream(cand.id, settings.tidalQuality);
    if (url) {
      return {
        url,
        qualityLabel: settings.tidalQuality === 'HI_RES_LOSSLESS' ? 'Tidal 24-bit FLAC' : cand.qualityLabel || 'Tidal FLAC',
        lossless: true,
      };
    }
  } else if (cand.source === 'qobuz') {
    const url = await resolveQobuzStream(cand.id);
    if (url) return { url, qualityLabel: cand.qualityLabel || 'Qobuz FLAC', lossless: true };
  } else if (cand.source === 'deezer') {
    const url = await resolveDeezerStream(cand.id);
    if (url) {
      return {
        url,
        qualityLabel: settings.deezerQuality === 'FLAC' ? 'Deezer FLAC' : 'Deezer MP3 320k',
        lossless: settings.deezerQuality === 'FLAC',
      };
    }
  } else if (cand.source === 'jiosaavn') {
    const url = await resolveJioSaavnStream(cand.id);
    if (url) return { url, qualityLabel: 'JioSaavn 320k AAC', lossless: false };
  } else if (cand.source === 'soundcloud') {
    const url = await resolveSoundCloudStream(cand.id);
    if (url) return { url, qualityLabel: 'SoundCloud Stream', lossless: false };
  } else if (cand.source === 'youtube') {
    const url = await ytmusicGetStreamUrl(cand.id.replace(/^youtube:/, ''));
    if (url) return { url, qualityLabel: 'YouTube Music Opus', lossless: false };
  }
  return null;
}

export async function resolveUniversalStream(
  track: { id: string; title: string; artist: string; album?: string; duration?: number; source: string; path?: string },
  forceSource?: AudioSourceId
): Promise<SmartStreamResolution> {
  if (track.source === 'local' || (track.path && !track.path.startsWith('http'))) {
    return {
      streamUrl: track.path || null,
      actualSource: 'local',
      originalSource: 'local',
      qualityLabel: 'Local Audio',
      lossless: Boolean(track.path?.toLowerCase().endsWith('.flac') || track.path?.toLowerCase().endsWith('.wav')),
      switched: false,
    };
  }

  const settings = getDb().settings;
  const threshold = settings.autoSwitchThreshold ?? 88;
  const preferLossless = settings.preferLosslessOverExact ?? true;

  // Smart Multi-Source Auto-Switch: when autoUpgradeLossless is ON and no manual forceSource is requested,
  // evaluate candidates across all enabled providers and automatically pick the best match >= threshold!
  if (!forceSource && settings.autoUpgradeLossless && settings.preferredAudioSource === 'auto') {
    try {
      const candidates = await findAlternativeSources(track);
      const eligible = candidates
        .filter((c) => settings.enabledSources[c.source] !== false && (c.matchScore ?? 0) >= threshold)
        .sort((a, b) => {
          if (preferLossless && Boolean(b.lossless) !== Boolean(a.lossless)) {
            return b.lossless ? 1 : -1;
          }
          if ((b.matchScore || 0) !== (a.matchScore || 0)) {
            return (b.matchScore || 0) - (a.matchScore || 0);
          }
          return Boolean(b.lossless) === Boolean(a.lossless) ? 0 : b.lossless ? 1 : -1;
        });

      for (const bestCand of eligible.slice(0, 4)) {
        try {
          const direct = await resolveCandidateDirectStream(bestCand, settings);
          if (direct?.url) {
            const switched = bestCand.source !== track.source;
            return {
              streamUrl: direct.url,
              actualSource: bestCand.source,
              originalSource: track.source,
              qualityLabel: `${direct.qualityLabel} (${bestCand.matchScore}% match)`,
              lossless: direct.lossless,
              switched,
              switchedReason: switched
                ? `Умный авто-выбор (${bestCand.matchScore}% совпадение) → ${bestCand.source.toUpperCase()} ${direct.qualityLabel}`
                : undefined,
            };
          }
        } catch {
          /* try next best candidate */
        }
      }
    } catch {
      /* fallback to sequential chain */
    }
  }

  const order = settings.sourceOrder.filter((s) => settings.enabledSources[s] && s !== 'apple' && s !== 'spotify');

  const chain: AudioSourceId[] = [];
  if (forceSource) chain.push(forceSource);

  if (settings.preferredAudioSource !== 'auto' && settings.preferredAudioSource !== 'apple' && settings.preferredAudioSource !== 'spotify') {
    if (!chain.includes(settings.preferredAudioSource)) chain.push(settings.preferredAudioSource);
  }

  if (settings.autoUpgradeLossless && !forceSource) {
    for (const hi of ['tidal', 'qobuz', 'deezer'] as AudioSourceId[]) {
      if (settings.enabledSources[hi] && !chain.includes(hi)) chain.push(hi);
    }
  }

  if (track.source !== 'spotify' && track.source !== 'apple' && track.source !== 'local') {
    const nat = track.source as AudioSourceId;
    if (!chain.includes(nat)) chain.push(nat);
  }

  if (settings.universalFallback) {
    for (const s of order) {
      if (!chain.includes(s)) chain.push(s);
    }
    if (!chain.includes('youtube')) chain.push('youtube');
  }

  for (const src of chain) {
    const lat = latencyCache.get(src);
    if (!forceSource && lat && Date.now() - lat.checkedAt < 60000 && lat.status === 'offline') {
      continue;
    }

    try {
      const resolved = await resolveBySourceId(src, track, settings);
      if (resolved?.url) {
        const switched = src !== track.source;
        let switchedReason: string | undefined;
        if (forceSource) {
          switchedReason = `Ручное переключение → ${resolved.qualityLabel}`;
        } else if (switched && resolved.lossless) {
          switchedReason = `Авто-апгрейд → ${resolved.qualityLabel}`;
        } else if (switched) {
          switchedReason = `Fallback → ${resolved.qualityLabel}`;
        }
        return {
          streamUrl: resolved.url,
          actualSource: src,
          originalSource: track.source,
          qualityLabel: resolved.qualityLabel,
          lossless: resolved.lossless,
          switched,
          switchedReason,
        };
      }
    } catch { /* try next source */ }
  }

  return {
    streamUrl: null,
    actualSource: (track.source as AudioSourceId) || 'youtube',
    originalSource: track.source,
    qualityLabel: 'Unavailable',
    lossless: false,
    switched: false,
    error: 'All configured audio sources failed to resolve a valid matching stream.',
  };
}

export function setupProvidersIPC(): void {
  ipcMain.handle(
    'providers:searchMulti',
    async (_e, query: string, source: 'all' | AudioSourceId = 'all') => {
      if (!query.trim()) return [];
      if (source === 'tidal') return searchTidal(query, 15);
      if (source === 'qobuz') return searchQobuz(query, 15);
      if (source === 'deezer') return searchDeezer(query, 15);
      if (source === 'jiosaavn') return searchJioSaavn(query, 15);
      if (source === 'apple') return searchAppleMusic(query, 15);
      if (source === 'soundcloud') return searchSoundCloud(query, 15);
      if (source === 'youtube') {
        const ytm = await ytmusicSearchSongs(query, 15);
        return ytm.map((y) => ({
          id: y.id,
          title: y.title,
          artist: y.artist,
          album: y.album,
          duration: y.duration,
          thumbnail: y.thumbnail,
          source: 'youtube' as const,
          qualityLabel: 'YouTube Music Opus',
        }));
      }

      const [ytm, tidal, qobuz, deezer, saavn, apple, sc] = await Promise.all([
        ytmusicSearchSongs(query, 8).catch(() => []),
        searchTidal(query, 6).catch(() => []),
        searchQobuz(query, 4).catch(() => []),
        searchDeezer(query, 5).catch(() => []),
        searchJioSaavn(query, 5).catch(() => []),
        searchAppleMusic(query, 4).catch(() => []),
        searchSoundCloud(query, 4).catch(() => []),
      ]);

      return [
        ...tidal,
        ...qobuz,
        ...ytm.map((y) => ({
          id: y.id,
          title: y.title,
          artist: y.artist,
          album: y.album,
          duration: y.duration,
          thumbnail: y.thumbnail,
          source: 'youtube' as const,
          qualityLabel: 'YouTube Music Opus',
        })),
        ...deezer,
        ...saavn,
        ...apple,
        ...sc,
      ];
    }
  );

  ipcMain.handle(
    'providers:resolveUniversal',
    async (
      _e,
      track: { id: string; title: string; artist: string; album?: string; duration?: number; source: string; path?: string },
      forceSource?: AudioSourceId
    ) => {
      return resolveUniversalStream(track, forceSource);
    }
  );

  ipcMain.handle('providers:findAlternatives', async (_e, track: { id: string; title: string; artist: string; album?: string; duration?: number }) => {
    return findAlternativeSources(track);
  });

  ipcMain.handle('providers:checkLatencies', async () => {
    return checkAllProviderLatencies();
  });
}
