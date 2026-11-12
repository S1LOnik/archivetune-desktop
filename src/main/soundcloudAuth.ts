/**
 * soundcloudAuth.ts — SoundCloud OAuth WebView Login, Dynamic Client ID Scraper & Personal Library
 *
 * Ports S1LOnik/ArchiveTune's `SoundCloudLoginSheet.kt` + `SoundCloudAudioProvider.kt`:
 * - In-app `BrowserWindow` (`persist:soundcloud`) loading `https://soundcloud.com/signin`
 * - Sweeps cookies, localStorage, sessionStorage, window.SC.connector.oauth_token,
 *   and `Authorization: OAuth <token>` network headers
 * - Dynamically resolves & caches `client_id` from `soundcloud.com` JS bundles
 * - Provides personal Library APIs: profile (`/me`), Liked Tracks, User Playlists,
 *   Following Stream feed, Genre Charts, and bidirectional track likes.
 */

import { BrowserWindow, ipcMain, session } from 'electron';
import https from 'https';
import { getDb, saveDbImmediate, PersistedTrack } from './db';

const SC_API = 'https://api-v2.soundcloud.com';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

let cachedClientId: { id: string; fetchedAt: number } | null = null;

function scHttpGet(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/html, */*',
          ...headers,
        },
        timeout: 9000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function scHttpPostEmpty(
  url: string,
  method: 'PUT' | 'DELETE',
  headers: Record<string, string>
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method,
        headers: { 'User-Agent': UA, ...headers },
        timeout: 8000,
      },
      (res) => {
        res.resume();
        resolve(Boolean(res.statusCode && res.statusCode < 400));
      }
    );
    req.on('error', () => resolve(false));
    req.end();
  });
}

export async function getSoundCloudClientId(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && cachedClientId && Date.now() - cachedClientId.fetchedAt < 3600_000) {
    return cachedClientId.id;
  }
  const html = await scHttpGet('https://soundcloud.com');
  if (!html) return cachedClientId?.id ?? null;

  const scripts = [...html.matchAll(/https:\/\/[a-z0-9-]+\.sndcdn\.com\/assets\/[^"']+\.js/g)].map(
    (m) => m[0]
  );
  for (const scriptUrl of scripts.slice(-6).reverse()) {
    const js = await scHttpGet(scriptUrl);
    if (!js) continue;
    const m = js.match(/client_id\s*:\s*["']([A-Za-z0-9]{20,})["']/);
    if (m?.[1]) {
      cachedClientId = { id: m[1], fetchedAt: Date.now() };
      return m[1];
    }
  }
  return cachedClientId?.id ?? null;
}

export function getStoredSoundCloudToken(): string {
  const db = getDb();
  return db.soundcloudAuth.oauthToken || db.settings.soundcloudToken || '';
}

function buildScAuthHeaders(oauthToken?: string): Record<string, string> {
  const token = oauthToken || getStoredSoundCloudToken();
  if (!token) return {};
  return {
    Authorization: token.startsWith('OAuth ') ? token : `OAuth ${token}`,
  };
}

function normalizeScArtwork(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace('-large.', '-t500x500.');
}

function mapScTrack(t: any): PersistedTrack | null {
  if (!t || !t.id || !t.title) return null;
  const durationSec = Math.round(Number(t.duration || 0) / 1000);
  return {
    id: `soundcloud:${t.id}`,
    title: String(t.title),
    artist: String(t.user?.username || t.publisher_metadata?.artist || 'SoundCloud Artist'),
    album: t.publisher_metadata?.album_title || undefined,
    duration: durationSec,
    thumbnail: normalizeScArtwork(t.artwork_url || t.user?.avatar_url),
    source: 'soundcloud',
    path: t.permalink_url,
  };
}

function extractTokenFromDump(dumpText: string): string | null {
  if (!dumpText) return null;
  const patterns = [
    /oauth_token[=:]"?([0-9]+-[0-9]+-[A-Za-z0-9_-]{15,})"?/i,
    /access_token[=:]"?([0-9]+-[0-9]+-[A-Za-z0-9_-]{15,})"?/i,
    /OAuth\s+([0-9]+-[0-9]+-[A-Za-z0-9_-]{15,})/i,
  ];
  for (const re of patterns) {
    const m = dumpText.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function fetchScMe(oauthToken: string): Promise<any | null> {
  const clientId = await getSoundCloudClientId();
  const qp = clientId ? `?client_id=${encodeURIComponent(clientId)}` : '';
  const raw = await scHttpGet(`${SC_API}/me${qp}`, buildScAuthHeaders(oauthToken));
  if (!raw) return null;
  try {
    const json = JSON.parse(raw);
    return json?.id ? json : null;
  } catch {
    return null;
  }
}

async function syncGoogleCookiesToScSession(targetSession: Electron.Session): Promise<void> {
  try {
    const ytmSession = session.fromPartition('persist:ytmusic', { cache: true });
    const allCookies = await ytmSession.cookies.get({});
    const googleCookies = allCookies.filter((c) => c.domain && c.domain.includes('google.'));
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
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export function setupSoundCloudAuthIPC(): void {
  ipcMain.handle('soundcloud:getStatus', async () => {
    const db = getDb();
    if (!getStoredSoundCloudToken()) {
      try {
        const authSession = session.fromPartition('persist:soundcloud', { cache: true });
        const cookies = await authSession.cookies.get({ name: 'oauth_token' });
        if (cookies.length > 0 && cookies[0].value.length >= 16) {
          const token = cookies[0].value;
          const user = (await fetchScMe(token)) || {
            id: Date.now(),
            username: 'SoundCloud User',
          };
          db.soundcloudAuth = {
            oauthToken: token,
            scSyncEnabled: true,
            user: {
              id: Number(user.id || Date.now()),
              username: String(user.username || 'SoundCloud User'),
              fullName: user.full_name,
              avatarUrl: user.avatar_url,
              followersCount: user.followers_count,
            },
          };
          db.settings.soundcloudToken = token;
          saveDbImmediate();
        }
      } catch {
        /* ignore */
      }
    }
    return {
      connected: Boolean(getStoredSoundCloudToken()),
      user: db.soundcloudAuth.user,
      scSyncEnabled: db.soundcloudAuth.scSyncEnabled,
    };
  });

  ipcMain.handle('soundcloud:login', async () => {
    const authSession = session.fromPartition('persist:soundcloud', { cache: true });
    authSession.setUserAgent(UA);
    await syncGoogleCookiesToScSession(authSession);

    return new Promise((resolve) => {
      let resolved = false;
      let verifying = false;

      const authWin = new BrowserWindow({
        width: 580,
        height: 760,
        title: 'Вход в SoundCloud — ArchiveTune Desktop',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: authSession,
        },
      });
      authWin.webContents.setUserAgent(UA);
      authWin.webContents.setWindowOpenHandler(({ url }) => {
        if (url && url.startsWith('http')) {
          void authWin.loadURL(url);
        }
        return { action: 'deny' };
      });

      const finishWithToken = async (rawToken: string) => {
        if (resolved || verifying) return;
        const cleanToken = rawToken.replace(/^OAuth\s+/i, '').trim();
        if (cleanToken.length < 16) return;

        verifying = true;
        try {
          const user = (await fetchScMe(cleanToken)) || {
            id: Date.now(),
            username: 'SoundCloud User',
          };

          resolved = true;
          clearInterval(pollTimer);
          const db = getDb();
          db.soundcloudAuth = {
            oauthToken: cleanToken,
            scSyncEnabled: true,
            user: {
              id: Number(user.id || Date.now()),
              username: String(user.username || user.full_name || 'SoundCloud User'),
              fullName: user.full_name,
              avatarUrl: user.avatar_url,
              followersCount: user.followers_count,
            },
          };
          db.settings.soundcloudToken = cleanToken;
          saveDbImmediate();

          if (!authWin.isDestroyed()) authWin.close();
          resolve({ ok: true, user: db.soundcloudAuth.user });
        } finally {
          verifying = false;
        }
      };

      authSession.webRequest.onBeforeSendHeaders(
        {
          urls: [
            'https://api-v2.soundcloud.com/*',
            'https://api.soundcloud.com/*',
            'https://*.soundcloud.com/*',
            'https://*.google.com/*',
          ],
        },
        (details: any, callback: any) => {
          const hdrs = details.requestHeaders || {};
          delete hdrs['Sec-CH-UA'];
          delete hdrs['sec-ch-ua'];
          try {
            const cidMatch = String(details.url || '').match(/[?&]client_id=([A-Za-z0-9]{20,})/);
            if (cidMatch?.[1]) {
              cachedClientId = { id: cidMatch[1], fetchedAt: Date.now() };
            }
            const auth = hdrs['Authorization'] || hdrs['authorization'];
            if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('oauth ')) {
              void finishWithToken(auth.slice(6));
            }
          } catch {
            /* ignore */
          }
          callback({ requestHeaders: hdrs });
        }
      );

      const sweepTokens = async () => {
        if (resolved || verifying || authWin.isDestroyed()) return;
        try {
          const cookies = await authSession.cookies.get({ name: 'oauth_token' });
          const oauthCookie = cookies.find((c) => c.value && c.value.length >= 16);
          if (oauthCookie?.value) {
            await finishWithToken(oauthCookie.value);
            return;
          }

          const dump: string = await authWin.webContents.executeJavaScript(`
            (() => {
              const rows = [document.cookie || ''];
              try {
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i);
                  rows.push(k + '=' + localStorage.getItem(k));
                }
              } catch {}
              try {
                for (let i = 0; i < sessionStorage.length; i++) {
                  const k = sessionStorage.key(i);
                  rows.push(k + '=' + sessionStorage.getItem(k));
                }
              } catch {}
              try {
                if (window.SC && window.SC.connector && window.SC.connector.oauth_token) {
                  rows.push('oauth_token=' + window.SC.connector.oauth_token);
                }
              } catch {}
              return rows.join('\\n');
            })()
          `);
          const found = extractTokenFromDump(dump);
          if (found) await finishWithToken(found);
        } catch {
          /* ignore */
        }
      };

      const pollTimer = setInterval(() => {
        void sweepTokens();
      }, 1200);

      authWin.webContents.on('did-finish-load', () => {
        void sweepTokens();
      });

      authWin.webContents.on('did-navigate', () => {
        void sweepTokens();
      });

      authWin.on('closed', () => {
        clearInterval(pollTimer);
        try {
          authSession.webRequest.onBeforeSendHeaders(null);
        } catch {
          /* ignore */
        }
        if (!resolved) {
          resolved = true;
          resolve({ ok: false, error: 'Окно входа SoundCloud было закрыто.' });
        }
      });

      void authWin.loadURL('https://soundcloud.com/signin');
    });
  });

  ipcMain.handle('soundcloud:connectManual', async (_e, rawToken: string) => {
    const token = rawToken.replace(/^OAuth\s+/i, '').trim();
    if (!token) return { ok: false, error: 'Empty SoundCloud token' };
    const user = await fetchScMe(token);
    if (!user) return { ok: false, error: 'Token rejected by SoundCloud /me API' };

    const db = getDb();
    db.soundcloudAuth = {
      oauthToken: token,
      scSyncEnabled: true,
      user: {
        id: Number(user.id),
        username: String(user.username || 'SoundCloud User'),
        fullName: user.full_name,
        avatarUrl: user.avatar_url,
        followersCount: user.followers_count,
      },
    };
    db.settings.soundcloudToken = token;
    saveDbImmediate();
    return { ok: true, user: db.soundcloudAuth.user };
  });

  ipcMain.handle('soundcloud:logout', async () => {
    const db = getDb();
    db.soundcloudAuth = { oauthToken: '', user: null, scSyncEnabled: false };
    db.settings.soundcloudToken = '';
    saveDbImmediate();
    try {
      await session.fromPartition('persist:soundcloud').clearStorageData();
    } catch {
      /* ignore */
    }
    return { ok: true };
  });

  ipcMain.handle('soundcloud:refreshClientId', async () => {
    const id = await getSoundCloudClientId(true);
    return { ok: Boolean(id), clientId: id };
  });

  ipcMain.handle('soundcloud:getLikedTracks', async (_e, limit = 40) => {
    const token = getStoredSoundCloudToken();
    const user = getDb().soundcloudAuth.user;
    const clientId = await getSoundCloudClientId();
    if (!token || !user || !clientId) return [];

    const raw = await scHttpGet(
      `${SC_API}/users/${user.id}/track_likes?client_id=${encodeURIComponent(clientId)}&limit=${limit}`,
      buildScAuthHeaders(token)
    );
    if (!raw) return [];
    try {
      const json = JSON.parse(raw);
      return (json.collection || [])
        .map((c: any) => mapScTrack(c.track))
        .filter(Boolean);
    } catch {
      return [];
    }
  });

  ipcMain.handle('soundcloud:getPlaylists', async (_e, limit = 25) => {
    const token = getStoredSoundCloudToken();
    const clientId = await getSoundCloudClientId();
    if (!token || !clientId) return [];

    const raw = await scHttpGet(
      `${SC_API}/me/library/all?client_id=${encodeURIComponent(clientId)}&limit=${limit}`,
      buildScAuthHeaders(token)
    );
    if (!raw) return [];
    try {
      const json = JSON.parse(raw);
      const lists: any[] = [];
      for (const item of json.collection || []) {
        const pl = item.playlist || item;
        if (!pl?.id || !pl?.title) continue;
        lists.push({
          id: `soundcloud:playlist:${pl.id}`,
          title: String(pl.title),
          trackCount: Number(pl.track_count || pl.tracks?.length || 0),
          thumbnail: normalizeScArtwork(pl.artwork_url || pl.user?.avatar_url),
          tracks: Array.isArray(pl.tracks)
            ? pl.tracks.map(mapScTrack).filter(Boolean)
            : [],
        });
      }
      return lists;
    } catch {
      return [];
    }
  });

  ipcMain.handle('soundcloud:getFollowingFeed', async (_e, limit = 30) => {
    const token = getStoredSoundCloudToken();
    const clientId = await getSoundCloudClientId();
    if (!token || !clientId) return [];
    const raw = await scHttpGet(
      `${SC_API}/stream?client_id=${encodeURIComponent(clientId)}&limit=${limit}`,
      buildScAuthHeaders(token)
    );
    if (!raw) return [];
    try {
      const json = JSON.parse(raw);
      return (json.collection || [])
        .map((item: any) => mapScTrack(item.track))
        .filter(Boolean);
    } catch {
      return [];
    }
  });

  ipcMain.handle('soundcloud:getGenreCharts', async (_e, genre = 'all-music', limit = 25) => {
    const clientId = await getSoundCloudClientId();
    if (!clientId) return [];
    const tag = genre === 'Trending' ? 'all-music' : genre.toLowerCase();
    const raw = await scHttpGet(
      `${SC_API}/charts?kind=top&genre=${encodeURIComponent(`soundcloud:genres:${tag}`)}&client_id=${encodeURIComponent(clientId)}&limit=${limit}`
    );
    if (!raw) return [];
    try {
      const json = JSON.parse(raw);
      return (json.collection || [])
        .map((c: any) => mapScTrack(c.track))
        .filter(Boolean);
    } catch {
      return [];
    }
  });

  ipcMain.handle('soundcloud:toggleLike', async (_e, scTrackId: string, like: boolean) => {
    const token = getStoredSoundCloudToken();
    const user = getDb().soundcloudAuth.user;
    const clientId = await getSoundCloudClientId();
    if (!token || !user || !clientId) return { ok: false };

    const cleanId = scTrackId.replace(/^soundcloud:/, '');
    const url = `${SC_API}/users/${user.id}/track_likes/${encodeURIComponent(cleanId)}?client_id=${encodeURIComponent(clientId)}`;
    const ok = await scHttpPostEmpty(url, like ? 'PUT' : 'DELETE', buildScAuthHeaders(token));
    return { ok };
  });
}
