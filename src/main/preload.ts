import { contextBridge, ipcRenderer } from 'electron';

function subscribe<T = unknown>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls & Desktop Integration
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMediaShortcut: (cb: (action: 'playPause' | 'play' | 'pause' | 'next' | 'prev') => void) =>
    subscribe<'playPause' | 'play' | 'pause' | 'next' | 'prev'>('shortcut:media', cb),
  updateDiscordPresence: (trackInfo: unknown) =>
    ipcRenderer.invoke('desktop:updatePresence', trackInfo),

  onMediaSeek: (cb: (event: { position?: number; offset?: number }) => void) => subscribe('shortcut:seek', cb),
  desktop: {
    updatePlaybackMode: (mode: unknown) => ipcRenderer.send('desktop:updatePlaybackMode', mode),
    onPlaybackMode: (cb: (mode: unknown) => void) => subscribe('desktop:playbackMode', cb),
    updateLyrics: (trackId: string, lines: unknown[]) => ipcRenderer.send('desktop:updateLyrics', trackId, lines),
    updatePosition: (position: number, seeked = false, trackId?: string) => ipcRenderer.send('desktop:updatePosition', position, seeked, trackId),
    updatePresence: (trackInfo: unknown) => ipcRenderer.invoke('desktop:updatePresence', trackInfo),
    listenBrainzNowPlaying: (trackInfo: unknown) =>
      ipcRenderer.invoke('desktop:listenBrainzNowPlaying', trackInfo),
    listenBrainzScrobble: (trackInfo: unknown) =>
      ipcRenderer.invoke('desktop:listenBrainzScrobble', trackInfo),
    toggleLocalApi: (enabled: boolean) => ipcRenderer.invoke('desktop:toggleLocalApi', enabled),
    readArtworkThumbnail: (imageUrl: string) => ipcRenderer.invoke('desktop:readArtworkThumbnail', imageUrl),
  },

  // Persistent Database, Stats & Settings
  db: {
    getInitialState: () => ipcRenderer.invoke('db:getInitialState'),
    updateSettings: (partial: Record<string, unknown>) =>
      ipcRenderer.invoke('db:updateSettings', partial),
    saveQueueState: (queueState: unknown) => ipcRenderer.invoke('db:saveQueueState', queueState),
    saveHistory: (history: unknown[]) => ipcRenderer.invoke('db:saveHistory', history),
    saveLocalLibrary: (directories: string[], localTracks: unknown[]) =>
      ipcRenderer.invoke('db:saveLocalLibrary', directories, localTracks),
    toggleLike: (track: unknown) => ipcRenderer.invoke('db:toggleLike', track),
    upsertLikedBatch: (tracks: unknown[], replaceAll?: boolean) =>
      ipcRenderer.invoke('db:upsertLikedBatch', tracks, replaceAll),
    savePlaylist: (playlist: unknown) => ipcRenderer.invoke('db:savePlaylist', playlist),
    deletePlaylist: (playlistId: string) => ipcRenderer.invoke('db:deletePlaylist', playlistId),
    toggleBlockArtist: (artistName: string) =>
      ipcRenderer.invoke('db:toggleBlockArtist', artistName),
    recordStats: (track: unknown, seconds?: number) =>
      ipcRenderer.invoke('db:recordStats', track, seconds),
    getStats: () => ipcRenderer.invoke('db:getStats'),
    resetStats: () => ipcRenderer.invoke('db:resetStats'),
    exportBackup: () => ipcRenderer.invoke('db:exportBackup'),
    importBackup: () => ipcRenderer.invoke('db:importBackup'),
  },

  // Dual-Deck mpv Audio Player, Smart Automix, SponsorBlock & DSP
  playbackCache: {
    info: () => ipcRenderer.invoke('cache:info'),
    configure: (limitMB: number) => ipcRenderer.invoke('cache:configure', limitMB),
    clear: () => ipcRenderer.invoke('cache:clear'),
  },
  offline: {
    list: () => ipcRenderer.invoke('offline:list'),
    find: (id: string) => ipcRenderer.invoke('offline:find', id),
    save: (track: unknown) => ipcRenderer.invoke('offline:save', track),
    remove: (id: string) => ipcRenderer.invoke('offline:remove', id),
  },
  player: {
    play: (url: string, meta: object) => ipcRenderer.invoke('player:play', url, meta),
    prebufferNext: (nextData: object | null) =>
      ipcRenderer.invoke('player:prebufferNext', nextData),
    pause: () => ipcRenderer.invoke('player:pause'),
    resume: () => ipcRenderer.invoke('player:resume'),
    stop: () => ipcRenderer.invoke('player:stop'),
    seek: (seconds: number) => ipcRenderer.invoke('player:seek', seconds),
    setVolume: (vol: number) => ipcRenderer.invoke('player:setVolume', vol),
    setSpeed: (speed: number) => ipcRenderer.invoke('player:setSpeed', speed),
    setNormalization: (enabled: boolean) => ipcRenderer.invoke('player:setNormalization', enabled),
    setDsp: (opts: object) => ipcRenderer.invoke('player:setDsp', opts),
    setCrossfade: (seconds: number) => ipcRenderer.invoke('player:setCrossfade', seconds),
    setSmartDjAutomix: (enabled: boolean) =>
      ipcRenderer.invoke('player:setSmartDjAutomix', enabled),
    setAutomixConfig: (opts: object) => ipcRenderer.invoke('player:setAutomixConfig', opts),
    setEqualizer: (config: { enabled: boolean; bands: number[]; preset?: string }) =>
      ipcRenderer.invoke('player:setEqualizer', config),
    getAudioDevices: () => ipcRenderer.invoke('player:getAudioDevices'),
    setAudioDevice: (device: string) => ipcRenderer.invoke('player:setAudioDevice', device),
    setSleepTimer: (minutes: number | null, afterTrack = false) =>
      ipcRenderer.invoke('player:setSleepTimer', minutes, afterTrack),
    setAbLoop: (a: number | null, b: number | null) => ipcRenderer.invoke('player:setAbLoop', a, b),
    auditQuality: (urlOrPath?: string) => ipcRenderer.invoke('player:auditQuality', urlOrPath),
    downloadTrack: (track: object) => ipcRenderer.invoke('player:downloadTrack', track),
    getStatus: () => ipcRenderer.invoke('player:getStatus'),
    onRecovery: (cb: (info: any) => void) => subscribe('player:recovery', cb),
    onProgress: (cb: (info: any) => void) => subscribe('player:progress', cb),
    onEnded: (cb: (info?: { trackId?: string | null; revision?: number }) => void) =>
      subscribe<{ trackId?: string | null; revision?: number } | undefined>('player:ended', cb),
    onAutomixTransition: (cb: (info: { fromTrackId?: string; nextTrackId: string; spotifyId?: string; revision?: number }) => void) =>
      subscribe<{ fromTrackId?: string; nextTrackId: string; spotifyId?: string; revision?: number }>('player:automixTransition', cb),
    onAutomixPlan: (cb: (plan: any) => void) => subscribe('player:automixPlan', cb),
    onSmartToast: (cb: (toast: { message: string; kind: string; timestamp: number }) => void) =>
      subscribe('player:smartToast', cb),
    onSleepTimerUpdate: (cb: (info: { remainingSec: number; afterTrack: boolean }) => void) =>
      subscribe('player:sleepTimerUpdate', cb),
  },

  // YouTube Music + Explore + Album / Artist / Playlist Details
  ytmusic: {
    search: (query: string) => ipcRenderer.invoke('ytmusic:search', query),
    searchAll: (query: string) => ipcRenderer.invoke('ytmusic:searchAll', query),
    getSuggestions: (query: string) => ipcRenderer.invoke('ytmusic:getSuggestions', query),
    getStreamUrl: (videoId: string) => ipcRenderer.invoke('ytmusic:getStreamUrl', videoId),
    getHome: (chipParams?: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('ytmusic:getHome', chipParams, forceRefresh),
    getExplore: () => ipcRenderer.invoke('ytmusic:getExplore'),
    getCategory: (category: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('ytmusic:getCategory', category, forceRefresh),
    getAlbum: (albumId: string) => ipcRenderer.invoke('ytmusic:getAlbum', albumId),
    getArtist: (artistId: string) => ipcRenderer.invoke('ytmusic:getArtist', artistId),
    getPlaylist: (playlistId: string) => ipcRenderer.invoke('ytmusic:getPlaylist', playlistId),
    getSuggested: (videoId: string) => ipcRenderer.invoke('ytmusic:getSuggested', videoId),
  },

  // Multi-Source Providers & Universal Fallback Matrix
  providers: {
    searchMulti: (query: string, source?: string) =>
      ipcRenderer.invoke('providers:searchMulti', query, source),
    resolveUniversal: (track: object, forceSource?: string, options?: { priority?: 'playback' | 'prebuffer' }) =>
      ipcRenderer.invoke('providers:resolveUniversal', track, forceSource, options),
    findAlternatives: (track: object) => ipcRenderer.invoke('providers:findAlternatives', track),
    checkLatencies: () => ipcRenderer.invoke('providers:checkLatencies'),
  },

  // Shazam Music Recognition
  recognition: {
    recognizeLive: (mode: 'mic' | 'system' = 'system') =>
      ipcRenderer.invoke('recognition:recognizeLive', mode),
    pickAndRecognizeFile: () => ipcRenderer.invoke('recognition:pickAndRecognizeFile'),
    recognizeFile: (filePath: string) => ipcRenderer.invoke('recognition:recognizeFile', filePath),
    getHistory: () => ipcRenderer.invoke('recognition:getHistory'),
    clearHistory: () => ipcRenderer.invoke('recognition:clearHistory'),
    topGlobal: (limit = 25) => ipcRenderer.invoke('recognition:topGlobal', limit),
    onStatus: (cb: (status: { phase: string; mode: string }) => void) =>
      subscribe('recognition:status', cb),
  },

  // Listen Together (WebSocket Sync Room)
  together: {
    getState: () => ipcRenderer.invoke('together:getState'),
    createRoom: (displayName: string, port?: number) =>
      ipcRenderer.invoke('together:createRoom', displayName, port),
    joinRoom: (url: string, displayName: string, code: string) =>
      ipcRenderer.invoke('together:joinRoom', url, displayName, code),
    leaveRoom: () => ipcRenderer.invoke('together:leaveRoom'),
    syncHostState: (update: object) => ipcRenderer.invoke('together:syncHostState', update),
    sendChat: (text: string, senderName?: string) =>
      ipcRenderer.invoke('together:sendChat', text, senderName),
    onState: (cb: (state: any) => void) => subscribe('together:state', cb),
    onSyncPlayback: (cb: (payload: any) => void) => subscribe('together:syncPlayback', cb),
  },

  // Cross-Platform Playlist Import/Export
  playlists: {
    importFromUrl: (rawUrl: string, customName?: string) =>
      ipcRenderer.invoke('playlists:importFromUrl', rawUrl, customName),
    importFromFile: () => ipcRenderer.invoke('playlists:importFromFile'),
    export: (playlistId: string, format: 'm3u8' | 'json') =>
      ipcRenderer.invoke('playlists:export', playlistId, format),
    onUpdated: (cb: (playlists: any[]) => void) => subscribe('playlists:updated', cb),
  },

  // Spotify
  spotify: {
    nativeStatus: () => ipcRenderer.invoke('spotify:nativeStatus'),
    nativeConnect: () => ipcRenderer.invoke('spotify:nativeConnect'),
    nativeDisable: () => ipcRenderer.invoke('spotify:nativeDisable'),
    getStatus: () => ipcRenderer.invoke('spotify:getStatus'),
    login: () => ipcRenderer.invoke('spotify:login'),
    connectManual: (spDc: string) => ipcRenderer.invoke('spotify:connectManual', spDc),
    disconnect: () => ipcRenderer.invoke('spotify:disconnect'),
    getLikedSongs: (limit?: number, offset?: number) =>
      ipcRenderer.invoke('spotify:getLikedSongs', limit, offset),
    getPlaylists: (limit?: number) => ipcRenderer.invoke('spotify:getPlaylists', limit),
    getPlaylistTracks: (playlistId: string) =>
      ipcRenderer.invoke('spotify:getPlaylistTracks', playlistId),
    getSavedAlbums: (limit?: number) => ipcRenderer.invoke('spotify:getSavedAlbums', limit),
    getFollowedArtists: (limit?: number) =>
      ipcRenderer.invoke('spotify:getFollowedArtists', limit),
    getTopTracks: (limit?: number) => ipcRenderer.invoke('spotify:getTopTracks', limit),
    toggleLike: (spotifyTrackId: string, like: boolean) =>
      ipcRenderer.invoke('spotify:toggleLike', spotifyTrackId, like),
    search: (query: string, limit?: number) =>
      ipcRenderer.invoke('spotify:search', query, limit),
    resolveTrack: (track: {
      id?: string;
      title: string;
      artist: string;
      album?: string;
      duration?: number;
    }) => ipcRenderer.invoke('spotify:resolveTrack', track),
    getPersonalizedHome: (forceRefresh?: boolean) =>
      ipcRenderer.invoke('spotify:getPersonalizedHome', forceRefresh),
  },

  // YouTube & YouTube Music Account Sync
  ytmAuth: {
    getStatus: () => ipcRenderer.invoke('ytmAuth:getStatus'),
    login: () => ipcRenderer.invoke('ytmAuth:login'),
    connectManualCookie: (cookie: string) =>
      ipcRenderer.invoke('ytmAuth:connectManualCookie', cookie),
    switchAccount: (accountId: string) => ipcRenderer.invoke('ytmAuth:switchAccount', accountId),
    toggleSync: (enabled: boolean) => ipcRenderer.invoke('ytmAuth:toggleSync', enabled),
    logout: (accountId?: string) => ipcRenderer.invoke('ytmAuth:logout', accountId),
    getLikedSongs: (mergeIntoLibrary = false) =>
      ipcRenderer.invoke('ytmAuth:getLikedSongs', mergeIntoLibrary),
    getLibraryPlaylists: () => ipcRenderer.invoke('ytmAuth:getLibraryPlaylists'),
    getSubscriptions: () => ipcRenderer.invoke('ytmAuth:getSubscriptions'),
    setLike: (videoId: string, like: boolean) =>
      ipcRenderer.invoke('ytmAuth:setLike', videoId, like),
  },

  // SoundCloud OAuth & Library
  soundcloud: {
    getStatus: () => ipcRenderer.invoke('soundcloud:getStatus'),
    login: () => ipcRenderer.invoke('soundcloud:login'),
    connectManual: (token: string) => ipcRenderer.invoke('soundcloud:connectManual', token),
    logout: () => ipcRenderer.invoke('soundcloud:logout'),
    refreshClientId: () => ipcRenderer.invoke('soundcloud:refreshClientId'),
    getLikedTracks: (limit?: number) => ipcRenderer.invoke('soundcloud:getLikedTracks', limit),
    getPlaylists: (limit?: number) => ipcRenderer.invoke('soundcloud:getPlaylists', limit),
    getFollowingFeed: (limit?: number) => ipcRenderer.invoke('soundcloud:getFollowingFeed', limit),
    getGenreCharts: (genre?: string, limit?: number) =>
      ipcRenderer.invoke('soundcloud:getGenreCharts', genre, limit),
    toggleLike: (scTrackId: string, like: boolean) =>
      ipcRenderer.invoke('soundcloud:toggleLike', scTrackId, like),
  },

  // Local Tag & Cover Editor
  tagEditor: {
    read: (filePath: string) => ipcRenderer.invoke('tagEditor:read', filePath),
    pickCover: () => ipcRenderer.invoke('tagEditor:pickCover'),
    write: (filePath: string, tags: object) => ipcRenderer.invoke('tagEditor:write', filePath, tags),
  },

  // Local library
  library: {
    scan: (dir: string) => ipcRenderer.invoke('library:scan', dir),
    addDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    addFiles: () => ipcRenderer.invoke('dialog:openFiles'),
    getMetadata: (filePath: string) => ipcRenderer.invoke('library:getMetadata', filePath),
  },

  // Multi-Provider Lyrics & Motion Canvas
  lyrics: {
    get: (title: string, artist: string, duration: number, trackId?: string, spotifyId?: string) =>
      ipcRenderer.invoke('lyrics:get', title, artist, duration, trackId, spotifyId),
    searchCandidates: (query: string) => ipcRenderer.invoke('lyrics:searchCandidates', query),
  },
  canvas: {
    get: (track: { id: string; title: string; artist: string }) =>
      ipcRenderer.invoke('canvas:get', track),
  },

  // Last.fm Scrobbling
  scrobble: {
    configure: (apiKey: string, apiSecret: string, sessionKey: string) =>
      ipcRenderer.invoke('scrobble:configure', apiKey, apiSecret, sessionKey),
    updateNowPlaying: (track: object) => ipcRenderer.invoke('scrobble:nowPlaying', track),
    scrobble: (track: object) => ipcRenderer.invoke('scrobble:scrobble', track),
  },

  openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),
});
