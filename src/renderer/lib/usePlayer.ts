/**
 * usePlayer.ts — React hook bridging Zustand store to Electron Dual-Deck mpv,
 * Universal Fallback Matrix, AutoMix Planner, Listen Together & Telemetry
 */

import { useCallback, useEffect } from 'react';
import {
  usePlayerStore,
  useUIStore,
  useAccountsStore,
} from '../store';
import type { Track, AudioSourceId } from '../types/electron';

async function resolveTrackStreamUrl(
  track: Track,
  forceSource?: AudioSourceId,
  priority: 'playback' | 'prebuffer' = 'playback'
): Promise<{
  url: string;
  spotifyId?: string;
  headers?: Record<string, string>;
  badge: string;
  actualSource: AudioSourceId | 'local';
  lossless: boolean;
  switched: boolean;
  switchedReason?: string;
}> {
  const api = window.electronAPI;
  if (!forceSource && track.source === 'local' && track.path) {
    return {
      url: `file://${track.path}`,
      badge: track.lossless
        ? `LOCAL ${track.codec || 'LOSSLESS'} • ${track.bitDepth || 16}bit`
        : `LOCAL ${track.codec || 'AUDIO'}`,
      actualSource: 'local',
      lossless: Boolean(track.lossless),
      switched: false,
    };
  }

  const uni = await api.providers.resolveUniversal(
    {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      source: track.source,
      path: track.path,
      spotifyUri: track.spotifyUri,
    },
    forceSource,
    { priority }
  );

  if (uni.streamUrl) {
    return {
      url: uni.streamUrl,
      spotifyId: uni.spotifyId,
      headers: uni.headers,
      badge: `${uni.actualSource.toUpperCase()} • ${uni.qualityLabel}`,
      actualSource: uni.actualSource,
      lossless: uni.lossless,
      switched: uni.switched,
      switchedReason: uni.switchedReason,
    };
  }

  throw new Error(uni.error || 'Could not resolve valid audio stream');
}

let prebufferGeneration = 0;
let prebufferTimer: ReturnType<typeof setTimeout> | null = null;
let playbackGeneration = 0;
let pendingPlaybackTrackId: string | null = null;
let playPauseChain = Promise.resolve();
let playbackCommandRevision = 0;
let slowLoadingTimer: ReturnType<typeof setTimeout> | null = null;

function cancelScheduledPrebuffer(): void {
  ++prebufferGeneration;
  if (prebufferTimer) {
    clearTimeout(prebufferTimer);
    prebufferTimer = null;
  }
}

function clearSlowLoadingTimer(): void {
  if (slowLoadingTimer) {
    clearTimeout(slowLoadingTimer);
    slowLoadingTimer = null;
  }
}

function schedulePrebufferUpcomingTrack(delayMs = 1800): void {
  cancelScheduledPrebuffer();
  const scheduledGen = prebufferGeneration;
  prebufferTimer = setTimeout(() => {
    prebufferTimer = null;
    if (scheduledGen !== prebufferGeneration) return;
    void prebufferUpcomingTrackInQueue(scheduledGen);
  }, delayMs);
}

async function prebufferUpcomingTrackInQueue(existingGen?: number): Promise<void> {
  const generation = existingGen ?? ++prebufferGeneration;
  const api = window.electronAPI;
  if (!api) return;

  const { queue, queueIndex, repeat, prebufferNextTrack, resolvedSourceId, isPlaying, loading } = usePlayerStore.getState();
  if (loading || !isPlaying) return;
  if (!prebufferNextTrack || repeat === 'one') {
    await api.player.prebufferNext(null);
    return;
  }
  if (queue.length === 0) {
    await api.player.prebufferNext(null);
    return;
  }

  let nextIdx = queueIndex + 1;
  if (nextIdx >= queue.length) {
    if (repeat === 'all') nextIdx = 0;
    else {
      await api.player.prebufferNext(null);
      return;
    }
  }

  const nextTrack = queue[nextIdx];
  if (!nextTrack) return;
  const nextUsesSpotify = nextTrack.source === 'spotify' || Boolean(nextTrack.spotifyUri)
    || /^(spotify:|https:\/\/open\.spotify\.com\/)/.test(nextTrack.id);
  // Open the next native track only after the current native session is playing.
  if (nextUsesSpotify && (!isPlaying || resolvedSourceId !== 'spotify')) {
    await api.player.prebufferNext(null);
    return;
  }

  try {
    const resolved = await resolveTrackStreamUrl(nextTrack, undefined, 'prebuffer');
    if (generation !== prebufferGeneration) return;
    await api.player.prebufferNext({
      url: resolved.url,
      headers: resolved.headers,
      meta: {
        id: nextTrack.id,
        title: nextTrack.title,
        artist: nextTrack.artist,
        album: nextTrack.album,
        duration: nextTrack.duration,
        source: resolved.actualSource,
        originalSource: nextTrack.source,
        spotifyUri: nextTrack.spotifyUri,
        spotifyId: resolved.spotifyId,
        thumbnail: nextTrack.thumbnail,
      },
    });
  } catch {
    if (generation === prebufferGeneration) await api.player.prebufferNext(null);
  }
}

function showPlaybackFeedback() {
  usePlayerStore.setState((state) => ({
    playbackStartAt: Math.max(performance.now(), state.playbackStartAt + 0.1),
  }));
}

export function usePlayer() {
  const {
    setCurrentTrack,
    setIsPlaying,
    setPosition,
    setDuration,
    setLoading,
    setLoadingStage,
    setPlaybackError,
    setTrackStartTimeSec,
    setResolvedStreamMeta,
    nextTrack,
    prevTrack,
  } = usePlayerStore.getState();

  const playTrack = useCallback(
    async (track: Track, forceSource?: AudioSourceId, showFeedback = true) => {
      const api = window.electronAPI;
      if (!api) return;

      const store = usePlayerStore.getState();
      const ui = useUIStore.getState();

      // Prevent duplicate concurrent play of same track unless explicit forceSource switch or retrying an error
      if (!forceSource && !store.playbackError && pendingPlaybackTrackId === track.id) return;

      ++playbackCommandRevision;
      const generation = ++playbackGeneration;
      pendingPlaybackTrackId = track.id;
      cancelScheduledPrebuffer();
      clearSlowLoadingTimer();
      setPlaybackError(null);
      setLoading(true);
      setLoadingStage('resolving');
      setCurrentTrack(track);
      setIsPlaying(false);
      if (showFeedback) showPlaybackFeedback();

      slowLoadingTimer = setTimeout(() => {
        if (generation === playbackGeneration && usePlayerStore.getState().loading) {
          setLoadingStage('slow');
        }
      }, 2200);

      const pausePrevious = api.player.pause().catch(() => {});
      void api.desktop?.updatePresence({ id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration, position: 0, isPlaying: false, thumbnail: track.thumbnail }).catch(() => {});
      // Use the saved cover before asking a CDN; apply artwork only to the current request.
      void (async () => {
        const saved = await api.offline?.find(track.id).catch(() => null);
        if (generation !== playbackGeneration) return;
        const thumbnail = saved?.track?.thumbnail || track.thumbnail;
        if (thumbnail && thumbnail !== track.thumbnail) {
          usePlayerStore.setState(state => ({
            currentTrack: state.currentTrack && state.currentTrack.id === track.id
              ? { ...state.currentTrack, thumbnail }
              : state.currentTrack,
          }));
        }
      })();
      setResolvedStreamMeta(forceSource ? `Подключаем ${forceSource.toUpperCase()}…` : 'Ищем аудиопоток…', null, false);

      try {
        const resolved = await resolveTrackStreamUrl(track, forceSource, 'playback');
        await pausePrevious;
        if (generation !== playbackGeneration) return;
        setLoadingStage('buffering');
        setResolvedStreamMeta(resolved.badge, resolved.actualSource, resolved.lossless, resolved.spotifyId);

        if (ui.showSmartSwitchToasts && resolved.switched && resolved.switchedReason) {
          ui.pushToast(
            resolved.switchedReason,
            resolved.lossless ? 'lossless' : 'switch'
          );
        } else if (forceSource) {
          ui.pushToast(`Источник переключён: ${resolved.badge}`, resolved.lossless ? 'lossless' : 'switch');
        }

        const latestThumbnail = usePlayerStore.getState().currentTrack?.id === track.id
          ? usePlayerStore.getState().currentTrack?.thumbnail || track.thumbnail
          : track.thumbnail;

        const res = await api.player.play(resolved.url, {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          source: resolved.actualSource,
          originalSource: track.source,
          spotifyUri: track.spotifyUri,
          spotifyId: resolved.spotifyId,
          thumbnail: latestThumbnail,
          headers: resolved.headers,
          strictSource: Boolean(forceSource),
        });

        if (generation !== playbackGeneration) return;
        if (!res.ok) {
          throw new Error(res.error || 'mpv failed to start stream');
        }

        clearSlowLoadingTimer();
        setLoadingStage('idle');
        setPlaybackError(null);
        store.addToHistory(track);
        setIsPlaying(true);
        setTrackStartTimeSec(Date.now() / 1000);
        if (track.duration) setDuration(track.duration);

        // Scrobbling & OS Presence + Stats
        const presencePayload = {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          position: 0,
          isPlaying: true,
          thumbnail: latestThumbnail,
        };
        api.desktop?.updatePresence(presencePayload).catch(() => {});
        api.scrobble?.updateNowPlaying(track).catch(() => {});
        if (ui.listenBrainzEnabled) {
          api.desktop?.listenBrainzNowPlaying(presencePayload).catch(() => {});
        }
        api.db?.recordStats(track, 0).catch(() => {});

        // Broadcast Listen Together if host
        const togetherRole = useAccountsStore.getState().together.role;
        if (togetherRole === 'host') {
          api.together?.syncHostState({ track, position: 0, isPlaying: true }).catch(() => {});
        }

        schedulePrebufferUpcomingTrack(1800);
      } catch (err: any) {
        if (generation !== playbackGeneration) return;
        clearSlowLoadingTimer();
        const message = err?.message || 'Поток недоступен';
        console.error('Playback error:', err);
        useUIStore.getState().pushToast(`Ошибка воспроизведения: ${message}`, 'error');
        setPlaybackError(message);
        setLoadingStage('idle');
        setResolvedStreamMeta('Поток недоступен', null, false);
        setIsPlaying(false);
      } finally {
        if (generation === playbackGeneration) {
          clearSlowLoadingTimer();
          pendingPlaybackTrackId = null;
          setLoading(false);
          if (usePlayerStore.getState().loadingStage !== 'idle') setLoadingStage('idle');
        }
      }
    },
    [
      setLoading,
      setLoadingStage,
      setPlaybackError,
      setCurrentTrack,
      setResolvedStreamMeta,
      setIsPlaying,
      setTrackStartTimeSec,
      setDuration,
    ]
  );

  const retryCurrentTrack = useCallback(async () => {
    const track = usePlayerStore.getState().currentTrack;
    if (track) await playTrack(track, undefined, true);
  }, [playTrack]);

  const playFromQueue = useCallback(
    async (tracks: Track[], index = 0) => {
      usePlayerStore.getState().setQueue(tracks, index);
      const track = usePlayerStore.getState().currentTrack;
      if (track) await playTrack(track);
    },
    [playTrack]
  );

  const startRadio = useCallback(
    async (seedTrack: Track) => {
      const api = window.electronAPI;
      const ui = useUIStore.getState();
      if (!api) return;
      ui.pushToast(`Запуск радио по "${seedTrack.title}"...`, 'info');
      usePlayerStore.getState().setQueue([seedTrack], 0);
      const radioQueue = usePlayerStore.getState().queue;
      const playback = playTrack(seedTrack);
      try {
        let radioTracks: Track[] = [];
        const cleanId = seedTrack.id.replace(/^youtube:/, '');
        let videoId = seedTrack.source === 'youtube' && cleanId.length === 11 ? cleanId : '';
        if (!videoId) {
          const matches = await api.ytmusic.search(`${seedTrack.artist} ${seedTrack.title}`).catch(() => []);
          const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          const title = normalize(seedTrack.title);
          const artist = normalize(seedTrack.artist);
          const match = matches.find((candidate) => {
            const candidateTitle = normalize(candidate.title || '');
            const candidateArtist = normalize(candidate.artist || '');
            const titleMatches = title.length > 0 && (candidateTitle.includes(title) || title.includes(candidateTitle) && candidateTitle.length >= 5);
            const artistMatches = artist.length > 0 && (candidateArtist.includes(artist) || candidateTitle.includes(artist));
            const durationMatches = !seedTrack.duration || (candidate.duration > 0 && Math.abs(seedTrack.duration - candidate.duration) <= 20);
            const versionMatches = ['remix', 'nightcore', 'slowed', 'sped up', 'live', 'cover', 'hardstyle'].every((version) =>
              title.includes(version) === candidateTitle.includes(version));
            return titleMatches && artistMatches && durationMatches && versionMatches;
          });
          videoId = match?.id?.replace(/^youtube:/, '') || '';
        }
        if (videoId.length === 11) radioTracks = await api.ytmusic.getSuggested(videoId).catch(() => []);
        if (radioTracks.length < 4) {
          const searchRes = await api.ytmusic.search(`${seedTrack.artist} mix`);
          radioTracks = [...radioTracks, ...searchRes];
        }
        const state = usePlayerStore.getState();
        if (state.queue !== radioQueue || state.currentTrack?.id !== seedTrack.id) return;
        const seen = new Set([seedTrack.id, videoId]);
        for (const track of radioTracks) {
          if (!track.id || seen.has(track.id)) continue;
          seen.add(track.id);
          state.addToQueue(track);
          if (seen.size >= 26) break;
        }
        // If the seed is still opening, playTrack will prebuffer after it starts.
        if (usePlayerStore.getState().isPlaying) void prebufferUpcomingTrackInQueue();
        await playback;
      } catch {
        await playback;
      }
    },
    [playTrack]
  );

  const pause = useCallback(() => {
    const commandRevision = ++playbackCommandRevision;
    ++playbackGeneration;
    pendingPlaybackTrackId = null;
    cancelScheduledPrebuffer();
    clearSlowLoadingTimer();
    setLoading(false);
    setLoadingStage('idle');
    setIsPlaying(false);
    playPauseChain = playPauseChain.then(async () => {
      if (commandRevision !== playbackCommandRevision) return;
      await window.electronAPI?.player.pause();
      if (commandRevision !== playbackCommandRevision) return;
      const t = usePlayerStore.getState().currentTrack;
      if (t) {
        window.electronAPI?.desktop?.updatePresence({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration,
          position: usePlayerStore.getState().position,
          isPlaying: false,
          thumbnail: t.thumbnail,
        });
        if (useAccountsStore.getState().together.role === 'host') {
          window.electronAPI?.together?.syncHostState({ isPlaying: false, position: usePlayerStore.getState().position });
        }
      }
    }).catch(() => {});
    return playPauseChain;
  }, [setIsPlaying, setLoading, setLoadingStage]);

  const resume = useCallback(() => {
    const commandRevision = ++playbackCommandRevision;
    if (usePlayerStore.getState().currentTrack) showPlaybackFeedback();
    setIsPlaying(true);
    playPauseChain = playPauseChain.then(async () => {
      const state = usePlayerStore.getState();
      const st = await window.electronAPI?.player.getStatus();
      if (commandRevision !== playbackCommandRevision) return;
      if (state.currentTrack && (state.playbackError || !st?.currentUrl || st.currentTrackId !== state.currentTrack.id)) {
        void playTrack(state.currentTrack, undefined, false);
        return;
      }
      await window.electronAPI?.player.resume();
      if (state.currentTrack) {
        window.electronAPI?.desktop?.updatePresence({
          id: state.currentTrack.id,
          title: state.currentTrack.title,
          artist: state.currentTrack.artist,
          album: state.currentTrack.album,
          duration: state.currentTrack.duration,
          position: state.position,
          isPlaying: true,
          thumbnail: state.currentTrack.thumbnail,
        });
        if (useAccountsStore.getState().together.role === 'host') {
          window.electronAPI?.together?.syncHostState({ isPlaying: true, position: state.position });
        }
      }
    }).catch(() => {});
    return playPauseChain;
  }, [playTrack, setIsPlaying]);

  const seek = useCallback(
    async (seconds: number) => {
      const trackId = usePlayerStore.getState().currentTrack?.id;
      setPosition(seconds);
      await window.electronAPI?.player.seek(seconds);
      window.electronAPI?.desktop?.updatePosition(seconds, true, trackId);
      if (useAccountsStore.getState().together.role === 'host') {
        window.electronAPI?.together?.syncHostState({ position: seconds });
      }
    },
    [setPosition]
  );

  const setVolume = useCallback(async (vol: number) => {
    usePlayerStore.getState().setVolume(vol);
    await window.electronAPI?.player.setVolume(vol);
  }, []);

  const skipNext = useCallback(async () => {
    const next = nextTrack();
    if (next) {
      await playTrack(next);
    } else {
      const state = usePlayerStore.getState();
      if (state.currentTrack && state.autoRadioOnQueueEnd) {
        await startRadio(state.currentTrack);
        return;
      }
      await window.electronAPI?.player.stop();
      setIsPlaying(false);
    }
  }, [nextTrack, playTrack, setIsPlaying, startRadio]);

  const skipPrev = useCallback(async () => {
    const { position } = usePlayerStore.getState();
    if (position > 4) {
      await seek(0);
      return;
    }
    const prev = prevTrack();
    if (prev) await playTrack(prev);
  }, [prevTrack, playTrack, seek]);

  const toggleLikeCurrent = useCallback((track?: Track | null) => {
    const t = track ?? usePlayerStore.getState().currentTrack;
    if (t) usePlayerStore.getState().toggleLike(t);
  }, []);

  const changeSpeed = useCallback(async (speed: number) => {
    usePlayerStore.getState().setSpeed(speed);
  }, []);

  const toggleNormalization = useCallback(async (enabled?: boolean) => {
    const next = enabled ?? !usePlayerStore.getState().normalization;
    usePlayerStore.getState().setDspOption({ normalization: next });
  }, []);

  const downloadCurrentTrack = useCallback(
    async (format?: 'mp3' | 'flac' | 'opus', lrc?: string) => {
      const t = usePlayerStore.getState().currentTrack;
      if (!t) return { ok: false, error: 'Нет активного трека' };
      return window.electronAPI.player.downloadTrack({ ...t, format, lrc });
    },
    []
  );

  return {
    playTrack,
    retryCurrentTrack,
    playFromQueue,
    startRadio,
    pause,
    resume,
    seek,
    setVolume,
    skipNext,
    skipPrev,
    toggleLikeCurrent,
    changeSpeed,
    toggleNormalization,
    downloadCurrentTrack,
  };
}

let lastScrobbledTrackId = '';

export function usePlayerEvents() {
  const { playTrack, skipNext, skipPrev, pause, resume, seek, setVolume } = usePlayer();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    let lastStatsTick = 0;
    let lastSystemPositionTick = 0;
    const publishMode = () => { const { shuffle, repeat } = usePlayerStore.getState(); api.desktop?.updatePlaybackMode({ shuffle, repeat }); };
    publishMode();
    const unsubMode = usePlayerStore.subscribe((state, previous) => {
      if (state.shuffle !== previous.shuffle || state.repeat !== previous.repeat) publishMode();
    });
    const unsubSystemMode = api.desktop?.onPlaybackMode(mode => {
      const state = usePlayerStore.getState();
      if (typeof mode.shuffle === 'boolean' && mode.shuffle !== state.shuffle) state.toggleShuffle();
      if (mode.repeat && mode.repeat !== state.repeat) state.setRepeat(mode.repeat);
    });
    const unsubRepeat = usePlayerStore.subscribe((state, previous) => {
      if (state.repeat !== previous.repeat) void prebufferUpcomingTrackInQueue();
    });

    const unsubRecovery = api.player.onRecovery?.((info) => {
      const store = usePlayerStore.getState();
      if (store.currentTrack?.id !== info.trackId) return;
      store.setLoading(info.loading);
      store.setLoadingStage(info.loading ? 'resolving' : 'idle');
      if (info.error) {
        store.setPlaybackError(info.error);
        store.setResolvedStreamMeta('Поток недоступен', null, false);
        store.setIsPlaying(false);
        useUIStore.getState().pushToast(info.error, 'error');
      } else if (info.badge && info.source) {
        store.setPlaybackError(null);
        store.setResolvedStreamMeta(info.badge, info.source as AudioSourceId, Boolean(info.lossless), info.spotifyId);
        store.setIsPlaying(true);
      }
    });
    const unsubProgress = api.player.onProgress((info) => {
      const store = usePlayerStore.getState();
      if (store.loading) return;
      if (info.trackId && info.trackId !== store.currentTrack?.id) return;
      if (Date.now() - lastSystemPositionTick >= 1000) {
        api.desktop?.updatePosition(info.position, false, store.currentTrack?.id);
        lastSystemPositionTick = Date.now();
      }
      const update: Partial<typeof store> = {};
      if (info.position !== store.position) update.position = info.position;
      if (info.duration > 0 && info.duration !== store.duration) update.duration = info.duration;
      const automixing = Boolean(info.automixing);
      if (automixing !== store.automixing) update.automixing = automixing;
      if (Object.keys(update).length) usePlayerStore.setState(update);

      const track = store.currentTrack;
      if (track && info.isPlaying) {
        // Periodic listening stats update every 15s of playback
        const now = Date.now();
        if (now - lastStatsTick >= 15000) {
          lastStatsTick = now;
          api.db?.recordStats(track, 15).catch(() => {});
        }

        // Scrobble at 50% or 120s
        if (
          info.duration > 30 &&
          lastScrobbledTrackId !== track.id &&
          (info.position >= info.duration * 0.5 || info.position >= 120)
        ) {
          lastScrobbledTrackId = track.id;
          api.scrobble?.scrobble(track).catch(() => {});
          if (useUIStore.getState().listenBrainzEnabled) {
            api.desktop
              ?.listenBrainzScrobble({
                title: track.title,
                artist: track.artist,
                album: track.album,
                duration: info.duration,
              })
              .catch(() => {});
          }
        }
      }
    });

    const unsubEnded = api.player.onEnded((info) => {
      const state = usePlayerStore.getState();
      if (state.loading) return;
      if (info?.trackId && state.currentTrack?.id && info.trackId !== state.currentTrack.id) return;
      if (state.repeat === 'one' && state.currentTrack) void playTrack(state.currentTrack);
      else void skipNext();
    });

    const unsubAutomix = api.player.onAutomixTransition(({ fromTrackId, nextTrackId, spotifyId }) => {
      const store = usePlayerStore.getState();
      if (store.loading) return;
      if (fromTrackId && store.currentTrack?.id && store.currentTrack.id !== fromTrackId) return;
      const idx = store.queue.findIndex((t) => t.id === nextTrackId);
      if (idx >= 0) {
        const nextT = store.queue[idx];
        usePlayerStore.setState({ queueIndex: idx, currentTrack: nextT, position: 0, duration: nextT.duration || 0, playbackError: null, automixPlan: null,
          resolvedSpotifyTrack: spotifyId ? { trackId: nextTrackId, spotifyId } : undefined });
        store.addToHistory(nextT);
        api.desktop?.updatePresence({
          id: nextT.id,
          title: nextT.title,
          artist: nextT.artist,
          album: nextT.album,
          duration: nextT.duration,
          position: 0,
          isPlaying: true,
          thumbnail: nextT.thumbnail,
        });
        schedulePrebufferUpcomingTrack(1800);
      }
    });

    const unsubPlan = api.player.onAutomixPlan?.((plan) => {
      usePlayerStore.getState().setAutomixPlan(plan);
    });

    const unsubToast = api.player.onSmartToast?.((toast) => {
      useUIStore.getState().pushToast(toast.message, toast.kind);
    });

    const unsubSleep = api.player.onSleepTimerUpdate?.((info) => {
      usePlayerStore.getState().setSleepProgress(info.remainingSec, info.afterTrack);
    });

    const unsubShortcut = api.onMediaShortcut((action) => {
      const { isPlaying } = usePlayerStore.getState();
      if (action === 'playPause') void (isPlaying ? pause() : resume());
      else if (action === 'play' && !isPlaying) void resume();
      else if (action === 'pause' && isPlaying) void pause();
      else if (action === 'next') void skipNext();
      else if (action === 'prev') void skipPrev();
    });

    const unsubMediaSeek = api.onMediaSeek((event) => {
      const state = usePlayerStore.getState();
      const target = typeof event.position === 'number' ? event.position : state.position + (event.offset || 0);
      void seek(Math.max(0, Math.min(state.duration || Infinity, target)));
    });

    const unsubTogetherState = api.together?.onState?.((st) => {
      useAccountsStore.getState().setTogetherState(st);
    });

    const unsubTogetherSync = api.together?.onSyncPlayback?.((payload) => {
      const store = usePlayerStore.getState();
      if (payload.track && store.currentTrack?.id !== payload.track.id) {
        void playTrack(payload.track);
      } else if (typeof payload.position === 'number' && Math.abs(payload.position - store.position) > 2.2) {
        void seek(payload.position);
      }
      if (typeof payload.isPlaying === 'boolean') {
        if (payload.isPlaying && !store.isPlaying) void resume();
        else if (!payload.isPlaying && store.isPlaying) void pause();
      }
    });

    const unsubPlaylists = api.playlists?.onUpdated?.((playlists) => {
      usePlayerStore.setState({ playlists });
    });

    // Global keyboard shortcuts (ignoring inputs)
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;
      if (isInput) return;

      const store = usePlayerStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        void (store.isPlaying ? pause() : resume());
      } else if (e.key === 'ArrowRight' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void seek(Math.min(store.duration || 9999, store.position + 5));
      } else if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void seek(Math.max(0, store.position - 5));
      } else if (e.key.toLowerCase() === 'l' && !e.ctrlKey) {
        void seek(Math.min(store.duration || 9999, store.position + 10));
      } else if (e.key.toLowerCase() === 'j' && !e.ctrlKey) {
        void seek(Math.max(0, store.position - 10));
      } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey) {
        void setVolume(store.volume > 0 ? 0 : 0.85);
      } else if (e.ctrlKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        useUIStore.getState().toggleQueueDrawer();
      } else if (e.key === 'Escape') {
        const ui = useUIStore.getState();
        if (ui.contextMenu) ui.setContextMenu(null);
        else if (ui.sourceSwitcherTrack) ui.setSourceSwitcherTrack(null);
        else if (ui.auditTarget) ui.setAuditTarget(null);
        else if (ui.tagEditorTrack) ui.setTagEditorTrack(null);
        else if (ui.queueDrawerOpen) ui.setQueueDrawerOpen(false);
        else if (ui.showNowPlaying) ui.setShowNowPlaying(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      unsubRecovery?.();
      unsubProgress();
      unsubEnded();
      unsubAutomix();
      unsubPlan?.();
      unsubToast?.();
      unsubSleep?.();
      unsubShortcut();
      unsubMediaSeek();
      unsubRepeat();
      unsubMode();
      unsubSystemMode?.();
      unsubTogetherState?.();
      unsubTogetherSync?.();
      unsubPlaylists?.();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [playTrack, skipNext, skipPrev, pause, resume, seek, setVolume]);
}
