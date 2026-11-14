import React from 'react';
import { Minus, Square, X, PictureInPicture2 } from 'lucide-react';
import { useUIStore } from '../store';

export default function TitleBar() {
  const { isMiniPipMode, setMiniPipMode } = useUIStore();

  const handleToggleMini = async () => {
    const next = await window.electronAPI?.toggleMiniMode();
    if (typeof next === 'boolean') {
      setMiniPipMode(next);
    }
  };

  return (
    <div
      className="flex items-center justify-between h-9 px-4 bg-surface-container/70 backdrop-blur-xl flex-shrink-0 select-none z-50"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-primary font-black text-xs tracking-wider flex items-center gap-1.5">
          <span>🌸</span>
          <span className="bg-gradient-to-r from-primary to-rose-300 bg-clip-text text-transparent font-extrabold">ArchiveTune</span>
        </span>
        {!isMiniPipMode && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary tracking-wide">
            v16.2 RC
          </span>
        )}
      </div>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleToggleMini}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
            isMiniPipMode
              ? 'bg-primary text-on-primary'
              : 'hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface'
          }`}
          title={isMiniPipMode ? 'Выйти из мини-плеера' : 'Мини-плеер поверх окон (PiP)'}
        >
          <PictureInPicture2 size={13} />
        </button>
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all"
          title="Свернуть"
        >
          <Minus size={13} />
        </button>
        {!isMiniPipMode && (
          <button
            onClick={() => window.electronAPI?.maximize()}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all"
            title="Развернуть"
          >
            <Square size={11} />
          </button>
        )}
        <button
          onClick={() => window.electronAPI?.close()}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/80 text-on-surface-variant hover:text-white transition-all"
          title="Закрыть"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
