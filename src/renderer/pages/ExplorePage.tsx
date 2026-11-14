import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Flame, AudioLines, Disc, RefreshCw, Play } from 'lucide-react';
import TrackRow from '../components/TrackRow';
import { usePlayer } from '../lib/usePlayer';
import type { Track } from '../types/electron';

export default function ExplorePage() {
  const navigate = useNavigate();
  const { playFromQueue } = usePlayer();

  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<Track[]>([]);
  const [moods, setMoods] = useState<Array<{ title: string; query: string }>>([]);
  const [newReleases, setNewReleases] = useState<any[]>([]);
  const [shazamTop, setShazamTop] = useState<Track[]>([]);
  const [activeGenreTracks, setActiveGenreTracks] = useState<Track[]>([]);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [explore, shazam] = await Promise.all([
        window.electronAPI?.ytmusic?.getExplore?.().catch(() => null),
        window.electronAPI?.recognition?.topGlobal?.(15).catch(() => []),
      ]);
      if (explore) {
        setCharts(explore.charts || []);
        setMoods(explore.moods || []);
        setNewReleases(explore.newReleases || []);
      }
      if (Array.isArray(shazam)) {
        setShazamTop(
          shazam.map((s: any, idx: number) => ({
            id: s.id || `shazam_${idx}`,
            title: s.title,
            artist: s.artist,
            album: s.album,
            thumbnail: s.thumbnail,
            duration: 0,
            source: 'apple' as const,
            qualityBadge: 'SHAZAM TOP',
          }))
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handleSelectMood = async (m: { title: string; query: string }) => {
    setSelectedMood(m.title);
    const list = await window.electronAPI?.ytmusic?.search?.(m.query).catch(() => []);
    setActiveGenreTracks(list || []);
  };

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-on-surface flex items-center gap-2.5">
            <Compass className="text-primary" size={26} />
            Обзор и Чарты
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Тренды YouTube Music, настроения, свежие релизы и глобальный топ Shazam
          </p>
        </div>
        <button
          onClick={() => void loadAll()}
          className="px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold flex items-center gap-2"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Обновить
        </button>
      </div>

      {/* Moods & Genres */}
      {moods.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
            Настроения и жанры
          </h2>
          <div className="flex flex-wrap gap-2">
            {moods.map((m) => (
              <button
                key={m.title}
                onClick={() => void handleSelectMood(m)}
                className={`px-4 py-2 rounded-2xl text-xs font-bold  transition ${
                  selectedMood === m.title
                    ? 'bg-primary text-on-primary '
                    : 'bg-surface-container-high text-on-surface  hover:bg-surface-container-highest'
                }`}
              >
                {m.title}
              </button>
            ))}
          </div>
          {selectedMood && activeGenreTracks.length > 0 && (
            <div className="mt-4 bg-surface-container rounded-2xl p-3 space-y-1">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-bold text-primary">Подборка: {selectedMood}</span>
                <button
                  onClick={() => void playFromQueue(activeGenreTracks, 0)}
                  className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                >
                  <Play size={12} /> Играть всё
                </button>
              </div>
              {activeGenreTracks.slice(0, 10).map((t, i) => (
                <TrackRow key={`${t.id}_${i}`} track={t} index={i} showIndex queue={activeGenreTracks} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* New Releases */}
      {newReleases.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-2">
            <Disc size={15} className="text-primary" /> Новые релизы и альбомы
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {newReleases.slice(0, 10).map((rel, idx) => (
              <div
                key={`${rel.id}_${idx}`}
                onClick={() => navigate(`/album/${encodeURIComponent(rel.id)}`)}
                className="group p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high cursor-pointer transition"
              >
                <div className="aspect-square rounded-xl overflow-hidden bg-surface-container-highest mb-2.5">
                  {rel.thumbnail ? (
                    <img
                      src={rel.thumbnail}
                      alt={rel.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">💿</div>
                  )}
                </div>
                <p className="text-xs font-bold text-on-surface truncate">{rel.title}</p>
                <p className="text-[11px] text-on-surface-variant truncate">{rel.subtitle}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Two columns: YTM Charts + Shazam Global Top */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-surface-container rounded-3xl p-4 space-y-2">
          <div className="flex items-center justify-between px-2 pb-1">
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <Flame size={17} className="text-red-400" /> Глобальные чарты YTM
            </h2>
            {charts.length > 0 && (
              <button
                onClick={() => void playFromQueue(charts, 0)}
                className="text-xs font-bold text-primary hover:underline"
              >
                Играть всё
              </button>
            )}
          </div>
          {charts.length === 0 ? (
            <p className="text-xs text-on-surface-variant p-4 text-center">Загрузка чартов...</p>
          ) : (
            charts.slice(0, 15).map((t, i) => (
              <TrackRow key={`${t.id}_${i}`} track={t} index={i} showIndex queue={charts} />
            ))
          )}
        </section>

        <section className="bg-surface-container rounded-3xl p-4 space-y-2">
          <div className="flex items-center justify-between px-2 pb-1">
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <AudioLines size={17} className="text-sky-400" /> Shazam Global Top
            </h2>
            {shazamTop.length > 0 && (
              <button
                onClick={() => void playFromQueue(shazamTop, 0)}
                className="text-xs font-bold text-primary hover:underline"
              >
                Играть всё
              </button>
            )}
          </div>
          {shazamTop.length === 0 ? (
            <p className="text-xs text-on-surface-variant p-4 text-center">
              Чарт Shazam временно недоступен.
            </p>
          ) : (
            shazamTop.map((t, i) => (
              <TrackRow key={`${t.id}_${i}`} track={t} index={i} showIndex queue={shazamTop} />
            ))
          )}
        </section>
      </div>
    </div>
  );
}
