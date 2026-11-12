import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home,
  Compass,
  Search,
  Library,
  PlugZap,
  Users,
  AudioLines,
  BarChart3,
  Settings,
  Music2,
  ListMusic,
  PictureInPicture2,
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
    <aside className="w-56 shrink-0 bg-surface-container flex flex-col py-3 border-r border-outline-variant/30 select-none">
      {/* Brand */}
      <div className="flex items-center justify-between px-4 py-2.5 mb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
            <Music2 size={18} />
          </div>
          <div>
            <span className="font-bold text-sm text-on-surface tracking-tight block leading-tight">
              ArchiveTune
            </span>
            <span className="text-[10px] text-primary font-semibold">V2 RELEASE</span>
          </div>
        </div>
      </div>

      {/* Connected account pills */}
      <div
        onClick={() => navigate('/integrations')}
        className="mx-3 mb-2 px-2.5 py-1.5 rounded-xl bg-surface-container-high/70 border border-outline-variant/20 flex items-center justify-between cursor-pointer hover:bg-surface-container-highest transition"
        title="Статус привязки Spotify / YouTube Music / SoundCloud"
      >
        <div className="flex items-center gap-1.5 text-[10px] font-bold">
          <span
            className={`px-1.5 py-0.5 rounded ${
              spotifyConnected ? 'bg-green-500/20 text-green-300' : 'bg-surface-container text-on-surface-variant/60'
            }`}
          >
            SP
          </span>
          <span
            className={`px-1.5 py-0.5 rounded ${
              ytmConnected ? 'bg-red-500/20 text-red-300' : 'bg-surface-container text-on-surface-variant/60'
            }`}
          >
            YT
          </span>
          <span
            className={`px-1.5 py-0.5 rounded ${
              scConnected ? 'bg-orange-500/20 text-orange-300' : 'bg-surface-container text-on-surface-variant/60'
            }`}
          >
            SC
          </span>
        </div>
        <span className="text-[10px] text-on-surface-variant">
          {spotifyConnected || ytmConnected || scConnected ? 'Online' : 'Connect'}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {NAV_ITEMS.map(({ icon: Icon, label, path }) => {
          const active =
            pathname === path ||
            (path === '/home' && (pathname === '/' || pathname === '')) ||
            (path === '/integrations' && pathname === '/spotify');
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 ${
                active
                  ? 'bg-secondary-container text-on-surface font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
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
      <div className="px-3 pt-2 border-t border-outline-variant/20 space-y-1.5">
        <button
          onClick={toggleQueueDrawer}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition ${
            queueDrawerOpen
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
          }`}
        >
          <span className="flex items-center gap-2">
            <ListMusic size={15} /> Очередь
          </span>
          <span className="opacity-80">{queueLen}</span>
        </button>
        <button
          onClick={() => void window.electronAPI?.toggleMiniMode?.()}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition"
        >
          <PictureInPicture2 size={15} /> Мини-плеер (Ctrl+M)
        </button>
      </div>
    </aside>
  );
}
