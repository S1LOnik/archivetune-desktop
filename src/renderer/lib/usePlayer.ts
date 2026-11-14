/**
 * usePlayer.ts — React hook bridging Zustand store to Electron Dual-Deck mpv,
 * Universal Fallback Matrix, AutoMix Planner, Listen Together & Telemetry
 */

import { useCallback, useEffect } from 'react';
import {
  usePlayerStore,
  useUIStore,
  useAccountsStore,
  extractDominantColorFromImage,
} from '../store';
import type { Track, AudioSourceId } from '../types/electron';

async function resolveTrackStreamUrlUncached(
  track: Track,
  forceSource?: AudioSourceId
): Promise<{
  url: string;
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
    },
    forceSource
  );

  if (uni.streamUrl) {
    return {
      url: uni.streamUrl,
      headers: uni.headers,
      badge: `${uni.actualSource.toUpperCase()} • ${uni.qualityLabel}`,
      actualSource: uni.actualSource,
      lossless: uni.lossless,
      switched: uni.switched,
      switchedReason: uni.switchedReason,
    };
  }

  // Fallback direct YouTube extraction
  const cleanId = track.id.replace(/^youtube:/, '');
  if (!forceSource && cleanId.length === 11 && !cleanId.includes(':')) {
    const directUrl = await api.ytmusic.getStreamUrl(cleanId);
    if (directUrl) {
      return {
        url: directUrl,
        badge: 'YOUTUBE • Opus',
        actualSource: 'youtube',
        lossless: false,
        switched: track.source !== 'youtube',
      };
    }
  }

  throw new Error(uni.error || 'Could not resolve valid audio stream');
}

type ResolvedTrack = Awaited<ReturnType<typeof resolveTrackStreamUrlUncached>>;
const resolvedTracks = new Map<string, { value: Promise<ResolvedTrack>; expires: number }>();
async function resolveTrackStreamUrl(track: Track, forceSource?: AudioSourceId): Promise<ResolvedTrack> {
  if (!forceSource) {
    const offline = await window.electronAPI.offline?.find(track.id);
    if (offline) return { url: offline.filePath, badge: 'ОФЛАЙН • На устройстве', actualSource: 'local', lossless: false, switched: false };
  }
  if (forceSource || track.source === 'local') return resolveTrackStreamUrlUncached(track, forceSource);
  const key = `${track.source}:${track.id}:${track.title}:${track.artist}`;
  const cached = resolvedTracks.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = resolveTrackStreamUrlUncached(track).catch((error) => {
    if (resolvedTracks.get(key)?.value === value) resolvedTracks.delete(key);
    throw error;
  });
  if (resolvedTracks.size >= 100) resolvedTracks.delete(resolvedTracks.keys().next().value!);
  resolvedTracks.set(key, { value, expires: Date.now() + 5 * 60 * 1000 });
  return value;
}

let prebufferGeneration = 0;
let playbackGeneration = 0;
let playPauseChain = Promise.resolve();
async function prebufferUpcomingTrackInQueue(): Promise<void> {
  const generation = ++prebufferGeneration;
  const api = window.electronAPI;
  if (!api) return;

  const { queue, queueIndex, repeat } = usePlayerStore.getState();
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

  try {
    const resolved = await resolveTrackStreamUrl(nextTrack);
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
        thumbnail: nextTrack.thumbnail,
      },
    });
  } catch {
    if (generation === prebufferGeneration) await api.player.prebufferNext(null);
  }
}

export function usePlayer() {
  const {
    currentTrack,
    queue,
    queueIndex,
    isPlaying,
    volume,
    setCurrentTrack,
    setIsPlaying,
    setPosition,
    setDuration,
    setLoading,
    setTrackStartTimeSec,
    setResolvedStreamMeta,
    nextTrack,
    prevTrack,
  } = usePlayerStore();

  const playTrack = useCallback(
    async (track: Track, forceSource?: AudioSourceId) => {
      const api = window.electronAPI;
      if (!api) return;

      const store = usePlayerStore.getState();
      const ui = useUIStore.getState();

      // Prevent duplicate concurrent play of same track unless explicit forceSource switch
      if (!forceSource && store.loading && store.currentTrack?.id === track.id) return;

      const generation = ++playbackGeneration;
      ++prebufferGeneration;
      setLoading(true);
      setCurrentTrack(track);
      // Use the saved cover before asking a CDN; apply artwork only to the current request.
      void (async () => {
        const saved = await api.offline?.find(track.id).catch(() => null);
        if (generation !== playbackGeneration) return;
        const thumbnail = saved?.track?.thumbnail || track.thumbnail;
        if (thumbnail && thumbnail !== track.thumbnail) {
          usePlayerStore.setState(state => ({ currentTrack: state.currentTrack ? { ...state.currentTrack, thumbnail } : null }));
        }
        if (ui.dynamicColorFromArt && thumbnail) {
          const hex = await extractDominantColorFromImage(thumbnail);
          if (generation === playbackGeneration) useUIStore.getState().setActiveArtColor(hex);
        }
      })();
      store.addToHistory(track);
      setResolvedStreamMeta(forceSource ? `Switching to ${forceSource.toUpperCase()}...` : 'Resolving best stream...', track.source, false);

      try {
        const resolved = await resolveTrackStreamUrl(track, forceSource);
        if (generation !== playbackGeneration) return;
        setResolvedStreamMeta(resolved.badge, resolved.actualSource, resolved.lossless);

        if (ui.showSmartSwitchToasts && resolved.switched && resolved.switchedReason) {
          ui.pushToast(
            resolved.switchedReason,
            resolved.lossless ? 'lossless' : 'switch'
          );
        } else if (forceSource) {
          ui.pushToast(`Источник переключён: ${resolved.badge}`, resolved.lossless ? 'lossless' : 'switch');
        }

        const res = await api.player.play(resolved.url, {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          source: resolved.actualSource,
          thumbnail: track.thumbnail,
          headers: resolved.headers,
        });

        if (generation !== playbackGeneration) return;
        if (!res.ok) {
          throw new Error(res.error || 'mpv failed to start stream');
        }

        setIsPlaying(true);
        setTrackStartTimeSec(Date.now() / 1000);
        if (track.duration) setDuration(track.duration);

        // Scrobbling & OS Presence + Stats
        const presencePayload = {
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          position: 0,
          isPlaying: true,
          thumbnail: track.thumbnail,
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

        // Prebuffer next track for Dual-Deck Smart DJ Automix / Gapless
        setTimeout(() => void prebufferUpcomingTrackInQueue(), 700);
      } catch (err: any) {
        if (generation !== playbackGeneration) return;
        resolvedTracks.delete(`${track.source}:${track.id}:${track.title}:${track.artist}`);
        console.error('Playback error:', err);
        useUIStore.getState().pushToast(`Ошибка воспроизведения: ${err?.message || 'Поток недоступен'}`, 'error');
        setResolvedStreamMeta('Stream Unavailable', track.source, false);
        setIsPlaying(false);
      } finally {
        if (generation === playbackGeneration) setLoading(false);
      }
    },
    [
      setLoading,
      setCurrentTrack,
      setResolvedStreamMeta,
      setIsPlaying,
      setTrackStartTimeSec,
      setDuration,
    ]
  );

  const playFromQueue = useCallback(
    async (tracks: Track[], index = 0) => {
      usePlayerStore.getState().setQueue(tracks, index);
      const track = usePlayerStore.getState().queue[index] || tracks[index];
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
      try {
        let radioTracks: Track[] = [];
        const cleanId = seedTrack.id.replace(/^youtube:/, '');
        if (cleanId.length === 11 && !cleanId.includes(':')) {
          radioTracks = await api.ytmusic.getSuggested(cleanId);
        }
        if (radioTracks.length < 4) {
          const searchRes = await api.ytmusic.search(`${seedTrack.artist} mix`);
          radioTracks = [...radioTracks, ...searchRes];
        }
        const unique = [
          seedTrack,
          ...radioTracks.filter((t) => t.id !== seedTrack.id),
        ].slice(0, 25);
        await playFromQueue(unique, 0);
      } catch {
        await playFromQueue([seedTrack], 0);
      }
    },
    [playFromQueue]
  );

  const pause = useCallback(() => {
    setIsPlaying(false);
    playPauseChain = playPauseChain.then(async () => {
      await window.electronAPI?.player.pause();
      const t = usePlayerStore.getState().currentTrack;
      if (t) {
        window.electronAPI?.desktop?.updatePresence({
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
  }, [setIsPlaying]);

  const resume = useCallback(() => {
    setIsPlaying(true);
    playPauseChain = playPauseChain.then(async () => {
      const state = usePlayerStore.getState();
      const st = await window.electronAPI?.player.getStatus();
      if (!st?.currentUrl && state.currentTrack) {
        await playTrack(state.currentTrack);
        return;
      }
      await window.electronAPI?.player.resume();
      if (state.currentTrack) {
        window.electronAPI?.desktop?.updatePresence({
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
      setPosition(seconds);
      await window.electronAPI?.player.seek(seconds);
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
      if (state.currentTrack) {
        const db = await window.electronAPI?.db?.getInitialState?.().catch(() => null);
        if (db?.settings?.autoRadioOnQueueEnd !== false) {
          await startRadio(state.currentTrack);
          return;
        }
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

  const downloadCurrentTrack = useCallback(async (format?: 'mp3' | 'flac' | 'opus') => {
    const t = usePlayerStore.getState().currentTrack;
    if (!t) return { ok: false, error: 'No track active' };
    if (format) useUIStore.getState().setDesktopSetting({ downloadFormat: format });
    const uni = await window.electronAPI.providers.resolveUniversal({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      source: t.source,
      path: t.path,
    });
    return window.electronAPI.player.downloadTrack({
      ...t,
      streamUrl: uni.streamUrl || undefined,
    });
  }, []);

  return {
    currentTrack,
    queue,
    queueIndex,
    isPlaying,
    volume,
    playTrack,
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

    const unsubRecovery = api.player.onRecovery?.((info) => {
      const store = usePlayerStore.getState();
      if (store.currentTrack?.id !== info.trackId) return;
      store.setLoading(info.loading);
      if (info.error) {
        store.setIsPlaying(false);
        useUIStore.getState().pushToast(info.error, 'error');
      } else if (info.badge && info.source) {
        store.setResolvedStreamMeta(info.badge, info.source as AudioSourceId, Boolean(info.lossless));
        store.setIsPlaying(true);
      }
    });
    const unsubProgress = api.player.onProgress((info) => {
      const store = usePlayerStore.getState();
      if (!store.isScrubbing) {
        store.setPosition(info.position);
      }
      if (info.duration > 0) store.setDuration(info.duration);
      store.setAutomixing(Boolean(info.automixing));
      if (info.automixPlan !== undefined) {
        store.setAutomixPlan(info.automixPlan ?? null);
      }

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

    const unsubEnded = api.player.onEnded(() => {
      void skipNext();
    });

    const unsubAutomix = api.player.onAutomixTransition(({ nextTrackId }) => {
      const store = usePlayerStore.getState();
      const idx = store.queue.findIndex((t) => t.id === nextTrackId);
      if (idx >= 0) {
        const nextT = store.queue[idx];
        usePlayerStore.setState({ queueIndex: idx, currentTrack: nextT, position: 0 });
        store.addToHistory(nextT);
        if (useUIStore.getState().dynamicColorFromArt && nextT.thumbnail) {
          extractDominantColorFromImage(nextT.thumbnail).then((hex) => {
            useUIStore.getState().setActiveArtColor(hex);
          }).catch(() => {});
        }
        api.desktop?.updatePresence({
          title: nextT.title,
          artist: nextT.artist,
          album: nextT.album,
          duration: nextT.duration,
          position: 0,
          isPlaying: true,
          thumbnail: nextT.thumbnail,
        });
        setTimeout(() => void prebufferUpcomingTrackInQueue(), 900);
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
      else if (action === 'next') void skipNext();
      else if (action === 'prev') void skipPrev();
    });

    const unsubMiniMode = api.onMiniModeChanged((isMini) => {
      useUIStore.getState().setMiniPipMode(isMini);
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
      } else if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        api.toggleMiniMode?.();
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
      unsubMiniMode();
      unsubTogetherState?.();
      unsubTogetherSync?.();
      unsubPlaylists?.();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [playTrack, skipNext, skipPrev, pause, resume, seek, setVolume]);
}
