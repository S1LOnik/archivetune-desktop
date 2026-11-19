/**
 * ytmusic.ts — Full YouTube Music InnerTube & `youtubei.js` Client
 *
 * Implements:
 * - Fast InnerTube JSON Search (Songs, Albums, Artists, Playlists) + Live Search Suggestions
 * - Home Feed, Explore Charts, Moods & Genres, New Releases
 * - Full Album Page, Artist Page (Top Songs, Albums, Singles, Similar), Online Playlist Page
 * - Up Next Radio (`getSuggested`)
 * - Audio Stream extraction via `yt-dlp` with expiry cache
 */

import { ipcMain, app } from 'electron';
import { execFile } from 'child_process';
import path from 'path';
import https from 'https';
import { setTimeout as delay } from 'node:timers/promises';
import type { Innertube } from 'youtubei.js';
import {
  buildAuthenticatedInnerTubeHeaders,
  getActiveYouTubeAccount,
  innerTubePost,
  fetchYouTubeHistory,
} from './youtubeAuth';
import { getDb, PersistedTrack } from './db';

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string
) => Promise<T>;

export interface YTMusicTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  duration: number;
  thumbnail: string;
  source: 'youtube';
}

export interface YTMusicEntity {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  type: 'album' | 'artist' | 'playlist';
}

export interface YTMusicSearchAllResult {
  songs: YTMusicTrack[];
  albums: YTMusicEntity[];
  artists: YTMusicEntity[];
  playlists: YTMusicEntity[];
}

const INNERTUBE_SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false';
const INNERTUBE_SUGGEST_URL = 'https://music.youtube.com/youtubei/v1/music/get_search_suggestions?prettyPrint=false';

const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20250401.01.00',
    hl: 'en',
    gl: 'US',
  },
};

const streamUrlCache = new Map<string, { url: string; expiresAt: number }>();
const categoryCache = new Map<string, { tracks: YTMusicTrack[]; fetchedAt: number }>();
const searchSongsCache = new Map<string, { results: YTMusicTrack[]; expiresAt: number }>();
const CATEGORY_CACHE_TTL_MS = 10 * 60 * 1000;

let innertubePromise: Promise<Innertube | null> | null = null;
function getInnertube(): Promise<Innertube | null> {
  if (!innertubePromise) {
    innertubePromise = dynamicImport<typeof import('youtubei.js')>('youtubei.js')
      .then((mod) => mod.Innertube.create({ generate_session_locally: true }))
      .catch(() => null);
  }
  return innertubePromise;
}

function postInnerTube<T = any>(url: string, body: Record<string, unknown>, timeoutMs = 8500): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const activeAcc = getActiveYouTubeAccount();
      const authHeaders = buildAuthenticatedInnerTubeHeaders(activeAcc);
      const contextPayload = {
        ...INNERTUBE_CONTEXT,
        client: {
          ...INNERTUBE_CONTEXT.client,
          ...(activeAcc?.visitorData ? { visitorData: activeAcc.visitorData } : {}),
        },
        ...(activeAcc?.dataSyncId
          ? { user: { onBehalfOfUser: activeAcc.dataSyncId.split('||')[0] } }
          : {}),
      };
      const payload = JSON.stringify({ context: contextPayload, ...body });
      const req = https.request(
        parsed,
        {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve(null);
      });
      req.write(payload);
      req.end();
    } catch {
      resolve(null);
    }
  });
}

function parseDurationText(text?: string): number {
  if (!text || !/^\d+(?::[0-5]\d){1,2}$/.test(text.trim())) return 0;
  const parts = text.trim().split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

// Old home cards stored their entire subtitle in the artist field.
const YOUTUBE_ITEM_LABEL = /^(?:song|track|video|композиция|песня|трек|видео|клип)$/iu;

export function youtubeArtistName(value: string): string {
  const parts = value.split('•').map(part => part.trim()).filter(Boolean);
  if (YOUTUBE_ITEM_LABEL.test(parts[0] || '')) parts.shift();
  return (parts[0] || '').replace(/\s+[-–—]\s+Topic$/i, '');
}

function readMusicSubtitle(runs: Array<{ text: string }>): string[] {
  return runs.map(run => run.text).join('').split('•').map(part => part.trim()).filter(Boolean);
}

function bestThumb(thumbs: any): string {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return '';
  return String(thumbs[thumbs.length - 1]?.url || '').replace(/=w\d+-h\d+/, '=w544-h544');
}

function extractMusicResponsiveListItem(item: any): YTMusicTrack | null {
  const renderer = item?.musicResponsiveListItemRenderer;
  if (!renderer) return null;
  const videoId =
    renderer.playlistItemData?.videoId ||
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId) return null;

  const flex = renderer.flexColumns || [];
  const titleRuns = flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const subRuns: any[] = flex[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const title = titleRuns?.map((r: any) => r.text).join('') || 'Unknown Track';

  let artist = '';
  let artistId: string | undefined;
  let album = '';
  let albumId: string | undefined;
  let duration = 0;

  for (const r of subRuns) {
    const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
    if (browseId?.startsWith('UC') || browseId?.startsWith('FEmusic_artist')) {
      artist = artist ? `${artist}, ${r.text}` : r.text;
      if (!artistId) artistId = browseId;
    } else if (browseId?.startsWith('MPREb')) {
      album = r.text;
      albumId = browseId;
    } else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(r.text || '').trim())) {
      duration = parseDurationText(r.text);
    }
  }
  if (!duration) {
    for (const column of renderer.fixedColumns || []) {
      const text = column?.musicResponsiveListItemFixedColumnRenderer?.text;
      const value = text?.simpleText || text?.runs?.map((r: any) => r.text).join('');
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(value || '').trim())) {
        duration = parseDurationText(value);
        break;
      }
    }
  }
  if (!artist) {
    const subtitle = readMusicSubtitle(subRuns);
    if (YOUTUBE_ITEM_LABEL.test(subtitle[0] || '')) subtitle.shift();
    artist = youtubeArtistName(subtitle[0] || '') || 'YouTube Music';
    if (!album && subtitle[1] && !parseDurationText(subtitle[1])) album = subtitle[1];
  }

  return {
    id: videoId,
    title,
    artist,
    artistId,
    album: album || undefined,
    albumId,
    duration,
    thumbnail: bestThumb(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
    source: 'youtube',
  };
}

function extractTwoRowOrListEntity(item: any, fallbackType: YTMusicEntity['type']): YTMusicEntity | null {
  const renderer = item?.musicResponsiveListItemRenderer || item?.musicTwoRowItemRenderer;
  if (!renderer) return null;
  const browseId =
    renderer.navigationEndpoint?.browseEndpoint?.browseId ||
    renderer.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
  if (!browseId) return null;

  let title = '';
  let subtitle = '';
  if (renderer.flexColumns) {
    title = renderer.flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((r: any) => r.text).join('') || '';
    subtitle = renderer.flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((r: any) => r.text).join('') || '';
  } else {
    title = renderer.title?.runs?.map((r: any) => r.text).join('') || '';
    subtitle = renderer.subtitle?.runs?.map((r: any) => r.text).join('') || '';
  }

  const thumbs =
    renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;

  const pageType = renderer.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  let type = fallbackType;
  if (pageType?.includes('ARTIST')) type = 'artist';
  else if (pageType?.includes('ALBUM')) type = 'album';
  else if (pageType?.includes('PLAYLIST')) type = 'playlist';

  return {
    id: browseId,
    title: title || 'Unknown',
    subtitle,
    thumbnail: bestThumb(thumbs),
    type,
  };
}

async function ytmusicSearchFiltered(query: string, limit: number, filter: 'songs' | 'videos'): Promise<YTMusicTrack[]> {
  if (!query.trim()) return [];
  const cacheKey = `${filter}:${query.trim().toLowerCase()}:${limit}`;
  const hit = searchSongsCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.results;
  }

  const data = await postInnerTube<any>(INNERTUBE_SEARCH_URL, { query, params: filter === 'videos' ? 'EgWKAQIQAWoKEAMQBBAJEAoQBQ%3D%3D' : 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D' });
  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs;
  const sections = tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  const songs: YTMusicTrack[] = [];
  for (const sec of sections) {
    const contents = sec?.musicShelfRenderer?.contents || [];
    for (const item of contents) {
      const parsed = extractMusicResponsiveListItem(item);
      if (parsed && !songs.some((s) => s.id === parsed.id)) {
        songs.push(parsed);
        if (songs.length >= limit) break;
      }
    }
    if (songs.length >= limit) break;
  }
  if (songs.length > 0) {
    if (searchSongsCache.size >= 120) searchSongsCache.delete(searchSongsCache.keys().next().value!);
    searchSongsCache.set(cacheKey, { results: songs, expiresAt: Date.now() + 5 * 60 * 1000 });
  }
  return songs;
}

export async function ytmusicSearchSongs(query: string, limit = 20): Promise<YTMusicTrack[]> {
  return ytmusicSearchFiltered(query, limit, 'songs');
}

export async function ytmusicSearchAll(query: string): Promise<YTMusicSearchAllResult> {
  const empty: YTMusicSearchAllResult = { songs: [], albums: [], artists: [], playlists: [] };
  if (!query.trim()) return empty;

  const [data, videos] = await Promise.all([
    postInnerTube<any>(INNERTUBE_SEARCH_URL, { query }),
    ytmusicSearchFiltered(query, 24, 'videos').catch(() => []),
  ]);
  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs;
  const sections = tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

  for (const sec of sections) {
    const shelf = sec?.musicShelfRenderer;
    const card = sec?.musicCardShelfRenderer;
    if (card?.title?.runs?.[0]) {
      const ent = extractTwoRowOrListEntity({ musicResponsiveListItemRenderer: card }, 'artist');
      if (ent) {
        if (ent.type === 'artist') empty.artists.push(ent);
        else if (ent.type === 'album') empty.albums.push(ent);
      }
    }
    if (!shelf?.contents) continue;
    const catTitle = String(shelf.title?.runs?.[0]?.text || '').toLowerCase();
    for (const item of shelf.contents) {
      if (catTitle.includes('album')) {
        const al = extractTwoRowOrListEntity(item, 'album');
        if (al) empty.albums.push(al);
      } else if (catTitle.includes('artist')) {
        const ar = extractTwoRowOrListEntity(item, 'artist');
        if (ar) empty.artists.push(ar);
      } else if (catTitle.includes('playlist')) {
        const pl = extractTwoRowOrListEntity(item, 'playlist');
        if (pl) empty.playlists.push(pl);
      } else {
        const song = extractMusicResponsiveListItem(item);
        if (song && !empty.songs.some((s) => s.id === song.id)) empty.songs.push(song);
      }
    }
  }

  if (empty.songs.length === 0) {
    empty.songs = await ytmusicSearchSongs(query, 15);
  }
  const seen = new Set(empty.songs.map((song) => song.id));
  for (const video of videos) {
    if (!seen.has(video.id)) { empty.songs.push(video); seen.add(video.id); }
  }
  return empty;
}

const watchNextRequests = new Map<string, Promise<any[]>>();
const trackDurations = new Map<string, number>();

function rememberTrackDuration(videoId: string, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (trackDurations.size >= 256) trackDurations.delete(trackDurations.keys().next().value!);
  trackDurations.set(videoId, duration);
  return duration;
}

function getWatchNextTracks(videoId: string): Promise<any[]> {
  const account = getActiveYouTubeAccount();
  const key = `${account?.id || 'anonymous'}:${videoId}`;
  const pending = watchNextRequests.get(key);
  if (pending) return pending;
  const task = innerTubePost<any>('next', {
    videoId,
    playlistId: `RDAMVM${videoId}`,
    isAudioOnly: true,
  }, account).then(data => {
    const tracks = walkAnyRenderers(data?.contents, 'playlistPanelVideoRenderer');
    const exact = tracks.find(item => item.videoId === videoId);
    rememberTrackDuration(videoId, parseDurationText(exact?.lengthText?.simpleText || exact?.lengthText?.runs?.[0]?.text));
    return tracks;
  }).catch(() => []).finally(() => watchNextRequests.delete(key));
  watchNextRequests.set(key, task);
  return task;
}

export async function ytmusicGetTrackDuration(videoId: string): Promise<number> {
  if (!/^[\w-]{11}$/.test(videoId)) return 0;
  const known = trackDurations.get(videoId);
  if (known) return known;
  await Promise.race([getWatchNextTracks(videoId), delay(3200, undefined, { ref: false })]);
  return trackDurations.get(videoId) || 0;
}

export async function ytmusicGetSuggested(videoId: string): Promise<YTMusicTrack[]> {
  if (!videoId) return [];
  const results = await getWatchNextTracks(videoId);
  const tracks: YTMusicTrack[] = [];
  for (const r of results) {
    if (!r?.videoId || r.videoId === videoId) continue;
    tracks.push({
      id: r.videoId,
      title: r.title?.runs?.map((x: any) => x.text).join('') || 'Unknown',
      artist: r.longBylineText?.runs?.filter((x: any) => !x.text.includes('•'))[0]?.text || 'YouTube Music',
      duration: parseDurationText(r.lengthText?.runs?.[0]?.text),
      thumbnail: bestThumb(r.thumbnail?.thumbnails),
      source: 'youtube',
    });
  }
  return tracks.slice(0, 20);
}

export async function ytmusicGetAlbum(browseId: string) {
  try {
    const yt = await getInnertube();
    if (!yt) return null;
    const album: any = await yt.music.getAlbum(browseId);
    const title = album?.header?.title?.text || 'Album';
    const subtitle = album?.header?.subtitle?.text || '';
    const thumb = album?.header?.thumbnail?.contents?.[0]?.url || '';
    const tracks: YTMusicTrack[] = (album?.contents || [])
      .map((item: any) => ({
        id: item.id || '',
        title: item.title || 'Unknown',
        artist: item.artists?.map((a: any) => a.name).join(', ') || subtitle.split('•')[0]?.trim() || 'Unknown',
        artistId: item.artists?.[0]?.channel_id,
        album: title,
        albumId: browseId,
        duration: item.duration?.seconds || 0,
        thumbnail: thumb || bestThumb(item.thumbnail?.contents),
        source: 'youtube' as const,
      }))
      .filter((t: YTMusicTrack) => Boolean(t.id));

    return { id: browseId, title, subtitle, thumbnail: thumb, tracks };
  } catch (err) {
    console.warn('[YTM] getAlbum error:', err);
    return null;
  }
}

export async function ytmusicGetArtist(browseId: string) {
  try {
    const yt = await getInnertube();
    if (!yt) return null;
    const artist: any = await yt.music.getArtist(browseId);
    const name = artist?.header?.title?.text || 'Artist';
    const description = artist?.header?.description?.text || '';
    const subscribers = artist?.header?.subscription_button?.subscribe_count?.text || '';
    const thumb = bestThumb(artist?.header?.thumbnail?.contents);

    const topSongs: YTMusicTrack[] = [];
    const albums: YTMusicEntity[] = [];
    const singles: YTMusicEntity[] = [];
    const relatedArtists: YTMusicEntity[] = [];

    for (const sec of artist?.sections || []) {
      const hTitle = String(sec?.header?.title?.text || '').toLowerCase();
      const contents = sec?.contents || [];
      if (hTitle.includes('song')) {
        for (const item of contents) {
          if (item.id) {
            topSongs.push({
              id: item.id,
              title: item.title || 'Unknown',
              artist: item.artists?.map((a: any) => a.name).join(', ') || name,
              artistId: browseId,
              album: item.album?.name,
              albumId: item.album?.id,
              duration: item.duration?.seconds || 0,
              thumbnail: bestThumb(item.thumbnail?.contents),
              source: 'youtube',
            });
          }
        }
      } else if (hTitle.includes('album')) {
        for (const item of contents) {
          if (item.id) {
            albums.push({
              id: item.id,
              title: item.title || 'Album',
              subtitle: item.year || 'Album',
              thumbnail: bestThumb(item.thumbnail?.contents),
              type: 'album',
            });
          }
        }
      } else if (hTitle.includes('single')) {
        for (const item of contents) {
          if (item.id) {
            singles.push({
              id: item.id,
              title: item.title || 'Single',
              subtitle: item.year || 'Single',
              thumbnail: bestThumb(item.thumbnail?.contents),
              type: 'album',
            });
          }
        }
      } else if (hTitle.includes('like') || hTitle.includes('similar') || hTitle.includes('artist')) {
        for (const item of contents) {
          if (item.id) {
            relatedArtists.push({
              id: item.id,
              title: item.name || item.title || 'Artist',
              subtitle: item.subscribers || 'Artist',
              thumbnail: bestThumb(item.thumbnail?.contents),
              type: 'artist',
            });
          }
        }
      }
    }
    return { id: browseId, name, description, subscribers, thumbnail: thumb, topSongs, albums, singles, relatedArtists };
  } catch (err) {
    console.warn('[YTM] getArtist error:', err);
    return null;
  }
}

export async function ytmusicGetPlaylist(browseId: string) {
  try {
    const yt = await getInnertube();
    if (!yt) return null;
    const cleanId = browseId.replace(/^VL/, '');
    const pl: any = await yt.music.getPlaylist(cleanId);
    const title = pl?.header?.title?.text || 'Playlist';
    const subtitle = pl?.header?.subtitle?.text || '';
    const thumb = bestThumb(pl?.header?.thumbnail?.contents);
    const tracks: YTMusicTrack[] = (pl?.items || [])
      .map((item: any) => ({
        id: item.id || '',
        title: item.title || 'Unknown',
        artist: item.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
        artistId: item.artists?.[0]?.channel_id,
        album: item.album?.name,
        albumId: item.album?.id,
        duration: item.duration?.seconds || 0,
        thumbnail: bestThumb(item.thumbnail?.contents),
        source: 'youtube' as const,
      }))
      .filter((t: YTMusicTrack) => Boolean(t.id));

    return { id: browseId, title, subtitle, thumbnail: thumb, tracks };
  } catch (err) {
    console.warn('[YTM] getPlaylist error:', err);
    return null;
  }
}

export async function ytmusicGetExplore() {
  const sections: Array<{
    title: string;
    items: Array<{
      id: string;
      title: string;
      subtitle: string;
      thumbnail?: string;
      type: 'song' | 'album' | 'playlist';
      duration?: number;
    }>;
  }> = [];

  try {
    const yt = await getInnertube();
    if (yt) {
      const explore: any = await yt.music.getExplore();
      for (const sec of explore?.sections || []) {
        const items = (sec?.contents || [])
          .map((c: any) => ({
            id: c.id || c.endpoint?.payload?.browseId || '',
            title: c.title || c.name || 'Mix',
            subtitle: c.subtitle?.text || c.artists?.map((a: any) => a.name).join(', ') || '',
            thumbnail: bestThumb(c.thumbnail?.contents),
            type: (c.item_type === 'song' ? 'song' : c.item_type === 'album' ? 'album' : 'playlist') as
              | 'song'
              | 'album'
              | 'playlist',
            duration: c.duration?.seconds || 0,
          }))
          .filter((x: any) => Boolean(x.id));
        if (items.length > 0) {
          sections.push({
            title: sec?.header?.title?.text || 'Explore',
            items,
          });
        }
      }
    }
  } catch {
    /* fallback to direct InnerTube curated sections below */
  }

  if (sections.length < 2) {
    try {
      const [newAlbums, globalCharts, viralHits, electronicMix] = await Promise.all([
        ytmusicSearchAll('new album releases 2026 hits').catch(() => null),
        ytmusicSearchSongs(CATEGORY_QUERIES.global_top, 16).catch(() => []),
        ytmusicSearchSongs(CATEGORY_QUERIES.trending, 16).catch(() => []),
        ytmusicSearchSongs(CATEGORY_QUERIES.phonk, 12).catch(() => []),
      ]);

      if (newAlbums?.albums && newAlbums.albums.length > 0) {
        sections.push({
          title: 'Новые альбомы и релизы',
          items: newAlbums.albums.slice(0, 12).map((a: any) => ({
            id: a.id,
            title: a.title,
            subtitle: a.subtitle || 'Album',
            thumbnail: a.thumbnail,
            type: 'album' as const,
          })),
        });
      }

      if (globalCharts.length > 0) {
        sections.push({
          title: 'Мировой Чарт • Top Global Hits',
          items: globalCharts.map((t) => ({
            id: t.id,
            title: t.title,
            subtitle: t.artist,
            thumbnail: t.thumbnail,
            type: 'song' as const,
            duration: t.duration,
          })),
        });
      }

      if (viralHits.length > 0) {
        sections.push({
          title: 'В тренде сейчас • Hot & Viral',
          items: viralHits.map((t) => ({
            id: t.id,
            title: t.title,
            subtitle: t.artist,
            thumbnail: t.thumbnail,
            type: 'song' as const,
            duration: t.duration,
          })),
        });
      }

      if (newAlbums?.playlists && newAlbums.playlists.length > 0) {
        sections.push({
          title: 'Редакционные плейлисты и миксы',
          items: newAlbums.playlists.slice(0, 12).map((p: any) => ({
            id: p.id,
            title: p.title,
            subtitle: p.subtitle || 'Playlist',
            thumbnail: p.thumbnail,
            type: 'playlist' as const,
          })),
        });
      }

      if (electronicMix.length > 0) {
        sections.push({
          title: 'Phonk, Electronic & Night Drive',
          items: electronicMix.map((t) => ({
            id: t.id,
            title: t.title,
            subtitle: t.artist,
            thumbnail: t.thumbnail,
            type: 'song' as const,
            duration: t.duration,
          })),
        });
      }
    } catch {
      /* ignore */
    }
  }

  return { sections };
}

const pendingStreams = new Map<string, Promise<string | null>>();

function fetchDirectInnerTubeStream(videoId: string, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'ANDROID_VR',
          clientVersion: '1.61.48',
          deviceMake: 'Oculus',
          deviceModel: 'Quest 3',
          osName: 'Android',
          osVersion: '12',
          androidSdkVersion: 32,
          hl: 'en',
          gl: 'US',
        },
      },
    });

    const req = https.request(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Android; Mobile; rv:109.0) Gecko/114.0 Firefox/114.0',
          'X-YouTube-Client-Name': '28',
          'X-YouTube-Client-Version': '1.61.48',
          'Content-Length': Buffer.byteLength(postData),
        },
        signal,
        timeout: 4000,
      },
      (res) => {
        let body = '';
        res.on('error', () => resolve(null));
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            rememberTrackDuration(videoId, Number(data.videoDetails?.lengthSeconds));
            if (data.playabilityStatus?.status !== 'OK') return resolve(null);
            const formats = (data.streamingData?.adaptiveFormats || []).filter(
              (f: any) => f.mimeType && f.mimeType.includes('audio/') && f.url
            );
            if (formats.length === 0) return resolve(null);
            formats.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
            const best = formats.find((f: any) => f.itag === 251) || formats.find((f: any) => f.itag === 140) || formats[0];
            resolve(best?.url || null);
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

function extractStreamCandidates(videoId: string, signal: AbortSignal, fast: boolean): Promise<string[]> {
  return new Promise((resolve) => {
    let cacheDir: string;
    try {
      cacheDir = path.join(app.getPath('userData'), 'yt-dlp-cache');
    } catch {
      cacheDir = '/tmp/archivetune-ytdlp-cache';
    }
    // Playback consumes direct HTTPS audio formats only.
    execFile('yt-dlp', [
      '--cache-dir', cacheDir, '-J', '--no-playlist',
      '--extractor-args', fast
        ? 'youtube:player_client=visionos;skip=hls,dash'
        : 'youtube:skip=hls,dash',
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
      { signal, timeout: fast ? 5500 : 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        try {
          const info = JSON.parse(stdout);
          rememberTrackDuration(videoId, Number(info.duration));
          const formats = (info.formats || []).filter((f: any) =>
            f.vcodec === 'none' && f.acodec !== 'none' && f.protocol === 'https' && f.url);
          formats.sort((a: any, b: any) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
          resolve(formats.map((f: any) => f.url));
        } catch { resolve([]); }
      });
  });
}

function isStreamAccessible(url: string, signal: AbortSignal, redirects = 2): Promise<boolean> {
  const probeSignal = redirects === 2 ? AbortSignal.any([signal, AbortSignal.timeout(2500)]) : signal;
  return new Promise((resolve) => {
    const req = https.get(url, { signal: probeSignal, headers: { Range: 'bytes=0-0' } }, (res) => {
      const { statusCode = 0, headers } = res;
      res.destroy();
      if (redirects > 0 && statusCode >= 300 && statusCode < 400 && headers.location) {
        try {
          const target = new URL(headers.location, url);
          if (target.protocol === 'https:' && target.hostname.endsWith('.googlevideo.com')) {
            resolve(isStreamAccessible(target.href, probeSignal, redirects - 1));
            return;
          }
        } catch { /* malformed redirect */ }
      }
      resolve(statusCode === 200 || statusCode === 206);
    });
    req.on('error', () => resolve(false));
  });
}

async function resolveExtractedStream(videoId: string, signal: AbortSignal, fast: boolean): Promise<string | null> {
  const candidates = await extractStreamCandidates(videoId, signal, fast);
  for (let i = 0; i < candidates.length && !signal.aborted; i += 4) {
    const batch = candidates.slice(i, i + 4);
    const url = await firstAvailable(batch.map(async (candidate, index) => {
      // Give the highest-quality format a head start without waiting on a slow CDN.
      if (index > 0) await delay(120, undefined, { signal });
      return await isStreamAccessible(candidate, signal) ? candidate : null;
    }));
    if (url) return url;
  }
  return null;
}

function firstAvailable(attempts: Promise<string | null>[]): Promise<string | null> {
  return Promise.any(attempts.map(async attempt => {
    const url = await attempt;
    if (url) return url;
    throw new Error('Stream unavailable');
  })).catch(() => null);
}

export function ytmusicGetStreamUrl(videoId: string): Promise<string | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return Promise.resolve(null);
  const cached = streamUrlCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);
  const pending = pendingStreams.get(videoId);
  if (pending) return pending;
  const task = (async () => {
    const controller = new AbortController();
    const { signal } = controller;
    try {
      const direct = fetchDirectInnerTubeStream(videoId, signal)
        .then(url => url && isStreamAccessible(url, signal).then(ok => ok ? url : null))
        .catch(() => null);
      // Most tracks need only the direct lookup or the single-client extractor.
      const fast = Promise.race([direct, delay(200, null, { signal })])
        .then(url => url ?? resolveExtractedStream(videoId, signal, true))
        .catch(() => null);
      const fallback = Promise.race([fast, delay(1800, null, { signal })])
        .then(url => !signal.aborted && !url ? resolveExtractedStream(videoId, signal, false) : url);
      const url = await firstAvailable([direct, fast, fallback]);
      if (url) {
        if (streamUrlCache.size >= 150) streamUrlCache.delete(streamUrlCache.keys().next().value!);
        streamUrlCache.set(videoId, { url, expiresAt: Date.now() + 20 * 60 * 1000 });
      }
      return url;
    } finally {
      controller.abort();
    }
  })().finally(() => pendingStreams.delete(videoId));
  pendingStreams.set(videoId, task);
  return task;
}

const CATEGORY_QUERIES: Record<string, string> = {
  trending: 'top trending music hits 2026 official audio',
  global_top: 'global top 50 hits billboard official audio',
  phonk: 'brazilian phonk drift phonk bass boosted hits',
  electronic: 'electronic dance house club hits 2026',
  pop: 'pop hits chart toppers official audio',
  lofi: 'lofi hip hop chill beats study',
  rock: 'rock hits alternative classics',
  hiphop: 'hip hop rap new releases official audio',
};

const CURATED_SPOTIFY_TRENDING: PersistedTrack[] = [
  {
    id: 'spotify:2plbrEY59IikOBgBGLjaoe',
    title: 'Die With A Smile',
    artist: 'Lady Gaga, Bruno Mars',
    album: 'Die With A Smile',
    duration: 252,
    thumbnail: 'https://i.scdn.co/image/ab67616d0000b27382ea2e9e1f4a9192bb3d843d',
    source: 'spotify',
  },
  {
    id: 'spotify:6dOtVTDdiauQNBQEDOtlAB',
    title: 'BIRDS OF A FEATHER',
    artist: 'Billie Eilish',
    album: 'HIT ME HARD AND SOFT',
    duration: 194,
    thumbnail: 'https://i.scdn.co/image/ab67616d0000b27371d62ea7ea8a5be92d3c1f62',
    source: 'spotify',
  },
  {
    id: 'spotify:2qSkIjg1o9h3YT9RAgYN75',
    title: 'Espresso',
    artist: 'Sabrina Carpenter',
    album: "Short n' Sweet",
    duration: 175,
    thumbnail: 'https://i.scdn.co/image/ab67616d0000b273659cd4673230913b3918e0d5',
    source: 'spotify',
  },
  {
    id: 'spotify:7MXVkk9YMctZqd1Srtv4MB',
    title: 'Starboy',
    artist: 'The Weeknd, Daft Punk',
    album: 'Starboy',
    duration: 230,
    thumbnail: 'https://i.scdn.co/image/ab67616d0000b2734718e2b124f79258be7bc452',
    source: 'spotify',
  },
  {
    id: 'spotify:0VjIjW4GlUZAMYd2vXMi3b',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    duration: 200,
    thumbnail: 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36',
    source: 'spotify',
  },
  {
    id: 'spotify:2QjOHCTQ1Jl3zawyYOpxh6',
    title: 'Sweater Weather',
    artist: 'The Neighbourhood',
    album: 'I Love You.',
    duration: 240,
    thumbnail: 'https://i.scdn.co/image/ab67616d0000b2738265a73628ee3269b6a38612',
    source: 'spotify',
  },
];

function walkAnyRenderers(node: any, targetKey: string, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) walkAnyRenderers(item, targetKey, out);
    return out;
  }
  if (node[targetKey]) out.push(node[targetKey]);
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') walkAnyRenderers(v, targetKey, out);
  }
  return out;
}

function shuffleCopy<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

let homeFeedCache: { key: string; data: any; fetchedAt: number } | null = null;

export async function ytmusicGetPersonalizedHome(chipParams?: string, forceRefresh = false) {
  const cacheKey = `${getActiveYouTubeAccount()?.id || 'anonymous'}:${chipParams || 'default'}`;
  if (
    !forceRefresh &&
    homeFeedCache &&
    homeFeedCache.key === cacheKey &&
    Date.now() - homeFeedCache.fetchedAt < 3 * 60 * 1000
  ) {
    return homeFeedCache.data;
  }

  const db = getDb();
  const likedAll = db.likedSongs || [];
  const likedYt = likedAll.filter((t) => t.source === 'youtube' || (!t.id.startsWith('spotify:') && !t.id.startsWith('soundcloud:')));
  const likedSp = likedAll.filter((t) => t.source === 'spotify' || t.id.startsWith('spotify:'));
  const localHist = db.history || [];

  // 1. Fetch FEmusic_home + FEmusic_history in parallel
  const [homeJson, ytmHistory] = await Promise.all([
    innerTubePost<any>(
      'browse',
      chipParams ? { browseId: 'FEmusic_home', params: chipParams } : { browseId: 'FEmusic_home' }
    ).catch(() => null),
    fetchYouTubeHistory().catch(() => [] as PersistedTrack[]),
  ]);

  // 2. Parse Mood/Activity Chips from FEmusic_home
  const rawChips = walkAnyRenderers(homeJson, 'chipCloudChipRenderer');
  const chips: Array<{ title: string; params: string }> = [];
  for (const c of rawChips) {
    const title = (c.text?.runs || []).map((r: any) => r.text).join('').trim();
    const params = c.navigationEndpoint?.browseEndpoint?.params;
    if (title && params && !chips.some((x) => x.title === title)) {
      chips.push({ title, params });
    }
  }

  // 3. Parse shelves from FEmusic_home (+ optional 1 continuation page)
  const ytmShelves: Array<{
    title: string;
    items: Array<{
      id: string;
      title: string;
      subtitle: string;
      thumbnail: string;
      type: 'song' | 'playlist' | 'album' | 'artist';
      duration?: number;
      source: 'youtube';
    }>;
  }> = [];

  const parseHomeShelves = (jsonNode: any) => {
    const shelves: any[] = [];
    const collectShelves = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(collectShelves); return; }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'musicCarouselShelfRenderer' || key === 'musicShelfRenderer') shelves.push(value);
        collectShelves(value);
      }
    };
    collectShelves(jsonNode);
    for (const s of shelves) {
      const title =
        (s.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs || s.title?.runs || [])
          .map((r: any) => r.text)
          .join('')
          .trim() || 'Рекомендации YouTube Music';
      const shelfItems: Array<{
        id: string;
        title: string;
        subtitle: string;
        thumbnail: string;
        type: 'song' | 'playlist' | 'album' | 'artist';
        duration?: number;
        source: 'youtube';
      }> = [];

      for (const content of s.contents || []) {
        if (content.musicResponsiveListItemRenderer) {
          const song = extractMusicResponsiveListItem(content);
          if (song && !shelfItems.some((x) => x.id === song.id)) {
            shelfItems.push({
              id: song.id,
              title: song.title,
              subtitle: song.artist,
              thumbnail: song.thumbnail,
              type: 'song',
              duration: song.duration,
              source: 'youtube',
            });
          }
        } else if (content.musicTwoRowItemRenderer) {
          const r = content.musicTwoRowItemRenderer;
          const itemTitle = (r.title?.runs || []).map((x: any) => x.text).join('').trim();
          const itemSub = (r.subtitle?.runs || []).map((x: any) => x.text).join('').trim();
          const thumb = bestThumb(r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails);
          const watchVideoId =
            r.navigationEndpoint?.watchEndpoint?.videoId ||
            r.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
              ?.playNavigationEndpoint?.watchEndpoint?.videoId;
          const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
          const watchPlaylistId =
            r.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
              ?.playNavigationEndpoint?.watchPlaylistEndpoint?.playlistId;

          if (watchVideoId) {
            shelfItems.push({
              id: watchVideoId,
              title: itemTitle || 'Track',
              subtitle: youtubeArtistName(itemSub) || 'YouTube Music',
              thumbnail: thumb,
              type: 'song',
              duration: readMusicSubtitle(r.subtitle?.runs || []).map(parseDurationText).find(Boolean),
              source: 'youtube',
            });
          } else if (browseId || watchPlaylistId) {
            const rawId = browseId || watchPlaylistId;
            if (rawId === 'VLLM' || rawId === 'LM') continue;
            const pageType =
              r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
                ?.browseEndpointContextMusicConfig?.pageType || '';
            const type: 'playlist' | 'album' | 'artist' = pageType.includes('ALBUM')
              ? 'album'
              : pageType.includes('ARTIST')
                ? 'artist'
                : 'playlist';
            shelfItems.push({
              id: String(rawId).replace(/^VL/, ''),
              title: itemTitle || 'Mix',
              subtitle: itemSub || 'YouTube Music',
              thumbnail: thumb,
              type,
              source: 'youtube',
            });
          }
        }
      }

      if (shelfItems.length > 0) {
        ytmShelves.push({ title, items: shelfItems });
      }
    }
  };

  if (homeJson) {
    parseHomeShelves(homeJson);
  }

  // Use YouTube's actual home shelves and their order for recommendations.
  // If there are no playable songs on the page, offer radio seeded by recent YouTube history.
  const quickPicks: PersistedTrack[] = [];
  const seenQuick = new Set<string>();
  for (const shelf of ytmShelves) {
    for (const item of shelf.items) {
      if (item.type !== 'song' || !item.id || seenQuick.has(item.id)) continue;
      seenQuick.add(item.id);
      quickPicks.push({ id: item.id, title: item.title, artist: item.subtitle, thumbnail: item.thumbnail, duration: item.duration || 0, source: 'youtube' });
    }
  }
  let quickPicksSource: 'youtube_home' | 'history_radio' | 'unavailable' = quickPicks.length ? 'youtube_home' : 'unavailable';
  if (!quickPicks.length && !chipParams) {
    const seeds = [...ytmHistory, ...localHist, ...likedYt].filter((t, i, all) =>
      t.source === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(t.id) && all.findIndex(x => x.id === t.id) === i
    ).slice(0, 3);
    const batches = await Promise.all(seeds.map(seed => ytmusicGetSuggested(seed.id).catch(() => [] as YTMusicTrack[])));
    for (const batch of batches) for (const track of batch) {
      if (!track.id || seenQuick.has(track.id)) continue;
      seenQuick.add(track.id); quickPicks.push({ ...track, source: 'youtube' });
      if (quickPicks.length >= 24) break;
    }
    if (quickPicks.length) quickPicksSource = 'history_radio';
  }
  const mixPages: Array<{ id: string; title: string; subtitle: string; source: 'youtube' | 'spotify'; tracks: PersistedTrack[] }> = [];

  // 6. Keep Listening (YTM History + Local History) & Forgotten Favorites (Liked Songs from both platforms)
  const keepListening = [...localHist, ...ytmHistory]
    .filter((t, idx, arr) => t.id && arr.findIndex((x) => x.id === t.id) === idx)
    .slice(0, 80);

  const forgottenFavorites = shuffleCopy(likedAll).slice(0, 18);

  // 7. Spotify Daily Discover Playlists & Spotify Trending / Top For You
  const userPlaylists = db.playlists || [];
  const spotifyPlaylists = userPlaylists
    .filter((p) => p.source === 'spotify')
    .sort((a, b) => {
      const aPers = /daily mix|дейли микс|discover weekly|release radar|on repeat/i.test(a.name) ? -1 : 0;
      const bPers = /daily mix|дейли микс|discover weekly|release radar|on repeat/i.test(b.name) ? -1 : 0;
      return aPers - bPers;
    })
    .slice(0, 12);

  const spotifyTracks = likedSp.slice(0, 16);

  const result = {
    chips,
    quickPicks: quickPicks.slice(0, 80),
    recentYoutube: ytmHistory.filter((t) => t.source === 'youtube' && t.id).slice(0, 100),
    quickPicksSource,
    youtubeAccountConnected: Boolean(getActiveYouTubeAccount()),
    mixPages,
    keepListening,
    forgottenFavorites,
    spotifyPlaylists,
    spotifyTracks,
    ytmShelves,
  };

  homeFeedCache = { key: cacheKey, data: result, fetchedAt: Date.now() };
  return result;
}

export function setupYTMusicIPC(): void {
  ipcMain.handle('ytmusic:search', async (_e, query: string) => ytmusicSearchSongs(query, 24));
  ipcMain.handle('ytmusic:searchAll', async (_e, query: string) => ytmusicSearchAll(query));
  ipcMain.handle('ytmusic:getSuggestions', async (_e, query: string) => {
    if (!query.trim()) return [];
    const data = await postInnerTube<any>(INNERTUBE_SUGGEST_URL, { input: query });
    const contents = data?.contents?.[0]?.searchSuggestionsSectionRenderer?.contents || [];
    return contents
      .map((c: any) => c?.searchSuggestionRenderer?.suggestion?.runs?.map((r: any) => r.text).join(''))
      .filter(Boolean);
  });
  ipcMain.handle('ytmusic:getStreamUrl', async (_e, videoId: string) => ytmusicGetStreamUrl(videoId));
  ipcMain.handle('ytmusic:getCategory', async (_e, category: string, forceRefresh = false) => {
    const cached = categoryCache.get(category);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CATEGORY_CACHE_TTL_MS) {
      return cached.tracks;
    }
    const tracks = await ytmusicSearchSongs(CATEGORY_QUERIES[category] || `${category} music hits`, 25);
    if (tracks.length > 0) {
      if (categoryCache.size >= 50) categoryCache.delete(categoryCache.keys().next().value!);
      categoryCache.set(category, { tracks, fetchedAt: Date.now() });
    }
    return tracks;
  });
  ipcMain.handle('ytmusic:getHome', async (_e, chipParams?: string, forceRefresh = false) =>
    ytmusicGetPersonalizedHome(chipParams, forceRefresh)
  );
  ipcMain.handle('ytmusic:getExplore', async () => ytmusicGetExplore());
  ipcMain.handle('ytmusic:getSuggested', async (_e, videoId: string) => ytmusicGetSuggested(videoId));
  ipcMain.handle('ytmusic:getAlbum', async (_e, albumId: string) => ytmusicGetAlbum(albumId));
  ipcMain.handle('ytmusic:getArtist', async (_e, artistId: string) => ytmusicGetArtist(artistId));
  ipcMain.handle('ytmusic:getPlaylist', async (_e, playlistId: string) => ytmusicGetPlaylist(playlistId));
}
