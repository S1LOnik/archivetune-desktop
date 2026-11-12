import React, { useEffect, useState } from 'react';
import { BarChart3, Clock, Flame, Trophy, Trash2 } from 'lucide-react';
import { usePlayer } from '../lib/usePlayer';

export default function StatsPage() {
  const { playTrack } = usePlayer();
  const [stats, setStats] = useState<any | null>(null);

  const load = async () => {
    const s = await window.electronAPI?.db?.getStats?.();
    setStats(s);
  };

  useEffect(() => {
    void load();
  }, []);

  if (!stats) return <div className="p-6 text-sm text-on-surface-variant">Загрузка статистики...</div>;

  const trackEntries = Object.values(stats.tracks || {}) as any[];
  const topTracks = [...trackEntries].sort((a, b) => b.count - a.count).slice(0, 12);

  const artistTotals = new Map<string, number>();
  for (const t of trackEntries) {
    artistTotals.set(t.artist, (artistTotals.get(t.artist) || 0) + t.count);
  }
  const topArtists = Array.from(artistTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const hourly: number[] = Array.isArray(stats.hourlyCounts) ? stats.hourlyCounts : new Array(24).fill(0);
  const maxHour = Math.max(1, ...hourly);
  const totalMins = Math.round((stats.totalSeconds || 0) / 60);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-7">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-on-surface flex items-center gap-2.5">
            <BarChart3 className="text-primary" size={26} />
            Статистика & Year in Music
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Локальная аналитика ваших прослушиваний и активности по часам
          </p>
        </div>
        <button
          onClick={async () => {
            const reset = await window.electronAPI.db.resetStats();
            setStats(reset);
          }}
          className="px-3.5 py-2 rounded-xl bg-red-500/15 text-red-300 text-xs font-semibold inline-flex items-center gap-1.5"
        >
          <Trash2 size={13} /> Сбросить статистику
        </button>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-3xl bg-gradient-to-br from-primary/25 to-surface-container border border-primary/30">
          <div className="text-xs text-on-surface-variant flex items-center gap-1.5">
            <Flame size={14} className="text-primary" /> Всего прослушиваний
          </div>
          <div className="text-3xl font-black text-on-surface mt-1">{stats.totalPlays || 0}</div>
        </div>
        <div className="p-5 rounded-3xl bg-surface-container border border-outline-variant/25">
          <div className="text-xs text-on-surface-variant flex items-center gap-1.5">
            <Clock size={14} className="text-primary" /> Время в музыке
          </div>
          <div className="text-3xl font-black text-on-surface mt-1">
            {totalMins >= 60 ? `${Math.floor(totalMins / 60)}ч ${totalMins % 60}м` : `${totalMins} мин`}
          </div>
        </div>
        <div className="p-5 rounded-3xl bg-surface-container border border-outline-variant/25">
          <div className="text-xs text-on-surface-variant flex items-center gap-1.5">
            <Trophy size={14} className="text-amber-300" /> Топ исполнитель
          </div>
          <div className="text-xl font-black text-on-surface mt-2 truncate">
            {topArtists[0]?.[0] || 'Пока нет данных'}
          </div>
        </div>
      </div>

      {/* Hourly Heatmap */}
      <section className="p-5 rounded-3xl bg-surface-container border border-outline-variant/25 space-y-3">
        <h2 className="text-sm font-bold text-on-surface">Активность по часам суток</h2>
        <div className="flex items-end gap-1.5 h-32 pt-4">
          {hourly.map((val, hour) => {
            const pct = Math.max(4, Math.round((val / maxHour) * 100));
            return (
              <div key={hour} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div
                  className="w-full rounded-t-md bg-primary/80 transition-all"
                  style={{ height: `${pct}%` }}
                  title={`${hour}:00 — ${val} треков`}
                />
                <span className="text-[9px] text-on-surface-variant">{hour}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="p-5 rounded-3xl bg-surface-container border border-outline-variant/25 space-y-3">
          <h2 className="text-base font-bold text-on-surface">Топ треки</h2>
          {topTracks.length === 0 ? (
            <p className="text-xs text-on-surface-variant">Послушайте пару треков, чтобы увидеть топ.</p>
          ) : (
            <div className="space-y-2">
              {topTracks.map((t, i) => (
                <div
                  key={t.id}
                  onClick={() =>
                    void playTrack({
                      id: t.id,
                      title: t.title,
                      artist: t.artist,
                      album: t.album,
                      thumbnail: t.thumbnail,
                      duration: 0,
                      source: (t.source || 'youtube') as any,
                    })
                  }
                  className="flex items-center gap-3 p-2.5 rounded-2xl bg-surface-container-high/60 hover:bg-surface-container-highest cursor-pointer"
                >
                  <span className="w-5 text-xs font-bold text-primary text-center">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-on-surface truncate">{t.title}</p>
                    <p className="text-[11px] text-on-surface-variant truncate">{t.artist}</p>
                  </div>
                  <span className="text-xs font-bold text-on-surface-variant">{t.count}x</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="p-5 rounded-3xl bg-surface-container border border-outline-variant/25 space-y-3">
          <h2 className="text-base font-bold text-on-surface">Топ исполнители</h2>
          {topArtists.length === 0 ? (
            <p className="text-xs text-on-surface-variant">Пока недостаточно данных.</p>
          ) : (
            <div className="space-y-2">
              {topArtists.map(([artist, count], i) => (
                <div
                  key={artist}
                  className="flex items-center justify-between p-3 rounded-2xl bg-surface-container-high/60 text-xs"
                >
                  <span className="font-bold text-on-surface">
                    #{i + 1} {artist}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-primary/15 text-primary font-bold">
                    {count} прослушиваний
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
