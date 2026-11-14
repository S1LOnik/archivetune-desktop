import React, { useEffect, useState } from 'react';
import { AudioLines, Mic, Speaker, FileAudio, Play, Trash2, Search } from 'lucide-react';
import { usePlayer } from '../lib/usePlayer';
import { useUIStore } from '../store';

export default function RecognitionPage() {
  const { playTrack } = usePlayer();
  const { pushToast, setSourceSwitcherTrack } = useUIStore();

  const [listening, setListening] = useState<'mic' | 'system' | null>(null);
  const [lastMatch, setLastMatch] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const loadHistory = async () => {
    const h = await window.electronAPI?.recognition?.getHistory?.();
    if (Array.isArray(h)) setHistory(h);
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const handleRecognizeLive = async (mode: 'mic' | 'system') => {
    setListening(mode);
    setLastMatch(null);
    try {
      const res = await window.electronAPI?.recognition?.recognizeLive(mode);
      if (res?.result) {
        setLastMatch(res.result);
        pushToast(`Распознано: ${res.result.title} — ${res.result.artist}`, 'lossless');
        await loadHistory();
      } else {
        pushToast(res?.error || 'Трек не распознан. Попробуйте ближе к фрагменту.', 'error');
      }
    } finally {
      setListening(null);
    }
  };

  const handleRecognizeFile = async () => {
    const res = await window.electronAPI?.recognition?.pickAndRecognizeFile();
    if (res?.canceled) return;
    if (res?.result) {
      setLastMatch(res.result);
      pushToast(`Распознано: ${res.result.title}`, 'lossless');
      await loadHistory();
    } else {
      pushToast('Не удалось распознать аудиофайл.', 'error');
    }
  };

  const playRecognized = (item: any) => {
    void playTrack({
      id: item.id,
      title: item.title,
      artist: item.artist,
      album: item.album,
      thumbnail: item.thumbnail,
      duration: 0,
      source: 'youtube',
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-on-surface flex items-center gap-2.5">
          <AudioLines className="text-primary" size={26} />
          Распознавание музыки (Shazam)
        </h1>
        <p className="text-xs text-on-surface-variant mt-1">
          Определение трека по системному звуку ПК (PulseAudio/PipeWire), микрофону или медиафайлу
        </p>
      </div>

      {/* Radar Action Panel */}
      <div className="p-8 rounded-3xl bg-surface-container   flex flex-col items-center text-center space-y-5">
        <button
          onClick={() => void handleRecognizeLive('system')}
          disabled={Boolean(listening)}
          className={`w-28 h-28 rounded-full flex items-center justify-center transition shadow-2xl ${
            listening
              ? 'bg-primary text-on-primary animate-pulse scale-105'
              : 'bg-primary/20 text-primary hover:bg-primary/30'
          }`}
        >
          <AudioLines size={44} />
        </button>

        <div>
          <p className="text-base font-bold text-on-surface">
            {listening === 'system'
              ? 'Слушаю системный звук (7 сек)...'
              : listening === 'mic'
              ? 'Слушаю микрофон (7 сек)...'
              : 'Нажмите, чтобы распознать то, что играет сейчас'}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-center">
          <button
            onClick={() => void handleRecognizeLive('system')}
            disabled={Boolean(listening)}
            className="px-4 py-2.5 rounded-2xl bg-primary text-on-primary text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Speaker size={15} /> Системный звук ПК
          </button>
          <button
            onClick={() => void handleRecognizeLive('mic')}
            disabled={Boolean(listening)}
            className="px-4 py-2.5 rounded-2xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Mic size={15} /> Микрофон
          </button>
          <button
            onClick={() => void handleRecognizeFile()}
            disabled={Boolean(listening)}
            className="px-4 py-2.5 rounded-2xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <FileAudio size={15} /> Из файла
          </button>
        </div>

        {lastMatch && (
          <div className="w-full max-w-md mt-4 p-4 rounded-2xl bg-surface-container-high   flex items-center gap-4 text-left">
            <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface-container flex-shrink-0">
              {lastMatch.thumbnail ? (
                <img src={lastMatch.thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl">🎵</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-on-surface truncate">{lastMatch.title}</p>
              <p className="text-xs text-on-surface-variant truncate">{lastMatch.artist}</p>
              {lastMatch.album && (
                <p className="text-[11px] text-primary truncate mt-0.5">{lastMatch.album}</p>
              )}
            </div>
            <button
              onClick={() => playRecognized(lastMatch)}
              className="p-3 rounded-2xl bg-primary text-on-primary"
            >
              <Play size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Recognition History */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
            История распознаваний ({history.length})
          </h2>
          {history.length > 0 && (
            <button
              onClick={async () => {
                await window.electronAPI.recognition.clearHistory();
                setHistory([]);
              }}
              className="text-xs text-red-400 hover:underline flex items-center gap-1"
            >
              <Trash2 size={12} /> Очистить
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {history.map((item) => (
            <div
              key={`${item.id}_${item.timestamp}`}
              className="flex items-center gap-3 p-3 rounded-2xl bg-surface-container  "
            >
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-surface-container-high flex-shrink-0">
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">🎵</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-on-surface truncate">{item.title}</p>
                <p className="text-xs text-on-surface-variant truncate">{item.artist}</p>
              </div>
              <button
                onClick={() =>
                  setSourceSwitcherTrack({
                    id: item.id,
                    title: item.title,
                    artist: item.artist,
                    duration: 0,
                    source: 'youtube',
                    thumbnail: item.thumbnail,
                  })
                }
                className="p-2 rounded-xl hover:bg-surface-container-high text-on-surface-variant"
                title="Найти Lossless / Switch Source"
              >
                <Search size={14} />
              </button>
              <button
                onClick={() => playRecognized(item)}
                className="p-2 rounded-xl bg-primary/15 text-primary hover:bg-primary hover:text-on-primary transition"
              >
                <Play size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
