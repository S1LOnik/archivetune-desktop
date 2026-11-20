import { formatCount, trackCount } from '../lib/interfaceText';
import React, { useState, useMemo, useCallback, useDeferredValue, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Flame,
  Sparkles,
  Loader2,
  Play,
  RefreshCw,
  History,
  Disc3,
  Compass,
  PlugZap,
  Users,
  ListMusic,
  Shuffle,
} from 'lucide-react';
import TrackRow from '../components/TrackRow';
import FeaturedCarousel from '../components/FeaturedCarousel';
import HomeSectionNav from '../components/HomeSectionNav';
import { Track, usePlayerStore, useAccountsStore } from '../store';
import { usePlayer } from '../lib/usePlayer';

const EMPTY_TRACKS: Track[] = [];
const AI_SLOP_REGEX = /\b(ai generated|suno ai|udio ai|10 hours)\b/i;

interface HomeChip {
  title: string;
  params: string;
}

interface HomeMixPage {
  id: string;
  title: string;
  subtitle: string;
  source: 'youtube' | 'spotify';
  tracks: Track[];
}

interface YtmShelfItem {
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  type: 'song' | 'playlist' | 'album' | 'artist';
  duration?: number;
  source: 'youtube';
}

interface YtmShelf {
  title: string;
  items: YtmShelfItem[];
}

export default function HomePage() {
  const navigate = useNavigate();
  const introRef = useRef<HTMLDivElement>(null);
  const listenDrag = useRef<{ startX: number; scrollLeft: number; moved: boolean } | null>(null);
  const listenDragged = useRef(false);
  const queryClient = useQueryClient();
  const [selectedChip, setSelectedChip] = useState<HomeChip | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingShelfItem, setLoadingShelfItem] = useState<string | null>(null);

  const { playTrack, startRadio } = usePlayer();
  const setQueue = usePlayerStore(state => state.setQueue);
  const history = usePlayerStore(state => state.history);
  const likedSongs = usePlayerStore(state => state.likedSongs);
  const playlists = usePlayerStore(state => state.playlists);
  const blockedArtists = usePlayerStore(state => state.blockedArtists);
  const aiContentFilter = usePlayerStore(state => state.aiContentFilter);
  const { spotifyConnected, spotifyUser, ytmConnected, scConnected } = useAccountsStore();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return 'Доброй ночи';
    if (hour < 12) return 'Доброе утро';
    if (hour < 17) return 'Добрый день';
    return 'Добрый вечер';
  }, []);

  const { data: homeData, isLoading, isFetching } = useQuery<any>({
    queryKey: ['personalizedHome', selectedChip?.params || 'default', likedSongs.length, playlists.length],
    queryFn: async () => {
      const res = await window.electronAPI?.ytmusic?.getHome(selectedChip?.params, false);
      return res || {};
    },
    staleTime: 2 * 60 * 1000,
  });

  const spotifyHomeKey = ['spotifyPersonalizedHome', spotifyConnected, spotifyUser?.id] as const;
  const { data: spotifyHomeTracks = EMPTY_TRACKS } = useQuery<Track[]>({
    queryKey: spotifyHomeKey,
    queryFn: async () => (await window.electronAPI?.spotify?.getPersonalizedHome?.()) || EMPTY_TRACKS,
    enabled: spotifyConnected,
    staleTime: 10 * 60 * 1000,
  });

  const filterTracks = (list: Track[] = []): Track[] => {
    return list.filter((t) => {
      if (!t || !t.title) return false;
      if (blockedArtists.some((b) => t.artist?.toLowerCase().includes(b.toLowerCase()))) return false;
      if (aiContentFilter && (AI_SLOP_REGEX.test(t.title) || AI_SLOP_REGEX.test(t.artist || '')))
        return false;
      return true;
    });
  };

  const chips: HomeChip[] = homeData?.chips || [];
  const loadingTrackId = usePlayerStore((state) => state.loading ? state.currentTrack?.id : undefined);
  const rawQuickPicks = useMemo(() => filterTracks(homeData?.quickPicks || []), [homeData, blockedArtists, aiContentFilter]);

  // Balanced mixing of YouTube + Spotify with ~35% Spotify target ratio, enlarging to at least 36 when available
  const createBalancedRecommendations = useCallback(
    (ytTracks: Track[], spTracks: Track[], targetMax = 36): Track[] => {
      if (!ytTracks.length && !spTracks.length) return EMPTY_TRACKS;
      if (!ytTracks.length) return spTracks.slice(0, targetMax);
      if (!spTracks.length) return ytTracks.slice(0, targetMax);

      const available = ytTracks.length + spTracks.length;
      let total = Math.min(targetMax, available);
      // Preserve the Spotify share when one provider has a smaller candidate pool.
      // Shrink the carousel instead of filling the YouTube shortfall with extra Spotify tracks.
      while (total > 0) {
        const spotifyNeeded = Math.round(total * 0.35);
        const youtubeNeeded = total - spotifyNeeded;
        if (spotifyNeeded <= spTracks.length && youtubeNeeded <= ytTracks.length) break;
        total -= 1;
      }
      const spotifyTarget = Math.round(total * 0.35);
      const ytTarget = total - spotifyTarget;
      const actualTotal = ytTarget + spotifyTarget;

      let yIdx = 0;
      let sIdx = 0;
      const mixed: Track[] = [];

      for (let i = 0; i < actualTotal; i++) {
        const useSpotify =
          sIdx < spotifyTarget &&
          (yIdx >= ytTarget || Math.floor(((i + 1) * spotifyTarget) / actualTotal) > sIdx);

        if (useSpotify) {
          mixed.push(spTracks[sIdx++]);
        } else if (yIdx < ytTarget) {
          mixed.push(ytTracks[yIdx++]);
        }
      }
      return mixed;
    },
    []
  );

  const carouselTracks = useMemo(() => {
    const spTracks = spotifyConnected ? filterTracks(spotifyHomeTracks) : EMPTY_TRACKS;
    return createBalancedRecommendations(rawQuickPicks, spTracks.filter((_, i) => i % 3 !== 2), 60);
  }, [rawQuickPicks, spotifyHomeTracks, spotifyConnected, createBalancedRecommendations, blockedArtists, aiContentFilter]);

  const quickPicks = useMemo(() => {
    const spTracks = spotifyConnected ? filterTracks(spotifyHomeTracks) : EMPTY_TRACKS;
    const recent = filterTracks(homeData?.recentYoutube?.length ? homeData.recentYoutube : history.filter(t => t.source === 'youtube'));
    return createBalancedRecommendations(recent, spTracks.filter((_, i) => i % 3 === 2), 36);
  }, [homeData, history, spotifyHomeTracks, spotifyConnected, createBalancedRecommendations, blockedArtists, aiContentFilter]);

  const quickPickSources = [
    quickPicks.some((track) => track.source === 'youtube') ? 'Недавние треки из YouTube Music' : null,
    quickPicks.some((track) => track.source === 'spotify') ? 'Рекомендации Spotify' : null,
  ].filter(Boolean).join(' · ');

  const mixPages: HomeMixPage[] = useMemo(() => homeData?.mixPages || [], [homeData]);
  const keepListening = useMemo(
    () => filterTracks(homeData?.keepListening?.length ? homeData.keepListening : history),
    [homeData, history, blockedArtists, aiContentFilter]
  );
  const forgottenFavorites = useMemo(
    () => filterTracks(homeData?.forgottenFavorites?.length ? homeData.forgottenFavorites : likedSongs.slice(0, 18)),
    [homeData, likedSongs, blockedArtists, aiContentFilter]
  );
  const spotifyPlaylists = useMemo(
    () =>
      homeData?.spotifyPlaylists?.length
        ? homeData.spotifyPlaylists
        : playlists.filter((p) => p.source === 'spotify').slice(0, 12),
    [homeData, playlists]
  );
  const spotifyTracks = useMemo(
    () => filterTracks(homeData?.spotifyTracks || []),
    [homeData, blockedArtists, aiContentFilter]
  );
  const deferredHomeData = useDeferredValue(homeData);
  const ytmShelves: YtmShelf[] = deferredHomeData?.ytmShelves || [];
  const playCarouselTrack = useCallback((index: number) => {
    const track = carouselTracks[index];
    if (track) void startRadio(track);
  }, [carouselTracks, startRadio]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (spotifyConnected) {
        void window.electronAPI.spotify.getPersonalizedHome(true)
          .then(tracks => queryClient.setQueryData(spotifyHomeKey, tracks))
          .catch(() => {});
      }
      const res = await window.electronAPI?.ytmusic?.getHome(selectedChip?.params, true);
      queryClient.setQueryData(
        ['personalizedHome', selectedChip?.params || 'default', likedSongs.length, playlists.length],
        res
      );
    } catch (err) {
      console.error('Home refresh error', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePlayQueue = (queueList: Track[], index: number) => {
    if (!queueList[index]) return;
    setQueue(queueList, index);
    void playTrack(queueList[index]);
  };

  const handleShelfItemClick = async (item: YtmShelfItem, shelfSongs: Track[]) => {
    if (item.type === 'song') {
      const songTrack: Track = {
        id: item.id,
        title: item.title,
        artist: item.subtitle,
        duration: item.duration || 0,
        thumbnail: item.thumbnail,
        source: 'youtube',
      };
      const queueToUse = shelfSongs.length > 0 ? shelfSongs : [songTrack];
      const idx = Math.max(0, queueToUse.findIndex((s) => s.id === item.id));
      setQueue(queueToUse, idx);
      void playTrack(songTrack);
      return;
    }

    setLoadingShelfItem(item.id);
    try {
      if (item.type === 'album') {
        const album = await window.electronAPI?.ytmusic?.getAlbum(item.id);
        if (album?.tracks?.length) {
          setQueue(album.tracks, 0);
          void playTrack(album.tracks[0]);
        }
      } else if (item.type === 'artist') {
        const artist = await window.electronAPI?.ytmusic?.getArtist(item.id);
        const top = (artist as any)?.topSongs || (artist as any)?.songs || [];
        if (top.length > 0) {
          setQueue(top, 0);
          void playTrack(top[0]);
        }
      } else {
        const pl = await window.electronAPI?.ytmusic?.getPlaylist(item.id);
        if (pl?.tracks?.length) {
          setQueue(pl.tracks, 0);
          void playTrack(pl.tracks[0]);
        }
      }
    } catch (err) {
      console.warn('Shelf item open failed:', err);
    } finally {
      setLoadingShelfItem(null);
    }
  };

  const handlePlaySpotifyPlaylist = async (pl: any) => {
    if (pl.tracks && pl.tracks.length > 0) {
      setQueue(pl.tracks, 0);
      void playTrack(pl.tracks[0]);
      return;
    }
    const cleanId = String(pl.externalId || pl.id).replace(/^sp_pl_/, '');
    setLoadingShelfItem(pl.id);
    try {
      const fetched = await window.electronAPI?.spotify?.getPlaylistTracks(cleanId);
      if (fetched && fetched.length > 0) {
        setQueue(fetched, 0);
        void playTrack(fetched[0]);
      } else {
        navigate('/library');
      }
    } finally {
      setLoadingShelfItem(null);
    }
  };

  const sections = [
    ...(quickPicks.length ? [{ id: 'home-quick-picks', label: 'Быстрый выбор' }] : []),
    ...(ytmShelves.length ? [{ id: 'home-youtube', label: 'YouTube Music' }] : []),
    ...(mixPages.length ? [{ id: 'home-mixes', label: 'Миксы' }] : []),
    ...(spotifyPlaylists.length || spotifyTracks.length ? [{ id: 'home-spotify', label: 'Spotify' }] : []),
    ...(keepListening.length ? [{ id: 'home-recent', label: 'Послушать ещё раз' }] : []),
    ...(forgottenFavorites.length ? [{ id: 'home-collection', label: 'Из коллекции' }] : []),
  ];

  return (
    <div className="screen home-page">
      <div ref={introRef} className="home-intro">
        <header className="screen-header">
          <div>
            <h1 id="home-title" tabIndex={-1}>{greeting}</h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => navigate('/explore')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-all"
            >
              <Compass size={14} className="text-primary" /> Обзор
            </button>
            <button
              onClick={() => navigate('/together')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-all"
            >
              <Users size={14} className="text-primary" /> Вместе
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || isFetching}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/15 hover:bg-primary/25 text-xs font-bold text-primary transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={14} className={isRefreshing || isFetching ? 'animate-spin' : ''} />
              <span>{isRefreshing ? 'Обновление…' : 'Обновить'}</span>
            </button>
          </div>
        </header>

        <FeaturedCarousel tracks={carouselTracks} onPlay={playCarouselTrack} source={homeData?.quickPicksSource || 'unavailable'} />

        {/* Connected Ecosystem Banner / Quick Stations */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => {
              if (likedSongs.length > 0) {
                const shuffled = [...likedSongs].sort(() => Math.random() - 0.5);
                setQueue(shuffled, 0);
                void playTrack(shuffled[0]);
              } else if (quickPicks[0]) {
                void startRadio(quickPicks[0]);
              }
            }}
            className="quick-tile glass-card group p-4 rounded-2xl bg-gradient-to-br from-primary/25 via-primary/10 to-surface-container/70 text-left flex items-center justify-between"
          >
            <div className="space-y-1">
              <p className="text-sm font-bold text-on-surface">
                {likedSongs.length > 0 ? 'Любимые треки' : 'Радио по рекомендациям'}
              </p>
              {likedSongs.length > 0 && <p className="text-xs text-on-surface-variant">{trackCount(likedSongs.length)}</p>}
            </div>
            <div className="w-10 h-10 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <Shuffle size={16} />
            </div>
          </button>

          <button
            onClick={() => navigate('/library')}
            className="quick-tile glass-card p-4 rounded-2xl text-left flex items-center justify-between hover:bg-surface-container-high/80"
          >
            <div className="space-y-1">
              <p className="text-sm font-bold text-on-surface">Медиатека</p>
              <p className="text-xs text-on-surface-variant">
                {trackCount(likedSongs.length)} в любимых · {formatCount(playlists.length, 'плейлист', 'плейлиста', 'плейлистов')}
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-surface-container-highest text-[11px] font-bold text-primary">
              Открыть
            </span>
          </button>

          <button
            onClick={() => navigate('/integrations')}
            className="quick-tile glass-card p-4 rounded-2xl text-left flex items-center justify-between hover:bg-surface-container-high/80"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-bold text-on-surface">
                <PlugZap size={15} className="text-primary" /> Подключения
              </div>
              <p className="text-xs text-on-surface-variant">
                {[spotifyConnected && 'Spotify', ytmConnected && 'YouTube Music', scConnected && 'SoundCloud']
                  .filter(Boolean)
                  .join(' · ') || 'Подключите музыкальный сервис'}
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-surface-container-highest text-[11px] font-bold text-on-surface">
              Настроить
            </span>
          </button>
        </section>
      </div>

      {sections.length > 0 && <HomeSectionNav introRef={introRef} sections={sections} />}

      {/* Real YouTube Music Mood & Activity Chips (from FEmusic_home) */}
      {chips.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedChip(null)}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              selectedChip === null
                ? 'bg-primary text-on-primary shadow-lg shadow-primary/20'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            Все рекомендации
          </button>
          {chips.map((chip) => {
            const active = selectedChip?.params === chip.params;
            return (
              <button
                key={chip.title}
                onClick={() => setSelectedChip(active ? null : chip)}
                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  active
                    ? 'bg-primary text-on-primary shadow-lg shadow-primary/20'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                }`}
              >
                {chip.title}
              </button>
            );
          })}
        </div>
      )}

      {/* 1. Быстрый выбор (Personalized Quick Picks: YouTube Radio Seeds + Spotify Favorites) */}
      {quickPicks.length > 0 && (
        <section className="home-shelf space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-primary" />
              <div>
                <h2 id="home-quick-picks" tabIndex={-1} className="text-lg font-bold text-on-surface tracking-tight">Быстрый выбор</h2>
                <p className="text-[11px] text-on-surface-variant">
                  {quickPickSources}
                </p>
              </div>
            </div>
            <button
              onClick={() => handlePlayQueue(quickPicks, 0)}
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
            >
              <Play size={12} fill="currentColor" /> Слушать всё ({quickPicks.length})
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {quickPicks.slice(0, 36).map((track, i) => {
              const isLoading = loadingTrackId === track.id;
              const isSp = track.source === 'spotify' || track.id.startsWith('spotify:');
              return (
                <button
                  type="button"
                  key={`qp-${track.id}-${i}`}
                  aria-busy={isLoading || undefined}
                  onClick={() => void startRadio(track)}
                  className="quick-tile glass-card group text-left flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer"
                >
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-surface-container-highest shrink-0 shadow">
                    {track.thumbnail ? (
                      <img loading="lazy" decoding="async"
                        src={track.thumbnail}
                        alt=""
                        className="w-12 h-12 object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-12 h-12 flex items-center justify-center text-lg">🎵</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase shrink-0 border ${
                          isSp
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : 'bg-red-500/20 text-red-300 border-red-500/30'
                        }`}
                      >
                        {isSp ? 'Spotify' : 'YouTube'}
                      </span>
                      <p className="text-xs font-bold text-on-surface truncate">{track.title}</p>
                    </div>
                    <p className="text-[11px] text-on-surface-variant truncate mt-0.5">{track.artist}</p>
                  </div>
                  <div className={`mr-2 transition-opacity ${isLoading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-md">
                      {isLoading ? <Loader2 size={15} className="animate-spin playback-spinner" /> : <Play size={13} fill="currentColor" />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 6. Персональные полки YouTube Music (FEmusic_home shelves) */}
      {ytmShelves.map((shelf, sIdx) => {
        const shelfSongs: Track[] = shelf.items
          .filter((x) => x.type === 'song')
          .map((x) => ({
            id: x.id,
            title: x.title,
            artist: x.subtitle,
            duration: x.duration || 0,
            thumbnail: x.thumbnail,
            source: 'youtube' as const,
          }));
        return (
          <section key={`ytm-shelf-${sIdx}`} className="home-shelf space-y-3">
            <div className="flex items-center justify-between">
              <h2 id={sIdx === 0 ? 'home-youtube' : undefined} tabIndex={sIdx === 0 ? -1 : undefined} className="text-lg font-bold text-on-surface tracking-tight">{shelf.title}</h2>
              {shelfSongs.length > 0 && (
                <button
                  onClick={() => handlePlayQueue(shelfSongs, 0)}
                  className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                >
                  <Play size={12} fill="currentColor" /> Слушать всё
                </button>
              )}
            </div>
            <div className="flex gap-3.5 overflow-x-auto pb-2 scrollbar-none">
              {shelf.items.map((item, i) => (
                <div
                  key={`${item.id}-${i}`}
                  onClick={() => void handleShelfItemClick(item, shelfSongs)}
                  className="group w-40 shrink-0 p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high transition-all cursor-pointer flex flex-col gap-2"
                >
                  <div className="relative aspect-square rounded-xl overflow-hidden bg-surface-container-highest">
                    {item.thumbnail ? (
                      <img loading="lazy" decoding="async"
                        src={item.thumbnail}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl">🎵</div>
                    )}
                    <span className="absolute top-1.5 left-1.5 text-[9px] font-black px-1.5 py-0.5 rounded bg-black/70 text-red-300 uppercase">
                      {item.type === 'song' ? 'YT' : item.type}
                    </span>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg">
                        {loadingShelfItem === item.id ? (
                          <RefreshCw size={15} className="animate-spin" />
                        ) : (
                          <Play size={16} fill="currentColor" />
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-on-surface truncate">{item.title}</p>
                    <p className="text-[11px] text-on-surface-variant truncate">{item.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {!isLoading && !homeData?.ytmShelves?.length && !quickPicks.length && (
        <div className="p-5 rounded-2xl bg-surface-container text-sm text-on-surface-variant">
          {ytmConnected ? 'Не удалось получить рекомендации YouTube Music. Обновите страницу или переподключите аккаунт.' : 'Подключите YouTube Music в разделе «Интеграции», чтобы увидеть свои рекомендации.'}
        </div>
      )}

      {/* 2. Персональные миксы (HomeMixPagesSection port: 9 tracks per mix from YT & Spotify) */}
      {mixPages.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Disc3 size={18} className="text-primary" />
            <div>
              <h2 id="home-mixes" tabIndex={-1} className="text-lg font-bold text-on-surface tracking-tight">
                Персональные миксы для тебя
              </h2>
              <p className="text-[11px] text-on-surface-variant">
                По 9 треков в каждом миксе на основе твоих прослушиваний YouTube Music и Spotify
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {mixPages.slice(0, 8).map((mix) => {
              const isSp = mix.source === 'spotify';
              const covers = mix.tracks.map((t) => t.thumbnail).filter(Boolean).slice(0, 4);
              return (
                <div
                  key={mix.id}
                  onClick={() => handlePlayQueue(mix.tracks, 0)}
                  className="group p-3.5 rounded-2xl bg-surface-container hover:bg-surface-container-high transition-all cursor-pointer flex flex-col justify-between gap-3 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    {/* 2x2 Cover Collage */}
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface-container-highest grid grid-cols-2 grid-rows-2 shrink-0 shadow-md">
                      {covers.length >= 4 ? (
                        covers.map((c, idx) => (
                          <img loading="lazy" decoding="async" key={idx} src={c} alt="" className="w-full h-full object-cover" />
                        ))
                      ) : covers[0] ? (
                        <img loading="lazy" decoding="async" src={covers[0]} alt="" className="w-full h-full object-cover col-span-2 row-span-2" />
                      ) : (
                        <div className="col-span-2 row-span-2 flex items-center justify-center text-xl">💿</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span
                        className={`inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase mb-1 ${
                          isSp
                            ? 'bg-emerald-500/20 text-emerald-300  '
                            : 'bg-red-500/20 text-red-300  '
                        }`}
                      >
                        {isSp ? 'Spotify Jam' : 'YouTube Mix'}
                      </span>
                      <h3 className="text-sm font-black text-on-surface truncate">{mix.title}</h3>
                      <p className="text-[11px] text-on-surface-variant line-clamp-2 mt-0.5">
                        {mix.subtitle}
                      </p>
                    </div>
                  </div>

                  {/* Mini tracklist preview */}
                  <div className="space-y-1 pt-1">
                    {mix.tracks.slice(0, 3).map((t, idx) => (
                      <div key={`${t.id}-${idx}`} className="flex items-center justify-between text-[11px] gap-2">
                        <span className="text-on-surface/90 font-medium truncate">
                          {idx + 1}. {t.title}
                        </span>
                        <span className="text-on-surface-variant truncate max-w-[90px] shrink-0">
                          {t.artist}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] font-semibold text-on-surface-variant">
                      {mix.tracks.length} треков
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-primary group-hover:translate-x-0.5 transition-transform">
                      <Play size={12} fill="currentColor" /> Включить микс
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. Spotify: Плейлисты и Дейли Миксы (SpotifyDailyDiscoverSection port) */}
      {spotifyPlaylists.length > 0 && (
        <section className="home-shelf space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListMusic size={18} className="text-emerald-400" />
              <div>
                <h2 id="home-spotify" tabIndex={-1} className="text-lg font-bold text-on-surface tracking-tight">
                  Spotify: Твои плейлисты и миксы
                </h2>
                <p className="text-[11px] text-on-surface-variant">
                  Синхронизировано из твоего аккаунта Spotify
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate('/library')}
              className="text-xs font-bold text-emerald-400 hover:underline"
            >
              Все плейлисты ({spotifyPlaylists.length})
            </button>
          </div>

          <div className="flex gap-3.5 overflow-x-auto pb-2 scrollbar-none">
            {spotifyPlaylists.map((pl: any) => (
              <div
                key={pl.id}
                onClick={() => void handlePlaySpotifyPlaylist(pl)}
                className="group w-40 shrink-0 p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high transition-all cursor-pointer flex flex-col gap-2"
              >
                <div className="relative aspect-square rounded-xl overflow-hidden bg-surface-container-highest">
                  {pl.thumbnail ? (
                    <img loading="lazy" decoding="async"
                      src={pl.thumbnail}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl">💚</div>
                  )}
                  <span className="absolute top-2 left-2 text-[9px] font-black px-1.5 py-0.5 rounded bg-black/70 text-emerald-300">
                    SPOTIFY
                  </span>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-emerald-500 text-black flex items-center justify-center shadow-lg">
                      <Play size={18} fill="currentColor" />
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-on-surface truncate">{pl.name}</p>
                  <p className="text-[11px] text-on-surface-variant truncate">
                    {pl.trackCount ? `${pl.trackCount} треков` : pl.description || 'Spotify'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. Spotify: Избранные и рекомендуемые треки (SpotifyTrendingSection port) */}
      {spotifyTracks.length > 0 && (
        <section className="home-shelf space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame size={18} className="text-emerald-400" />
              <h2 id={spotifyPlaylists.length ? undefined : 'home-spotify'} tabIndex={spotifyPlaylists.length ? undefined : -1} className="text-lg font-bold text-on-surface tracking-tight">
                В твоём вкусе из Spotify
              </h2>
            </div>
            <button
              onClick={() => handlePlayQueue(spotifyTracks, 0)}
              className="text-xs font-bold text-emerald-400 hover:underline flex items-center gap-1"
            >
              <Play size={12} fill="currentColor" /> Играть подборку
            </button>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {spotifyTracks.slice(0, 14).map((track, i) => (
              <div
                key={`sp-top-${track.id}-${i}`}
                onClick={() => handlePlayQueue(spotifyTracks, i)}
                className="group w-36 shrink-0 p-2.5 rounded-2xl bg-surface-container hover:bg-surface-container-high transition-all cursor-pointer flex flex-col gap-2"
              >
                <div className="relative aspect-square rounded-xl overflow-hidden bg-surface-container-highest">
                  {track.thumbnail ? (
                    <img loading="lazy" decoding="async"
                      src={track.thumbnail}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">🎵</div>
                  )}
                  <span className="absolute top-1.5 left-1.5 text-[9px] font-black px-1.5 py-0.5 rounded bg-black/70 text-emerald-300">
                    SP
                  </span>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-9 h-9 rounded-full bg-emerald-500 text-black flex items-center justify-center shadow-lg">
                      <Play size={16} fill="currentColor" />
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-on-surface truncate">{track.title}</p>
                  <p className="text-[11px] text-on-surface-variant truncate">{track.artist}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Послушать ещё раз (YouTube Music History + Local History) */}
      {keepListening.length > 0 && (
        <section className="home-shelf space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History size={18} className="text-primary" />
              <div>
                <h2 id="home-recent" tabIndex={-1} className="text-lg font-bold text-on-surface tracking-tight">
                  Послушать ещё раз
                </h2>
                <p className="text-[11px] text-on-surface-variant">
                  Недавно прослушанное в YouTube Music и ArchiveTune
                </p>
              </div>
            </div>
            <button
              onClick={() => handlePlayQueue(keepListening, 0)}
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
            >
              <Play size={12} fill="currentColor" /> Слушать всё
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none cursor-grab active:cursor-grabbing select-none"
            onPointerDown={(event) => { if (event.button === 0 && event.pointerType === 'mouse') { listenDragged.current = false; listenDrag.current = { startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false }; } }}
            onPointerMove={(event) => { const drag = listenDrag.current; if (!drag) return; const delta = event.clientX - drag.startX; if (Math.abs(delta) > 5) { drag.moved = true; listenDragged.current = true; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.scrollLeft = drag.scrollLeft - delta; } }}
            onPointerUp={() => { listenDrag.current = null; }}
            onPointerCancel={() => { listenDrag.current = null; }}
            onClickCapture={(event) => { if (listenDragged.current) { event.preventDefault(); event.stopPropagation(); listenDragged.current = false; } }}
          >
            {keepListening.map((track, i) => (
              <div
                key={`keep-${track.id}-${i}`}
                onClick={() => handlePlayQueue(keepListening, i)}
                className="group w-36 shrink-0 p-2.5 rounded-2xl bg-surface-container hover:bg-surface-container-high transition-all duration-200 cursor-pointer flex flex-col gap-2 shadow-sm"
              >
                <div className="relative aspect-square rounded-xl overflow-hidden bg-surface-container-highest">
                  {track.thumbnail ? (
                    <img loading="lazy" decoding="async"
                      src={track.thumbnail}
                      alt=""
                      draggable={false}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">🎵</div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg">
                      <Play size={16} fill="currentColor" />
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-on-surface truncate">{track.title}</p>
                  <p className="text-[11px] text-on-surface-variant truncate">{track.artist}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 7. Забытые фавориты (Forgotten Favorites from Unified Library) */}
      {forgottenFavorites.length > 0 && (
        <section className="home-shelf space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="home-collection" tabIndex={-1} className="text-lg font-bold text-on-surface tracking-tight">
              Из вашей коллекции ({forgottenFavorites.length})
            </h2>
            <button
              onClick={() => handlePlayQueue(forgottenFavorites, 0)}
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              <Play size={12} fill="currentColor" /> Воспроизвести все
            </button>
          </div>
          <div className="space-y-1">
            {forgottenFavorites.slice(0, 15).map((track, i) => (
              <TrackRow
                key={`fav-${track.id}-${i}`}
                track={track}
                index={i}
                showIndex
                queue={forgottenFavorites}
              />
            ))}
          </div>
        </section>
      )}

      {isLoading && quickPicks.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-surface-container rounded-xl animate-pulse">
              <div className="w-12 h-12 rounded-lg bg-surface-container-high shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 bg-surface-container-high rounded w-2/5" />
                <div className="h-3 bg-surface-container-high rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
