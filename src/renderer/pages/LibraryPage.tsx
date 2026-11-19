import { useShallow } from 'zustand/react/shallow';
import { formatCount, trackCount } from '../lib/interfaceText';
import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  RefreshCw,
  Music2,
  Heart,
  History,
  Search,
  Play,
  HardDrive,
  ListMusic,
  Plus,
  Link2,
  Upload,
  Download,
  Trash2,
  Ban,
  PlugZap,
  Disc3,
  Radio,
  User,
  Album as AlbumIcon,
  ChevronRight,
  Loader2,
  FileAudio,
} from 'lucide-react';
import {
  useLibraryStore,
  usePlayerStore,
  useAccountsStore,
  useUIStore,
  Track,
  PlaylistItem,
} from '../store';
import { usePlayer } from '../lib/usePlayer';
import TrackRow from '../components/TrackRow';
import LibraryTrackList from '../components/LibraryTrackList';
import OfflineLibrary from '../components/OfflineLibrary';

type MainTab =
  | 'offline'
  | 'liked'
  | 'playlists'
  | 'local'
  | 'history'
  | 'blocked'
  | 'spotify'
  | 'ytmusic'
  | 'soundcloud';

export default function LibraryPage() {
  const navigate = useNavigate();
  const { tracks, directories, scanning, addDirectory, setTracks, setScanning } = useLibraryStore();
  const {
    likedSongs,
    playlists,
    history,
    blockedArtists,
    savePlaylist,
    deletePlaylist,
    toggleBlockArtist,
    upsertLikedSongs,
  } = usePlayerStore(useShallow((state) => ({
    likedSongs: state.likedSongs,
    playlists: state.playlists,
    history: state.history,
    blockedArtists: state.blockedArtists,
    savePlaylist: state.savePlaylist,
    deletePlaylist: state.deletePlaylist,
    toggleBlockArtist: state.toggleBlockArtist,
    upsertLikedSongs: state.upsertLikedSongs,
  })));
  const { spotifyConnected, ytmConnected, scConnected, syncingAll, syncAllPlatforms } = useAccountsStore();
  const { setTagEditorTrack, pushToast } = useUIStore();
  const { playFromQueue } = usePlayer();

  const [activeTab, setActiveTab] = useState<MainTab>('liked');
  const [filterQuery, setFilterQuery] = useState('');
  const [likedSourceFilter, setLikedSourceFilter] = useState<'all' | 'spotify' | 'youtube' | 'soundcloud' | 'local'>('all');
  const [playlistSourceFilter, setPlaylistSourceFilter] = useState<'all' | 'spotify' | 'youtube' | 'soundcloud' | 'local'>('all');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [selectedPlaylistLoading, setSelectedPlaylistLoading] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>('all');

  // Create / import playlist modals inline
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [importUrlValue, setImportUrlValue] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistTag, setNewPlaylistTag] = useState('');
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);

  // Platform tabs state
  const [spSubTab, setSpSubTab] = useState<'liked' | 'playlists' | 'top' | 'albums' | 'artists'>('liked');
  const [spTracks, setSpTracks] = useState<Track[]>([]);
  const [spPlaylists, setSpPlaylists] = useState<any[]>([]);
  const [spTopTracks, setSpTopTracks] = useState<Track[]>([]);
  const [spAlbums, setSpAlbums] = useState<any[]>([]);
  const [spArtists, setSpArtists] = useState<any[]>([]);
  const [spLoading, setSpLoading] = useState(false);
  const [spSelectedPlTracks, setSpSelectedPlTracks] = useState<{ title: string; tracks: Track[] } | null>(null);

  const [ytmSubTab, setYtmSubTab] = useState<'liked' | 'playlists' | 'subscriptions'>('liked');
  const [ytmTracks, setYtmTracks] = useState<Track[]>([]);
  const [ytmPlaylists, setYtmPlaylists] = useState<any[]>([]);
  const [ytmSubs, setYtmSubs] = useState<any[]>([]);
  const [ytmLoading, setYtmLoading] = useState(false);

  const [scSubTab, setScSubTab] = useState<'liked' | 'playlists' | 'feed' | 'charts'>('liked');
  const [scTracks, setScTracks] = useState<Track[]>([]);
  const [scPlaylists, setScPlaylists] = useState<any[]>([]);
  const [scFeed, setScFeed] = useState<Track[]>([]);
  const [scCharts, setScCharts] = useState<Track[]>([]);
  const [scGenre, setScGenre] = useState('all-music');
  const [scLoading, setScLoading] = useState(false);

  const scanDirectory = useCallback(
    async (dirPath: string) => {
      setScanning(true);
      try {
        const scanned = (await window.electronAPI?.library?.scan(dirPath)) ?? [];
        const libTracks: Track[] = scanned.map((meta: any) => ({
          ...meta,
          id: meta.path || meta.id,
          title: meta.title || 'Unknown Title',
          artist: meta.artist || 'Unknown Artist',
          duration: meta.duration || 0,
          source: 'local' as const,
          path: meta.path,
          qualityBadge: meta.qualityBadge || meta.format || 'LOCAL',
        }));
        const existing = useLibraryStore.getState().tracks;
        const mergedMap = new Map<string, Track>();
        for (const t of [...existing, ...libTracks]) {
          mergedMap.set(t.id, t);
        }
        setTracks(Array.from(mergedMap.values()));
      } catch (err) {
        console.error('Library scan failed', err);
        pushToast('Не удалось прочитать папку с музыкой.', 'error');
      } finally {
        setScanning(false);
      }
    },
    [pushToast, setTracks, setScanning]
  );

  const handleAddDirectory = useCallback(async () => {
    const dirPath = await window.electronAPI?.library?.addDirectory();
    if (!dirPath) return;
    addDirectory(dirPath);
    setActiveTab('local');
    await scanDirectory(dirPath);
  }, [addDirectory, scanDirectory]);

  const handleAddFiles = useCallback(async () => {
    const paths = (await window.electronAPI?.library?.addFiles()) ?? [];
    if (paths.length === 0) return;
    setScanning(true);
    try {
      const loaded: Track[] = [];
      for (const p of paths) {
        const meta = await window.electronAPI?.library?.getMetadata(p);
        if (meta) loaded.push({ ...meta, source: 'local' as const, path: p });
      }
      if (loaded.length > 0) {
        const existing = useLibraryStore.getState().tracks;
        const map = new Map<string, Track>();
        for (const t of [...existing, ...loaded]) map.set(t.id, t);
        setTracks(Array.from(map.values()));
        setActiveTab('local');
      }
    } finally {
      setScanning(false);
    }
  }, [setTracks, setScanning]);

  const handleRescan = useCallback(async () => {
    if (!directories.length) return;
    setScanning(true);
    try {
      const current = useLibraryStore.getState().tracks;
      const results = await Promise.allSettled(directories.map(async (dir) => {
        const scanned = await window.electronAPI?.library?.scan(dir);
        if (!scanned) throw new Error('Library scanner unavailable');
        return scanned.map((meta: any): Track => ({
          ...meta,
          id: meta.path || meta.id,
          title: meta.title || 'Unknown Title',
          artist: meta.artist || 'Unknown Artist',
          duration: meta.duration || 0,
          source: 'local',
          path: meta.path,
          qualityBadge: meta.qualityBadge || meta.format || 'LOCAL',
        }));
      }));
      const succeeded = directories.filter((_, i) => results[i].status === 'fulfilled');
      const belongsTo = (path: string, dir: string) => {
        const normalized = dir.replace(/[\\/]+$/, '');
        return path === normalized || path.startsWith(`${normalized}/`) || path.startsWith(`${normalized}\\`);
      };
      // Keep separately imported files and the previous contents of failed folders.
      const merged = new Map(current.filter((track) => !track.path || !succeeded.some((dir) => belongsTo(track.path!, dir))).map((track) => [track.id, track]));
      for (const result of results) {
        if (result.status === 'fulfilled') for (const track of result.value) merged.set(track.id, track);
      }
      setTracks(Array.from(merged.values()));
      if (results.some((result) => result.status === 'rejected')) {
        pushToast('Не удалось обновить некоторые папки. Прежние треки сохранены.', 'error');
      }
    } finally {
      setScanning(false);
    }
  }, [directories, pushToast, setScanning, setTracks]);

  // Platform data loaders
  const loadSpotifyTab = useCallback(async () => {
    if (!spotifyConnected) return;
    setSpLoading(true);
    try {
      if (spSubTab === 'liked' && spTracks.length === 0) {
        const res = (await window.electronAPI?.spotify?.getLikedSongs(400, 0)) ?? [];
        setSpTracks(res);
        if (res.length > 0) upsertLikedSongs(res);
      } else if (spSubTab === 'playlists' && spPlaylists.length === 0) {
        const res = (await window.electronAPI?.spotify?.getPlaylists(50)) ?? [];
        setSpPlaylists(res);
        for (const p of res) {
          const pid = `sp_pl_${p.id}`;
          const existing = usePlayerStore.getState().playlists.find((x) => x.id === pid);
          savePlaylist({
            id: pid,
            externalId: p.id,
            name: p.name || 'Spotify Playlist',
            description: p.description || '',
            thumbnail: p.thumbnail,
            source: 'spotify',
            tags: ['Spotify'],
            trackCount: p.trackCount || existing?.trackCount || 0,
            tracks: existing?.tracks || [],
            updatedAt: Date.now(),
          });
        }
      } else if (spSubTab === 'top' && spTopTracks.length === 0) {
        const res = (await window.electronAPI?.spotify?.getTopTracks(40)) ?? [];
        setSpTopTracks(res);
      } else if (spSubTab === 'albums' && spAlbums.length === 0) {
        const res = (await window.electronAPI?.spotify?.getSavedAlbums(40)) ?? [];
        setSpAlbums(res);
      } else if (spSubTab === 'artists' && spArtists.length === 0) {
        const res = (await window.electronAPI?.spotify?.getFollowedArtists(40)) ?? [];
        setSpArtists(res);
      }
    } catch (err) {
      console.error('Spotify load error', err);
    } finally {
      setSpLoading(false);
    }
  }, [spotifyConnected, spSubTab, spTracks.length, spPlaylists.length, spTopTracks.length, spAlbums.length, spArtists.length, upsertLikedSongs, savePlaylist]);

  const loadYtmTab = useCallback(async () => {
    if (!ytmConnected) return;
    setYtmLoading(true);
    try {
      if (ytmSubTab === 'liked' && ytmTracks.length === 0) {
        const res = (await window.electronAPI?.ytmAuth?.getLikedSongs(false)) ?? [];
        setYtmTracks(res);
        if (res.length > 0) upsertLikedSongs(res);
      } else if (ytmSubTab === 'playlists' && ytmPlaylists.length === 0) {
        const res = (await window.electronAPI?.ytmAuth?.getLibraryPlaylists()) ?? [];
        setYtmPlaylists(res);
        for (const p of res) {
          const rawId = String(p.id || '').replace(/^VL/, '');
          if (!rawId) continue;
          const pid = `yt_pl_${rawId}`;
          const existing = usePlayerStore.getState().playlists.find((x) => x.id === pid);
          savePlaylist({
            id: pid,
            externalId: rawId,
            name: p.title || p.name || 'YTM Playlist',
            description: p.subtitle || '',
            thumbnail: p.thumbnail,
            source: 'youtube',
            tags: ['YouTube Music'],
            trackCount: p.trackCount || existing?.trackCount || 0,
            tracks: existing?.tracks || [],
            updatedAt: Date.now(),
          });
        }
      } else if (ytmSubTab === 'subscriptions' && ytmSubs.length === 0) {
        const res = (await window.electronAPI?.ytmAuth?.getSubscriptions()) ?? [];
        setYtmSubs(res);
      }
    } catch (err) {
      console.error('YTM load error', err);
    } finally {
      setYtmLoading(false);
    }
  }, [ytmConnected, ytmSubTab, ytmTracks.length, ytmPlaylists.length, ytmSubs.length, upsertLikedSongs, savePlaylist]);

  const loadSoundCloudTab = useCallback(async () => {
    setScLoading(true);
    try {
      if (scSubTab === 'charts') {
        const res = (await window.electronAPI?.soundcloud?.getGenreCharts(scGenre, 30)) ?? [];
        setScCharts(res);
      } else if (scConnected) {
        if (scSubTab === 'liked' && scTracks.length === 0) {
          const res = (await window.electronAPI?.soundcloud?.getLikedTracks(40)) ?? [];
          setScTracks(res);
        } else if (scSubTab === 'playlists' && scPlaylists.length === 0) {
          const res = (await window.electronAPI?.soundcloud?.getPlaylists(30)) ?? [];
          setScPlaylists(res);
        } else if (scSubTab === 'feed' && scFeed.length === 0) {
          const res = (await window.electronAPI?.soundcloud?.getFollowingFeed(40)) ?? [];
          setScFeed(res);
        }
      }
    } catch (err) {
      console.error('SoundCloud load error', err);
    } finally {
      setScLoading(false);
    }
  }, [scConnected, scSubTab, scGenre, scTracks.length, scPlaylists.length, scFeed.length]);

  useEffect(() => {
    if (activeTab === 'spotify') void loadSpotifyTab();
    if (activeTab === 'ytmusic') void loadYtmTab();
    if (activeTab === 'soundcloud') void loadSoundCloudTab();
  }, [activeTab, spSubTab, ytmSubTab, scSubTab, scGenre, loadSpotifyTab, loadYtmTab, loadSoundCloudTab]);

  const filterTracks = useCallback(
    (list: Track[]) => {
      if (!filterQuery.trim()) return list;
      const q = filterQuery.toLowerCase();
      return list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          (t.album || '').toLowerCase().includes(q)
      );
    },
    [filterQuery]
  );

  const selectedPlaylist = useMemo(
    () => playlists.find((p) => p.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId]
  );

  // Lazy-load remote tracks when a synced Spotify or YouTube Music playlist is opened in Unified Playlists
  useEffect(() => {
    if (!selectedPlaylist || selectedPlaylist.tracks.length > 0) return;
    let cancelled = false;
    const fetchRemotePlaylistTracks = async () => {
      if (selectedPlaylist.source === 'spotify') {
        setSelectedPlaylistLoading(true);
        try {
          const rawId = selectedPlaylist.externalId || selectedPlaylist.id.replace(/^sp_pl_/, '');
          const loaded = (await window.electronAPI?.spotify?.getPlaylistTracks(rawId)) ?? [];
          if (!cancelled && loaded.length > 0) {
            savePlaylist({
              ...selectedPlaylist,
              tracks: loaded,
              trackCount: loaded.length,
              updatedAt: Date.now(),
            });
          }
        } finally {
          if (!cancelled) setSelectedPlaylistLoading(false);
        }
      } else if (selectedPlaylist.source === 'youtube') {
        setSelectedPlaylistLoading(true);
        try {
          const rawId = selectedPlaylist.externalId || selectedPlaylist.id.replace(/^yt_pl_/, '');
          const plData = await window.electronAPI?.ytmusic?.getPlaylist(rawId);
          if (!cancelled && plData?.tracks && plData.tracks.length > 0) {
            savePlaylist({
              ...selectedPlaylist,
              tracks: plData.tracks,
              trackCount: plData.tracks.length,
              updatedAt: Date.now(),
            });
          }
        } finally {
          if (!cancelled) setSelectedPlaylistLoading(false);
        }
      }
    };
    void fetchRemotePlaylistTracks();
    return () => {
      cancelled = true;
    };
  }, [selectedPlaylist?.id, selectedPlaylist?.tracks.length]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const p of playlists) {
      for (const t of p.tags || []) s.add(t);
    }
    return Array.from(s);
  }, [playlists]);

  const filteredPlaylists = useMemo(() => {
    let list = playlists;
    if (playlistSourceFilter !== 'all') {
      list = list.filter((p) => p.source === playlistSourceFilter);
    }
    if (selectedTag !== 'all') {
      list = list.filter((p) => p.tags?.includes(selectedTag));
    }
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [playlists, playlistSourceFilter, selectedTag, filterQuery]);

  const activeTrackList = useMemo(() => {
    if (activeTab === 'liked') {
      const bySource =
        likedSourceFilter === 'all'
          ? likedSongs
          : likedSongs.filter((t) => t.source === likedSourceFilter);
      return filterTracks(bySource);
    }
    if (activeTab === 'local') return filterTracks(tracks);
    if (activeTab === 'history') return filterTracks(history);
    if (activeTab === 'playlists' && selectedPlaylist) return filterTracks(selectedPlaylist.tracks || []);
    return [];
  }, [activeTab, likedSongs, likedSourceFilter, tracks, history, selectedPlaylist, filterTracks]);

  const handlePlayList = (list: Track[]) => {
    if (list.length === 0) return;
    void playFromQueue(list);
  };

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const item: PlaylistItem = {
      id: `pl_${Date.now()}`,
      name: newPlaylistName.trim(),
      source: 'local',
      tags: newPlaylistTag
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      trackCount: 0,
      tracks: [],
      updatedAt: Date.now(),
    };
    savePlaylist(item);
    setNewPlaylistName('');
    setNewPlaylistTag('');
    setShowNewPlaylist(false);
    setSelectedPlaylistId(item.id);
    pushToast(`Плейлист «${item.name}» создан`, 'success');
  };

  const handleImportByUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importUrlValue.trim()) return;
    setImportLoading(true);
    try {
      const res = await window.electronAPI?.playlists?.importFromUrl(importUrlValue.trim());
      if (res?.ok && res.playlist) {
        savePlaylist(res.playlist);
        setImportUrlValue('');
        setShowImportUrl(false);
        setSelectedPlaylistId(res.playlist.id);
        pushToast(`Импортирован «${res.playlist.name}» (${res.playlist.tracks.length} треков)`, 'success');
      } else {
        pushToast(res?.error || 'Не удалось импортировать плейлист', 'error');
      }
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportFile = async () => {
    const res = await window.electronAPI?.playlists?.importFromFile();
    if (res?.ok && res.playlist) {
      savePlaylist(res.playlist);
      setSelectedPlaylistId(res.playlist.id);
      pushToast(`Импортирован «${res.playlist.name}»`, 'success');
    } else if (res && !res.canceled && res.error) {
      pushToast(res.error, 'error');
    }
  };

  const handleExportPlaylist = async (plId: string, format: 'm3u8' | 'json') => {
    const res = await window.electronAPI?.playlists?.export(plId, format);
    if (res?.ok) {
      pushToast(`Экспортировано (${format.toUpperCase()})`, 'success');
    } else if (res?.error) {
      pushToast(res.error, 'error');
    }
  };

  const tabs: Array<{ id: MainTab; label: string; count?: number; badge?: string }> = [
    { id: 'liked', label: 'Любимые', count: likedSongs.length },
    { id: 'playlists', label: 'Плейлисты', count: playlists.length },
    { id: 'local', label: 'На устройстве', count: tracks.length },
    { id: 'offline', label: 'Загрузки' },
    { id: 'history', label: 'История', count: history.length },
    { id: 'blocked', label: 'Скрытые артисты', count: blockedArtists.length },
    { id: 'spotify', label: 'Spotify', badge: spotifyConnected ? 'ON' : undefined },
    { id: 'ytmusic', label: 'YouTube Music', badge: ytmConnected ? 'ON' : undefined },
    { id: 'soundcloud', label: 'SoundCloud', badge: scConnected ? 'ON' : undefined },
  ];

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>Медиатека</h1>
          <p className="screen-description">
            {trackCount(likedSongs.length)} в любимых · {formatCount(playlists.length, 'плейлист', 'плейлиста', 'плейлистов')}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(spotifyConnected || ytmConnected || scConnected) && (
            <button
              onClick={() => void syncAllPlatforms(true)}
              disabled={syncingAll}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-bold transition disabled:opacity-50"
              title="Синхронизировать любимые треки и плейлисты из Spotify, YouTube Music и SoundCloud"
            >
              <RefreshCw size={14} className={syncingAll ? 'animate-spin text-primary' : 'text-primary'} />
              <span>{syncingAll ? 'Синхронизация…' : 'Синхронизировать всё'}</span>
            </button>
          )}
          {activeTrackList.length > 0 && (
            <button
              onClick={() => handlePlayList(activeTrackList)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary hover:opacity-90 text-xs font-bold shadow-md shadow-primary/20"
            >
              <Play size={14} fill="currentColor" /> Слушать ({activeTrackList.length})
            </button>
          )}
          {activeTab === 'local' && (
            <>
              {directories.length > 0 && (
                <button
                  onClick={handleRescan}
                  disabled={scanning}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container text-on-surface-variant hover:bg-surface-container-high text-xs font-semibold disabled:opacity-50"
                >
                  <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} /> Пересканировать
                </button>
              )}
              <button
                onClick={handleAddFiles}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container text-on-surface hover:bg-surface-container-high text-xs font-semibold"
              >
                <FileAudio size={14} /> Файлы
              </button>
              <button
                onClick={handleAddDirectory}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-high text-on-surface hover:bg-surface-container-highest text-xs font-semibold"
              >
                <FolderOpen size={14} /> Папка
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Navigation Tabs (Unified + Spotify + YTM + SC) + Filter */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="library-tabs flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                aria-pressed={active}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id !== 'playlists') setSelectedPlaylistId(null);
                }}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  active
                    ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
                    : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className={`text-[10px] opacity-80`}>({tab.count})</span>
                )}
                {tab.badge && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      active ? 'bg-on-primary' : 'bg-emerald-400'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="search-field flex items-center gap-2 bg-surface-container px-3 py-2.5 rounded-xl w-full sm:w-72">
          <Search size={14} className="text-on-surface-variant" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            aria-label="Фильтр медиатеки"
            placeholder="Фильтр по названию или артисту…"
            className="search-input bg-transparent text-xs text-on-surface placeholder-on-surface-variant outline-none w-full"
          />
        </div>
      </div>

      {/* Scanning banner */}
      {scanning && (
        <div className="flex items-center gap-3 text-on-surface-variant bg-surface-container rounded-xl p-4">
          <RefreshCw size={16} className="animate-spin text-primary" />
          <span className="text-sm">Ищем аудиофайлы и считываем теги…</span>
        </div>
      )}

      {/* ==================== TAB: LIKED / LOCAL / HISTORY ==================== */}
      {activeTab === 'offline' && <OfflineLibrary query={filterQuery} />}

      {(activeTab === 'liked' || activeTab === 'local' || activeTab === 'history') && (
        <>
          {activeTab === 'liked' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'all', label: `Все платформы (${likedSongs.length})` },
                {
                  id: 'spotify',
                  label: `Spotify (${likedSongs.filter((t) => t.source === 'spotify').length})`,
                },
                {
                  id: 'youtube',
                  label: `YouTube Music (${likedSongs.filter((t) => t.source === 'youtube').length})`,
                },
                {
                  id: 'soundcloud',
                  label: `SoundCloud (${likedSongs.filter((t) => t.source === 'soundcloud').length})`,
                },
                {
                  id: 'local',
                  label: `Локальные (${likedSongs.filter((t) => t.source === 'local').length})`,
                },
              ].map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setLikedSourceFilter(pill.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    likedSourceFilter === pill.id
                      ? 'bg-primary/20 text-primary  '
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          )}

          {activeTrackList.length > 0 ? (
            <LibraryTrackList
              key={activeTab}
              tracks={activeTrackList}
              onEditTags={activeTab === 'local' ? setTagEditorTrack : undefined}
            />
          ) : !scanning ? (
            <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant gap-4 bg-surface-container/40 rounded-3xl">
              {activeTab === 'liked' ? (
                <Heart size={44} className="text-primary/40" />
              ) : activeTab === 'local' ? (
                <HardDrive size={44} className="text-primary/40" />
              ) : (
                <History size={44} className="text-primary/40" />
              )}
              <div className="text-center space-y-1">
                <p className="text-base font-bold text-on-surface">
                  {activeTab === 'liked'
                    ? 'Нет любимых треков'
                    : activeTab === 'local'
                      ? 'Локальные папки не добавлены'
                      : 'История прослушивания пуста'}
                </p>
                <p className="text-xs max-w-sm">
                  {activeTab === 'liked'
                    ? 'Ставьте ❤️ трекам или синхронизируйте Spotify / YouTube Music / SoundCloud.'
                    : activeTab === 'local'
                      ? 'Добавьте папку с MP3, FLAC, WAV, OPUS или M4A. Доступен встроенный редактор тегов.'
                      : 'Включите любой трек, чтобы начать собирать историю.'}
                </p>
              </div>
              {activeTab === 'local' && (
                <button
                  onClick={handleAddDirectory}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold"
                >
                  <FolderOpen size={15} /> Выбрать папку
                </button>
              )}
            </div>
          ) : null}
        </>
      )}

      {/* ==================== TAB: PLAYLISTS ==================== */}
      {activeTab === 'playlists' && (
        <div className="space-y-5">
          {/* Source Filter Pills for Unified Playlists */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { id: 'all', label: `Все плейлисты (${playlists.length})` },
              {
                id: 'spotify',
                label: `Spotify (${playlists.filter((p) => p.source === 'spotify').length})`,
              },
              {
                id: 'youtube',
                label: `YouTube Music (${playlists.filter((p) => p.source === 'youtube').length})`,
              },
              {
                id: 'soundcloud',
                label: `SoundCloud (${playlists.filter((p) => p.source === 'soundcloud').length})`,
              },
              {
                id: 'local',
                label: `Мои / Локальные (${playlists.filter((p) => p.source === 'local' || p.source === 'imported').length})`,
              },
            ].map((pill) => (
              <button
                key={pill.id}
                onClick={() => {
                  setPlaylistSourceFilter(pill.id as any);
                  setSelectedPlaylistId(null);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  playlistSourceFilter === pill.id
                    ? 'bg-primary/20 text-primary  '
                    : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowNewPlaylist((v) => !v)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold"
              >
                <Plus size={14} /> Создать
              </button>
              <button
                onClick={() => setShowImportUrl((v) => !v)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-container-high text-on-surface text-xs font-semibold hover:bg-surface-container-highest"
              >
                <Link2 size={14} /> Импорт по URL
              </button>
              <button
                onClick={handleImportFile}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-container-high text-on-surface text-xs font-semibold hover:bg-surface-container-highest"
              >
                <Upload size={14} /> Импорт M3U8 / JSON
              </button>
            </div>

            {allTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setSelectedTag('all')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                    selectedTag === 'all' ? 'bg-primary/20 text-primary' : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  Все теги
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(tag)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                      selectedTag === tag
                        ? 'bg-primary/20 text-primary'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {showNewPlaylist && (
            <form
              onSubmit={handleCreatePlaylist}
              className="p-4 rounded-2xl bg-surface-container flex flex-wrap gap-3 items-center"
            >
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="Название плейлиста…"
                className="flex-1 min-w-[180px] bg-surface-container-high px-3 py-2 rounded-xl text-xs text-on-surface outline-none"
                autoFocus
              />
              <input
                type="text"
                value={newPlaylistTag}
                onChange={(e) => setNewPlaylistTag(e.target.value)}
                placeholder="Теги через запятую (phonk, night)…"
                className="flex-1 min-w-[180px] bg-surface-container-high px-3 py-2 rounded-xl text-xs text-on-surface outline-none"
              />
              <button type="submit" className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold">
                Создать
              </button>
            </form>
          )}

          {showImportUrl && (
            <form
              onSubmit={handleImportByUrl}
              className="p-4 rounded-2xl bg-surface-container flex flex-wrap gap-3 items-center"
            >
              <input
                type="text"
                value={importUrlValue}
                onChange={(e) => setImportUrlValue(e.target.value)}
                placeholder="Вставьте URL плейлиста Spotify, YouTube Music или SoundCloud…"
                className="flex-1 min-w-[260px] bg-surface-container-high px-3 py-2 rounded-xl text-xs text-on-surface outline-none"
                autoFocus
              />
              <button
                type="submit"
                disabled={importLoading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold disabled:opacity-50"
              >
                {importLoading && <Loader2 size={13} className="animate-spin" />} Импортировать
              </button>
            </form>
          )}

          {selectedPlaylist ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3 p-4 rounded-2xl bg-surface-container">
                <div>
                  <button
                    onClick={() => setSelectedPlaylistId(null)}
                    className="text-xs text-primary font-semibold hover:underline mb-1"
                  >
                    ← Все плейлисты
                  </button>
                  <h2 className="text-lg font-black text-on-surface">{selectedPlaylist.name}</h2>
                  <p className="text-xs text-on-surface-variant">
                    {selectedPlaylist.tracks.length} треков • Источник: {selectedPlaylist.source}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePlayList(selectedPlaylist.tracks)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold"
                  >
                    <Play size={14} fill="currentColor" /> Играть
                  </button>
                  <button
                    onClick={() => void handleExportPlaylist(selectedPlaylist.id, 'm3u8')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container-high text-xs font-semibold text-on-surface"
                  >
                    <Download size={13} /> M3U8
                  </button>
                  <button
                    onClick={() => void handleExportPlaylist(selectedPlaylist.id, 'json')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container-high text-xs font-semibold text-on-surface"
                  >
                    <Download size={13} /> JSON
                  </button>
                  <button
                    onClick={() => {
                      deletePlaylist(selectedPlaylist.id);
                      setSelectedPlaylistId(null);
                    }}
                    className="p-2 rounded-xl bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                    title="Удалить плейлист"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {selectedPlaylistLoading ? (
                <div className="py-12 text-center text-sm text-on-surface-variant flex items-center justify-center gap-2">
                  <Loader2 size={18} className="animate-spin text-primary" />
                  <span>Загрузка треков плейлиста из {selectedPlaylist.source.toUpperCase()}…</span>
                </div>
              ) : (
                <LibraryTrackList key={selectedPlaylist.id} tracks={activeTrackList} />
              )}
            </div>
          ) : filteredPlaylists.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredPlaylists.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => setSelectedPlaylistId(pl.id)}
                  className="p-4 rounded-2xl bg-surface-container hover:bg-surface-container-high cursor-pointer transition-all flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-surface-container-highest overflow-hidden shrink-0 flex items-center justify-center">
                      {pl.thumbnail ? (
                        <img src={pl.thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ListMusic size={20} className="text-primary" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-on-surface truncate">{pl.name}</p>
                      <p className="text-[11px] text-on-surface-variant">
                        {pl.tracks.length || pl.trackCount || 0} треков • {pl.source.toUpperCase()}
                      </p>
                      {pl.tags && pl.tags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {pl.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px] font-bold"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-on-surface-variant shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-on-surface-variant">
              <ListMusic size={40} className="mx-auto mb-3 text-primary/40" />
              <p className="text-sm font-semibold">Плейлистов пока нет</p>
              <p className="text-xs mt-1">Создайте плейлист или импортируйте его по ссылке.</p>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB: BLOCKED ARTISTS ==================== */}
      {activeTab === 'blocked' && (
        <div className="space-y-3">
          {blockedArtists.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {blockedArtists.map((artist) => (
                <div
                  key={artist}
                  className="p-4 rounded-2xl bg-surface-container flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Ban size={16} className="text-rose-400 shrink-0" />
                    <span className="text-sm font-semibold text-on-surface truncate">{artist}</span>
                  </div>
                  <button
                    onClick={() => toggleBlockArtist(artist)}
                    className="px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-primary hover:text-on-primary text-xs font-bold transition-colors"
                  >
                    Разблокировать
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-on-surface-variant">
              <Ban size={40} className="mx-auto mb-3 text-primary/40" />
              <p className="text-sm font-semibold">Скрытых артистов пока нет</p>
              <p className="text-xs mt-1">Чтобы скрыть артиста, откройте меню его трека.</p>
            </div>
          )}
        </div>
      )}

      {/* ==================== PLATFORM TAB 1: SPOTIFY ==================== */}
      {activeTab === 'spotify' && (
        <div className="space-y-4">
          {!spotifyConnected ? (
            <div className="p-10 rounded-3xl bg-surface-container/60 text-center space-y-4">
              <Disc3 size={44} className="mx-auto text-emerald-400" />
              <div>
                <h2 className="text-lg font-black text-on-surface">Spotify не подключён</h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  Авторизуйтесь через встроенный браузер или sp_dc, чтобы видеть Любимые, Плейлисты, Топ, Альбомы и Артистов.
                </p>
              </div>
              <button
                onClick={() => navigate('/integrations')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-black text-xs font-black"
              >
                <PlugZap size={14} /> Подключить Spotify
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {(
                    [
                      { id: 'liked', label: 'Любимые' },
                      { id: 'playlists', label: 'Плейлисты' },
                      { id: 'top', label: 'Топ-треки' },
                      { id: 'albums', label: 'Альбомы' },
                      { id: 'artists', label: 'Исполнители' },
                    ] as const
                  ).map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => {
                        setSpSubTab(sub.id);
                        setSpSelectedPlTracks(null);
                      }}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
                        spSubTab === sub.id
                          ? 'bg-emerald-500 text-black'
                          : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>

                {spSubTab === 'liked' && spTracks.length > 0 && (
                  <button
                    onClick={() => {
                      upsertLikedSongs(spTracks);
                      pushToast(`Синхронизировано ${spTracks.length} треков из Spotify в Единую библиотеку`, 'success');
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-primary/15 text-primary text-xs font-bold"
                  >
                    + В Единую библиотеку
                  </button>
                )}
              </div>

              {spLoading ? (
                <div className="flex items-center gap-2 py-12 justify-center text-on-surface-variant text-sm">
                  <Loader2 size={18} className="animate-spin text-emerald-400" /> Загрузка библиотеки Spotify…
                </div>
              ) : spSubTab === 'liked' ? (
                <div className="space-y-1">
                  {filterTracks(spTracks).map((t, i, filtered) => (
                    <TrackRow key={`sp-liked-${t.id}-${i}`} track={t} index={i} showIndex queue={filtered} />
                  ))}
                </div>
              ) : spSubTab === 'top' ? (
                <div className="space-y-1">
                  {filterTracks(spTopTracks).map((t, i, filtered) => (
                    <TrackRow key={`sp-top-${t.id}-${i}`} track={t} index={i} showIndex queue={filtered} />
                  ))}
                </div>
              ) : spSubTab === 'playlists' ? (
                spSelectedPlTracks ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setSpSelectedPlTracks(null)}
                        className="text-xs font-bold text-emerald-400 hover:underline"
                      >
                        ← Назад к плейлистам Spotify
                      </button>
                      <button
                        onClick={() => handlePlayList(spSelectedPlTracks.tracks)}
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-500 text-black text-xs font-bold"
                      >
                        Играть ({spSelectedPlTracks.tracks.length})
                      </button>
                    </div>
                    <h3 className="text-base font-black text-on-surface">{spSelectedPlTracks.title}</h3>
                    <div className="space-y-1">
                      {spSelectedPlTracks.tracks.map((t, i) => (
                        <TrackRow key={`sp-pl-t-${t.id}-${i}`} track={t} index={i} showIndex queue={spSelectedPlTracks.tracks} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {spPlaylists.map((pl: any) => (
                      <button
                        key={pl.id}
                        onClick={async () => {
                          setSpLoading(true);
                          try {
                            const pts = (await window.electronAPI?.spotify?.getPlaylistTracks(pl.id)) ?? [];
                            setSpSelectedPlTracks({ title: pl.name, tracks: pts });
                          } finally {
                            setSpLoading(false);
                          }
                        }}
                        className="p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high text-left space-y-2 transition-all"
                      >
                        <div className="aspect-square rounded-xl overflow-hidden bg-surface-container-highest">
                          {pl.thumbnail ? (
                            <img src={pl.thumbnail} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">🎶</div>
                          )}
                        </div>
                        <p className="text-xs font-bold text-on-surface truncate">{pl.name}</p>
                        <p className="text-[11px] text-on-surface-variant">{pl.trackCount || 0} треков</p>
                      </button>
                    ))}
                  </div>
                )
              ) : spSubTab === 'albums' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {spAlbums.map((alb: any) => (
                    <div
                      key={alb.id}
                      onClick={() => navigate(`/album/${encodeURIComponent(`${alb.artist} ${alb.title}`)}`)}
                      className="p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high cursor-pointer space-y-2"
                    >
                      <div className="aspect-square rounded-xl overflow-hidden bg-surface-container-highest flex items-center justify-center">
                        {alb.thumbnail ? (
                          <img src={alb.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <AlbumIcon size={24} className="text-on-surface-variant" />
                        )}
                      </div>
                      <p className="text-xs font-bold text-on-surface truncate">{alb.title}</p>
                      <p className="text-[11px] text-on-surface-variant truncate">{alb.artist}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {spArtists.map((art: any) => (
                    <div
                      key={art.id}
                      onClick={() => navigate(`/artist/${encodeURIComponent(art.name)}`)}
                      className="p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high cursor-pointer text-center space-y-2"
                    >
                      <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-surface-container-highest flex items-center justify-center">
                        {art.thumbnail ? (
                          <img src={art.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User size={22} />
                        )}
                      </div>
                      <p className="text-xs font-bold text-on-surface truncate">{art.name}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ==================== PLATFORM TAB 2: YOUTUBE MUSIC ==================== */}
      {activeTab === 'ytmusic' && (
        <div className="space-y-4">
          {!ytmConnected ? (
            <div className="p-10 rounded-3xl bg-surface-container/60 text-center space-y-4">
              <Radio size={44} className="mx-auto text-rose-400" />
              <div>
                <h2 className="text-lg font-black text-on-surface">YouTube Music не подключён</h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  Войдите в Google аккаунт (поддерживаются Brand-каналы и несколько профилей), чтобы синхронизировать Liked Music и подписки.
                </p>
              </div>
              <button
                onClick={() => navigate('/integrations')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500 text-white text-xs font-black"
              >
                <PlugZap size={14} /> Подключить YouTube Music
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  {(
                    [
                      { id: 'liked', label: 'Liked Music' },
                      { id: 'playlists', label: 'Плейлисты библиотеки' },
                      { id: 'subscriptions', label: 'Подписки' },
                    ] as const
                  ).map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => setYtmSubTab(sub.id)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
                        ytmSubTab === sub.id
                          ? 'bg-rose-500 text-white'
                          : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>

                {ytmSubTab === 'liked' && ytmTracks.length > 0 && (
                  <button
                    onClick={() => {
                      upsertLikedSongs(ytmTracks);
                      pushToast(`Синхронизировано ${ytmTracks.length} треков из YT Music`, 'success');
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-primary/15 text-primary text-xs font-bold"
                  >
                    + В Единую библиотеку
                  </button>
                )}
              </div>

              {ytmLoading ? (
                <div className="flex items-center gap-2 py-12 justify-center text-on-surface-variant text-sm">
                  <Loader2 size={18} className="animate-spin text-rose-400" /> Загрузка YouTube Music…
                </div>
              ) : ytmSubTab === 'liked' ? (
                <div className="space-y-1">
                  {filterTracks(ytmTracks).map((t, i, filtered) => (
                    <TrackRow key={`ytm-liked-${t.id}-${i}`} track={t} index={i} showIndex queue={filtered} />
                  ))}
                </div>
              ) : ytmSubTab === 'playlists' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {ytmPlaylists.map((pl: any) => (
                    <button
                      key={pl.id}
                      onClick={() => navigate(`/playlist/${encodeURIComponent(pl.id)}`)}
                      className="p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high text-left space-y-2 transition-all"
                    >
                      <div className="aspect-square rounded-xl overflow-hidden bg-surface-container-highest">
                        {pl.thumbnail ? (
                          <img src={pl.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">🎶</div>
                        )}
                      </div>
                      <p className="text-xs font-bold text-on-surface truncate">{pl.title}</p>
                      {pl.subtitle && <p className="text-[11px] text-on-surface-variant truncate">{pl.subtitle}</p>}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {ytmSubs.map((sub: any) => (
                    <button
                      key={sub.id}
                      onClick={() => navigate(`/artist/${encodeURIComponent(sub.id)}`)}
                      className="p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high text-center space-y-2"
                    >
                      <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-surface-container-highest flex items-center justify-center">
                        {sub.thumbnail ? (
                          <img src={sub.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User size={22} />
                        )}
                      </div>
                      <p className="text-xs font-bold text-on-surface truncate">{sub.name}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ==================== PLATFORM TAB 3: SOUNDCLOUD (SECONDARY) ==================== */}
      {activeTab === 'soundcloud' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {(
                [
                  { id: 'liked', label: 'Лайки' },
                  { id: 'playlists', label: 'Плейлисты' },
                  { id: 'feed', label: 'Лента подписок' },
                  { id: 'charts', label: 'Чарты по жанрам' },
                ] as const
              ).map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setScSubTab(sub.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
                    scSubTab === sub.id
                      ? 'bg-orange-500 text-black'
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {scSubTab === 'charts' && (
              <select
                value={scGenre}
                onChange={(e) => setScGenre(e.target.value)}
                className="bg-surface-container-high text-on-surface text-xs font-semibold px-3 py-1.5 rounded-xl outline-none"
              >
                <option value="all-music">Все жанры</option>
                <option value="electronic">Electronic</option>
                <option value="hiphoprap">Hip-Hop &amp; Rap</option>
                <option value="pop">Pop</option>
                <option value="rock">Rock</option>
                <option value="ambient">Ambient / Chill</option>
              </select>
            )}
          </div>

          {scSubTab !== 'charts' && !scConnected ? (
            <div className="p-10 rounded-3xl bg-surface-container/60 text-center space-y-4">
              <Music2 size={44} className="mx-auto text-orange-400" />
              <div>
                <h2 className="text-lg font-black text-on-surface">SoundCloud не подключён</h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  Публичные чарты работают сразу, а для лайков, плейлистов и ленты подключите OAuth-токен.
                </p>
              </div>
              <button
                onClick={() => navigate('/integrations')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 text-black text-xs font-black"
              >
                <PlugZap size={14} /> Подключить SoundCloud
              </button>
            </div>
          ) : scLoading ? (
            <div className="flex items-center gap-2 py-12 justify-center text-on-surface-variant text-sm">
              <Loader2 size={18} className="animate-spin text-orange-400" /> Загрузка SoundCloud…
            </div>
          ) : scSubTab === 'playlists' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {scPlaylists.map((pl: any, idx: number) => (
                <div
                  key={`${pl.id}-${idx}`}
                  onClick={() => {
                    if (Array.isArray(pl.tracks) && pl.tracks.length > 0) {
                      handlePlayList(pl.tracks);
                    }
                  }}
                  className="p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high cursor-pointer space-y-2"
                >
                  <div className="aspect-square rounded-xl overflow-hidden bg-surface-container-highest">
                    {pl.thumbnail ? (
                      <img src={pl.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">☁️</div>
                    )}
                  </div>
                  <p className="text-xs font-bold text-on-surface truncate">{pl.title || pl.name}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {filterTracks(
                scSubTab === 'liked' ? scTracks : scSubTab === 'feed' ? scFeed : scCharts
              ).map((t, i, arr) => (
                <TrackRow key={`sc-${scSubTab}-${t.id}-${i}`} track={t} index={i} showIndex queue={arr} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
