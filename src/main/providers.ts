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
import { TitleMatch } from './automix';
import { ytmusicSearchSongs, ytmusicGetStreamUrl, ytmusicGetTrackDuration, youtubeArtistName } from './ytmusic';
import { getSoundCloudClientId, getStoredSoundCloudToken } from './soundcloudAuth';
import { spotifySearchCandidates, getSpotifyAudioCredentials } from './spotify';
import { resolveNativeSpotify, spotifyTrackId } from './spotifyNative';

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
  spotifyId?: string;
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

export async function findAlternativeSources(input: StreamTrack): Promise<MultiTrackCandidate[]> {
  const track = matchingTrack(input);
  const query = sourceSearchQuery(track);

  const [tidal, qobuz, deezer, saavn, ytm, sc, sp, duration] = await Promise.all([
    searchTidal(query, 4).catch(() => []),
    searchQobuz(query, 4).catch(() => []),
    searchDeezer(query, 4).catch(() => []),
    searchJioSaavn(query, 4).catch(() => []),
    ytmusicSearchSongs(query, 4).catch(() => []),
    searchSoundCloud(query, 3).catch(() => []),
    spotifySearchCandidates(query, 6).catch(() => []),
    sourceTrackDuration(track),
  ]);

  const wantedDurMs = duration ? duration * 1000 : undefined;
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

  const all = [...tidal, ...qobuz, ...deezer, ...saavn, ...ytmCandidates, ...sc, ...(sp as MultiTrackCandidate[])];
  const scored: MultiTrackCandidate[] = [];

  for (const cand of all) {
    const candidateArtist = cand.source === 'youtube' ? youtubeArtistName(cand.artist) : cand.artist;
    if (!track.artist || !candidateArtist || (duration && !cand.duration && cand.id !== track.id)) continue;
    const evalRes = TitleMatch.evaluate({
      wantedTitle: track.title,
      wantedArtists: [track.artist],
      wantedAlbum: track.album,
      wantedDurationMs: wantedDurMs,
      candidateTitle: cand.title,
      candidateArtist,
      candidateAlbum: cand.album,
      candidateDurationMs: cand.duration ? cand.duration * 1000 : undefined,
    });
    if (evalRes.accepted) {
      scored.push({ ...cand, matchScore: Math.round(evalRes.score * 100) });
    }
  }

  return scored.sort((a, b) => {
    if (Boolean(b.lossless) !== Boolean(a.lossless)) return b.lossless ? 1 : -1;
    return (b.matchScore || 0) - (a.matchScore || 0);
  });
}

type StreamTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  source: string;
  path?: string;
  spotifyUri?: string;
};

function matchingTrack(track: StreamTrack): StreamTrack {
  return track.source === 'youtube' ? { ...track, artist: youtubeArtistName(track.artist) } : track;
}

function sourceSearchQuery(track: StreamTrack): string {
  return `${TitleMatch.cleanTitle(track.title)} ${track.artist}`.trim();
}

async function sourceTrackDuration(track: StreamTrack): Promise<number> {
  if (track.duration && track.duration > 0) return track.duration;
  if (track.source === 'youtube') return ytmusicGetTrackDuration(track.id.replace(/^youtube:/, '')).catch(() => 0);
  return 0;
}

function linkedSpotifyId(track: StreamTrack): string | undefined {
  return spotifyTrackId(track.spotifyUri) ||
    (track.source === 'spotify' || /^(spotify:|https:\/\/open\.spotify\.com\/)/.test(track.id)
      ? spotifyTrackId(track.id)
      : undefined);
}

function findSpotifyLibraryId(track: StreamTrack, likedSongs: StreamTrack[]): string | undefined {
  const duration = track.duration;
  if (!duration || !track.artist) return undefined;
  const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase();
  const title = normalize(track.title);
  const artist = normalize(track.artist);
  const match = likedSongs.find(candidate =>
    candidate.source === 'spotify' && candidate.duration && Math.abs(candidate.duration - duration) <= 2
    && normalize(candidate.title) === title && normalize(candidate.artist) === artist && linkedSpotifyId(candidate));
  return match && linkedSpotifyId(match);
}

async function resolveBySourceId(
  source: AudioSourceId,
  track: StreamTrack,
  settings: ReturnType<typeof getDb>['settings'],
  manual = false,
  signal?: AbortSignal,
): Promise<{ url: string; qualityLabel: string; lossless: boolean; actualSource?: AudioSourceId; headers?: Record<string, string>; spotifyId?: string } | null> {
  const query = sourceSearchQuery(track);

  const pickBest = (candidates: MultiTrackCandidate[], requireCloseMatch = false, duration = track.duration): MultiTrackCandidate | null => {
    const wantedDurMs = duration ? duration * 1000 : undefined;
    let best: MultiTrackCandidate | null = null;
    let bestScore = requireCloseMatch ? 0.90 : 0.72;
    for (const c of candidates) {
      // With a known original duration, an unmeasured alternative cannot be
      // distinguished reliably from a short edit or a different recording.
      const artist = c.source === 'youtube' ? youtubeArtistName(c.artist) : c.artist;
      if (!track.artist || !artist || (wantedDurMs && !c.duration)) continue;
      if (requireCloseMatch && (!duration || !c.duration || Math.abs(c.duration - duration) > 5)) continue;
      const res = TitleMatch.evaluate({
        wantedTitle: track.title,
        wantedArtists: [track.artist],
        wantedAlbum: track.album,
        wantedDurationMs: wantedDurMs,
        candidateTitle: c.title,
        candidateArtist: artist,
        candidateAlbum: c.album,
        candidateDurationMs: c.duration ? c.duration * 1000 : undefined,
      });
      if (res.accepted && res.score > bestScore) {
        bestScore = res.score;
        best = c;
      }
    }
    return best;
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
    const cleanYtId = track.id.replace(/^youtube:/, '');
    const exactVideoId = (track.source === 'youtube' || track.id.startsWith('youtube:')) && /^[\w-]{11}$/.test(cleanYtId)
      ? cleanYtId
      : undefined;
    if (exactVideoId) {
      const url = await ytmusicGetStreamUrl(exactVideoId);
      if (url) return { url, qualityLabel: 'YouTube Music Opus', lossless: false };
    }
    if (signal?.aborted) return null;
    const ytm = await ytmusicSearchSongs(query, 5);
    const cands: MultiTrackCandidate[] = ytm.filter(y => y.id !== exactVideoId).map((y) => ({
      id: y.id,
      title: y.title,
      artist: y.artist,
      duration: y.duration,
      source: 'youtube',
      qualityLabel: 'YouTube Music Opus',
    }));
    const match = pickBest(cands);
    if (match && !signal?.aborted) {
      const url = await ytmusicGetStreamUrl(match.id);
      if (url) return { url, qualityLabel: 'YouTube Music Opus', lossless: false };
    }
  } else if (source === 'spotify' && settings.nativeSpotifyEnabled) {
    const nativeId = linkedSpotifyId(track);
    const requireCloseMatch = !manual && settings.preferredAudioSource === 'auto' && track.source === 'youtube';
    if (!nativeId && !track.artist) return null;
    const credentials = await getSpotifyAudioCredentials();
    if (!credentials || signal?.aborted) return null;
    let id = nativeId;
    if (!id) {
      const [candidates, duration] = await Promise.all([spotifySearchCandidates(query, 6), sourceTrackDuration(track)]);
      id = pickBest(candidates, requireCloseMatch, duration)?.id;
    }
    if (id && !signal?.aborted) {
      const resolved = await resolveNativeSpotify(id, credentials, manual, signal);
      if (resolved) return { ...resolved, spotifyId: spotifyTrackId(id) };
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
  } else if (cand.source === 'spotify') {
    const ytm = await ytmusicSearchSongs(`${cand.title} ${cand.artist}`, 3);
    if (ytm[0]?.id) {
      const url = await ytmusicGetStreamUrl(ytm[0].id);
      if (url) return { url, qualityLabel: 'YouTube Music • подбор по Spotify', lossless: false };
    }
  }
  return null;
}

const universalResolutionCache = new Map<string, { res: SmartStreamResolution; expiresAt: number }>();
const inFlightResolutions = new Map<string, Promise<SmartStreamResolution>>();

export async function resolveUniversalStream(
  track: StreamTrack,
  forceSource?: AudioSourceId,
  excludedSources: string[] = []
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

  const { settings, likedSongs } = getDb();
  const normalizedTrack = matchingTrack(track);
  const linkedId = linkedSpotifyId(track);
  const spotifyId = linkedId || (settings.nativeSpotifyEnabled && (!forceSource || forceSource === 'spotify')
    ? findSpotifyLibraryId(normalizedTrack, likedSongs)
    : undefined);
  const routeTrack = spotifyId && !linkedId ? { ...normalizedTrack, spotifyUri: spotifyId } : normalizedTrack;
  const nativeSpotifyTrack = Boolean(spotifyId) || track.source === 'spotify';
  const preferred = settings.preferredAudioSource;
  const originalSources: AudioSourceId[] = nativeSpotifyTrack
    ? ['spotify', 'youtube']
    : track.source === 'soundcloud' || track.id.startsWith('soundcloud:')
      ? ['soundcloud', 'youtube', 'spotify']
      : track.source === 'youtube' && preferred === 'auto'
        ? ['spotify', 'youtube', 'soundcloud']
        : ['youtube', 'spotify', 'soundcloud'];
  const chain = forceSource ? [forceSource] : [
    ...new Set([...(preferred && preferred !== 'auto' ? [preferred] : []), ...originalSources]),
  ].filter(source => {
    if (settings.enabledSources[source] === false || excludedSources.includes(source)) return false;
    if (source === 'spotify') return settings.nativeSpotifyEnabled;
    const probe = latencyCache.get(source);
    return source === 'youtube' || !probe || Date.now() - probe.checkedAt >= 60000 || probe.status !== 'offline';
  });

  // A URL resolved under a different source preference cannot short-circuit the
  // current primary provider. The native bridge owns the lifetime of Spotify URLs.
  const cacheKey = JSON.stringify([chain, preferred, track.source, track.id, track.title, track.artist,
    track.album, track.duration, spotifyId, settings.tidalQuality, settings.deezerQuality]);
  if (!forceSource && excludedSources.length === 0) {
    const cached = universalResolutionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.res;
  }

  const flightKey = JSON.stringify([cacheKey, forceSource, excludedSources.slice().sort()]);
  const existingFlight = inFlightResolutions.get(flightKey);
  if (existingFlight) return existingFlight;

  const resolutionTask = (async (): Promise<SmartStreamResolution> => {
    type SourceResult = Awaited<ReturnType<typeof resolveBySourceId>>;
    const deadline = Date.now() + (forceSource ? 20000 : 24000);
    const attempt = async (source: AudioSourceId, signal: AbortSignal): Promise<SourceResult> => {
      const budget = source === 'spotify' && !forceSource ? (spotifyId ? 9000 : 5000) : 15000;
      const timeout = AbortSignal.timeout(Math.max(0, Math.min(budget, deadline - Date.now())));
      const scopedSignal = AbortSignal.any([signal, timeout]);
      const result = resolveBySourceId(source, routeTrack, settings, Boolean(forceSource), scopedSignal)
        .catch(() => null);
      let onAbort: () => void = () => {};
      try {
        return await Promise.race([
          result,
          new Promise<null>(resolve => {
            onAbort = () => resolve(null);
            if (scopedSignal.aborted) onAbort();
            else scopedSignal.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
      } finally {
        scopedSignal.removeEventListener('abort', onAbort);
      }
    };

    const fallback = new AbortController();
    let youtubeFallback: Promise<SourceResult> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    if (chain[0] === 'spotify' && chain[1] === 'youtube') {
      // Start preparing an alternative to hide network latency on failure.
      // Its result is only consumed if the Spotify attempt fails.
      fallbackTimer = setTimeout(() => { youtubeFallback = attempt('youtube', fallback.signal); }, 450);
    }

    try {
      for (const source of chain) {
        if (Date.now() >= deadline) break;
        if (source === 'youtube' && fallbackTimer) clearTimeout(fallbackTimer);
        const resolved = await (source === 'youtube' && youtubeFallback
          ? youtubeFallback
          : attempt(source, fallback.signal));
        if (!resolved?.url) continue;

        const actualSource = resolved.actualSource || source;
        const switched = actualSource !== track.source;
        let switchedReason: string | undefined;
        if (forceSource) switchedReason = `Ручное переключение → ${resolved.qualityLabel}`;
        else if (switched && actualSource === 'spotify' && source === chain[0]) switchedReason = 'Воспроизведение из Spotify';
        else if (switched) switchedReason = `${resolved.lossless ? 'Авто-апгрейд' : 'Fallback'} → ${resolved.qualityLabel}`;
        const outcome: SmartStreamResolution = {
          streamUrl: resolved.url,
          spotifyId: resolved.spotifyId,
          headers: resolved.headers,
          actualSource,
          originalSource: track.source,
          qualityLabel: resolved.qualityLabel,
          lossless: resolved.lossless,
          switched,
          switchedReason,
        };
        if (!forceSource && excludedSources.length === 0 && source === chain[0] && !switched && actualSource !== 'spotify') {
          if (universalResolutionCache.size >= 200) {
            universalResolutionCache.delete(universalResolutionCache.keys().next().value!);
          }
          universalResolutionCache.set(cacheKey, { res: outcome, expiresAt: Date.now() + 15 * 60 * 1000 });
        }
        return outcome;
      }
    } finally {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallback.abort();
    }

    return {
      streamUrl: null,
      actualSource: (track.source as AudioSourceId) || 'youtube',
      originalSource: track.source,
      qualityLabel: 'Unavailable',
      lossless: false,
      switched: false,
      error: forceSource ? `Источник ${forceSource.toUpperCase()} не смог открыть трек.` : 'Не удалось открыть трек из доступных источников.',
    };
  })();

  inFlightResolutions.set(flightKey, resolutionTask);
  try {
    return await resolutionTask;
  } finally {
    inFlightResolutions.delete(flightKey);
  }
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
      track: { id: string; title: string; artist: string; album?: string; duration?: number; source: string; path?: string; spotifyUri?: string },
      forceSource?: AudioSourceId
    ) => {
      return resolveUniversalStream(track, forceSource);
    }
  );

  ipcMain.handle('providers:findAlternatives', async (_e, track: StreamTrack) => {
    return findAlternativeSources(track);
  });

  ipcMain.handle('providers:checkLatencies', async () => {
    return checkAllProviderLatencies();
  });
}
