/**
 * youtubeAuth.ts — YouTube & YouTube Music Account Authentication + Library Sync
 *
 * Ports S1LOnik/ArchiveTune's `YouTubeLoginRepository.kt` to Desktop:
 * - In-app Google / YouTube Music BrowserWindow (`persist:ytmusic`) login
 * - Intercepts cookies (`SAPISID`, `__Secure-3PAPISID`, `SID`, `HSID`, `SSID`, `APISID`),
 *   `X-Goog-Visitor-Id` (`visitorData`), and `DATASYNC_ID` (Brand Accounts / channels)
 * - Supports multiple saved YouTube accounts (`db.youtubeAuth.savedAccounts`) with instant switch
 * - Signs authenticated InnerTube requests with `Authorization: SAPISIDHASH <ts>_<sha1>`
 * - Syncs & exposes YTM Liked Music (`FEmusic_liked_videos`), Library Playlists (`FEmusic_library_landing`),
 *   Subscriptions, History, and bidirectional Like / Unlike actions.
 */

import { BrowserWindow, ipcMain, session } from 'electron';
import crypto from 'crypto';
import https from 'https';
import {
  getDb,
  saveDbImmediate,
  SavedYouTubeAccount,
  PersistedTrack,
  upsertLikedSongsBatch,
} from './db';

const YTM_ORIGIN = 'https://music.youtube.com';
const YTM_CLIENT_VERSION = '1.20260401.01.00';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

const REQUIRED_AUTH_COOKIES = ['SAPISID', '__Secure-3PAPISID'];

export function extractCookieValue(cookieHeader: string, name: string): string | null {
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === name && v) return v;
  }
  return null;
}

export function hasValidYouTubeCookies(cookieHeader: string): boolean {
  if (!cookieHeader) return false;
  const hasSapisid = REQUIRED_AUTH_COOKIES.some((c) => Boolean(extractCookieValue(cookieHeader, c)));
  const hasSession =
    Boolean(extractCookieValue(cookieHeader, 'LOGIN_INFO')) ||
    Boolean(extractCookieValue(cookieHeader, 'SID')) ||
    Boolean(extractCookieValue(cookieHeader, '__Secure-1PSID')) ||
    Boolean(extractCookieValue(cookieHeader, '__Secure-3PSID'));
  return hasSapisid && hasSession;
}

async function getCleanYouTubeCookieHeader(authSession: Electron.Session): Promise<string> {
  const ytCookies = await authSession.cookies.get({ url: 'https://music.youtube.com' });
  const byName = new Map<string, string>();
  for (const c of ytCookies) {
    if (c.name && c.value) {
      byName.set(c.name, c.value);
    }
  }
  return Array.from(byName.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Computes InnerTube `SAPISIDHASH` header per Google/YouTube specification
 */
export function buildSapisidHash(sapisid: string, origin = YTM_ORIGIN): string {
  const ts = Math.floor(Date.now() / 1000);
  const digest = crypto.createHash('sha1').update(`${ts} ${sapisid} ${origin}`).digest('hex');
  return `SAPISIDHASH ${ts}_${digest}`;
}

export function getActiveYouTubeAccount(): SavedYouTubeAccount | null {
  const db = getDb();
  const activeId = db.youtubeAuth.activeAccountId;
  if (!activeId) return null;
  return db.youtubeAuth.savedAccounts.find((a) => a.id === activeId) ?? null;
}

export function buildAuthenticatedInnerTubeHeaders(
  account?: SavedYouTubeAccount | null
): Record<string, string> {
  const acc = account ?? getActiveYouTubeAccount();
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    Origin: YTM_ORIGIN,
    Referer: `${YTM_ORIGIN}/`,
    'X-YouTube-Client-Name': '67',
    'X-YouTube-Client-Version': YTM_CLIENT_VERSION,
  };

  const cookie = acc?.cookie || getDb().settings.youtubeCookie;
  if (cookie && hasValidYouTubeCookies(cookie)) {
    const sapisid =
      extractCookieValue(cookie, 'SAPISID') ||
      extractCookieValue(cookie, '__Secure-3PAPISID') ||
      extractCookieValue(cookie, 'APISID') ||
      '';
    if (sapisid) {
      headers['Cookie'] = cookie;
      headers['Authorization'] = buildSapisidHash(sapisid, YTM_ORIGIN);
      headers['X-Origin'] = YTM_ORIGIN;
      headers['X-Goog-AuthUser'] = '0';
    }
  }
  if (acc?.visitorData) {
    headers['X-Goog-Visitor-Id'] = acc.visitorData;
  }
  if (acc?.dataSyncId) {
    headers['X-Goog-PageId'] = acc.dataSyncId.split('||')[0];
  }
  return headers;
}

export async function innerTubePost<T = any>(
  endpoint: string,
  payload: Record<string, unknown>,
  account?: SavedYouTubeAccount | null,
  queryParams = ''
): Promise<T | null> {
  const acc = account ?? getActiveYouTubeAccount();
  const headers = buildAuthenticatedInnerTubeHeaders(acc);
  const context: Record<string, any> = {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: YTM_CLIENT_VERSION,
      hl: 'ru',
      gl: 'US',
      ...(acc?.visitorData ? { visitorData: acc.visitorData } : {}),
    },
    ...(acc?.dataSyncId
      ? {
          user: {
            onBehalfOfUser: acc.dataSyncId.split('||')[0],
          },
        }
      : {}),
  };

  const body = JSON.stringify({
    context,
    ...payload,
  });

  const url = `https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false${
    queryParams ? `&${queryParams}` : ''
  }`;

  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': String(Buffer.byteLength(body)),
        },
        timeout: 15000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(raw) as T);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

export async function fetchYouTubeAccountInfo(
  cookie: string,
  visitorData?: string,
  dataSyncId?: string
): Promise<{ name: string; email: string; channelHandle: string; avatarUrl?: string; resolvedDataSyncId?: string } | null> {
  const tempAcc: SavedYouTubeAccount = {
    id: 'temp',
    name: 'YouTube User',
    email: '',
    channelHandle: '',
    cookie,
    visitorData,
    dataSyncId,
    ytmSync: true,
    addedAt: Date.now(),
  };

  const json = await innerTubePost<any>('account/account_menu', { deviceTheme: 'DEVICE_THEME_SUPPORTED' }, tempAcc);
  if (!json) {
    return hasValidYouTubeCookies(cookie)
      ? {
          name: 'YouTube Music',
          email: '',
          channelHandle: '@ytmusic',
          resolvedDataSyncId: dataSyncId,
        }
      : null;
  }

  try {
    const header =
      json?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.header
        ?.activeAccountHeaderRenderer;
    if (!header) {
      return hasValidYouTubeCookies(cookie)
        ? {
            name: 'YouTube Music',
            email: '',
            channelHandle: '@ytmusic',
            resolvedDataSyncId: dataSyncId,
          }
        : null;
    }

    const name = header.accountName?.runs?.map((r: any) => r.text).join('') || 'YouTube Account';
    const email = header.email?.runs?.map((r: any) => r.text).join('') || '';
    const channelHandle = header.channelHandle?.runs?.map((r: any) => r.text).join('') || '';
    const avatarUrl = header.accountPhoto?.thumbnails?.slice(-1)?.[0]?.url;

    // Try extracting channel / dataSyncId from account switcher items if not captured
    let resolvedSyncId = dataSyncId;
    if (!resolvedSyncId) {
      const sections =
        json?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.sections || [];
      for (const sec of sections) {
        const items = sec?.multiPageMenuSectionRenderer?.items || [];
        for (const item of items) {
          const id = item?.compactLinkRenderer?.serviceEndpoint?.selectActiveIdentityEndpoint
            ?.supportedTokens?.find((t: any) => t.pageIdToken?.pageId)?.pageIdToken?.pageId;
          if (id) {
            resolvedSyncId = String(id);
            break;
          }
        }
      }
    }

    return { name, email, channelHandle, avatarUrl, resolvedDataSyncId: resolvedSyncId };
  } catch {
    return hasValidYouTubeCookies(cookie)
      ? {
          name: 'YouTube Music',
          email: '',
          channelHandle: '@ytmusic',
          resolvedDataSyncId: dataSyncId,
        }
      : null;
  }
}

function parseMusicResponsiveItem(renderer: any): PersistedTrack | null {
  if (!renderer) return null;
  const videoId =
    renderer.playlistItemData?.videoId ||
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId) return null;

  const cols: any[] = renderer.flexColumns || [];
  const col0Runs: any[] = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const col1Runs: any[] = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];

  const title = col0Runs.map((r) => r.text).join('').trim();
  if (!title) return null;

  const artistParts: string[] = [];
  let album: string | undefined;
  let duration = 0;

  for (const r of col1Runs) {
    const txt = String(r.text || '').trim();
    if (!txt || txt === '•' || txt === '&' || txt === ',') continue;
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(txt)) {
      const segs = txt.split(':').map(Number);
      duration =
        segs.length === 3 ? segs[0] * 3600 + segs[1] * 60 + segs[2] : segs[0] * 60 + segs[1];
      continue;
    }
    const browseId: string | undefined = r.navigationEndpoint?.browseEndpoint?.browseId;
    if (browseId?.startsWith('MPRE') || browseId?.startsWith('OLAK')) {
      album = txt;
    } else if (artistParts.length < 3 && !/plays|views|K|M$/i.test(txt)) {
      artistParts.push(txt);
    }
  }

  const fixedCols: any[] = renderer.fixedColumns || [];
  if (!duration && fixedCols.length > 0) {
    const durText = fixedCols[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
    if (durText && /^\d{1,2}:\d{2}/.test(durText)) {
      const segs = durText.split(':').map(Number);
      duration = segs[0] * 60 + (segs[1] || 0);
    }
  }

  const thumbs: any[] = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
  const thumbnail = thumbs.slice(-1)?.[0]?.url;

  return {
    id: videoId,
    title,
    artist: artistParts.join(', ') || 'Unknown Artist',
    album,
    duration,
    thumbnail,
    source: 'youtube',
  };
}

function walkRenderers(node: any, targetKey: string, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) walkRenderers(item, targetKey, out);
    return out;
  }
  if (node[targetKey]) out.push(node[targetKey]);
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') walkRenderers(v, targetKey, out);
  }
  return out;
}

function extractContinuationTokens(node: any, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) extractContinuationTokens(item, out);
    return out;
  }
  if (typeof node.nextContinuationData?.continuation === 'string') {
    out.push(node.nextContinuationData.continuation);
  }
  if (typeof node.continuationEndpoint?.continuationCommand?.token === 'string') {
    out.push(node.continuationEndpoint.continuationCommand.token);
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') extractContinuationTokens(v, out);
  }
  return out;
}

export async function fetchYouTubeLikedSongs(): Promise<PersistedTrack[]> {
  const acc = getActiveYouTubeAccount();
  if (!acc) return [];

  const tracks: PersistedTrack[] = [];
  const seen = new Set<string>();
  const seenContinuations = new Set<string>();

  const collectFromJson = (json: any) => {
    if (!json) return;
    const renderers = walkRenderers(json, 'musicResponsiveListItemRenderer');
    for (const r of renderers) {
      const t = parseMusicResponsiveItem(r);
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        tracks.push(t);
      }
    }
  };

  // Query VLLM (100 items per page, full Liked Music playlist) + FEmusic_liked_videos fallback
  for (const browseId of ['VLLM', 'FEmusic_liked_videos']) {
    if (tracks.length > 0 && browseId === 'FEmusic_liked_videos') break;
    const initialJson = await innerTubePost<any>('browse', { browseId }, acc);
    if (!initialJson) continue;
    collectFromJson(initialJson);

    let nextToken = extractContinuationTokens(initialJson).find(
      (tok) => tok && !seenContinuations.has(tok)
    );
    let page = 1;
    while (nextToken && page < 50) {
      seenContinuations.add(nextToken);
      page++;
      const q = `ctoken=${encodeURIComponent(nextToken)}&continuation=${encodeURIComponent(nextToken)}&type=next`;
      const nextJson = await innerTubePost<any>(
        'browse',
        { continuation: nextToken },
        acc,
        q
      );
      if (!nextJson) break;
      const beforeCount = tracks.length;
      collectFromJson(nextJson);
      const nextCandidates = extractContinuationTokens(nextJson).filter(
        (tok) => tok && !seenContinuations.has(tok)
      );
      if (tracks.length === beforeCount && nextCandidates.length === 0) break;
      nextToken = nextCandidates[0];
    }
  }

  return tracks;
}

export async function fetchYouTubeHistory(): Promise<PersistedTrack[]> {
  const acc = getActiveYouTubeAccount();
  if (!acc) return [];
  const json = await innerTubePost<any>('browse', { browseId: 'FEmusic_history' }, acc);
  if (!json) return [];

  const renderers = walkRenderers(json, 'musicResponsiveListItemRenderer');
  const tracks: PersistedTrack[] = [];
  const seen = new Set<string>();
  for (const r of renderers) {
    const t = parseMusicResponsiveItem(r);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      tracks.push(t);
    }
  }
  return tracks;
}

export async function fetchYouTubeLibraryPlaylists(): Promise<
  Array<{ id: string; title: string; subtitle?: string; thumbnail?: string; countText?: string }>
> {
  const acc = getActiveYouTubeAccount();
  if (!acc) return [];

  const playlists: Array<{
    id: string;
    title: string;
    subtitle?: string;
    thumbnail?: string;
    countText?: string;
  }> = [];
  const seen = new Set<string>();
  const seenContinuations = new Set<string>();

  const collectPlaylists = (json: any) => {
    if (!json) return;
    const cards = walkRenderers(json, 'musicTwoRowItemRenderer');
    for (const card of cards) {
      const browseId: string | undefined = card.navigationEndpoint?.browseEndpoint?.browseId;
      if (!browseId || (!browseId.startsWith('VL') && !browseId.startsWith('PL'))) continue;
      const cleanId = browseId.replace(/^VL/, '');
      if (seen.has(cleanId) || cleanId === 'LM' || cleanId === 'SE') continue;
      seen.add(cleanId);

      const title = (card.title?.runs || []).map((r: any) => r.text).join('').trim();
      const subtitle = (card.subtitle?.runs || []).map((r: any) => r.text).join('').trim();
      const thumbnail =
        card.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;

      playlists.push({
        id: cleanId,
        title: title || 'YouTube Playlist',
        subtitle,
        thumbnail,
      });
    }
  };

  for (const bId of ['FEmusic_liked_playlists', 'FEmusic_library_landing']) {
    const json = await innerTubePost<any>('browse', { browseId: bId }, acc);
    if (!json) continue;
    collectPlaylists(json);
    let nextToken = extractContinuationTokens(json).find((t) => t && !seenContinuations.has(t));
    let page = 1;
    while (nextToken && page < 10) {
      seenContinuations.add(nextToken);
      page++;
      const q = `ctoken=${encodeURIComponent(nextToken)}&continuation=${encodeURIComponent(nextToken)}&type=next`;
      const nextJson = await innerTubePost<any>('browse', { continuation: nextToken }, acc, q);
      if (!nextJson) break;
      collectPlaylists(nextJson);
      nextToken = extractContinuationTokens(nextJson).find((t) => t && !seenContinuations.has(t));
    }
  }

  return playlists;
}

export async function fetchYouTubeSubscriptions(): Promise<
  Array<{ id: string; name: string; subtitle?: string; thumbnail?: string }>
> {
  const acc = getActiveYouTubeAccount();
  if (!acc) return [];
  const json = await innerTubePost<any>(
    'browse',
    { browseId: 'FEmusic_library_corpus_artists' },
    acc
  );
  if (!json) return [];

  const items = walkRenderers(json, 'musicResponsiveListItemRenderer');
  const artists: Array<{ id: string; name: string; subtitle?: string; thumbnail?: string }> = [];
  for (const item of items) {
    const browseId = item.navigationEndpoint?.browseEndpoint?.browseId;
    if (!browseId) continue;
    const cols: any[] = item.flexColumns || [];
    const name = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
      ?.map((r: any) => r.text)
      .join('')
      .trim();
    const subtitle = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
      ?.map((r: any) => r.text)
      .join('')
      .trim();
    const thumbnail = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
    if (name) {
      artists.push({ id: browseId, name, subtitle, thumbnail });
    }
  }
  return artists;
}

export async function setYouTubeLikeStatus(
  videoId: string,
  like: boolean
): Promise<{ ok: boolean }> {
  const acc = getActiveYouTubeAccount();
  if (!acc || !acc.ytmSync) return { ok: false };
  const cleanId = videoId.replace(/^youtube:/, '');
  if (cleanId.includes(':')) return { ok: false };

  const endpoint = like ? 'like/like' : 'like/removelike';
  const res = await innerTubePost<any>(endpoint, { target: { videoId: cleanId } }, acc);
  return { ok: Boolean(res) };
}

export async function recoverYouTubeSessionIfPresent(): Promise<void> {
  const db = getDb();
  if (db.youtubeAuth.activeAccountId && db.youtubeAuth.savedAccounts.length > 0) return;
  try {
    const authSession = session.fromPartition('persist:ytmusic', { cache: true });
    const cookieHeader = await getCleanYouTubeCookieHeader(authSession);
    if (!hasValidYouTubeCookies(cookieHeader)) return;

    const info = await fetchYouTubeAccountInfo(cookieHeader);
    if (!info) return;

    const accountId = info.email || info.channelHandle || info.name || 'ytmusic_primary';
    const saved: SavedYouTubeAccount = {
      id: accountId,
      name: info.name,
      email: info.email,
      channelHandle: info.channelHandle,
      avatarUrl: info.avatarUrl,
      cookie: cookieHeader,
      dataSyncId: info.resolvedDataSyncId,
      ytmSync: true,
      addedAt: Date.now(),
    };
    db.youtubeAuth.savedAccounts = [
      saved,
      ...db.youtubeAuth.savedAccounts.filter((a) => a.id !== accountId),
    ];
    db.youtubeAuth.activeAccountId = accountId;
    db.settings.youtubeCookie = cookieHeader;
    saveDbImmediate();
  } catch {
    /* ignore */
  }
}

export function setupYouTubeAuthIPC(): void {
  ipcMain.handle('ytmAuth:getStatus', async () => {
    await recoverYouTubeSessionIfPresent();
    const db = getDb();
    const active = getActiveYouTubeAccount();
    return {
      connected: Boolean(active),
      activeAccount: active
        ? {
            id: active.id,
            name: active.name,
            email: active.email,
            channelHandle: active.channelHandle,
            avatarUrl: active.avatarUrl,
            ytmSync: active.ytmSync,
            hasDataSyncId: Boolean(active.dataSyncId),
          }
        : null,
      savedAccounts: db.youtubeAuth.savedAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        channelHandle: a.channelHandle,
        avatarUrl: a.avatarUrl,
        ytmSync: a.ytmSync,
        hasDataSyncId: Boolean(a.dataSyncId),
      })),
    };
  });

  ipcMain.handle('ytmAuth:login', async () => {
    return new Promise((resolve) => {
      let finished = false;
      let checking = false;
      const authSession = session.fromPartition('persist:ytmusic', { cache: true });
      authSession.setUserAgent(USER_AGENT);

      const authWin = new BrowserWindow({
        width: 580,
        height: 760,
        title: 'Вход в YouTube Music — ArchiveTune Desktop',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: authSession,
        },
      });
      authWin.webContents.setUserAgent(USER_AGENT);
      authWin.webContents.setWindowOpenHandler(({ url }) => {
        if (url && url.startsWith('http')) {
          void authWin.loadURL(url);
        }
        return { action: 'deny' };
      });

      let capturedVisitorData: string | undefined;
      let capturedDataSyncId: string | undefined;

      const tryComplete = async () => {
        if (finished || checking || authWin.isDestroyed()) return;
        checking = true;
        try {
          const cookieHeader = await getCleanYouTubeCookieHeader(authSession);
          if (!hasValidYouTubeCookies(cookieHeader)) return;

          const currentUrl = authWin.webContents.getURL();
          if (currentUrl.includes('accounts.google.com') && !currentUrl.includes('CheckCookie')) {
            return;
          }

          try {
            const ytcfgData = await authWin.webContents.executeJavaScript(`
              (() => {
                try {
                  if (window.ytcfg && typeof window.ytcfg.get === 'function') {
                    return {
                      visitorData: window.ytcfg.get('VISITOR_DATA') || null,
                      dataSyncId: window.ytcfg.get('DATASYNC_ID') || null,
                    };
                  }
                } catch (e) {}
                return null;
              })()
            `);
            if (ytcfgData?.visitorData) capturedVisitorData = ytcfgData.visitorData;
            if (ytcfgData?.dataSyncId) capturedDataSyncId = ytcfgData.dataSyncId;
          } catch {
            /* ignore */
          }

          const info = await fetchYouTubeAccountInfo(
            cookieHeader,
            capturedVisitorData,
            capturedDataSyncId
          );
          if (!info) return;

          finished = true;
          clearInterval(pollTimer);
          const db = getDb();
          const finalSyncId = capturedDataSyncId || info.resolvedDataSyncId || '';
          const accountId = info.email || info.channelHandle || info.name || 'ytmusic_primary';

          const saved: SavedYouTubeAccount = {
            id: accountId,
            name: info.name,
            email: info.email,
            channelHandle: info.channelHandle,
            avatarUrl: info.avatarUrl,
            cookie: cookieHeader,
            visitorData: capturedVisitorData,
            dataSyncId: finalSyncId || undefined,
            ytmSync: true,
            addedAt: Date.now(),
          };

          db.youtubeAuth.savedAccounts = [
            saved,
            ...db.youtubeAuth.savedAccounts.filter((a) => a.id !== accountId),
          ];
          db.youtubeAuth.activeAccountId = accountId;
          db.settings.youtubeCookie = cookieHeader;
          saveDbImmediate();

          if (!authWin.isDestroyed()) authWin.close();
          resolve({
            ok: true,
            account: {
              id: saved.id,
              name: saved.name,
              email: saved.email,
              channelHandle: saved.channelHandle,
              avatarUrl: saved.avatarUrl,
              ytmSync: saved.ytmSync,
              hasDataSyncId: Boolean(saved.dataSyncId),
            },
          });
        } catch {
          /* retry on next poll */
        } finally {
          checking = false;
        }
      };

      const pollTimer = setInterval(() => {
        void tryComplete();
      }, 1200);

      const onBeforeSend = (details: any, callback: any) => {
        const hdrs = details.requestHeaders || {};
        delete hdrs['Sec-CH-UA'];
        delete hdrs['sec-ch-ua'];
        const vData = hdrs['X-Goog-Visitor-Id'] || hdrs['x-goog-visitor-id'];
        if (vData) capturedVisitorData = String(vData);
        callback({ requestHeaders: hdrs });
      };

      authSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://*.youtube.com/*', 'https://*.google.com/*'] },
        onBeforeSend
      );

      authWin.webContents.on('did-finish-load', () => {
        void tryComplete();
      });

      authWin.webContents.on('did-navigate', () => {
        void tryComplete();
      });

      authWin.on('closed', () => {
        clearInterval(pollTimer);
        try {
          authSession.webRequest.onBeforeSendHeaders(null);
        } catch {
          /* ignore */
        }
        if (!finished) {
          finished = true;
          resolve({ ok: false, error: 'Окно входа YouTube Music было закрыто.' });
        }
      });

      void authWin.loadURL(
        'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com'
      );
    });
  });

  ipcMain.handle('ytmAuth:connectManualCookie', async (_e, rawCookie: string) => {
    const cookie = rawCookie.trim();
    if (!hasValidYouTubeCookies(cookie)) {
      return { ok: false, error: 'Cookie string must include SAPISID or __Secure-3PAPISID.' };
    }
    const info = await fetchYouTubeAccountInfo(cookie);
    if (!info) {
      return { ok: false, error: 'Could not verify YouTube session with provided cookies.' };
    }
    const db = getDb();
    const accountId = info.email || info.channelHandle || info.name;
    const saved: SavedYouTubeAccount = {
      id: accountId,
      name: info.name,
      email: info.email,
      channelHandle: info.channelHandle,
      avatarUrl: info.avatarUrl,
      cookie,
      dataSyncId: info.resolvedDataSyncId,
      ytmSync: true,
      addedAt: Date.now(),
    };
    db.youtubeAuth.savedAccounts = [
      saved,
      ...db.youtubeAuth.savedAccounts.filter((a) => a.id !== accountId),
    ];
    db.youtubeAuth.activeAccountId = accountId;
    db.settings.youtubeCookie = cookie;
    saveDbImmediate();
    return { ok: true, account: saved };
  });

  ipcMain.handle('ytmAuth:switchAccount', (_e, accountId: string) => {
    const db = getDb();
    const target = db.youtubeAuth.savedAccounts.find((a) => a.id === accountId);
    if (!target) return { ok: false, error: 'Account not found.' };
    db.youtubeAuth.activeAccountId = target.id;
    db.settings.youtubeCookie = target.cookie;
    saveDbImmediate();
    return { ok: true, account: target };
  });

  ipcMain.handle('ytmAuth:toggleSync', (_e, enabled: boolean) => {
    const db = getDb();
    const active = getActiveYouTubeAccount();
    if (active) {
      active.ytmSync = enabled;
      saveDbImmediate();
    }
    return { ok: true, ytmSync: enabled };
  });

  ipcMain.handle('ytmAuth:logout', async (_e, accountId?: string) => {
    const db = getDb();
    const targetId = accountId || db.youtubeAuth.activeAccountId;
    if (targetId) {
      db.youtubeAuth.savedAccounts = db.youtubeAuth.savedAccounts.filter((a) => a.id !== targetId);
    }
    if (db.youtubeAuth.activeAccountId === targetId) {
      db.youtubeAuth.activeAccountId = db.youtubeAuth.savedAccounts[0]?.id ?? null;
      db.settings.youtubeCookie = db.youtubeAuth.savedAccounts[0]?.cookie ?? '';
    }
    if (db.youtubeAuth.savedAccounts.length === 0) {
      try {
        await session.fromPartition('persist:ytmusic').clearStorageData();
      } catch {
        /* ignore */
      }
    }
    saveDbImmediate();
    return { ok: true };
  });

  ipcMain.handle('ytmAuth:getLikedSongs', async (_e, mergeIntoLibrary = false) => {
    const tracks = await fetchYouTubeLikedSongs();
    if (mergeIntoLibrary && tracks.length > 0) {
      upsertLikedSongsBatch(tracks, false);
    }
    return tracks;
  });

  ipcMain.handle('ytmAuth:getLibraryPlaylists', async () => {
    return fetchYouTubeLibraryPlaylists();
  });

  ipcMain.handle('ytmAuth:getSubscriptions', async () => {
    return fetchYouTubeSubscriptions();
  });

  ipcMain.handle('ytmAuth:setLike', async (_e, videoId: string, like: boolean) => {
    return setYouTubeLikeStatus(videoId, like);
  });
}
