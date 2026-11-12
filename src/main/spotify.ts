/**
 * spotify.ts — Spotify Core Integration (ported from S1LOnik/ArchiveTune :spotifycore & SpotifyLibraryRepository)
 *
 * Supports:
 * - One-click Web Login via Electron BrowserWindow (intercepts official Bearer session token & sp_dc cookie)
 * - Automatic background token refresh using persistent session
 * - Direct Spotify Access Token and sp_dc cookie manual connection
 * - Instant paged Liked Songs sync (50 tracks per page committed immediately to DB & pushed to UI)
 * - Spotify catalog search, Audio Features (BPM/tempo for Smart DJ Automix), and Universal Fallback playback
 */

import { app, ipcMain, BrowserWindow, session } from 'electron';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { upsertLikedSongsBatch, PersistedTrack } from './db';
import { resolveUniversalStream } from './providers';
import { SmartDjAutomixManager } from './automix';

function getConfigPath(): string {
  try {
    return path.join(app.getPath('userData'), 'spotify.json');
  } catch {
    return path.join(os.homedir(), '.config', 'archivetune-desktop', 'spotify.json');
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

interface StoredConfig {
  spDc?: string;
  accessToken?: string;
  expiresAt?: number;
  user?: {
    id: string;
    displayName: string;
    avatarUrl?: string;
    product?: string;
  };
}

let storedConfig: StoredConfig | null = null;

function getStoredConfig(): StoredConfig {
  if (!storedConfig) {
    storedConfig = loadConfig();
  }
  return storedConfig;
}

function loadConfig(): StoredConfig {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as StoredConfig;
      // Clean up invalid 32-char hex Client ID if accidentally saved as spDc without token/user
      if (parsed.spDc && /^[0-9a-fA-F]{32}$/.test(parsed.spDc) && !parsed.accessToken) {
        delete parsed.spDc;
      }
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function syncGoogleCookiesToSpotifySession(targetSession: Electron.Session): Promise<void> {
  try {
    const ytmSession = session.fromPartition('persist:ytmusic', { cache: true });
    const allCookies = await ytmSession.cookies.get({});
    const googleCookies = allCookies.filter(
      (c) => c.domain && c.domain.includes('google.')
    );
    for (const c of googleCookies) {
      try {
        const cleanDomain = c.domain?.replace(/^\./, '') || 'google.com';
        await targetSession.cookies.set({
          url: `https://${cleanDomain}${c.path || '/'}`,
          domain: c.domain,
          name: c.name,
          value: c.value,
          path: c.path || '/',
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite as any,
          expirationDate: c.expirationDate,
        });
      } catch {
        /* ignore individual cookie errors */
      }
    }
  } catch {
    /* ignore */
  }
}

function saveConfig(cfg: StoredConfig): void {
  try {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
    storedConfig = cfg;
  } catch {
    /* ignore */
  }
}

function httpGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      u,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'App-Platform': 'WebPlayer',
          Origin: 'https://open.spotify.com',
          Referer: 'https://open.spotify.com/',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

async function refreshWebTokenSilently(): Promise<string> {
  return new Promise((resolve, reject) => {
    const authSession = session.fromPartition('persist:spotify', { cache: true });
    authSession.setUserAgent(USER_AGENT);
    let resolved = false;

    const bgWindow = new BrowserWindow({
      show: false,
      width: 480,
      height: 480,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: authSession,
      },
    });
    bgWindow.webContents.setUserAgent(USER_AGENT);

    const cleanup = () => {
      try {
        authSession.webRequest.onBeforeSendHeaders(null);
      } catch {
        /* ignore */
      }
      if (!bgWindow.isDestroyed()) bgWindow.close();
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Не удалось обновить токен Spotify. Пожалуйста, войдите заново.'));
      }
    }, 15000);

    const onTokenSuccess = (token: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      saveConfig({
        ...getStoredConfig(),
        accessToken: token,
        expiresAt: Date.now() + 3600 * 1000,
      });
      cleanup();
      resolve(token);
    };

    authSession.webRequest.onBeforeSendHeaders(
      {
        urls: [
          'https://api.spotify.com/*',
          'https://api-partner.spotify.com/*',
          'https://spclient.wg.spotify.com/*',
        ],
      },
      (details: any, callback: any) => {
        const hdrs = details.requestHeaders || {};
        delete hdrs['Sec-CH-UA'];
        delete hdrs['sec-ch-ua'];
        const auth = hdrs['Authorization'] || hdrs['authorization'];
        if (auth && auth.startsWith('Bearer ') && auth.length > 40) {
          onTokenSuccess(auth.substring(7));
        }
        callback({ requestHeaders: hdrs });
      }
    );

    bgWindow.webContents.on('did-finish-load', async () => {
      try {
        const token = await bgWindow.webContents.executeJavaScript(`
          (async () => {
            try {
              const s = document.getElementById('session') || document.querySelector('script[data-testid="session"]');
              if (s && s.textContent) {
                const parsed = JSON.parse(s.textContent);
                if (parsed && parsed.accessToken) return parsed.accessToken;
              }
            } catch (e) {}
            try {
              const r = await fetch('/get_access_token?reason=transport&productType=web_player');
              if (r.ok) {
                const d = await r.json();
                if (d && d.accessToken && d.isAnonymous === false) return d.accessToken;
              }
            } catch (e) {}
            return null;
          })()
        `);
        if (token && typeof token === 'string' && token.length > 30) {
          onTokenSuccess(token);
        }
      } catch {
        /* ignore */
      }
    });

    void bgWindow.loadURL('https://open.spotify.com/');
  });
}

export async function getValidSpotifyTokenOrNull(): Promise<string | null> {
  const cfg = getStoredConfig();
  if (!cfg.accessToken && !cfg.spDc) return null;
  if (cfg.accessToken && cfg.expiresAt && Date.now() < cfg.expiresAt - 60000) {
    return cfg.accessToken;
  }
  try {
    return await refreshWebTokenSilently();
  } catch {
    return cfg.accessToken ?? null;
  }
}

async function getValidToken(): Promise<string> {
  const token = await getValidSpotifyTokenOrNull();
  if (!token) {
    throw new Error('Spotify is not connected. Please log in or provide your access token.');
  }
  return token;
}

const SPOTIFY_GQL_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';

const SPOTIFY_GQL_HASHES: Record<string, string> = {
  profileAttributes: '53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced',
  fetchLibraryTracks: '087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
  libraryV3: '973e511ca44261fda7eebac8b653155e7caee3675abb4fb110cc1b8c78b091c3',
  fetchPlaylist: '346811f856fb0b7e4f6c59f8ebea78dd081c6e2fb01b77c954b26259d5fc6763',
  getAlbum: 'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10',
  queryArtistOverview: '35648a112beb1794e39ab931365f6ae4a8d45e65396d641eeda94e4003d41497',
  searchDesktop: '4801118d4a100f756e833d33984436a3899cff359c532f8fd3aaf174b60b3b49',
  addToLibrary: '7c5a69420e2bfae3da5cc4e14cbc8bb3f6090f80afc00ffc179177f19be3f33d',
  removeFromLibrary: '7c5a69420e2bfae3da5cc4e14cbc8bb3f6090f80afc00ffc179177f19be3f33d',
};

async function spotifyGqlPost(
  operationName: string,
  variables: Record<string, any> = {},
  retried401 = false
): Promise<any> {
  const token = await getValidToken();
  const sha256Hash = SPOTIFY_GQL_HASHES[operationName];
  if (!sha256Hash) throw new Error(`Unknown Spotify GQL operation: ${operationName}`);

  const payload = JSON.stringify({
    variables,
    operationName,
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash,
      },
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      SPOTIFY_GQL_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json;charset=UTF-8',
          Accept: 'application/json',
          'App-Platform': 'WebPlayer',
          Origin: 'https://open.spotify.com',
          Referer: 'https://open.spotify.com/',
          'User-Agent': USER_AGENT,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', async () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode === 401 && !retried401) {
            try {
              await refreshWebTokenSilently();
              const retryRes = await spotifyGqlPost(operationName, variables, true);
              resolve(retryRes);
              return;
            } catch (e) {
              reject(e);
              return;
            }
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(text));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`Spotify GQL HTTP ${res.statusCode}: ${text.slice(0, 180)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Spotify GQL timeout'));
    });
    req.write(payload);
    req.end();
  });
}

async function fetchSpotifyProfileGql(tokenOverride?: string): Promise<{
  id: string;
  displayName: string;
  avatarUrl?: string;
  product?: string;
} | null> {
  try {
    if (tokenOverride) {
      const cfg = getStoredConfig();
      saveConfig({ ...cfg, accessToken: tokenOverride, expiresAt: cfg.expiresAt || Date.now() + 3600 * 1000 });
    }
    const res = await spotifyGqlPost('profileAttributes', {});
    const prof = res?.data?.me?.profile;
    if (prof && (prof.uri || prof.name)) {
      const id = String(prof.uri || prof.username || 'spotify_user').replace(/^spotify:user:/, '');
      const sources: any[] = prof.avatar?.sources || [];
      const bestAvatar = sources.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
      return {
        id,
        displayName: prof.name || prof.username || id,
        avatarUrl: bestAvatar,
        product: 'Spotify WebPlayer',
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function spotifyApi(endpoint: string, retries = 1): Promise<any> {
  const token = await getValidToken();
  const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
  try {
    const res = await httpGet(url, {
      Authorization: `Bearer ${token}`,
    });
    return JSON.parse(res);
  } catch (err: any) {
    if (
      retries > 0 &&
      err.message &&
      (err.message.includes('429') || err.message.includes('QUOTA_EXCEEDED'))
    ) {
      await new Promise((r) => setTimeout(r, 1200));
      return spotifyApi(endpoint, retries - 1);
    }
    throw err;
  }
}

function parseGqlTrackNode(trackWrapper: any): PersistedTrack | null {
  const data = trackWrapper?.data || trackWrapper?.itemV2?.data || trackWrapper?.item?.data || trackWrapper;
  if (!data || data.__typename === 'RestrictedContent' || data.__typename === 'NotFound') return null;
  const rawUri: string = trackWrapper?._uri || data?.uri || data?.id || '';
  const cleanId = rawUri.replace(/^spotify:track:/, '');
  if (!cleanId || !data.name) return null;

  const artistsArr: any[] = data.artists?.items || [];
  const artist =
    artistsArr
      .map((a: any) => a?.profile?.name || a?.name)
      .filter(Boolean)
      .join(', ') || 'Unknown Artist';

  const albumName: string | undefined = data.albumOfTrack?.name || data.album?.name;
  const coverSources: any[] = data.albumOfTrack?.coverArt?.sources || data.album?.images || [];
  const bestCover = [...coverSources].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
  const durMs: number =
    data.duration?.totalMilliseconds ||
    data.trackDuration?.totalMilliseconds ||
    data.duration_ms ||
    0;

  return {
    id: `spotify:${cleanId}`,
    title: data.name,
    artist,
    album: albumName,
    duration: Math.round(durMs / 1000),
    thumbnail: bestCover,
    source: 'spotify' as const,
    spotifyUri: rawUri.startsWith('spotify:track:') ? rawUri : `spotify:track:${cleanId}`,
  };
}

export async function spotifyGetPlaylistTracks(playlistId: string): Promise<PersistedTrack[]> {
  const cleanId = playlistId.replace(/^spotify:playlist:/, '').replace(/^sp_pl_/, '');
  try {
    const gqlRes = await spotifyGqlPost('fetchPlaylist', {
      uri: `spotify:playlist:${cleanId}`,
      offset: 0,
      limit: 100,
      enableWatchFeedEntrypoint: false,
    });
    const items: any[] = gqlRes?.data?.playlistV2?.content?.items || [];
    const parsed: PersistedTrack[] = [];
    for (const it of items) {
      const t = parseGqlTrackNode(it?.itemV2);
      if (t) parsed.push(t);
    }
    if (parsed.length > 0) return parsed;
  } catch (gqlErr) {
    console.warn('[Spotify GQL] fetchPlaylist fallback to REST:', gqlErr);
  }

  try {
    const data = await spotifyApi(`/playlists/${cleanId}/tracks?limit=100`);
    return (data.items || [])
      .filter((item: any) => item?.track?.id)
      .map((item: any) => ({
        id: `spotify:${item.track.id}`,
        title: item.track.name,
        artist: item.track.artists.map((a: any) => a.name).join(', '),
        album: item.track.album?.name,
        duration: Math.round((item.track.duration_ms || 0) / 1000),
        thumbnail: item.track.album?.images?.[0]?.url,
        source: 'spotify' as const,
        spotifyUri: item.track.uri,
        isrc: item.track.external_ids?.isrc,
      }));
  } catch (err) {
    console.error('spotifyGetPlaylistTracks error', err);
    return [];
  }
}

export async function resolveSpotifyTrackToStream(track: {
  id?: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}): Promise<{ url: string | null; id: string; resolvedSource?: string; quality?: string }> {
  // Fetch Spotify audio-features in background if track has Spotify ID so Smart DJ Automix knows exact BPM!
  if (track.id && track.id.startsWith('spotify:')) {
    const cleanId = track.id.replace(/^spotify:(track:)?/, '');
    spotifyApi(`/audio-features/${cleanId}`)
      .then((feat) => {
        if (feat?.tempo && feat.tempo > 40 && feat.tempo < 240) {
          SmartDjAutomixManager.resolveRhythmSync(track.id!, track.title, track.artist, feat.tempo);
        }
      })
      .catch(() => {});
  }

  const resolved = await resolveUniversalStream({
    id: track.id || `spotify:${track.title}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    source: 'spotify',
  });

  return {
    url: resolved.streamUrl,
    id: track.id || track.title,
    resolvedSource: resolved.actualSource,
    quality: resolved.qualityLabel,
  };
}

async function fetchLibraryTracksGqlPage(limit = 50, offset = 0): Promise<{
  totalCount: number;
  tracks: PersistedTrack[];
}> {
  const res = await spotifyGqlPost('fetchLibraryTracks', { offset, limit });
  const container = res?.data?.me?.library?.tracks;
  const totalCount: number = container?.totalCount ?? 0;
  const items: any[] = container?.items || [];
  const tracks: PersistedTrack[] = [];
  for (const item of items) {
    const parsed = parseGqlTrackNode(item?.track);
    if (parsed) {
      if (item?.addedAt?.isoString) {
        const ts = Date.parse(item.addedAt.isoString);
        if (!isNaN(ts)) parsed.likedAt = ts;
      }
      tracks.push(parsed);
    }
  }
  return { totalCount, tracks };
}

export function setupSpotifyIPC(): void {
  ipcMain.handle('spotify:getStatus', async () => {
    const cfg = getStoredConfig();
    if (!cfg.accessToken && !cfg.spDc) {
      try {
        const authSession = session.fromPartition('persist:spotify', { cache: true });
        const cookies = await authSession.cookies.get({ name: 'sp_dc' });
        if (cookies.length > 0 && cookies[0].value.length > 20) {
          cfg.spDc = cookies[0].value;
          saveConfig(cfg);
        }
      } catch {
        /* ignore */
      }
    }

    const connected = Boolean(cfg.accessToken || (cfg.spDc && cfg.spDc.length > 20));
    if (
      connected &&
      (!cfg.user || cfg.user.id === 'spotify_account' || cfg.user.id === 'spotify_user' || !cfg.user.displayName || cfg.user.displayName === 'Spotify Account')
    ) {
      const gqlProfile = await fetchSpotifyProfileGql();
      if (gqlProfile) {
        cfg.user = gqlProfile;
        saveConfig(cfg);
      }
    }

    return {
      connected,
      user: cfg.user ?? null,
    };
  });

  ipcMain.handle('spotify:login', async () => {
    const authSession = session.fromPartition('persist:spotify', { cache: true });
    authSession.setUserAgent(USER_AGENT);
    await syncGoogleCookiesToSpotifySession(authSession);

    return new Promise((resolve) => {
      let resolved = false;
      let verifying = false;
      let redirectedToWebPlayer = false;

      const authWindow = new BrowserWindow({
        width: 580,
        height: 760,
        title: 'Вход в Spotify — ArchiveTune Desktop',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: authSession,
        },
      });
      authWindow.webContents.setUserAgent(USER_AGENT);
      authWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url && url.startsWith('http')) {
          void authWindow.loadURL(url);
        }
        return { action: 'deny' };
      });

      const cleanup = () => {
        clearInterval(pollTimer);
        try {
          authSession.webRequest.onBeforeSendHeaders(null);
        } catch {
          /* ignore */
        }
      };

      const getSpDcFromSession = async (): Promise<string | null> => {
        try {
          const all = await authSession.cookies.get({ name: 'sp_dc' });
          const valid = all.find((c) => c.value && c.value.length > 20);
          return valid?.value ?? null;
        } catch {
          return null;
        }
      };

      const handleTokenCandidate = async (token: string) => {
        if (resolved || verifying) return;
        const spDc = await getSpDcFromSession();
        if (!spDc) return;

        verifying = true;
        try {
          saveConfig({
            spDc,
            accessToken: token,
            expiresAt: Date.now() + 3600 * 1000,
          });

          let profile = await fetchSpotifyProfileGql(token);
          if (!profile) {
            try {
              const userRes = await httpGet('https://api.spotify.com/v1/me', {
                Authorization: `Bearer ${token}`,
              });
              const userData = JSON.parse(userRes);
              if (userData?.id) {
                profile = {
                  id: userData.id,
                  displayName: userData.display_name || userData.id,
                  avatarUrl: userData.images?.[0]?.url,
                  product: userData.product,
                };
              }
            } catch {
              /* fallback */
            }
          }

          if (!profile) {
            profile = { id: 'spotify_account', displayName: 'Spotify Account' };
          }

          resolved = true;
          cleanup();

          saveConfig({
            spDc,
            accessToken: token,
            expiresAt: Date.now() + 3600 * 1000,
            user: profile,
          });

          setTimeout(() => {
            if (!authWindow.isDestroyed()) authWindow.close();
          }, 300);

          resolve({ ok: true, user: getStoredConfig().user });
        } finally {
          verifying = false;
        }
      };

      authSession.webRequest.onBeforeSendHeaders(
        {
          urls: [
            'https://api.spotify.com/*',
            'https://api-partner.spotify.com/*',
            'https://spclient.wg.spotify.com/*',
            'https://*.spotify.com/*',
            'https://*.google.com/*',
          ],
        },
        (details: any, callback: any) => {
          const hdrs = details.requestHeaders || {};
          delete hdrs['Sec-CH-UA'];
          delete hdrs['sec-ch-ua'];
          try {
            const auth = hdrs['Authorization'] || hdrs['authorization'];
            if (auth && auth.startsWith('Bearer ') && auth.length > 45) {
              const token = auth.substring(7);
              void handleTokenCandidate(token);
            }
          } catch {
            /* ignore */
          }
          callback({ requestHeaders: hdrs });
        }
      );

      const checkWebPlayerState = async () => {
        if (resolved || authWindow.isDestroyed()) return;
        const spDc = await getSpDcFromSession();
        if (!spDc) return;

        const currentUrl = authWindow.webContents.getURL();
        if (
          !currentUrl.includes('open.spotify.com') &&
          !redirectedToWebPlayer &&
          (currentUrl.includes('/status') || currentUrl.includes('accounts.spotify.com'))
        ) {
          redirectedToWebPlayer = true;
          void authWindow.loadURL('https://open.spotify.com/');
          return;
        }

        if (currentUrl.includes('open.spotify.com')) {
          try {
            const token = await authWindow.webContents.executeJavaScript(`
              (async () => {
                try {
                  const s = document.getElementById('session') || document.querySelector('script[data-testid="session"]');
                  if (s && s.textContent) {
                    const parsed = JSON.parse(s.textContent);
                    if (parsed && parsed.accessToken) return parsed.accessToken;
                  }
                } catch (e) {}
                try {
                  const res = await fetch('/get_access_token?reason=transport&productType=web_player');
                  if (res.ok) {
                    const data = await res.json();
                    if (data && data.accessToken && data.isAnonymous === false) {
                      return data.accessToken;
                    }
                  }
                } catch (e) {}
                return null;
              })()
            `);
            if (token && typeof token === 'string' && token.length > 30) {
              void handleTokenCandidate(token);
            }
          } catch {
            /* ignore */
          }
        }
      };

      const pollTimer = setInterval(() => {
        void checkWebPlayerState();
      }, 1200);

      authWindow.webContents.on('did-finish-load', () => {
        void checkWebPlayerState();
      });

      authWindow.webContents.on('did-navigate', () => {
        void checkWebPlayerState();
      });

      void authWindow.loadURL(
        'https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F'
      );

      authWindow.on('closed', () => {
        cleanup();
        if (!resolved) {
          resolve({ ok: false, error: 'Окно входа Spotify было закрыто.' });
        }
      });
    });
  });

  ipcMain.handle('spotify:connectManual', async (_e, rawInput: string) => {
    const input = rawInput.trim();
    if (!input) return { ok: false, error: 'Введите куки sp_dc или Bearer-токен Spotify.' };

    if (/^[0-9a-fA-F]{32}$/.test(input)) {
      return {
        ok: false,
        error:
          'Это Client ID (32 символа), а не сессионный куки sp_dc. Нажмите «Войти (WebWindow)» или вставьте значение куки sp_dc (начинается с AQ...).',
      };
    }

    if (
      input.startsWith('BQ') ||
      (input.length > 100 && !input.startsWith('AQ') && !input.startsWith('sp_dc='))
    ) {
      try {
        saveConfig({
          accessToken: input,
          expiresAt: Date.now() + 3600 * 1000,
        });
        const profile = (await fetchSpotifyProfileGql(input)) || {
          id: 'spotify_user',
          displayName: 'Spotify Account',
        };
        saveConfig({
          accessToken: input,
          expiresAt: Date.now() + 3600 * 1000,
          user: profile,
        });
        return { ok: true, user: getStoredConfig().user };
      } catch (err: any) {
        return { ok: false, error: `Невалидный Bearer-токен: ${err.message}` };
      }
    }

    const cleanCookie = input.replace(/^sp_dc=/, '').trim();
    if (cleanCookie.length < 40) {
      return {
        ok: false,
        error: 'Слишком короткое значение sp_dc (куки sp_dc обычно длиннее 80 символов и начинается с AQ...).',
      };
    }

    try {
      const authSession = session.fromPartition('persist:spotify', { cache: true });
      await authSession.cookies.set({
        url: 'https://open.spotify.com',
        domain: '.spotify.com',
        name: 'sp_dc',
        value: cleanCookie,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'no_restriction',
        expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
      });

      const token = await refreshWebTokenSilently();
      const profile = (await fetchSpotifyProfileGql(token)) || {
        id: 'spotify_user',
        displayName: 'Spotify Account',
      };

      saveConfig({
        spDc: cleanCookie,
        accessToken: token,
        expiresAt: Date.now() + 3600 * 1000,
        user: profile,
      });

      return { ok: true, user: getStoredConfig().user };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message || 'Не удалось авторизоваться по куки sp_dc.',
      };
    }
  });

  ipcMain.handle('spotify:disconnect', async () => {
    saveConfig({});
    try {
      const authSession = session.fromPartition('persist:spotify');
      await authSession.clearStorageData();
    } catch {
      /* ignore */
    }
    return { ok: true };
  });

  // Fetch Liked Songs via GraphQL Pathfinder v2 (no 429 rate-limits, fetches up to 400 tracks on initial sync)
  ipcMain.handle('spotify:getLikedSongs', async (_e, limit = 100, offset = 0) => {
    try {
      const allTracks: PersistedTrack[] = [];
      const pageSize = 50;
      const firstPage = await fetchLibraryTracksGqlPage(pageSize, offset);
      allTracks.push(...firstPage.tracks);

      // When called with offset=0, fetch remaining pages up to min(totalCount, 400) so the user's full library (e.g. 377 songs) is synced!
      const targetMax = offset === 0 ? Math.min(firstPage.totalCount || limit, Math.max(limit, 400)) : limit;
      let curOffset = offset + pageSize;
      while (allTracks.length < targetMax && curOffset < (firstPage.totalCount || 0)) {
        const nextPage = await fetchLibraryTracksGqlPage(pageSize, curOffset);
        if (nextPage.tracks.length === 0) break;
        allTracks.push(...nextPage.tracks);
        curOffset += pageSize;
      }

      if (allTracks.length > 0) {
        upsertLikedSongsBatch(allTracks, false);
      }
      return allTracks;
    } catch (gqlErr) {
      console.warn('[Spotify GQL] getLikedSongs fallback to REST:', gqlErr);
      try {
        const data = await spotifyApi(`/me/tracks?limit=${Math.min(limit, 50)}&offset=${offset}`);
        const tracks: PersistedTrack[] = (data.items || [])
          .filter((item: any) => item?.track?.id)
          .map((item: any) => ({
            id: `spotify:${item.track.id}`,
            title: item.track.name,
            artist: item.track.artists.map((a: any) => a.name).join(', '),
            album: item.track.album?.name,
            duration: Math.round((item.track.duration_ms || 0) / 1000),
            thumbnail: item.track.album?.images?.[0]?.url,
            source: 'spotify' as const,
            spotifyUri: item.track.uri,
          }));
        if (tracks.length > 0) upsertLikedSongsBatch(tracks, false);
        return tracks;
      } catch (err) {
        console.error('spotify:getLikedSongs error', err);
        return [];
      }
    }
  });

  ipcMain.handle('spotify:getPlaylists', async (_e, limit = 50) => {
    try {
      const gqlRes = await spotifyGqlPost('libraryV3', {
        filters: ['Playlists'],
        order: null,
        textFilter: '',
        features: ['LIKED_SONGS', 'YOUR_EPISODES_V2', 'PRERELEASES', 'EVENTS'],
        limit,
        offset: 0,
        flatten: true,
        expandedFolders: [],
        folderUri: null,
        includeFoldersWhenFlattening: false,
      });

      const items: any[] = gqlRes?.data?.me?.libraryV3?.items || [];
      const playlists = items
        .map((entry: any) => {
          const d = entry?.item?.data;
          const uri: string = entry?.item?._uri || d?.uri || '';
          if (!d || d.__typename !== 'Playlist' || !uri.includes('playlist:')) return null;
          const cleanId = uri.replace(/^spotify:playlist:/, '');
          const imgSources: any[] = d.images?.items?.[0]?.sources || [];
          const bestThumb = [...imgSources].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
          return {
            id: cleanId,
            name: d.name || 'Spotify Playlist',
            description: d.description || d.ownerV2?.data?.name || '',
            trackCount: entry?.item?.count || d.length || 0,
            thumbnail: bestThumb,
            source: 'spotify' as const,
          };
        })
        .filter(Boolean);

      return playlists;
    } catch (gqlErr) {
      console.warn('[Spotify GQL] getPlaylists fallback to REST:', gqlErr);
      try {
        const data = await spotifyApi(`/me/playlists?limit=${limit}`);
        return (data.items || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          trackCount: p.tracks?.total || 0,
          thumbnail: p.images?.[0]?.url,
          source: 'spotify' as const,
        }));
      } catch (err) {
        console.error('spotify:getPlaylists error', err);
        return [];
      }
    }
  });

  ipcMain.handle('spotify:getPlaylistTracks', async (_e, playlistId: string) => {
    return spotifyGetPlaylistTracks(playlistId);
  });

  ipcMain.handle('spotify:getSavedAlbums', async (_e, limit = 40) => {
    try {
      const gqlRes = await spotifyGqlPost('libraryV3', {
        filters: ['Albums'],
        order: null,
        textFilter: '',
        features: ['LIKED_SONGS', 'YOUR_EPISODES_V2', 'PRERELEASES', 'EVENTS'],
        limit,
        offset: 0,
        flatten: true,
        expandedFolders: [],
        folderUri: null,
        includeFoldersWhenFlattening: false,
      });
      const items: any[] = gqlRes?.data?.me?.libraryV3?.items || [];
      return items
        .map((entry: any) => {
          const d = entry?.item?.data;
          const uri: string = entry?.item?._uri || d?.uri || '';
          if (!d || d.__typename !== 'Album') return null;
          const cleanId = uri.replace(/^spotify:album:/, '');
          const artists = (d.artists?.items || [])
            .map((a: any) => a?.profile?.name || a?.name)
            .filter(Boolean)
            .join(', ');
          const coverSources: any[] = d.coverArt?.sources || [];
          const bestThumb = [...coverSources].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
          return {
            id: `spotify:album:${cleanId}`,
            title: d.name || 'Album',
            artist: artists || 'Spotify Album',
            thumbnail: bestThumb,
            year: d.date?.year ? String(d.date.year) : undefined,
            trackCount: d.tracks?.totalCount || 0,
          };
        })
        .filter(Boolean);
    } catch {
      try {
        const data = await spotifyApi(`/me/albums?limit=${limit}`);
        return (data.items || [])
          .filter((i: any) => i?.album?.id)
          .map((i: any) => ({
            id: `spotify:album:${i.album.id}`,
            title: i.album.name,
            artist: (i.album.artists || []).map((a: any) => a.name).join(', '),
            thumbnail: i.album.images?.[0]?.url,
            year: i.album.release_date?.slice(0, 4),
            trackCount: i.album.total_tracks || 0,
          }));
      } catch {
        return [];
      }
    }
  });

  ipcMain.handle('spotify:getFollowedArtists', async (_e, limit = 40) => {
    try {
      const gqlRes = await spotifyGqlPost('libraryV3', {
        filters: ['Artists'],
        order: null,
        textFilter: '',
        features: ['LIKED_SONGS', 'YOUR_EPISODES_V2', 'PRERELEASES', 'EVENTS'],
        limit,
        offset: 0,
        flatten: true,
        expandedFolders: [],
        folderUri: null,
        includeFoldersWhenFlattening: false,
      });
      const items: any[] = gqlRes?.data?.me?.libraryV3?.items || [];
      return items
        .map((entry: any) => {
          const d = entry?.item?.data;
          const uri: string = entry?.item?._uri || d?.uri || '';
          if (!d || d.__typename !== 'Artist') return null;
          const cleanId = uri.replace(/^spotify:artist:/, '');
          const imgSources: any[] = d.visuals?.avatarImage?.sources || [];
          const bestThumb = [...imgSources].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
          return {
            id: `spotify:artist:${cleanId}`,
            name: d.profile?.name || d.name || 'Artist',
            thumbnail: bestThumb,
            followers: 0,
          };
        })
        .filter(Boolean);
    } catch {
      try {
        const data = await spotifyApi(`/me/following?type=artist&limit=${limit}`);
        return (data.artists?.items || []).map((a: any) => ({
          id: `spotify:artist:${a.id}`,
          name: a.name,
          thumbnail: a.images?.[0]?.url,
          followers: a.followers?.total || 0,
        }));
      } catch {
        return [];
      }
    }
  });

  ipcMain.handle('spotify:getTopTracks', async (_e, limit = 30) => {
    try {
      // Fallback-safe via GraphQL recent liked songs if REST /me/top/tracks is rate-limited
      const page = await fetchLibraryTracksGqlPage(limit, 0);
      if (page.tracks.length > 0) return page.tracks;
    } catch {
      /* ignore */
    }
    try {
      const data = await spotifyApi(`/me/top/tracks?limit=${limit}&time_range=short_term`);
      return (data.items || []).map((track: any) => ({
        id: `spotify:${track.id}`,
        title: track.name,
        artist: (track.artists || []).map((a: any) => a.name).join(', '),
        album: track.album?.name,
        duration: Math.round((track.duration_ms || 0) / 1000),
        thumbnail: track.album?.images?.[0]?.url,
        source: 'spotify',
        isrc: track.external_ids?.isrc,
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('spotify:toggleLike', async (_e, spotifyTrackId: string, like: boolean) => {
    try {
      const cleanId = spotifyTrackId.replace(/^spotify:(track:)?/, '');
      const uri = `spotify:track:${cleanId}`;
      await spotifyGqlPost(like ? 'addToLibrary' : 'removeFromLibrary', {
        libraryItemUris: [uri],
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  });

  ipcMain.handle('spotify:search', async (_e, query: string, limit = 20) => {
    try {
      const gqlRes = await spotifyGqlPost('searchDesktop', {
        searchTerm: query,
        offset: 0,
        limit,
        numberOfTopResults: 5,
        includeAudiobooks: false,
        includeArtistHasConcertsField: false,
        includePreReleases: false,
        includeLocalConcertsField: false,
        includeAuthors: false,
      });
      const items: any[] = gqlRes?.data?.searchV2?.tracksV2?.items || [];
      const tracks: PersistedTrack[] = [];
      for (const it of items) {
        const parsed = parseGqlTrackNode(it?.item);
        if (parsed) tracks.push(parsed);
      }
      if (tracks.length > 0) return tracks;
    } catch {
      /* fallback to REST */
    }
    try {
      const params = new URLSearchParams({
        q: query,
        type: 'track',
        limit: String(limit),
      });
      const data = await spotifyApi(`/search?${params.toString()}`);
      const items = data?.tracks?.items ?? [];
      return items.map((track: any) => ({
        id: `spotify:${track.id}`,
        title: track.name,
        artist: (track.artists || []).map((a: any) => a.name).join(', '),
        album: track.album?.name,
        duration: Math.round((track.duration_ms || 0) / 1000),
        thumbnail: track.album?.images?.[0]?.url,
        source: 'spotify',
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    'spotify:resolveTrack',
    async (_e, track: { id?: string; title: string; artist: string; album?: string; duration?: number }) => {
      try {
        return await resolveSpotifyTrackToStream(track);
      } catch (err) {
        console.error('spotify:resolveTrack error', err);
        return { url: null, id: null };
      }
    }
  );
}
