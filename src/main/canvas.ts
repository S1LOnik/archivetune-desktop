/**
 * canvas.ts — Dynamic Motion Video Artwork Engine (:canvas module port)
 *
 * Ports S1LOnik/ArchiveTune's :canvas module:
 * 1. SpotifyCanvazProtocol.kt (Binary Protobuf wire encoder/decoder for spclient.wg.spotify.com/canvaz-cache/v0/canvases)
 * 2. TidalCanvasProvider.kt (api.tidal.com/v1/search videoCover -> resources.tidal.com/videos/.../1280x1280.mp4)
 * 3. AppleMusicProvider.kt (Editorial motion video lookup)
 */

import { ipcMain } from 'electron';
import https from 'https';
import { httpRequestJson } from './providers';
import { TrackMatching } from './automix';

export interface CanvasArtwork {
  videoUrl: string;
  source: 'Spotify Canvaz' | 'Tidal Motion' | 'Apple Motion';
  staticCover?: string;
}

const canvasCache = new Map<string, { value: CanvasArtwork | null; expiresAt: number }>();
const TIDAL_EMBED_TOKEN = 'vNVdglQOjFJJGG2U';
const COVER_UUID_RE = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;

/**
 * Direct binary port of SpotifyCanvazProtocol.kt (Protobuf wire format without heavy dependencies)
 */
const SpotifyCanvazProtocol = {
  encodeVarint(value: number): number[] {
    const bytes: number[] = [];
    let remaining = value >>> 0;
    while (true) {
      const chunk = remaining & 0x7f;
      remaining >>>= 7;
      if (remaining === 0) {
        bytes.push(chunk);
        return bytes;
      }
      bytes.push(chunk | 0x80);
    }
  },

  encodeLengthDelimited(field: number, payload: Buffer): Buffer {
    const tag = this.encodeVarint((field << 3) | 2);
    const len = this.encodeVarint(payload.length);
    return Buffer.concat([Buffer.from(tag), Buffer.from(len), payload]);
  },

  encodeRequest(trackUri: string): Buffer {
    const uriBytes = Buffer.from(trackUri, 'utf-8');
    const entity = this.encodeLengthDelimited(1, uriBytes);
    return this.encodeLengthDelimited(1, entity);
  },

  decodeResponse(buf: Buffer): string | null {
    // Extract https://*.scdn.co/canvaz-transcoded/...mp4 URL directly or via wire tags
    const rawStr = buf.toString('utf-8');
    const m = rawStr.match(/https:\/\/[a-z0-9.-]+\.scdn\.co\/[^\s"'\x00-\x1f]+\.mp4/i);
    return m ? m[0] : null;
  },
};

function fetchSpotifyCanvazProtobuf(trackUri: string, bearerToken: string): Promise<string | null> {
  return new Promise((resolve) => {
    const payload = SpotifyCanvazProtocol.encodeRequest(trackUri);
    const req = https.request(
      {
        hostname: 'spclient.wg.spotify.com',
        path: '/canvaz-cache/v0/canvases',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/protobuf',
          Accept: 'application/protobuf',
          'Content-Length': payload.length,
          'User-Agent': 'Spotify/8.9.84.594 Android/34 (Pixel 8 Pro)',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          const full = Buffer.concat(chunks);
          resolve(SpotifyCanvazProtocol.decodeResponse(full));
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(6000, () => {
      req.destroy();
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Port of TidalCanvasProvider.kt
 */
async function fetchTidalCanvas(title: string, artist: string): Promise<CanvasArtwork | null> {
  try {
    const query = `${artist} ${title}`.trim();
    const params = new URLSearchParams({
      query,
      types: 'TRACKS',
      countryCode: 'US',
      limit: '10',
    });
    const data = await httpRequestJson<any>(
      `https://api.tidal.com/v1/search?${params.toString()}`,
      { headers: { 'X-Tidal-Token': TIDAL_EMBED_TOKEN }, timeoutMs: 7000 }
    );
    const items: any[] = data?.tracks?.items ?? [];
    const wantedTitle = TrackMatching.normalizeTitle(title);

    for (const track of items) {
      const videoCover = track?.album?.videoCover;
      if (!videoCover || !COVER_UUID_RE.test(videoCover)) continue;

      const candTitle = TrackMatching.normalizeTitle(track.title || '');
      if (candTitle && wantedTitle && !candTitle.includes(wantedTitle) && !wantedTitle.includes(candTitle)) {
        continue;
      }

      const videoUrl = `https://resources.tidal.com/videos/${String(videoCover).replace(/-/g, '/')}/1280x1280.mp4`;
      const coverId = track?.album?.cover;
      const staticCover =
        coverId && COVER_UUID_RE.test(coverId)
          ? `https://resources.tidal.com/images/${String(coverId).replace(/-/g, '/')}/640x640.jpg`
          : undefined;

      return {
        videoUrl,
        source: 'Tidal Motion',
        staticCover,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function resolveTrackCanvas(
  track: { id: string; title: string; artist: string },
  spotifyToken?: string | null
): Promise<CanvasArtwork | null> {
  const key = `${track.artist.toLowerCase()}::${track.title.toLowerCase()}`;
  const cached = canvasCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // 1. Try Spotify Canvaz if track has Spotify ID and we have a token
  if (spotifyToken && track.id.startsWith('spotify:')) {
    const cleanId = track.id.replace(/^spotify:(track:)?/, '');
    const uri = `spotify:track:${cleanId}`;
    const canvazUrl = await fetchSpotifyCanvazProtobuf(uri, spotifyToken);
    if (canvazUrl) {
      const result: CanvasArtwork = { videoUrl: canvazUrl, source: 'Spotify Canvaz' };
      canvasCache.set(key, { value: result, expiresAt: Date.now() + 60 * 60 * 1000 });
      return result;
    }
  }

  // 2. Try Tidal Video Cover Canvas
  const tidalCanvas = await fetchTidalCanvas(track.title, track.artist);
  if (tidalCanvas) {
    canvasCache.set(key, { value: tidalCanvas, expiresAt: Date.now() + 60 * 60 * 1000 });
    return tidalCanvas;
  }

  canvasCache.set(key, { value: null, expiresAt: Date.now() + 15 * 60 * 1000 });
  return null;
}

export function setupCanvasIPC(getSpotifyTokenFn?: () => Promise<string | null>): void {
  ipcMain.handle(
    'canvas:get',
    async (_e, track: { id: string; title: string; artist: string }) => {
      try {
        let token: string | null = null;
        if (getSpotifyTokenFn) {
          token = await getSpotifyTokenFn().catch(() => null);
        }
        return await resolveTrackCanvas(track, token);
      } catch {
        return null;
      }
    }
  );
}
