import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Loader2,
  Disc3,
  Sparkles,
  Radio,
  Music,
  User,
  ListMusic,
  Album as AlbumIcon,
  X,
  ArrowUpRight,
  SlidersHorizontal,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import TrackRow from '../components/TrackRow';
import { Track, useSearchStore, usePlayerStore, AudioSourceId } from '../store';

type SearchSourceTab = 'all' | 'tidal' | 'qobuz' | 'youtube' | 'soundcloud' | 'deezer' | 'jiosaavn' | 'spotify';
type EntityFilter = 'all' | 'songs' | 'albums' | 'artists' | 'playlists';

const SOURCE_TABS: Array<{ id: SearchSourceTab; label: string; badge?: string }> = [
  { id: 'all', label: 'Universal Matrix', badge: '8 источников' },
  { id: 'tidal', label: 'Tidal', badge: 'Lossless FLAC' },
  { id: 'qobuz', label: 'Qobuz', badge: 'Hi-Res 24-bit' },
  { id: 'youtube', label: 'YouTube Music', badge: 'InnerTube' },
  { id: 'soundcloud', label: 'SoundCloud', badge: 'API v2' },
  { id: 'deezer', label: 'Deezer', badge: 'Catalog' },
  { id: 'jiosaavn', label: 'JioSaavn', badge: '320kbps' },
  { id: 'spotify', label: 'Spotify', badge: 'Web API' },
];

const AI_SPAM_PATTERNS = /\b(ai generated|suno ai|udio ai|10 hours|8d audio|slowed \+ reverb loop)\b/i;

export default function SearchPage() {
  const navigate = useNavigate();
  const {
    query,
    results,
    albums,
    artists,
    playlists,
    sourceFilter,
    suggestions,
    searching,
    setQuery,
    setResults,
    setSearchAllResults,
    setSourceFilter,
    setSuggestions,
    setSearching,
  } = useSearchStore();
  const { blockedArtists, aiContentFilter } = usePlayerStore();

  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [searched, setSearched] = useState(results.length > 0 || albums.length > 0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (inputWrapperRef.current && !inputWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim() || val.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const list = (await window.electronAPI?.ytmusic?.getSuggestions(val.trim())) ?? [];
        setSuggestions(list.slice(0, 7));
        setShowSuggestions(list.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 240);
  };

  const runSearch = useCallback(
    async (rawQ: string, src: SearchSourceTab) => {
      const q = rawQ.trim();
      if (!q) return;
      setSearching(true);
      setSearched(true);
      setShowSuggestions(false);
      try {
        if (src === 'spotify') {
          const spRes = (await window.electronAPI?.spotify?.search(q, 30)) ?? [];
          setSearchAllResults({ songs: spRes, albums: [], artists: [], playlists: [] });
        } else if (src === 'youtube') {
          const ytmAll = await window.electronAPI?.ytmusic?.searchAll(q);
          setSearchAllResults(ytmAll || { songs: [], albums: [], artists: [], playlists: [] });
        } else if (src === 'all') {
          const [multiRes, ytmAll] = await Promise.allSettled([
            window.electronAPI?.providers?.searchMulti(q, 'all'),
            window.electronAPI?.ytmusic?.searchAll(q),
          ]);
          const tracks =
            multiRes.status === 'fulfilled' && Array.isArray(multiRes.value)
              ? multiRes.value
              : ytmAll.status === 'fulfilled'
                ? ytmAll.value?.songs || []
                : [];
          const ytmData = ytmAll.status === 'fulfilled' ? ytmAll.value : null;
          setSearchAllResults({
            songs: tracks,
            albums: ytmData?.albums || [],
            artists: ytmData?.artists || [],
            playlists: ytmData?.playlists || [],
          });
        } else {
          const multiRes = (await window.electronAPI?.providers?.searchMulti(q, src)) ?? [];
          setSearchAllResults({ songs: multiRes, albums: [], artists: [], playlists: [] });
        }
      } catch (err) {
        console.error('Search error', err);
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [setResults, setSearchAllResults, setSearching]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query, sourceFilter as SearchSourceTab);
  };

  const filteredSongs = useMemo(() => {
    return results.filter((t) => {
      if (blockedArtists.some((b) => t.artist.toLowerCase().includes(b.toLowerCase()))) return false;
      if (aiContentFilter && (AI_SPAM_PATTERNS.test(t.title) || AI_SPAM_PATTERNS.test(t.artist))) return false;
      return true;
    });
  }, [results, blockedArtists, aiContentFilter]);

  const activeSourceTab = (sourceFilter || 'all') as SearchSourceTab;

  return (
    <div className="p-6 space-y-6 pb-28">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-on-surface tracking-tight">
            Мульти-Поиск &amp; Universal Matrix
          </h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Живые подсказки YTM, альбомы, артисты, плейлисты и прямой поиск по Tidal / Qobuz / SoundCloud / Spotify
          </p>
        </div>
        {aiContentFilter && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/15 text-primary text-[11px] font-bold">
            <SlidersHorizontal size={12} /> Фильтр AI-спама активен
          </span>
        )}
      </div>

      {/* Search bar + live suggestions dropdown */}
      <div ref={inputWrapperRef} className="relative">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="flex-1 flex items-center gap-3 bg-surface-container-high rounded-2xl px-4 py-3 border border-outline-variant/40 focus-within:border-primary transition-colors shadow-sm">
            <Search size={18} className="text-on-surface-variant flex-shrink-0" />
            <input
              type="text"
              value={query}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Найти треки, альбомы, артистов, плейлисты или ISRC…"
              className="flex-1 bg-transparent text-on-surface placeholder-on-surface-variant text-sm outline-none"
              autoFocus
            />
            {query && !searching && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSuggestions([]);
                  setShowSuggestions(false);
                }}
                className="p-1 rounded-full hover:bg-surface-container text-on-surface-variant"
              >
                <X size={14} />
              </button>
            )}
            {searching && <Loader2 size={16} className="text-primary animate-spin flex-shrink-0" />}
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="px-6 py-3 bg-primary text-on-primary rounded-2xl text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40 shadow-md shadow-primary/20"
          >
            Найти
          </button>
        </form>

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-24 top-full mt-2 z-40 rounded-2xl bg-surface-container-high border border-outline-variant/30 shadow-2xl overflow-hidden py-1">
            {suggestions.map((sug, idx) => (
              <button
                key={`${sug}-${idx}`}
                type="button"
                onClick={() => {
                  setQuery(sug);
                  setShowSuggestions(false);
                  void runSearch(sug, activeSourceTab);
                }}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm text-on-surface hover:bg-primary/10 transition-colors"
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Search size={14} className="text-on-surface-variant shrink-0" />
                  <span className="truncate">{sug}</span>
                </span>
                <ArrowUpRight size={14} className="text-on-surface-variant shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Source Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {SOURCE_TABS.map((tab) => {
          const active = activeSourceTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setSourceFilter(tab.id as 'all' | AudioSourceId);
                if (query.trim()) void runSearch(query, tab.id);
              }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                active
                  ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                    active ? 'bg-black/20 text-on-primary' : 'bg-surface-container-highest text-primary'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Entity filter tabs when albums/artists/playlists exist */}
      {(filteredSongs.length > 0 || albums.length > 0 || artists.length > 0 || playlists.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {(
            [
              { id: 'all', label: 'Всё' },
              { id: 'songs', label: `Треки (${filteredSongs.length})` },
              { id: 'albums', label: `Альбомы (${albums.length})` },
              { id: 'artists', label: `Артисты (${artists.length})` },
              { id: 'playlists', label: `Плейлисты (${playlists.length})` },
            ] as Array<{ id: EntityFilter; label: string }>
          ).map((et) => (
            <button
              key={et.id}
              onClick={() => setEntityFilter(et.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                entityFilter === et.id
                  ? 'bg-surface-container-highest text-primary border border-primary/40'
                  : 'bg-surface-container/60 text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {et.label}
            </button>
          ))}
        </div>
      )}

      {/* Results sections */}
      {searched &&
      !searching &&
      filteredSongs.length === 0 &&
      albums.length === 0 &&
      artists.length === 0 &&
      playlists.length === 0 ? (
        <div className="text-center py-16 text-on-surface-variant">
          <Disc3 size={40} className="mx-auto mb-3 text-primary/40" />
          <p className="text-base font-semibold">Ничего не найдено</p>
          <p className="text-xs mt-1">Попробуйте сменить источник или уточнить запрос</p>
        </div>
      ) : !searched ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
          <div className="p-5 rounded-2xl bg-surface-container border border-outline-variant/20 space-y-2">
            <Sparkles size={22} className="text-primary" />
            <h3 className="text-sm font-bold text-on-surface">Tidal &amp; Qobuz Hi-Res</h3>
            <p className="text-xs text-on-surface-variant">
              Авто-подбор 16/24-bit FLAC потоков через Smart Stream Resolver &amp; TrackMatching.
            </p>
          </div>
          <div className="p-5 rounded-2xl bg-surface-container border border-outline-variant/20 space-y-2">
            <Radio size={22} className="text-primary" />
            <h3 className="text-sm font-bold text-on-surface">8-Platform Failover Matrix</h3>
            <p className="text-xs text-on-surface-variant">
              Моментальное переключение между Tidal, Qobuz, YouTube Music, Deezer, JioSaavn и SoundCloud.
            </p>
          </div>
          <div className="p-5 rounded-2xl bg-surface-container border border-outline-variant/20 space-y-2">
            <Music size={22} className="text-primary" />
            <h3 className="text-sm font-bold text-on-surface">Word-by-Word Караоке</h3>
            <p className="text-xs text-on-surface-variant">
              Синхронизация по словам через BetterLyrics, Paxsenix, NetEase и транслитерация.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Artists Grid */}
          {artists.length > 0 && (entityFilter === 'all' || entityFilter === 'artists') && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-2">
                <User size={15} className="text-primary" /> Исполнители
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {artists.slice(0, entityFilter === 'artists' ? 24 : 6).map((art: any, idx: number) => (
                  <button
                    key={`art-${art.id}-${idx}`}
                    onClick={() => navigate(`/artist/${encodeURIComponent(art.id)}`)}
                    className="group p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high text-center transition-all flex flex-col items-center gap-2"
                  >
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-surface-container-highest shadow">
                      {art.thumbnail ? (
                        <img
                          src={art.thumbnail}
                          alt={art.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-on-surface-variant">
                          <User size={28} />
                        </div>
                      )}
                    </div>
                    <p className="text-xs font-bold text-on-surface truncate w-full">{art.name}</p>
                    {art.subscribers && (
                      <p className="text-[10px] text-on-surface-variant truncate w-full">{art.subscribers}</p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Albums Grid */}
          {albums.length > 0 && (entityFilter === 'all' || entityFilter === 'albums') && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-2">
                <AlbumIcon size={15} className="text-primary" /> Альбомы
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {albums.slice(0, entityFilter === 'albums' ? 25 : 5).map((alb: any, idx: number) => (
                  <button
                    key={`alb-${alb.id}-${idx}`}
                    onClick={() => navigate(`/album/${encodeURIComponent(alb.id)}`)}
                    className="group p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high text-left transition-all flex flex-col gap-2"
                  >
                    <div className="aspect-square rounded-xl overflow-hidden bg-surface-container-highest w-full">
                      {alb.thumbnail ? (
                        <img
                          src={alb.thumbnail}
                          alt={alb.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">💿</div>
                      )}
                    </div>
                    <p className="text-xs font-bold text-on-surface truncate w-full">{alb.title}</p>
                    <p className="text-[11px] text-on-surface-variant truncate w-full">
                      {alb.artist || alb.year || 'Album'}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Playlists Grid */}
          {playlists.length > 0 && (entityFilter === 'all' || entityFilter === 'playlists') && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-2">
                <ListMusic size={15} className="text-primary" /> Плейлисты
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {playlists.slice(0, entityFilter === 'playlists' ? 25 : 5).map((pl: any, idx: number) => (
                  <button
                    key={`pl-${pl.id}-${idx}`}
                    onClick={() => navigate(`/playlist/${encodeURIComponent(pl.id)}`)}
                    className="group p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high text-left transition-all flex flex-col gap-2"
                  >
                    <div className="aspect-square rounded-xl overflow-hidden bg-surface-container-highest w-full">
                      {pl.thumbnail ? (
                        <img
                          src={pl.thumbnail}
                          alt={pl.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">🎶</div>
                      )}
                    </div>
                    <p className="text-xs font-bold text-on-surface truncate w-full">{pl.title}</p>
                    <p className="text-[11px] text-on-surface-variant truncate w-full">
                      {pl.author || 'Playlist'}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Tracks list */}
          {filteredSongs.length > 0 && (entityFilter === 'all' || entityFilter === 'songs') && (
            <section className="space-y-2">
              <p className="text-xs text-on-surface-variant px-2 font-semibold">
                Треки: {filteredSongs.length} результатов по запросу &ldquo;{query}&rdquo;
              </p>
              <div className="space-y-1">
                {filteredSongs.map((track: Track, i: number) => (
                  <TrackRow
                    key={`${track.source}-${track.id}-${i}`}
                    track={track}
                    index={i}
                    showIndex
                    queue={filteredSongs}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
