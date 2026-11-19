import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Music2, Play } from 'lucide-react';
import { usePlayerStore, type Track } from '../store';
import { useInterfaceMotion } from '../lib/useInterfaceMotion';

interface Props {
  tracks: Track[];
  onPlay: (index: number) => void;
  source: 'youtube_home' | 'history_radio' | 'unavailable';
}

export default React.memo(function FeaturedCarousel({ tracks, onPlay, source }: Props) {
  const loadingTrackId = usePlayerStore((state) => state.loading ? state.currentTrack?.id : undefined);
  const count = tracks.length;
  const isCyclic = count >= 2;

  // Render enough repeats to allow seamless infinite looping in both directions without huge DOM
  const repeats = useMemo(() => {
    if (!isCyclic) return 1;
    if (count >= 15) return 3;
    const targetMinCards = 36;
    const needed = Math.max(5, Math.ceil(targetMinCards / count));
    return needed % 2 === 0 ? needed + 1 : needed;
  }, [count, isCyclic]);

  const midBlock = Math.floor(repeats / 2);
  const midOffset = midBlock * count;

  const virtualTracks = useMemo(() => {
    if (!isCyclic) return tracks;
    const list: Track[] = [];
    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < count; i++) {
        list.push(tracks[i]);
      }
    }
    return list;
  }, [tracks, repeats, isCyclic, count]);

  const [selectedReal, setSelectedReal] = useState(() => Math.min(2, Math.max(0, count - 1)));
  const [selectedVirtual, setSelectedVirtual] = useState(() => midOffset + Math.min(2, Math.max(0, count - 1)));
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const rail = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef<number | null>(null);
  const animRaf = useRef<number | null>(null);
  const inputRaf = useRef<number | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const geometry = useRef({ step: 0, width: 0, firstCenter: 0, maxScroll: 0 });
  const lastPaintedScroll = useRef<number | null>(null);
  const scaledCards = useRef(new Set<HTMLElement>());
  const requestedVirtual = useRef<number | null>(null);

  const selectedTrackId = useRef<string | undefined>(tracks[selectedReal]?.id);

  // Gesture & Momentum physics state
  const gesture = useRef<{
    startX: number;
    startY: number;
    startScrollLeft: number;
    positions: Array<{ x: number; time: number }>;
  } | null>(null);
  const dragged = useRef(false);
  const wheelTimer = useRef<number>();
  const lastWheel = useRef<{ time: number; velocity: number } | null>(null);
  const previewTimer = useRef<number>();
  const previewPending = useRef(false);

  const clearPreview = useCallback(() => window.clearTimeout(previewTimer.current), []);

  const schedulePreview = useCallback((trackId: string | undefined, source: Track['source'] | undefined) => {
    clearPreview();
    const videoId = trackId?.replace(/^youtube:/, '');
    if (source !== 'youtube' || !videoId || !/^[\w-]{11}$/.test(videoId)) return;
    previewTimer.current = window.setTimeout(() => {
      const { enabledSources, prebufferNextTrack } = usePlayerStore.getState();
      const ytmusic = window.electronAPI?.ytmusic;
      if (!ytmusic || !prebufferNextTrack || enabledSources.youtube === false || previewPending.current) return;
      previewPending.current = true;
      void ytmusic.getStreamUrl(videoId).catch(() => null).finally(() => {
        previewPending.current = false;
      });
    }, 200);
  }, [clearPreview]);

  const selected = tracks[selectedReal];
  useEffect(() => {
    schedulePreview(selected?.id, selected?.source);
    return clearPreview;
  }, [selected?.id, selected?.source, schedulePreview, clearPreview]);

  const { reducedMotion, preset } = useInterfaceMotion();
  const { stiffness, damping, friction } = preset.carousel;

  const measureRail = useCallback(() => {
    const list = rail.current;
    const first = list?.firstElementChild;
    if (!list || !first) return;
    const railStyle = getComputedStyle(list);
    const cardWidth = parseFloat(getComputedStyle(first).width);
    geometry.current = {
      step: cardWidth + parseFloat(railStyle.columnGap),
      width: list.clientWidth,
      firstCenter: parseFloat(railStyle.paddingLeft) + cardWidth / 2,
      maxScroll: list.scrollWidth - list.clientWidth,
    };
    lastPaintedScroll.current = null;
  }, []);

  const scrollAt = useCallback((index: number) => {
    const { firstCenter, step, width } = geometry.current;
    return firstCenter + index * step - width / 2;
  }, []);

  // Stop any active momentum or spring animation
  const stopAnimation = useCallback(() => {
    if (animRaf.current !== null) {
      cancelAnimationFrame(animRaf.current);
      animRaf.current = null;
    }
  }, []);

  // Seamless cyclic boundary wrapping (returns scroll shift amount in px)
  const wrapBoundary = useCallback((position?: number): number => {
    const list = rail.current;
    if (!list) return 0;
    const current = position ?? list.scrollLeft;
    const { step, maxScroll: maxPosition } = geometry.current;
    const cycleWidth = count * step;
    if (!isCyclic || cycleWidth <= 0) {
      if (position !== undefined) list.scrollLeft = current;
      return 0;
    }

    const minScroll = (midBlock - 0.5) * cycleWidth;
    const maxScroll = (midBlock + 0.5) * cycleWidth;

    if (current >= minScroll && current <= maxScroll) {
      if (position !== undefined) list.scrollLeft = current;
      return 0;
    }
    const cycles = current < minScroll
      ? Math.ceil((minScroll - current) / cycleWidth)
      : -Math.ceil((current - maxScroll) / cycleWidth);
    const shift = cycles * cycleWidth;
    const target = current + shift;
    // An unmeasured or very wide rail can clamp the requested position.
    if (target < 0 || target > maxPosition) {
      if (position !== undefined) list.scrollLeft = current;
      return 0;
    }
    list.scrollLeft = target;
    if (requestedVirtual.current !== null) {
      const total = count * repeats;
      const rebased = requestedVirtual.current + cycles * count;
      requestedVirtual.current = ((rebased % total) + total) % total;
    }
    return shift;
  }, [count, isCyclic, midBlock, repeats]);

  // Find nearest virtual card index to a given scroll position
  const findNearestVirtualToScroll = useCallback(
    (scrollLeftVal: number) => {
      const list = rail.current;
      if (!list || list.children.length === 0) return 0;
      const { width, step, firstCenter } = geometry.current;
      if (step <= 0) return 0;
      const approx = Math.round((scrollLeftVal + width / 2 - firstCenter) / step);
      return Math.max(0, Math.min(list.children.length - 1, approx));
    },
    []
  );

  const nearestVirtualIndex = useCallback(() => {
    const list = rail.current;
    if (!list) return 0;
    return findNearestVirtualToScroll(list.scrollLeft);
  }, [findNearestVirtualToScroll]);

  // Smoothly scale central card slightly larger and scale neighboring cards based on distance
  const updateCardScales = useCallback(() => {
    const list = rail.current;
    if (!list || list.children.length === 0) return;
    const scroll = list.scrollLeft;
    if (scroll === lastPaintedScroll.current) return;
    lastPaintedScroll.current = scroll;
    const { width, step, firstCenter } = geometry.current;
    const centerIndex = (scroll + width / 2 - firstCenter) / step;
    const nextScaled = new Set<HTMLElement>();

    if (!reducedMotion && step > 0) {
      const start = Math.max(0, Math.ceil(centerIndex - 1.8));
      const end = Math.min(list.children.length - 1, Math.floor(centerIndex + 1.8));
      for (let i = start; i <= end; i++) {
        const child = list.children[i] as HTMLElement;
        const distance = Math.abs(centerIndex - i);
        const factor = Math.cos(distance * Math.PI / 3.6) ** 1.25;
        child.style.setProperty('--card-factor', factor.toFixed(4));
        child.style.zIndex = String(Math.round(1 + 49 * factor));
        nextScaled.add(child);
      }
    }

    for (const child of scaledCards.current) {
      if (nextScaled.has(child)) continue;
      child.style.removeProperty('--card-factor');
      child.style.removeProperty('z-index');
    }
    scaledCards.current = nextScaled;
  }, [reducedMotion]);

  const applyInput = useCallback(() => {
    if (inputRaf.current !== null) cancelAnimationFrame(inputRaf.current);
    inputRaf.current = null;
    const list = rail.current;
    const position = pendingScroll.current;
    pendingScroll.current = null;
    if (!list || position === null) return;
    const shift = wrapBoundary(position);
    if (gesture.current) gesture.current.startScrollLeft += shift;
    updateCardScales();
  }, [updateCardScales, wrapBoundary]);

  const queueInput = useCallback((position: number) => {
    pendingScroll.current = position;
    if (inputRaf.current === null) inputRaf.current = requestAnimationFrame(applyInput);
  }, [applyInput]);

  const updateSelectionByVirtual = useCallback(
    (virtualIndex: number) => {
      if (count === 0) return;
      const real = ((virtualIndex % count) + count) % count;
      setSelectedVirtual((previous) => previous === virtualIndex ? previous : virtualIndex);
      requestedVirtual.current = virtualIndex;
      selectedTrackId.current = tracksRef.current[real]?.id;
      setSelectedReal(real);
    },
    [count]
  );

  // Smooth spring-damper snap to target virtual card without sudden jerks
  const startSpringSnap = useCallback(
    (initialVelocity = 0, explicitTargetVirtual?: number) => {
      const list = rail.current;
      if (!list) return;

      stopAnimation();

      const targetVirtual =
        explicitTargetVirtual !== undefined ? explicitTargetVirtual : nearestVirtualIndex();

      if (reducedMotion) {
        delete list.dataset.scrolling;
        if (list.children[targetVirtual]) {
          list.scrollLeft = scrollAt(targetVirtual);
          wrapBoundary();
          updateCardScales();
          updateSelectionByVirtual(nearestVirtualIndex());
        }
        return;
      }

      list.dataset.scrolling = 'spring';
      let velocity = initialVelocity;

      if (!list.children[targetVirtual]) {
        delete list.dataset.scrolling;
        return;
      }

      let targetScroll = scrollAt(targetVirtual);
      let position = list.scrollLeft;
      let settledFrames = 0;

      let lastFrame = performance.now();
      const startedAt = lastFrame;
      const tick = (now: number) => {
        if (!rail.current) return;
        const curList = rail.current;
        const dt = Math.min(2, Math.max(0.25, (now - lastFrame) / 16.667));
        lastFrame = now;
        // Keep a fractional position and integrate in steps of at most one 60 Hz frame.
        const steps = Math.ceil(dt);
        const step = dt / steps;
        for (let i = 0; i < steps; i++) {
          velocity = (velocity + (targetScroll - position) * stiffness * step) * Math.pow(damping, step);
          position += velocity * step;
        }
        const shift = wrapBoundary(position);
        position += shift;
        targetScroll += shift;

        updateCardScales();

        if (Math.abs(targetScroll - position) < 0.65 && Math.abs(velocity) < 0.3) settledFrames++;
        else settledFrames = 0;

        // Keep the spring responsive during long keyboard bursts and wheel flicks.
        // The time limit also prevents scroll rounding from leaving the animation stuck.
        if (settledFrames >= 3 || now - startedAt >= 1400) {
          curList.scrollLeft = targetScroll;
          wrapBoundary();
          updateCardScales();
          delete curList.dataset.scrolling;
          updateSelectionByVirtual(nearestVirtualIndex());
          animRaf.current = null;
        } else {
          animRaf.current = requestAnimationFrame(tick);
        }
      };

      animRaf.current = requestAnimationFrame(tick);
    },
    [reducedMotion, stiffness, damping, nearestVirtualIndex, scrollAt, stopAnimation, updateCardScales, updateSelectionByVirtual, wrapBoundary]
  );

  // Smooth momentum deceleration transitioning seamlessly into the spring snap
  const startMomentum = useCallback(
    (releaseVelocity: number) => {
      const list = rail.current;
      if (!list) return;

      stopAnimation();

      if (reducedMotion || Math.abs(releaseVelocity) < 0.15) {
        startSpringSnap(0);
        return;
      }

      list.dataset.scrolling = 'momentum';
      // Convert px/ms to px/frame
      let velocity = -releaseVelocity * 16.667;
      const maxVelocity = 30;
      velocity = Math.max(-maxVelocity, Math.min(maxVelocity, velocity));

      let lastFrame = performance.now();
      const tick = (now: number) => {
        if (!rail.current) return;
        const curList = rail.current;
        const dt = Math.min(2, Math.max(0.25, (now - lastFrame) / 16.667));
        lastFrame = now;
        velocity *= Math.pow(friction, dt);
        wrapBoundary(curList.scrollLeft + velocity * dt);
        updateCardScales();

        // When momentum decelerates to a gentle speed, hand over to spring snap
        if (Math.abs(velocity) <= 1.8) {
          const predictedScroll = curList.scrollLeft + velocity * (friction / (1 - friction));
          const targetVirtual = findNearestVirtualToScroll(predictedScroll);
          startSpringSnap(velocity, targetVirtual);
        } else {
          animRaf.current = requestAnimationFrame(tick);
        }
      };

      animRaf.current = requestAnimationFrame(tick);
    },
    [findNearestVirtualToScroll, friction, reducedMotion, startSpringSnap, stopAnimation, updateCardScales, wrapBoundary]
  );

  // Scroll to a specific virtual card with optional spring animation
  const scrollToVirtual = useCallback(
    (virtualIndex: number, smooth = true) => {
      const list = rail.current;
      if (!list || !list.children.length) return;
      requestedVirtual.current = null;
      const target = Math.max(0, Math.min(virtualIndex, list.children.length - 1));
      if (!smooth || reducedMotion) {
        stopAnimation();
        delete list.dataset.scrolling;
        list.scrollLeft = scrollAt(target);
        wrapBoundary();
        updateSelectionByVirtual(nearestVirtualIndex());
        updateCardScales();
      } else {
        startSpringSnap(0, target);
      }
    },
    [reducedMotion, scrollAt, startSpringSnap, stopAnimation, updateCardScales, updateSelectionByVirtual, wrapBoundary]
  );

  // Preserve selected track across data updates
  const trackOrder = tracks.map((t) => t.id).join('|');
  useLayoutEffect(() => {
    if (!tracks.length) return;
    measureRail();
    let targetReal = 0;
    if (selectedTrackId.current) {
      const found = tracksRef.current.findIndex((t) => t.id === selectedTrackId.current);
      if (found >= 0) targetReal = found;
    }
    const initialVirtual = isCyclic ? midOffset + targetReal : targetReal;
    scrollToVirtual(initialVirtual, false);
  }, [trackOrder, isCyclic, midOffset, measureRail, scrollToVirtual]);

  useEffect(() => {
    const list = rail.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      measureRail();
      updateCardScales();
    });
    observer.observe(list);
    if (list.firstElementChild) observer.observe(list.firstElementChild);
    return () => observer.disconnect();
  }, [count, measureRail, updateCardScales]);

  // Global mouse & wheel event listeners
  useEffect(() => {
    const list = rail.current;
    if (!list) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      requestedVirtual.current = null;
      stopAnimation();
      if (list.dataset.scrolling !== 'wheel') list.dataset.scrolling = 'wheel';

      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? geometry.current.width : 1;
      const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
      const now = performance.now();
      const elapsed = lastWheel.current ? Math.max(1, now - lastWheel.current.time) : 0;
      const velocity = elapsed ? delta / elapsed : 0;
      lastWheel.current = { time: now, velocity };
      queueInput((pendingScroll.current ?? list.scrollLeft) + delta);

      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => {
        applyInput();
        const wheelVelocity = lastWheel.current?.velocity || 0;
        lastWheel.current = null;
        if (Math.abs(wheelVelocity) > 0.0005) startMomentum(-wheelVelocity);
        else startSpringSnap(0);
      }, 90);
    };

    const onPointerMove = (clientX: number, clientY: number) => {
      const start = gesture.current;
      if (!start) return;
      const dx = clientX - start.startX;
      const dy = clientY - start.startY;

      // Check if this is horizontal drag
      if (!dragged.current) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          dragged.current = true;
          gesture.current = null;
          return;
        }
        dragged.current = true;
      }

      if (list.dataset.scrolling !== 'drag') list.dataset.scrolling = 'drag';
      queueInput(start.startScrollLeft - dx);

      const now = performance.now();
      start.positions.push({ x: clientX, time: now });
      while (start.positions.length > 1 && now - start.positions[0].time > 80) {
        start.positions.shift();
      }
    };

    const onPointerRelease = () => {
      applyInput();
      const currentGesture = gesture.current;
      if (!currentGesture) {
        if (dragged.current) window.setTimeout(() => { dragged.current = false; }, 0);
        return;
      }
      gesture.current = null;

      if (!dragged.current) {
        delete list.dataset.scrolling;
        return;
      }

      const pos = currentGesture.positions;
      let velocity = 0;
      if (pos.length >= 2) {
        const first = pos[0];
        const last = pos[pos.length - 1];
        const dt = last.time - first.time;
        if (dt > 10 && performance.now() - last.time <= 70) {
          velocity = (last.x - first.x) / dt;
        }
      }

      startMomentum(velocity);
      window.setTimeout(() => { dragged.current = false; }, 0);
    };

    const onMouseMove = (e: MouseEvent) => onPointerMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    list.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onPointerRelease);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onPointerRelease);
    window.addEventListener('touchcancel', onPointerRelease);
    window.addEventListener('blur', onPointerRelease);

    return () => {
      list.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onPointerRelease);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onPointerRelease);
      window.removeEventListener('touchcancel', onPointerRelease);
      window.removeEventListener('blur', onPointerRelease);
      window.clearTimeout(wheelTimer.current);
      lastWheel.current = null;
      stopAnimation();
      if (inputRaf.current !== null) cancelAnimationFrame(inputRaf.current);
      inputRaf.current = null;
      pendingScroll.current = null;
      if (scrollRaf.current !== null) {
        cancelAnimationFrame(scrollRaf.current);
        scrollRaf.current = null;
      }
      delete list.dataset.scrolling;
    };
  }, [applyInput, count, queueInput, startMomentum, startSpringSnap, stopAnimation]);

  const onScroll = () => {
    if (rail.current?.dataset.scrolling || scrollRaf.current !== null) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      if (rail.current?.dataset.scrolling) return;
      wrapBoundary();
      updateCardScales();
    });
  };

  const stepSelection = (delta: number) => {
    const list = rail.current;
    if (!list || !list.children.length) return;
    const currentVirtual = requestedVirtual.current ?? nearestVirtualIndex();
    let nextVirtual = currentVirtual + delta;
    if (isCyclic) {
      while (nextVirtual < 0) nextVirtual += count;
      while (nextVirtual >= list.children.length) nextVirtual -= count;
    } else {
      nextVirtual = Math.max(0, Math.min(list.children.length - 1, nextVirtual));
    }
    scrollToVirtual(nextVirtual, true);
    requestedVirtual.current = nextVirtual;
  };

  if (!tracks.length) return null;

  const hasSpotify = tracks.some((t) => t.source === 'spotify' || t.id.startsWith('spotify:'));
  const hasYouTube = tracks.some((t) => t.source === 'youtube');
  const youtubeLabel = source === 'history_radio' ? 'Подборка по истории YouTube Music' : 'YouTube Music';
  const sourceLabel = hasSpotify
    ? hasYouTube
      ? `${youtubeLabel} · Spotify`
      : 'Spotify'
    : youtubeLabel;

  return (
    <section className="featured-section" aria-label="Рекомендованные треки">
      <div className="featured-header">
        <div>
          <h2>Для вас</h2>
          <p className="featured-subtitle">{sourceLabel}</p>
        </div>
        <div className="featured-controls">
          <span aria-live="polite" className="featured-counter">
            {selectedReal + 1} / {count}
          </span>
        </div>
      </div>

      <div
        ref={rail}
        className="featured-rail select-none cursor-grab active:cursor-grabbing"
        onMouseDown={(event) => {
          if (event.button !== 0 || !rail.current) return;
          applyInput();
          requestedVirtual.current = null;
          window.clearTimeout(wheelTimer.current);
          lastWheel.current = null;
          stopAnimation();
          dragged.current = false;
          const now = performance.now();
          gesture.current = {
            startX: event.clientX,
            startY: event.clientY,
            startScrollLeft: rail.current.scrollLeft,
            positions: [{ x: event.clientX, time: now }],
          };
        }}
        onTouchStart={(event) => {
          if (!rail.current || event.touches.length === 0) return;
          applyInput();
          requestedVirtual.current = null;
          window.clearTimeout(wheelTimer.current);
          lastWheel.current = null;
          stopAnimation();
          dragged.current = false;
          const touch = event.touches[0];
          const now = performance.now();
          gesture.current = {
            startX: touch.clientX,
            startY: touch.clientY,
            startScrollLeft: rail.current.scrollLeft,
            positions: [{ x: touch.clientX, time: now }],
          };
        }}
        onScroll={onScroll}
        role="region"
        aria-label="Лента рекомендованных треков"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            stepSelection(-1);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            stepSelection(1);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const virtual = nearestVirtualIndex();
            onPlay(((virtual % count) + count) % count);
          }
        }}
      >
        {virtualTracks.map((track, virtualIndex) => {
          const realIndex = count > 0 ? virtualIndex % count : 0;
          const isLoading = virtualIndex === selectedVirtual && loadingTrackId === track.id;
          const isSpotify = track.source === 'spotify' || track.id.startsWith('spotify:');

          return (
            <button
              type="button"
              key={`${track.id}-${virtualIndex}`}
              data-feature-index={virtualIndex}
              data-track-id={track.id}
              data-source={track.source}
              aria-busy={isLoading || undefined}
              aria-current={virtualIndex === selectedVirtual ? 'true' : undefined}
              tabIndex={virtualIndex === selectedVirtual ? 0 : -1}
              aria-label={`Воспроизвести ${track.title}, ${track.artist}`}
              onMouseEnter={() => schedulePreview(track.id, track.source)}
              onMouseLeave={clearPreview}
              onClick={(event) => {
                if (dragged.current) {
                  event.preventDefault();
                  return;
                }
                clearPreview();
                const list = rail.current;
                const offset = list ? scrollAt(virtualIndex) - list.scrollLeft : 0;
                if (Math.abs(offset) > 1) scrollToVirtual(virtualIndex, true);
                else updateSelectionByVirtual(virtualIndex);
                onPlay(realIndex);
              }}
              className="featured-track"
            >
              {track.thumbnail ? (
                <img
                  src={track.thumbnail}
                  alt=""
                  draggable={false}
                  decoding="async"
                  loading={Math.abs(virtualIndex - selectedVirtual) > 4 ? 'lazy' : 'eager'}
                />
              ) : (
                <span className="featured-placeholder">
                  <Music2 size={36} />
                </span>
              )}
              <span className="featured-shade" />

              {/* Visible source badge with moderate frosted glass */}
              {isSpotify ? (
                <span className="featured-source-badge featured-source-spotify">Spotify</span>
              ) : (
                <span className="featured-source-badge featured-source-yt">YouTube</span>
              )}

              <span className="featured-play">
                {isLoading ? <Loader2 size={19} className="animate-spin playback-spinner" /> : <Play size={19} fill="currentColor" />}
              </span>
              <span className="featured-copy">
                <span className="featured-title">{track.title}</span>
                <span className="featured-artist">{track.artist}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
});
