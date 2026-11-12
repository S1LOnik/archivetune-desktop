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
      className="flex items-center justify-between h-9 px-4 bg-surface-container border-b border-outline-variant/40 flex-shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <span className="text-primary font-black text-sm tracking-wide">🌸 ArchiveTune</span>
        {!isMiniPipMode && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
            V2.0 RC
          </span>
        )}
      </div>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleToggleMini}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
            isMiniPipMode
              ? 'bg-primary text-on-primary'
              : 'hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface'
          }`}
          title={isMiniPipMode ? 'Exit Mini Widget (PiP)' : 'Always-on-Top Mini Widget (PiP)'}
        >
          <PictureInPicture2 size={13} />
        </button>
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        {!isMiniPipMode && (
          <button
            onClick={() => window.electronAPI?.maximize()}
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
            title="Maximize"
          >
            <Square size={12} />
          </button>
        )}
        <button
          onClick={() => window.electronAPI?.close()}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-red-500/80 text-on-surface-variant hover:text-white transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
