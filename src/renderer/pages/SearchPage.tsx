import { useShallow } from 'zustand/react/shallow';
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Loader2,
  Disc3,
  User,
  ListMusic,
  Album as AlbumIcon,
  X,
  ArrowUpRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { trackCount } from '../lib/interfaceText';
import TrackRow from '../components/TrackRow';
import { Track, useSearchStore, usePlayerStore, AudioSourceId } from '../store';

type SearchSourceTab = 'all' | 'tidal' | 'qobuz' | 'youtube' | 'soundcloud' | 'deezer' | 'jiosaavn' | 'spotify';
type EntityFilter = 'all' | 'songs' | 'albums' | 'artists' | 'playlists';

const SOURCE_TABS: Array<{ id: SearchSourceTab; label: string }> = [
  { id: 'all', label: 'Все источники' },
  { id: 'tidal', label: 'Tidal' },
  { id: 'qobuz', label: 'Qobuz' },
  { id: 'youtube', label: 'YouTube Music' },
  { id: 'soundcloud', label: 'SoundCloud' },
  { id: 'deezer', label: 'Deezer' },
  { id: 'jiosaavn', label: 'JioSaavn' },
  { id: 'spotify', label: 'Spotify' },
];

let searchRequest = 0;

const AI_SPAM_PATTERNS = /\b(ai generated|suno ai|udio ai|10 hours|8d audio|slowed \+ reverb loop)\b/i;

export default function SearchPage() {
  const navigate = useNavigate();
  const {
    query,
    submittedQuery,
    searchError,
    results,
    albums,
    artists,
    playlists,
    sourceFilter,
    suggestions,
    searching,
    setQuery,
    setSubmittedQuery,
    setSearchError,
    setSearchAllResults,
    setSourceFilter,
    setSuggestions,
    setSearching,
  } = useSearchStore();
  const { blockedArtists, aiContentFilter } = usePlayerStore(useShallow((state) => ({
    blockedArtists: state.blockedArtists,
    aiContentFilter: state.aiContentFilter,
  })));

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem('archivetune.searchHistory') || '[]'); return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').slice(0, 20) : []; } catch { return []; }
  });
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const searched = Boolean(submittedQuery);
  const suggestionRequest = useRef(0);
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
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      suggestionRequest.current++;
    };
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setShowSuggestions(false);
    setSuggestions([]);
    const request = ++suggestionRequest.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) return;
    debounceRef.current = setTimeout(async () => {
      try {
        const list = (await window.electronAPI?.ytmusic?.getSuggestions(val.trim())) ?? [];
        if (request !== suggestionRequest.current) return;
        setSuggestions(list.slice(0, 7));
        setShowSuggestions(list.length > 0);
      } catch {
        if (request === suggestionRequest.current) setSuggestions([]);
      }
    }, 240);
  };

  const runSearch = useCallback(
    async (rawQ: string, src: SearchSourceTab) => {
      const q = rawQ.trim();
      if (!q) return;
      setSearchHistory((previous) => {
        const next = [q, ...previous.filter((item) => item.toLocaleLowerCase() !== q.toLocaleLowerCase())].slice(0, 20);
        try { localStorage.setItem('archivetune.searchHistory', JSON.stringify(next)); } catch { /* storage unavailable */ }
        return next;
      });
      setSearching(true);
      setSubmittedQuery(q);
      setSearchError(false);
      setEntityFilter('all');
      const request = ++searchRequest;
      suggestionRequest.current++;
      setSuggestions([]);
      const publish = (data: Parameters<typeof setSearchAllResults>[0]) => {
        if (request === searchRequest) setSearchAllResults(data);
      };
      setShowSuggestions(false);
      try {
        if (src === 'spotify') {
          const spRes = (await window.electronAPI?.spotify?.search(q, 30)) ?? [];
          publish({ songs: spRes, albums: [], artists: [], playlists: [] });
        } else if (src === 'youtube') {
          const ytmAll = await window.electronAPI?.ytmusic?.searchAll(q);
          publish(ytmAll || { songs: [], albums: [], artists: [], playlists: [] });
        } else if (src === 'all') {
          const [multiRes, ytmAll] = await Promise.allSettled([
            window.electronAPI?.providers?.searchMulti(q, 'all'),
            window.electronAPI?.ytmusic?.searchAll(q),
          ]);
          if (multiRes.status === 'rejected' && ytmAll.status === 'rejected') throw ytmAll.reason;
          const tracks =
            multiRes.status === 'fulfilled' && Array.isArray(multiRes.value)
              ? multiRes.value
              : ytmAll.status === 'fulfilled'
                ? ytmAll.value?.songs || []
                : [];
          const ytmData = ytmAll.status === 'fulfilled' ? ytmAll.value : null;
          publish({
            songs: [...(ytmData?.songs || []), ...tracks.filter((track) => !(ytmData?.songs || []).some((song) => song.id === track.id && song.source === track.source))],
            albums: ytmData?.albums || [],
            artists: ytmData?.artists || [],
            playlists: ytmData?.playlists || [],
          });
        } else {
          const multiRes = (await window.electronAPI?.providers?.searchMulti(q, src)) ?? [];
          publish({ songs: multiRes, albums: [], artists: [], playlists: [] });
        }
      } catch (err) {
        console.error('Search error', err);
        if (request === searchRequest) {
          publish({ songs: [], albums: [], artists: [], playlists: [] });
          setSearchError(true);
        }
      } finally {
        if (request === searchRequest) setSearching(false);
      }
    },
    [setSearchAllResults, setSearchError, setSearching, setSubmittedQuery, setSuggestions]
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
    <div className="screen">
      <header className="screen-header">
        <h1>Поиск</h1>
      </header>

      {/* Search bar + live suggestions dropdown */}
      <div ref={inputWrapperRef} className="relative">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="search-field flex-1 flex items-center gap-3 bg-surface-container-high rounded-2xl px-4 py-3 transition-colors shadow-sm">
            <Search size={18} className="text-on-surface-variant flex-shrink-0" />
            <input
              type="text"
              value={query}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              onChange={(e) => handleQueryChange(e.target.value)}
              aria-label="Поисковый запрос"
              placeholder="Трек, альбом, артист или плейлист"
              className="search-input min-w-0 flex-1 bg-transparent text-on-surface placeholder-on-surface-variant text-sm outline-none focus-visible:outline-none"
              autoFocus
            />
            {query && !searching && (
              <button
                type="button"
                aria-label="Очистить запрос"
                onClick={() => {
                  handleQueryChange('');
                  setSubmittedQuery('');
                  setSearchError(false);
                  setSearchAllResults({ songs: [], albums: [], artists: [], playlists: [] });
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
            disabled={!query.trim()}
            className="px-6 py-3 bg-primary text-on-primary rounded-2xl text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40 shadow-md shadow-primary/20"
          >
            Найти
          </button>
        </form>

        {showSuggestions && suggestions.length > 0 && (
          <div className="search-suggestions absolute left-0 right-24 top-full mt-2 z-40 rounded-2xl bg-surface-container-high shadow-xl overflow-hidden py-1">
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
      <div role="group" aria-label="Источники поиска" className="filter-group">
        {SOURCE_TABS.map((tab) => {
          const active = activeSourceTab === tab.id;
          return (
            <button
              key={tab.id}
              aria-pressed={active}
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
            </button>
          );
        })}
      </div>

      {!searched && searchHistory.length > 0 && (
        <section aria-label="История поиска" className="space-y-2">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Недавние запросы</h2><button type="button" className="text-xs text-on-surface-variant hover:text-primary" onClick={() => { setSearchHistory([]); try { localStorage.removeItem('archivetune.searchHistory'); } catch { /* storage unavailable */ } }}>Очистить</button></div>
          <div className="flex flex-wrap gap-2">{searchHistory.map((item) => <button type="button" key={item} onClick={() => { setQuery(item); void runSearch(item, activeSourceTab); }} className="rounded-full bg-surface-container-high px-3 py-1.5 text-xs hover:bg-primary/20 transition-colors">{item}</button>)}</div>
        </section>
      )}

      {/* Entity filter tabs when albums/artists/playlists exist */}
      {!searching && (filteredSongs.length > 0 || albums.length > 0 || artists.length > 0 || playlists.length > 0) && (
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
              aria-pressed={entityFilter === et.id}
              onClick={() => setEntityFilter(et.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                entityFilter === et.id
                  ? 'bg-surface-container-highest text-primary  '
                  : 'bg-surface-container/60 text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {et.label}
            </button>
          ))}
        </div>
      )}

      {/* Results sections */}
      {searching ? (
        <div className="status-panel" role="status">Ищем по выбранным источникам…</div>
      ) : searchError ? (
        <div className="status-panel" role="status">
          <p>Поиск не загрузился</p>
          <button className="text-primary font-semibold" onClick={() => void runSearch(submittedQuery, activeSourceTab)}>
            Повторить поиск
          </button>
        </div>
      ) : searched && filteredSongs.length === 0 && albums.length === 0 && artists.length === 0 && playlists.length === 0 ? (
        <div className="status-panel" role="status">
          <Disc3 size={28} aria-hidden="true" className="text-primary" />
          <p>По запросу «{submittedQuery}» ничего не найдено</p>
          <p className="screen-description">Уточните запрос или выберите другой источник.</p>
        </div>
      ) : searched && (
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
                      {alb.artist || alb.year || 'Альбом'}
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
                      {pl.author || 'Плейлист'}
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
                {trackCount(filteredSongs.length)} по запросу «{submittedQuery}»
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
