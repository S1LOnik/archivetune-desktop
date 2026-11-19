import { useShallow } from 'zustand/react/shallow';
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useInterfaceMotion } from '../lib/useInterfaceMotion';
import {
  X,
  Trash2,
  ArrowUp,
  ArrowDown,
  Disc3,
  ListMusic,
  Save,
  Sparkles,
} from 'lucide-react';
import { useUIStore, usePlayerStore } from '../store';
import { usePlayer } from '../lib/usePlayer';

export default function QueueDrawer() {
  const { reducedMotion, panelTransition } = useInterfaceMotion();
  const { queueDrawerOpen, setQueueDrawerOpen, pushToast } = useUIStore();
  const {
    queue,
    queueIndex,
    currentTrack,
    automixPlan,
    smartDjAutomix,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    savePlaylist,
  } = usePlayerStore(useShallow((state) => ({
    queue: state.queue,
    queueIndex: state.queueIndex,
    currentTrack: state.currentTrack,
    automixPlan: state.automixPlan,
    smartDjAutomix: state.smartDjAutomix,
    removeFromQueue: state.removeFromQueue,
    reorderQueue: state.reorderQueue,
    clearQueue: state.clearQueue,
    savePlaylist: state.savePlaylist,
  })));
  const { playFromQueue } = usePlayer();

  const handleSaveAsPlaylist = () => {
    if (queue.length === 0) return;
    const name = `Очередь от ${new Date().toLocaleDateString('ru')}`;
    savePlaylist({
      id: `local:queue:${Date.now()}`,
      name,
      source: 'local',
      tags: ['Queue', 'Mix'],
      trackCount: queue.length,
      tracks: [...queue],
      thumbnail: currentTrack?.thumbnail || queue[0]?.thumbnail,
      updatedAt: Date.now(),
    });
    pushToast(`Очередь сохранена в плейлист "${name}"`, 'info');
  };

  return (
    <AnimatePresence>
      {queueDrawerOpen && (
        <motion.aside
          key="queue"
          aria-label="Очередь"
          initial={reducedMotion ? false : { opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 28 }}
          transition={{ ...panelTransition, opacity: { duration: reducedMotion ? 0 : 0.16 } }}
          className="w-80 flex-shrink-0 bg-surface-container/95 backdrop-blur-xl flex flex-col h-full border-l border-outline-variant/40"
        >
          <div className="px-4 py-3   flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListMusic size={17} className="text-primary" />
              <h3 className="text-sm font-bold text-on-surface">
                Очередь ({queue.length})
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleSaveAsPlaylist}
                title="Сохранить очередь как плейлист"
                className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface"
              >
                <Save size={14} />
              </button>
              <button
                onClick={clearQueue}
                title="Очистить очередь"
                className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
              <button
                aria-label="Закрыть очередь"
                onClick={() => setQueueDrawerOpen(false)}
                className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Live Smart DJ Automix Plan Card */}
          {smartDjAutomix && automixPlan && (
            <div className="mx-3 mt-3 p-3 rounded-2xl bg-primary/10   text-xs space-y-1">
              <div className="flex items-center justify-between font-bold text-primary">
                <span className="flex items-center gap-1.5">
                  <Disc3 size={14} /> Smart DJ AutoMix
                </span>
                <span>{Math.round(automixPlan.compatibilityScore * 100)}% совместимости</span>
              </div>
              <div className="text-[11px] text-on-surface flex items-center gap-1.5 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-primary/20 font-semibold">
                  {automixPlan.style.replace('_', ' ')}
                </span>
                <span>{(automixPlan.fadeMs / 1000).toFixed(1)} с перехода</span>
                {automixPlan.bassSwap && <span>• Смена баса</span>}
                {automixPlan.filterSweep && <span>• LPF/HPF Ride</span>}
              </div>
              <p className="text-[10px] text-on-surface-variant leading-snug">{automixPlan.reason}</p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {queue.length === 0 ? (
              <div className="py-12 text-center text-xs text-on-surface-variant">
                Очередь пуста. Выберите трек или запустите радио.
              </div>
            ) : (
              queue.map((track, idx) => {
                const isActive = idx === queueIndex;
                return (
                  <div
                    key={`${track.id}_${idx}`}
                    className={`group flex items-center gap-2.5 p-2 rounded-xl transition cursor-pointer ${
                      isActive
                        ? 'bg-primary/15  '
                        : 'hover:bg-surface-container-high  '
                    }`}
                    onClick={() => void playFromQueue(queue, idx)}
                  >
                    <div className="w-9 h-9 rounded-lg overflow-hidden bg-surface-container-high flex-shrink-0">
                      {track.thumbnail ? (
                        <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs">🎵</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-xs font-semibold truncate ${
                          isActive ? 'text-primary' : 'text-on-surface'
                        }`}
                      >
                        {track.title}
                      </p>
                      <p className="text-[11px] text-on-surface-variant truncate">{track.artist}</p>
                    </div>
                    <div
                      className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => reorderQueue(idx, idx - 1)}
                        disabled={idx === 0}
                        className="p-1 rounded hover:bg-surface-container-highest disabled:opacity-30"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => reorderQueue(idx, idx + 1)}
                        disabled={idx === queue.length - 1}
                        className="p-1 rounded hover:bg-surface-container-highest disabled:opacity-30"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        onClick={() => removeFromQueue(idx)}
                        className="p-1 rounded hover:bg-surface-container-highest text-red-400"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {smartDjAutomix && queue[queueIndex + 1] && (
            <div className="px-3 py-2   text-[11px] text-on-surface-variant flex items-center gap-1.5">
              <Sparkles size={12} className="text-primary flex-shrink-0" />
              <span className="truncate">Далее: {queue[queueIndex + 1].title}</span>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
