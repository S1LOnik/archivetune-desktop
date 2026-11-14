import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home,
  Compass,
  Search,
  Library,
  Settings,
  Users,
  AudioLines,
  BarChart3,
  PlugZap,
  ListMusic,
  PictureInPicture2,
  Sparkles,
} from 'lucide-react';
import { useAccountsStore, usePlayerStore, useUIStore } from '../store';

const NAV_ITEMS = [
  { icon: Home, label: 'Главная', path: '/home' },
  { icon: Compass, label: 'Обзор', path: '/explore' },
  { icon: Search, label: 'Поиск', path: '/search' },
  { icon: Library, label: 'Библиотека', path: '/library' },
  { icon: PlugZap, label: 'Интеграции', path: '/integrations' },
  { icon: Users, label: 'Вместе', path: '/together' },
  { icon: AudioLines, label: 'Shazam', path: '/recognize' },
  { icon: BarChart3, label: 'Статистика', path: '/stats' },
  { icon: Settings, label: 'Настройки', path: '/settings' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { spotifyConnected, ytmConnected, scConnected, together } = useAccountsStore();
  const queueLen = usePlayerStore((s) => s.queue.length);
  const { queueDrawerOpen, toggleQueueDrawer } = useUIStore();

  return (
    <aside className="app-sidebar w-60 shrink-0 bg-surface-container/70 backdrop-blur-2xl flex flex-col py-3 select-none">
      {/* Brand */}
      <div className="flex items-center justify-between px-4 py-2.5 mb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary/30 to-purple-500/20 text-primary flex items-center justify-center shadow-sm">
            <Sparkles size={18} />
          </div>
          <div>
            <span className="font-extrabold text-sm text-on-surface tracking-tight block leading-tight">
              ArchiveTune
            </span>
            <span className="text-[10px] text-primary/90 font-bold tracking-wider uppercase">ТВОЯ МУЗЫКА</span>
          </div>
        </div>
      </div>

      {/* Connected Account Quick Chips */}
      <div
        onClick={() => navigate('/integrations')}
        className="mx-3 mb-3 px-3 py-2 rounded-2xl bg-surface-container-high/60 hover:bg-surface-container-highest/80 flex items-center justify-between cursor-pointer transition-all shadow-sm"
        title="Статус интеграций: Spotify, YouTube Music, SoundCloud"
      >
        <div className="flex items-center gap-1.5 text-[10px] font-bold">
          <span
            className={`px-2 py-0.5 rounded-full transition-colors ${
              spotifyConnected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-surface-container text-on-surface-variant/40'
            }`}
          >
            SP
          </span>
          <span
            className={`px-2 py-0.5 rounded-full transition-colors ${
              ytmConnected ? 'bg-red-500/20 text-red-300' : 'bg-surface-container text-on-surface-variant/40'
            }`}
          >
            YT
          </span>
          <span
            className={`px-2 py-0.5 rounded-full transition-colors ${
              scConnected ? 'bg-amber-500/20 text-amber-300' : 'bg-surface-container text-on-surface-variant/40'
            }`}
          >
            SC
          </span>
        </div>
        <span className="text-[11px] font-semibold text-on-surface-variant flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              spotifyConnected || ytmConnected || scConnected ? 'bg-emerald-400' : 'bg-neutral-500'
            }`}
          />
          {spotifyConnected || ytmConnected || scConnected ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-1">
        {NAV_ITEMS.map(({ icon: Icon, label, path }) => {
          const active =
            pathname === path ||
            (path === '/home' && (pathname === '/' || pathname === '')) ||
            (path === '/integrations' && pathname === '/spotify');
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all duration-150 ${
                active
                  ? 'bg-primary/15 text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon size={18} strokeWidth={active ? 2.5 : 2} className={active ? 'text-primary' : 'opacity-70'} />
                {label}
              </span>
              {path === '/together' && together.role !== 'idle' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Desktop Quick Actions */}
      <div className="px-3 pt-3 space-y-1.5">
        <button
          onClick={toggleQueueDrawer}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all shadow-sm ${
            queueDrawerOpen
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container-high/80 text-on-surface hover:bg-surface-container-highest'
          }`}
        >
          <span className="flex items-center gap-2">
            <ListMusic size={15} /> Очередь
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-black/20 text-[10px] font-bold">{queueLen}</span>
        </button>
        <button
          onClick={() => void window.electronAPI?.toggleMiniMode?.()}
          className="w-full flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high/60 hover:text-on-surface transition"
        >
          <PictureInPicture2 size={15} /> Мини-плеер (Ctrl+M)
        </button>
      </div>
    </aside>
  );
}
