import React, { useEffect, useState, useRef } from 'react';
import {
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Shuffle,
  List,
  Moon,
  Download,
  Gauge,
  Sliders,
  ChevronUp,
  ChevronDown,
  Trash2,
  RotateCcw,
  Check,
  Music2,
  Sparkles,
  Heart,
  Share2,
  Film,
  Languages,
  Layers,
  Disc3,
  Activity,
  ArrowLeftRight,
  Repeat1,
  Rewind,
  FastForward,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayerStore, useUIStore, PlayerStyleId, extractDominantColorFromImage } from '../store';
import { usePlayer } from '../lib/usePlayer';
import AudioVisualizer from './AudioVisualizer';

interface LyricWord {
  text: string;
  startTime: number;
  endTime: number;
}

interface LyricLine {
  time: number;
  endTime?: number;
  text: string;
  words?: LyricWord[];
  romanized?: string;
  translation?: string;
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTimecode(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '00:00.00';
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const SLEEP_TIMER_OPTIONS: Array<{ label: string; value: number | 'track' | null }> = [
  { label: 'Off', value: null },
  { label: '15 Minutes', value: 15 },
  { label: '30 Minutes', value: 30 },
  { label: '45 Minutes', value: 45 },
  { label: '60 Minutes', value: 60 },
  { label: 'End of Song', value: 'track' },
];

const PLAYER_STYLES: Array<{ id: PlayerStyleId; label: string; badge: string }> = [
  { id: 'flamingo', label: 'Flamingo', badge: 'Apple Music' },
  { id: 'v8_immersive', label: 'V9 Immersive', badge: 'Full Canvas' },
  { id: 'v10_expressive', label: 'V10 Expressive', badge: 'M3 Modern' },
  { id: 'bitchord', label: 'BitChord', badge: 'Studio Deck' },
  { id: 'simpmusic', label: 'SimpMusic', badge: 'Dual Card' },
  { id: 'spatialflow', label: 'SpatialFlow', badge: '3D Depth' },
  { id: 'tiktok', label: 'TikTok Rail', badge: 'Vertical 9:16' },
  { id: 'classic', label: 'Classic', badge: 'Hi-Fi Split' },
];

const EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const EQ_PRESET_MAP: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost': [6, 5, 4, 2, 0, 0, 0, 1, 2, 2],
  'Harman Target': [4, 3.5, 2, 0, -1, 0, 2, 3.5, 3, 2],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Electronic: [5, 4, 1, 0, -2, 1, 1, 3, 4, 5],
  Acoustic: [3, 3, 2, 1, 2, 2, 3, 3, 2, 2],
  'Night Mode': [-4, -3, -1, 1, 2, 2, 1, -1, -2, -3],
};

export default function NowPlayingOverlay() {
  const {
    currentTrack,
    isPlaying,
    isScrubbing,
    automixing,
    position,
    duration,
    resolvedSourceBadge,
    repeat,
    shuffle,
    speed,
    normalization,
    smartDjAutomix,
    eqEnabled,
    eqPreset,
    eqBands,
    canvasEnabled,
    sleepTimerRemainingSec,
    sleepAfterTrack,
    abLoopA,
    abLoopB,
    pitchSemitones,
    bassBoost,
    stereoWidener,
    silenceSkip,
    audioCompressor,
    lyricsOffset,
    lyricsFontSize,
    lyricsWordByWord,
    lyricsRomanize,
    lyricsTranslate,
    queue,
    setRepeat,
    toggleShuffle,
    setIsScrubbing,
    setSmartDjAutomix,
    setEqualizerState,
    setSleepTimer,
    setAbLoop,
    setDspOption,
    setLyricsSettings,
    isTrackLiked,
  } = usePlayerStore();

  const {
    playerStyle,
    setPlayerStyle,
    setShowNowPlaying,
    setSourceSwitcherTrack,
    setAuditTarget,
    dynamicColorFromArt,
    activeArtColor,
    setActiveArtColor,
  } = useUIStore();

  useEffect(() => {
    if (dynamicColorFromArt && currentTrack?.thumbnail) {
      extractDominantColorFromImage(currentTrack.thumbnail).then((hex) => {
        if (hex) setActiveArtColor(hex);
      });
    }
  }, [currentTrack?.id, currentTrack?.thumbnail, dynamicColorFromArt, setActiveArtColor]);
  const setLyricsOffset = (val: number) => setLyricsSettings({ lyricsOffset: val });
  const setLyricsFontSize = (val: 'small' | 'medium' | 'large') =>
    setLyricsSettings({ lyricsFontSize: val });
  const setLyricsWordByWord = (val: boolean) => setLyricsSettings({ lyricsWordByWord: val });
  const setLyricsRomanize = (val: boolean) => setLyricsSettings({ lyricsRomanize: val });
  const setLyricsTranslate = (val: boolean) => setLyricsSettings({ lyricsTranslate: val });
  const {
    pause,
    resume,
    seek,
    skipNext,
    skipPrev,
    changeSpeed,
    toggleNormalization,
    toggleLikeCurrent,
    downloadCurrentTrack,
  } = usePlayer();

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState('');
  const [lyricsSource, setLyricsSource] = useState('');
  const [hasWordSync, setHasWordSync] = useState(false);
  const [canvasData, setCanvasData] = useState<{ videoUrl: string; source: string } | null>(null);

  const [showQueue, setShowQueue] = useState(false);
  const [showDspModal, setShowDspModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedShareLines, setSelectedShareLines] = useState<number[]>([]);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'mp3' | 'flac' | 'opus'>('mp3');
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'done' | 'error'>(
    'idle'
  );
  const [downloadMsg, setDownloadMsg] = useState('');
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [arrowPulse, setArrowPulse] = useState<'prev' | 'next' | null>(null);

  const activeLyricRef = useRef<HTMLDivElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const displayPosition = isScrubbing && scrubPosition !== null ? scrubPosition : position;
  const effectivePosition = displayPosition + lyricsOffset / 1000;
  const activeIndex = lyrics.reduce((acc, line, i) => {
    if (line.time <= effectivePosition) return i;
    return acc;
  }, -1);

  useEffect(() => {
    if (!currentTrack) return;
    setLyrics([]);
    setPlainLyrics('');
    setLyricsSource('Searching 10+ providers...');
    setHasWordSync(false);

    window.electronAPI?.lyrics
      .get(currentTrack.title, currentTrack.artist, currentTrack.duration, currentTrack.id)
      .then((res) => {
        setLyrics(res.synced || []);
        setPlainLyrics(res.plain || '');
        setLyricsSource(res.source || 'none');
        setHasWordSync(Boolean(res.hasWordSync));
        if (res.synced && res.synced.length > 0) {
          setSelectedShareLines([0, Math.min(1, res.synced.length - 1)]);
        }
      })
      .catch(() => {
        setLyricsSource('none');
      });
  }, [currentTrack?.id, currentTrack?.title, lyricsTranslate, lyricsRomanize]);

  useEffect(() => {
    if (!currentTrack || !canvasEnabled) {
      setCanvasData(null);
      return;
    }
    setCanvasData(null);
    window.electronAPI?.canvas
      .get({
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
      })
      .then((res) => {
        if (res?.videoUrl) {
          setCanvasData({ videoUrl: res.videoUrl, source: res.source });
        }
      })
      .catch(() => {});
  }, [currentTrack?.id, currentTrack?.title, canvasEnabled]);

  useEffect(() => {
    const container = lyricsContainerRef.current;
    const el = activeLyricRef.current;
    if (container && el) {
      const targetTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }
  }, [activeIndex, playerStyle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showShareModal) setShowShareModal(false);
        else if (showDspModal) setShowDspModal(false);
        else if (showQueue) setShowQueue(false);
        else setShowNowPlaying(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showShareModal, showDspModal, showQueue, setShowNowPlaying]);

  if (!currentTrack) return null;

  const liked = isTrackLiked(currentTrack);
  const coverCompressed = !isPlaying || isScrubbing;

  const handleInstantPrev = () => {
    setArrowPulse('prev');
    setTimeout(() => setArrowPulse(null), 220);
    void skipPrev();
  };

  const handleInstantNext = () => {
    setArrowPulse('next');
    setTimeout(() => setArrowPulse(null), 220);
    void skipNext();
  };

  const nextRepeat = () => {
    const modes: Array<'none' | 'one' | 'all'> = ['none', 'all', 'one'];
    const idx = modes.indexOf(repeat);
    setRepeat(modes[(idx + 1) % modes.length]);
  };

  const handleDownload = async () => {
    if (downloadState === 'downloading' || !currentTrack) return;
    setDownloadState('downloading');
    setDownloadMsg(`Saving ${downloadFormat.toUpperCase()} + LRC to ~/Music/ArchiveTune...`);
    try {
      const res = await downloadCurrentTrack(downloadFormat);
      if (res?.ok) {
        setDownloadState('done');
        setDownloadMsg('Saved to ~/Music/ArchiveTune');
        setTimeout(() => setDownloadState('idle'), 4000);
      } else {
        setDownloadState('error');
        setDownloadMsg(res?.error || 'Download failed');
        setTimeout(() => setDownloadState('idle'), 4000);
      }
    } catch {
      setDownloadState('error');
      setDownloadMsg('Download failed');
      setTimeout(() => setDownloadState('idle'), 4000);
    }
  };

  const exportLyricsShareCardPng = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 1080, 1350);
    grad.addColorStop(0, '#1e162b');
    grad.addColorStop(0.5, '#12101b');
    grad.addColorStop(1, '#09080d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1350);

    const radial = ctx.createRadialGradient(850, 250, 40, 850, 250, 520);
    radial.addColorStop(0, 'rgba(203, 185, 245, 0.28)');
    radial.addColorStop(1, 'rgba(203, 185, 245, 0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, 1080, 1350);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText(currentTrack.title.slice(0, 34), 90, 150);

    ctx.fillStyle = '#cbb9f5';
    ctx.font = '600 32px sans-serif';
    ctx.fillText(currentTrack.artist.slice(0, 42), 90, 205);

    const chosenLines =
      selectedShareLines.length > 0
        ? selectedShareLines
            .sort((a, b) => a - b)
            .map((idx) => lyrics[idx]?.text)
            .filter(Boolean)
        : lyrics.slice(Math.max(0, activeIndex), Math.max(0, activeIndex) + 3).map((l) => l.text);

    ctx.fillStyle = '#f5f2ff';
    ctx.font = 'bold 52px sans-serif';
    let y = 360;
    for (const line of chosenLines.slice(0, 5)) {
      const words = (line || '').split(' ');
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > 880) {
          ctx.fillText(currentLine, 90, y);
          currentLine = word;
          y += 72;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) {
        ctx.fillText(currentLine, 90, y);
        y += 92;
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '600 26px sans-serif';
    ctx.fillText('🌸 ArchiveTune Extended Edition', 90, 1260);

    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `ArchiveTune-Lyrics-${currentTrack.title.replace(/[^a-z0-9]/gi, '_')}.png`;
    a.click();
    setShowShareModal(false);
  };

  const fontSizes = {
    small: 'text-xs md:text-sm leading-relaxed',
    medium: 'text-sm md:text-base leading-relaxed',
    large: 'text-lg md:text-xl leading-relaxed',
  };

  const activeFontSizes = {
    small: 'text-base md:text-lg font-bold',
    medium: 'text-xl md:text-2xl font-black',
    large: 'text-2xl md:text-4xl font-black',
  };

  const appleBlurInactiveFontSizes = {
    small: 'text-sm md:text-base font-semibold text-white/40',
    medium: 'text-lg md:text-xl font-extrabold text-white/40',
    large: 'text-2xl md:text-3xl font-black text-white/45',
  };

  const appleBlurActiveFontSizes = {
    small: 'text-xl md:text-2xl font-black text-white scale-[1.02] origin-left drop-shadow-[0_0_16px_rgba(255,255,255,0.45)]',
    medium: 'text-2xl md:text-3xl font-black text-white scale-[1.03] origin-left drop-shadow-[0_0_24px_rgba(255,255,255,0.45)]',
    large: 'text-4xl md:text-5xl font-black text-white scale-[1.04] origin-left drop-shadow-[0_0_36px_rgba(255,255,255,0.6)]',
  };

  const renderArtworkMedia = (className = 'w-full h-full object-cover') => {
    if (canvasEnabled && canvasData?.videoUrl) {
      return (
        <video
          key={`cover-${canvasData.videoUrl}`}
          src={canvasData.videoUrl}
          autoPlay
          loop
          muted
          playsInline
          className={className}
        />
      );
    }
    if (currentTrack.thumbnail) {
      return <img src={currentTrack.thumbnail} alt={currentTrack.title} className={className} />;
    }
    return (
      <div className="w-full h-full bg-surface-container-high flex items-center justify-center text-6xl">
        🎵
      </div>
    );
  };

  const renderSeekSlider = (accentClass = 'accent-primary h-2') => (
    <div className="w-full space-y-1.5">
      <input
        type="range"
        min={0}
        max={duration || 100}
        step={0.2}
        value={displayPosition}
        onMouseDown={() => {
          setIsScrubbing(true);
          setScrubPosition(position);
        }}
        onTouchStart={() => {
          setIsScrubbing(true);
          setScrubPosition(position);
        }}
        onChange={(e) => {
          const val = parseFloat(e.target.value);
          setScrubPosition(val);
          if (!isScrubbing) void seek(val);
        }}
        onMouseUp={(e) => {
          const val = parseFloat((e.target as HTMLInputElement).value);
          setIsScrubbing(false);
          setScrubPosition(null);
          void seek(val);
        }}
        onTouchEnd={() => {
          if (scrubPosition !== null) void seek(scrubPosition);
          setIsScrubbing(false);
          setScrubPosition(null);
        }}
        className={`w-full cursor-pointer rounded-lg ${accentClass}`}
      />
      <div className="flex justify-between text-xs text-on-surface-variant font-semibold tabular-nums">
        <span>{formatTime(displayPosition)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );

  const renderSecondaryPills = () => (
    <div className="flex items-center flex-wrap justify-center gap-2 pt-1 relative">
      {/* Speed selector */}
      <div className="relative">
        <button
          onClick={() => {
            setShowSpeedMenu((v) => !v);
            setShowSleepMenu(false);
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            speed !== 1.0
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <Gauge size={13} />
          <span>{speed}x</span>
        </button>
        {showSpeedMenu && (
          <div className="absolute bottom-10 left-0 bg-surface-container-highest   rounded-xl p-1.5 shadow-xl z-30 flex flex-col min-w-[90px]">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  void changeSpeed(s);
                  setShowSpeedMenu(false);
                }}
                className={`px-3 py-1.5 text-xs rounded-lg text-left flex items-center justify-between ${
                  speed === s
                    ? 'bg-primary/20 text-primary font-bold'
                    : 'text-on-surface hover:bg-surface-container-high'
                }`}
              >
                <span>{s}x</span>
                {speed === s && <Check size={12} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Normalization toggle */}
      <button
        onClick={() => void toggleNormalization()}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          normalization
            ? 'bg-primary text-on-primary'
            : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
        }`}
      >
        <Sparkles size={13} />
        <span>Norm</span>
      </button>

      {/* Sleep Timer */}
      <div className="relative">
        <button
          onClick={() => {
            setShowSleepMenu((v) => !v);
            setShowSpeedMenu(false);
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            sleepTimerRemainingSec !== null || sleepAfterTrack
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <Moon size={13} />
          <span>
            {sleepAfterTrack
              ? 'End of Track'
              : sleepTimerRemainingSec !== null
                ? `${Math.ceil(sleepTimerRemainingSec / 60)}m`
                : 'Sleep'}
          </span>
        </button>
        {showSleepMenu && (
          <div className="absolute bottom-10 left-0 bg-surface-container-highest   rounded-xl p-1.5 shadow-xl z-30 flex flex-col min-w-[130px]">
            {SLEEP_TIMER_OPTIONS.map((opt) => {
              const active =
                (opt.value === null && sleepTimerRemainingSec === null && !sleepAfterTrack) ||
                (opt.value === 'track' && sleepAfterTrack) ||
                (typeof opt.value === 'number' &&
                  sleepTimerRemainingSec !== null &&
                  Math.ceil(sleepTimerRemainingSec / 60) === opt.value);
              return (
                <button
                  key={String(opt.value)}
                  onClick={() => {
                    if (opt.value === null) setSleepTimer(null, false);
                    else if (opt.value === 'track') setSleepTimer(null, true);
                    else setSleepTimer(opt.value, false);
                    setShowSleepMenu(false);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-lg text-left flex items-center justify-between ${
                    active
                      ? 'bg-primary/20 text-primary font-bold'
                      : 'text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  <span>{opt.label}</span>
                  {active && <Check size={12} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* A-B Looper */}
      <button
        onClick={() => {
          if (abLoopA === null) {
            setAbLoop(position, null);
          } else if (abLoopB === null) {
            if (position > abLoopA + 0.5) setAbLoop(abLoopA, position);
            else setAbLoop(null, null);
          } else {
            setAbLoop(null, null);
          }
        }}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          abLoopA !== null
            ? 'bg-primary text-on-primary'
            : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
        }`}
        title="A-B Loop (нажмите для установки точки A, затем B, затем сброса)"
      >
        <Repeat1 size={13} />
        <span>
          {abLoopA === null
            ? 'A-B'
            : abLoopB === null
              ? `A: ${formatTime(abLoopA)}`
              : `${formatTime(abLoopA)}–${formatTime(abLoopB)}`}
        </span>
      </button>

      {/* Offline Download with Format Selector */}
      {currentTrack.source !== 'local' && (
        <div className="flex items-center bg-surface-container-high rounded-full p-0.5">
          <select
            value={downloadFormat}
            onChange={(e) => setDownloadFormat(e.target.value as 'mp3' | 'flac' | 'opus')}
            className="bg-transparent text-[11px] font-bold text-primary pl-2.5 pr-1 py-1 outline-none cursor-pointer"
          >
            <option value="mp3" className="bg-surface text-on-surface">
              MP3 320
            </option>
            <option value="flac" className="bg-surface text-on-surface">
              FLAC
            </option>
            <option value="opus" className="bg-surface text-on-surface">
              OPUS
            </option>
          </select>
          <button
            onClick={handleDownload}
            disabled={downloadState === 'downloading'}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
              downloadState === 'done'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            <Download
              size={13}
              className={downloadState === 'downloading' ? 'animate-bounce' : ''}
            />
            <span>
              {downloadState === 'downloading'
                ? 'Saving...'
                : downloadState === 'done'
                  ? 'Saved!'
                  : 'Save'}
            </span>
          </button>
        </div>
      )}
    </div>
  );

  const renderTransportControls = (playSize = 'w-16 h-16', playColor = 'bg-primary text-on-primary') => (
    <div className="flex items-center gap-6">
      <button
        onClick={toggleShuffle}
        className={`p-2 rounded-full transition-colors ${
          shuffle ? 'text-primary bg-primary/15' : 'text-on-surface-variant hover:text-on-surface'
        }`}
        title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
      >
        <Shuffle size={19} />
      </button>

      <motion.button
        animate={arrowPulse === 'prev' ? { scale: 0.78, x: -8 } : { scale: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18 }}
        onClick={handleInstantPrev}
        className="p-2.5 text-on-surface hover:text-primary transition-colors"
        title="Previous"
      >
        <SkipBack size={28} />
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.86 }}
        animate={{ borderRadius: isPlaying ? '22px' : '36px' }}
        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        onClick={() => (isPlaying ? pause() : resume())}
        className={`${playSize} ${playColor} flex items-center justify-center shadow-xl shadow-primary/30 hover:opacity-95`}
      >
        <motion.div
          key={isPlaying ? 'pause-icon' : 'play-icon'}
          initial={{ scale: 0.6, rotate: -20, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
        >
          {isPlaying ? <Pause size={28} /> : <Play size={28} className="translate-x-0.5" />}
        </motion.div>
      </motion.button>

      <motion.button
        animate={arrowPulse === 'next' ? { scale: 0.78, x: 8 } : { scale: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18 }}
        onClick={handleInstantNext}
        className="p-2.5 text-on-surface hover:text-primary transition-colors"
        title="Next"
      >
        <SkipForward size={28} />
      </motion.button>

      <button
        onClick={nextRepeat}
        className={`p-2 rounded-full transition-colors relative ${
          repeat !== 'none'
            ? 'text-primary bg-primary/15'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
        title={`Repeat: ${repeat}`}
      >
        <Repeat size={19} />
        {repeat === 'one' && (
          <span className="absolute -top-0.5 -right-0.5 text-[9px] bg-primary text-on-primary rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
            1
          </span>
        )}
      </button>
    </div>
  );

  const renderRightDrawerOrLyrics = (variant: 'apple_blur' | 'timecode' | 'spatial_3d' | 'card' | 'default' = 'default') => {
    if (showDspModal) {
      return (
        <div className="flex flex-col h-full space-y-5 overflow-y-auto pr-1">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-on-surface flex items-center gap-2">
                <Sliders size={18} className="text-primary" />
                <span>Real-Time DSP &amp; Smart DJ Automix</span>
              </h3>
              <p className="text-xs text-on-surface-variant">Dual-Deck mpv lavfi audio pipeline</p>
            </div>
            <button
              onClick={() => setShowDspModal(false)}
              className="text-xs px-3 py-1 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-on-surface"
            >
              Back to Lyrics
            </button>
          </div>

          <div className="flex items-center justify-between p-4 rounded-2xl bg-surface-container-high/80  ">
            <div>
              <p className="text-sm font-bold text-on-surface">
                Smart DJ Automix (BPM Phrase Sync + Bass Swap)
              </p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Aligns transitions to 2/4/8 bar musical phrases, trims trailing silence, and swaps bass
              </p>
            </div>
            <button
              onClick={() => setSmartDjAutomix(!smartDjAutomix)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                smartDjAutomix
                  ? 'bg-primary text-on-primary shadow-md'
                  : 'bg-surface-container-highest text-on-surface-variant'
              }`}
            >
              {smartDjAutomix ? 'ENABLED' : 'OFF'}
            </button>
          </div>

          <div className="p-4 rounded-2xl bg-surface-container-high/80   space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-on-surface">
                  10-Band Parametric Equalizer
                </span>
                <button
                  onClick={() => setEqualizerState(!eqEnabled, eqBands, eqPreset)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold ${
                    eqEnabled
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-highest text-on-surface-variant'
                  }`}
                >
                  {eqEnabled ? 'ON' : 'BYPASS'}
                </button>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {Object.keys(EQ_PRESET_MAP).map((presetName) => (
                  <button
                    key={presetName}
                    onClick={() => setEqualizerState(true, EQ_PRESET_MAP[presetName], presetName)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                      eqPreset === presetName && eqEnabled
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {presetName}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-10 gap-2 pt-2 h-44 items-center">
              {EQ_LABELS.map((label, idx) => {
                const val = eqBands[idx] ?? 0;
                return (
                  <div key={label} className="flex flex-col items-center h-full justify-between">
                    <span className="text-[10px] font-bold text-primary tabular-nums">
                      {val > 0 ? `+${val}` : val}dB
                    </span>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={val}
                      onChange={(e) => {
                        const nextBands = [...eqBands];
                        nextBands[idx] = parseFloat(e.target.value);
                        setEqualizerState(true, nextBands, 'Custom');
                      }}
                      className="h-24 accent-primary cursor-pointer"
                      style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                    />
                    <span className="text-[10px] text-on-surface-variant font-medium">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-surface-container-high/80   space-y-3 text-xs">
            <div className="font-bold text-on-surface text-sm">Audio Effects Pipeline</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Pitch</span>
                  <span className="font-bold text-primary">
                    {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} st
                  </span>
                </div>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={pitchSemitones}
                  onChange={(e) => setDspOption({ pitchSemitones: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
              </label>
              <label className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Bass Boost</span>
                  <span className="font-bold text-primary">+{bassBoost} dB</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={0.5}
                  value={bassBoost}
                  onChange={(e) => setDspOption({ bassBoost: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
              </label>
              <label className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Stereo Widener</span>
                  <span className="font-bold text-primary">{Math.round(stereoWidener * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={stereoWidener}
                  onChange={(e) => setDspOption({ stereoWidener: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
              </label>
            </div>
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                onClick={() => setDspOption({ silenceSkip: !silenceSkip })}
                className={`px-3 py-1.5 rounded-xl font-semibold ${
                  silenceSkip
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                Skip Silence {silenceSkip ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => setDspOption({ audioCompressor: !audioCompressor })}
                className={`px-3 py-1.5 rounded-xl font-semibold ${
                  audioCompressor
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                Compressor {audioCompressor ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (showQueue) {
      return (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">
              Up Next ({queue.length} tracks)
            </h3>
            {queue.length > 0 && (
              <button
                onClick={() => usePlayerStore.getState().clearQueue()}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-red-500/10"
              >
                <Trash2 size={12} />
                Clear Queue
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-2">
            {queue.map((track, idx) => {
              const isCurrent = idx === usePlayerStore.getState().queueIndex;
              return (
                <div
                  key={`${track.id}-${idx}`}
                  onClick={() => {
                    usePlayerStore.setState({ queueIndex: idx });
                    void usePlayerStore.getState().setCurrentTrack(track);
                  }}
                  className={`group flex items-center gap-3 p-2.5 rounded-xl transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-primary/20  '
                      : 'bg-surface-container/60 hover:bg-surface-container-high'
                  }`}
                >
                  <span className="text-xs font-mono text-on-surface-variant w-6 text-center">
                    {isCurrent ? '▶' : idx + 1}
                  </span>
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-surface-container-high flex-shrink-0">
                    {track.thumbnail ? (
                      <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music2 size={16} className="text-on-surface-variant" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-semibold truncate ${
                        isCurrent ? 'text-primary' : 'text-on-surface'
                      }`}
                    >
                      {track.title}
                    </p>
                    <p className="text-xs text-on-surface-variant truncate">{track.artist}</p>
                  </div>
                  <div
                    className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      disabled={idx === 0}
                      onClick={() => usePlayerStore.getState().reorderQueue(idx, idx - 1)}
                      className="p-1 rounded hover:bg-surface-container-highest text-on-surface-variant disabled:opacity-30"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      disabled={idx === queue.length - 1}
                      onClick={() => usePlayerStore.getState().reorderQueue(idx, idx + 1)}
                      className="p-1 rounded hover:bg-surface-container-highest text-on-surface-variant disabled:opacity-30"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      onClick={() => usePlayerStore.getState().removeFromQueue(idx)}
                      className="p-1 rounded hover:bg-red-500/20 text-on-surface-variant hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between pb-3 mb-2   flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
              {variant === 'timecode' ? 'Studio Timecode Lyrics' : 'Lyrics'}
            </span>
            {lyricsSource && lyricsSource !== 'none' && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                {lyricsSource}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {hasWordSync && (
              <button
                onClick={() => setLyricsWordByWord(!lyricsWordByWord)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                  lyricsWordByWord
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-high text-on-surface-variant'
                }`}
              >
                Word-Sync
              </button>
            )}
            <button
              onClick={() => setLyricsRomanize(!lyricsRomanize)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                lyricsRomanize
                  ? 'bg-primary/20 text-primary  '
                  : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              Romaji
            </button>
            <button
              onClick={() => setLyricsTranslate(!lyricsTranslate)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                lyricsTranslate
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              <Languages size={12} />
              <span>RU Translate</span>
            </button>
            <div className="flex items-center gap-1 bg-surface-container-high rounded-lg px-2 py-0.5 text-[11px]">
              <button
                onClick={() => setLyricsOffset(lyricsOffset - 250)}
                className="hover:text-primary font-bold px-1"
              >
                -0.25s
              </button>
              <span className="text-primary font-mono">
                {lyricsOffset >= 0 ? `+${lyricsOffset}` : lyricsOffset}ms
              </span>
              <button
                onClick={() => setLyricsOffset(lyricsOffset + 250)}
                className="hover:text-primary font-bold px-1"
              >
                +0.25s
              </button>
              {lyricsOffset !== 0 && (
                <button
                  onClick={() => setLyricsOffset(0)}
                  className="text-on-surface-variant hover:text-on-surface ml-0.5"
                >
                  <RotateCcw size={10} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-0.5 bg-surface-container-high rounded-lg p-0.5  ">
              {(['small', 'medium', 'large'] as const).map((sz) => (
                <button
                  key={sz}
                  onClick={() => setLyricsFontSize(sz)}
                  title={sz === 'small' ? 'Мелкий шрифт' : sz === 'medium' ? 'Средний шрифт' : 'Крупный шрифт'}
                  className={`px-2 py-0.5 rounded text-[11px] font-black uppercase transition-all ${
                    lyricsFontSize === sz
                      ? 'bg-primary text-on-primary shadow-sm scale-105'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {sz[0]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          ref={lyricsContainerRef}
          className="flex-1 min-h-0 overflow-y-auto space-y-4 py-10 pr-3 scrollbar-thin relative"
        >
          {lyrics.length > 0 ? (
            lyrics.map((line, i) => {
              const isActive = i === activeIndex;
              const isPast = i < activeIndex;
              const dist = Math.abs(i - activeIndex);

              const variantClasses =
                variant === 'apple_blur'
                  ? isActive
                    ? `${appleBlurActiveFontSizes[lyricsFontSize]}`
                    : `${appleBlurInactiveFontSizes[lyricsFontSize]} ${
                        dist > 2 ? 'blur-[1.5px]' : 'blur-[0.5px]'
                      } hover:blur-none hover:text-white/80`
                  : variant === 'timecode'
                    ? isActive
                      ? `${activeFontSizes[lyricsFontSize]} bg-cyan-500/15   text-cyan-200`
                      : `${fontSizes[lyricsFontSize]} text-on-surface-variant/65 hover:bg-white/5`
                    : variant === 'card'
                      ? isActive
                        ? `${activeFontSizes[lyricsFontSize]} bg-emerald-500/20   text-emerald-200 shadow-lg`
                        : `${fontSizes[lyricsFontSize]} bg-black/20 text-on-surface-variant/60 hover:text-on-surface`
                      : isActive
                        ? `${activeFontSizes[lyricsFontSize]} text-on-surface bg-white/5 shadow-sm scale-[1.02] origin-left`
                        : isPast
                          ? `${fontSizes[lyricsFontSize]} text-on-surface-variant/35 hover:text-on-surface-variant/70`
                          : `${fontSizes[lyricsFontSize]} text-on-surface-variant/60 hover:text-on-surface`;

              return (
                <div
                  key={i}
                  ref={isActive ? activeLyricRef : undefined}
                  onClick={() => seek(line.time)}
                  style={
                    variant === 'spatial_3d'
                      ? {
                          transform: isActive
                            ? 'perspective(700px) translateZ(26px) rotateX(0deg)'
                            : `perspective(700px) translateZ(-${Math.min(dist * 10, 40)}px)`,
                        }
                      : undefined
                  }
                  className={`cursor-pointer transition-all duration-300 rounded-2xl px-4 py-2.5 ${variantClasses}`}
                >
                  <div className="flex items-baseline gap-3">
                    {variant === 'timecode' && (
                      <span className="text-[11px] font-mono text-cyan-400/80 shrink-0">
                        [{formatTimecode(line.time)}]
                      </span>
                    )}
                    <div className="flex-1">
                      {isActive && lyricsWordByWord && line.words && line.words.length > 0 ? (
                        <div className="flex flex-wrap gap-x-1.5 gap-y-1">
                          {line.words.map((w, wIdx) => {
                            const wordActive =
                              effectivePosition >= w.startTime && effectivePosition <= w.endTime;
                            const wordDone = effectivePosition > w.endTime;
                            return (
                              <span
                                key={wIdx}
                                className={`inline-block transition-all duration-150 ${
                                  wordActive
                                    ? 'text-primary -translate-y-0.5 drop-shadow-[0_0_12px_rgba(203,185,245,0.85)]'
                                    : wordDone
                                      ? 'text-primary/95'
                                      : 'text-on-surface/45'
                                }`}
                              >
                                {w.text}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className={isActive && variant === 'default' ? 'text-primary' : ''}>
                          {line.text}
                        </p>
                      )}

                      {lyricsRomanize && line.romanized && (
                        <p className="text-xs font-medium text-primary/75 mt-1 tracking-wide">
                          {line.romanized}
                        </p>
                      )}
                      {lyricsTranslate && line.translation && (
                        <p className="text-sm font-semibold text-on-surface/80 mt-1 italic">
                          {line.translation}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : plainLyrics ? (
            <pre className="whitespace-pre-wrap font-sans text-base text-on-surface-variant leading-relaxed px-4">
              {plainLyrics}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-on-surface-variant gap-3">
              <Layers size={42} className="text-primary/35" />
              <p className="text-sm font-medium">
                {lyricsSource === 'Searching 10+ providers...'
                  ? 'Searching YouLyPlus, BetterLyrics, LRCLib, SimpMusic...'
                  : 'No synchronized lyrics found for this track'}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      <motion.div
        key="now-playing"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 30 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="fixed top-9 left-0 right-0 bottom-0 z-40 flex flex-col bg-surface overflow-hidden select-none"
      >
        {/* Dynamic Background Layer */}
        {canvasEnabled && canvasData?.videoUrl ? (
          <video
            key={canvasData.videoUrl}
            src={canvasData.videoUrl}
            autoPlay
            loop
            muted
            playsInline
            className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-all duration-700 ${
              playerStyle === 'v8_immersive'
                ? 'opacity-85 scale-100 blur-none'
                : 'opacity-30 scale-125 blur-2xl'
            }`}
          />
        ) : (
          currentTrack.thumbnail && (
            <div
              className={`absolute inset-0 bg-cover bg-center pointer-events-none transition-all duration-700 ${
                playerStyle === 'v8_immersive'
                  ? 'opacity-75 scale-105 blur-md'
                  : playerStyle === 'flamingo'
                    ? 'opacity-45 scale-125 blur-3xl saturate-200'
                    : 'opacity-25 scale-125 blur-3xl'
              }`}
              style={{ backgroundImage: `url(${currentTrack.thumbnail})` }}
            />
          )
        )}
        <div
          className={`absolute inset-0 pointer-events-none transition-all duration-700 ${
            playerStyle === 'v8_immersive'
              ? 'bg-gradient-to-b from-black/30 via-black/55 to-black/95'
              : playerStyle === 'bitchord'
                ? 'bg-[#090a0f]/95'
                : 'bg-gradient-to-b from-surface/65 via-surface/75 to-surface/95'
          }`}
          style={{
            backgroundImage:
              playerStyle !== 'bitchord'
                ? `radial-gradient(circle at 18% 45%, var(--player-glow-accent, rgba(203,185,245,0.22)) 0%, transparent 60%), radial-gradient(circle at 82% 25%, var(--player-bg-tint, rgba(203,185,245,0.12)) 0%, transparent 55%)`
                : undefined,
          }}
        />

        {/* Top Header Bar: ONLY ONE Collapse Button on Left + 8 Style Switcher in Center + Tools on Right */}
        <div className="relative z-20 flex-shrink-0 flex items-center justify-between px-6 pt-3 pb-2 gap-3 flex-wrap   bg-surface-container/60 backdrop-blur-xl">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowNowPlaying(false)}
              className="px-3.5 py-1.5 rounded-full bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface text-xs font-bold   transition inline-flex items-center gap-1.5 shadow-sm"
              title="Свернуть полноэкранный плеер (Esc)"
            >
              <ChevronDown size={15} />
              <span>Свернуть (Esc)</span>
            </button>
            <button
              onClick={() => setSourceSwitcherTrack(currentTrack)}
              className="text-[11px] font-bold text-primary uppercase tracking-widest px-2.5 py-1 rounded-full bg-primary/15   hover:bg-primary/25 transition inline-flex items-center gap-1.5"
              title="Нажмите, чтобы переключить источник (Tidal / Qobuz / Deezer / YTM)"
            >
              <ArrowLeftRight size={11} />
              {resolvedSourceBadge || currentTrack.source.toUpperCase()}
            </button>
            <button
              onClick={() => setAuditTarget({ track: currentTrack, urlOrPath: currentTrack.path })}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface-container-high/80 text-on-surface-variant hover:text-primary   transition inline-flex items-center gap-1"
              title="Спектральный аудит качества (FFT 4096)"
            >
              <Activity size={11} />
              Audit
            </button>

            {automixing && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300   animate-pulse flex items-center gap-1">
                <Disc3 size={12} className="animate-spin" />
                SMART DJ AUTOMIX
              </span>
            )}

            {canvasData && (
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-200   flex items-center gap-1">
                <Film size={12} />
                {canvasData.source}
              </span>
            )}
          </div>

          {/* 8 Player Styles Selector Pill */}
          <div className="flex items-center gap-1 bg-surface-container/80 backdrop-blur-md p-1 rounded-full   overflow-x-auto max-w-full">
            {PLAYER_STYLES.map((st) => {
              const active = playerStyle === st.id;
              return (
                <button
                  key={st.id}
                  onClick={() => setPlayerStyle(st.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                    active
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                  title={`${st.label} (${st.badge})`}
                >
                  {st.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowDspModal((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                showDspModal || eqEnabled || smartDjAutomix
                  ? 'bg-primary/20 text-primary  '
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
              title="DSP Equalizer & Smart DJ Automix"
            >
              <Sliders size={14} />
              <span>DSP / EQ</span>
            </button>

            {lyrics.length > 0 && (
              <button
                onClick={() => setShowShareModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                title="Create Lyrics Share Card"
              >
                <Share2 size={14} />
                <span>Share Card</span>
              </button>
            )}

            <button
              onClick={() => setShowQueue((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                showQueue
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <List size={14} />
              <span>Queue ({queue.length})</span>
            </button>
          </div>
        </div>

        {/* ====================================================================
            8 DISTINCT PLAYER DESIGNS (ported from S1LOnik/ArchiveTune)
           ==================================================================== */}

        {/* STYLE 1: V8/V9 IMMERSIVE (Full-Bleed Cinema Backdrop + Floating Lyrics + Bottom Glass Deck) */}
        {playerStyle === 'v8_immersive' && (
          <div className="relative z-10 flex-1 min-h-0 flex flex-col justify-between px-10 py-6 overflow-hidden">
            {/* Upper Cinema Stage: Floating Centered Karaoke Lyrics */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-6">
              {showDspModal || showQueue ? (
                <div className="w-full max-w-3xl h-full bg-black/65 backdrop-blur-2xl rounded-3xl   p-5 overflow-hidden">
                  {renderRightDrawerOrLyrics()}
                </div>
              ) : lyrics.length > 0 ? (
                <div className="max-w-4xl space-y-4">
                  <p className="text-base md:text-lg font-bold text-white/40 transition-all">
                    {activeIndex > 0 ? lyrics[activeIndex - 1]?.text : ' '}
                  </p>
                  <motion.p
                    key={activeIndex}
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="text-3xl md:text-5xl font-black text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.9)] leading-tight"
                  >
                    {lyrics[activeIndex]?.text || currentTrack.title}
                  </motion.p>
                  {lyricsTranslate && lyrics[activeIndex]?.translation && (
                    <p className="text-lg font-semibold text-primary drop-shadow">
                      {lyrics[activeIndex]?.translation}
                    </p>
                  )}
                  <p className="text-base md:text-lg font-bold text-white/50 transition-all">
                    {activeIndex + 1 < lyrics.length ? lyrics[activeIndex + 1]?.text : ' '}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-52 h-52 rounded-3xl overflow-hidden shadow-2xl  ">
                    {renderArtworkMedia()}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Glassmorphic Cinema Control Deck */}
            <div className="w-full max-w-4xl mx-auto rounded-[32px] bg-black/65 backdrop-blur-2xl   p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden   shrink-0 shadow-lg">
                    {renderArtworkMedia()}
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-primary/25 text-primary">
                      V9 IMMERSIVE STAGE
                    </span>
                    <h2 className="text-2xl font-black text-white truncate mt-0.5">
                      {currentTrack.title}
                    </h2>
                    <p className="text-sm text-white/70 truncate">
                      {currentTrack.artist}
                      {currentTrack.album ? ` • ${currentTrack.album}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {renderTransportControls('w-14 h-14')}
                  <button
                    onClick={() => toggleLikeCurrent(currentTrack)}
                    className={`p-3 rounded-full ${
                      liked ? 'bg-pink-500/25 text-pink-400' : 'bg-white/10 text-white/70'
                    }`}
                  >
                    <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>
              {renderSeekSlider('accent-white h-2')}
              <div className="flex items-center justify-between flex-wrap gap-2">
                {renderSecondaryPills()}
                <AudioVisualizer height={28} className="w-48 opacity-85" />
              </div>
            </div>
          </div>
        )}

        {/* STYLE 2: V10 EXPRESSIVE (Material 3 Expressive Squircle Hero + Pill Controls) */}
        {playerStyle === 'v10_expressive' && (
          <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center px-8 py-4 overflow-y-auto">
            <div className="w-full max-w-2xl flex flex-col items-center gap-4 bg-surface-container/70 backdrop-blur-2xl rounded-[44px]   p-7 shadow-2xl">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-primary/20 text-primary">
                <Sparkles size={12} /> Material 3 Expressive • V10
              </div>

              <motion.div
                animate={{
                  scale: coverCompressed ? 0.9 : 1,
                  borderRadius: isPlaying ? '48px' : '64px',
                }}
                className="w-64 h-64 overflow-hidden shadow-2xl ring-4 ring-primary/35 relative"
              >
                {renderArtworkMedia()}
              </motion.div>

              <div className="text-center max-w-lg">
                <h2 className="text-2xl font-black text-on-surface truncate">
                  {currentTrack.title}
                </h2>
                <p className="text-sm text-primary font-semibold truncate mt-0.5">
                  {currentTrack.artist}
                </p>
              </div>

              {/* Expressive Live Lyrics Pill */}
              {lyrics.length > 0 && (
                <div
                  onClick={() => setPlayerStyle('flamingo')}
                  className="w-full rounded-3xl bg-primary/10   px-5 py-3 text-center cursor-pointer hover:bg-primary/15 transition"
                  title="Нажмите для полного текста"
                >
                  <p className="text-base font-extrabold text-on-surface truncate">
                    ♪ {lyrics[activeIndex]?.text || lyrics[0]?.text}
                  </p>
                  {activeIndex + 1 < lyrics.length && (
                    <p className="text-xs text-on-surface-variant truncate mt-0.5">
                      {lyrics[activeIndex + 1]?.text}
                    </p>
                  )}
                </div>
              )}

              <div className="w-full">{renderSeekSlider('accent-primary h-3')}</div>

              {/* Expressive Oversized Pill Buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleShuffle}
                  className={`p-3.5 rounded-2xl ${
                    shuffle ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface'
                  }`}
                >
                  <Shuffle size={18} />
                </button>
                <button
                  onClick={handleInstantPrev}
                  className="px-6 py-4 rounded-[26px] bg-surface-container-highest hover:bg-primary/20 text-on-surface font-bold"
                >
                  <SkipBack size={24} />
                </button>
                <button
                  onClick={() => (isPlaying ? pause() : resume())}
                  className="px-10 py-4 rounded-[28px] bg-primary text-on-primary font-black text-sm flex items-center gap-2 shadow-xl shadow-primary/30"
                >
                  {isPlaying ? <Pause size={26} /> : <Play size={26} fill="currentColor" />}
                  <span>{isPlaying ? 'ПАУЗА' : 'ИГРАТЬ'}</span>
                </button>
                <button
                  onClick={handleInstantNext}
                  className="px-6 py-4 rounded-[26px] bg-surface-container-highest hover:bg-primary/20 text-on-surface font-bold"
                >
                  <SkipForward size={24} />
                </button>
                <button
                  onClick={() => toggleLikeCurrent(currentTrack)}
                  className={`p-3.5 rounded-2xl ${
                    liked ? 'bg-pink-500 text-white' : 'bg-surface-container-highest text-on-surface'
                  }`}
                >
                  <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
                </button>
              </div>

              {renderSecondaryPills()}
            </div>
          </div>
        )}

        {/* STYLE 3: BITCHORD (Studio Monitor & Telemetry Deck + Timecode Lyrics) */}
        {playerStyle === 'bitchord' && (
          <div className="relative z-10 flex-1 min-h-0 flex flex-col px-8 py-4 gap-4 overflow-hidden font-mono">
            {/* Top Technical Telemetry Bar */}
            <div className="flex items-center justify-between px-4 py-2 rounded-xl bg-cyan-950/30   text-[11px] text-cyan-300">
              <div className="flex items-center gap-4">
                <span className="font-bold text-cyan-400">● BITCHORD STUDIO DECK</span>
                <span>SRC: {(resolvedSourceBadge || currentTrack.source).toUpperCase()}</span>
                <span>DSP: {eqEnabled ? `EQ (${eqPreset})` : 'FLAT 24-BIT'}</span>
                <span>PITCH: {pitchSemitones >= 0 ? `+${pitchSemitones}` : pitchSemitones} ST</span>
              </div>
              <div className="flex items-center gap-3">
                <span>POS: {formatTimecode(displayPosition)}</span>
                <span>DUR: {formatTimecode(duration)}</span>
              </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-12 gap-6 overflow-hidden">
              {/* Left Studio Deck */}
              <div className="col-span-5 flex flex-col justify-between bg-[#11131c]   rounded-3xl p-6 shadow-2xl">
                <div className="flex items-center gap-5">
                  <div className="relative w-36 h-36 rounded-2xl overflow-hidden   shrink-0 shadow-lg">
                    {renderArtworkMedia()}
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                      MASTER MONITOR
                    </span>
                    <h2 className="text-lg font-black text-white truncate font-sans">
                      {currentTrack.title}
                    </h2>
                    <p className="text-xs text-cyan-200/80 truncate font-sans">
                      {currentTrack.artist}
                    </p>
                    <AudioVisualizer height={30} className="pt-1" />
                  </div>
                </div>

                {/* Tactile Step-Seek & Studio Loop Controls */}
                <div className="grid grid-cols-4 gap-2 my-2">
                  <button
                    onClick={() => void seek(Math.max(0, position - 10))}
                    className="py-2 rounded-xl bg-white/5 hover:bg-cyan-500/20 text-cyan-200 text-xs font-bold flex items-center justify-center gap-1  "
                  >
                    <Rewind size={13} /> -10s
                  </button>
                  <button
                    onClick={() => void seek(Math.min(duration, position + 10))}
                    className="py-2 rounded-xl bg-white/5 hover:bg-cyan-500/20 text-cyan-200 text-xs font-bold flex items-center justify-center gap-1  "
                  >
                    +10s <FastForward size={13} />
                  </button>
                  <button
                    onClick={() => setDspOption({ pitchSemitones: Math.max(-12, pitchSemitones - 1) })}
                    className="py-2 rounded-xl bg-white/5 hover:bg-cyan-500/20 text-cyan-200 text-xs font-bold  "
                  >
                    Pitch -1
                  </button>
                  <button
                    onClick={() => setDspOption({ pitchSemitones: Math.min(12, pitchSemitones + 1) })}
                    className="py-2 rounded-xl bg-white/5 hover:bg-cyan-500/20 text-cyan-200 text-xs font-bold  "
                  >
                    Pitch +1
                  </button>
                </div>

                {renderSeekSlider('accent-cyan-400 h-2')}
                <div className="flex justify-center">
                  {renderTransportControls('w-14 h-14', 'bg-cyan-400 text-black')}
                </div>
                {renderSecondaryPills()}
              </div>

              {/* Right Studio Timecode Lyrics Monitor */}
              <div className="col-span-7 min-h-0 flex flex-col overflow-hidden bg-[#11131c]/90 rounded-3xl   p-5">
                {renderRightDrawerOrLyrics('timecode')}
              </div>
            </div>
          </div>
        )}

        {/* STYLE 4: SIMPMUSIC (Dual Elevated Dark Cards with Emerald Accent) */}
        {playerStyle === 'simpmusic' && (
          <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center px-8 py-4 overflow-hidden">
            <div className="w-full max-w-6xl h-full grid grid-cols-12 gap-6 overflow-hidden">
              {/* SimpMusic Left Elevated Card */}
              <div className="col-span-5 bg-[#1b1b22] rounded-[32px]   p-6 shadow-2xl flex flex-col justify-between">
                <div className="relative aspect-square max-h-72 mx-auto w-full rounded-2xl overflow-hidden shadow-xl">
                  {renderArtworkMedia()}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 flex items-end justify-between">
                    <div className="min-w-0 pr-2">
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-emerald-500/25 text-emerald-300">
                        SIMPMUSIC CARD
                      </span>
                      <h2 className="text-lg font-black text-white truncate mt-1">
                        {currentTrack.title}
                      </h2>
                      <p className="text-xs text-white/75 truncate">{currentTrack.artist}</p>
                    </div>
                    <button
                      onClick={() => toggleLikeCurrent(currentTrack)}
                      className={`p-2.5 rounded-full ${
                        liked ? 'bg-emerald-500 text-black' : 'bg-white/15 text-white'
                      }`}
                    >
                      <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  {renderSeekSlider('accent-emerald-400 h-2')}
                  <div className="flex justify-center">
                    {renderTransportControls('w-14 h-14', 'bg-emerald-400 text-black')}
                  </div>
                  {renderSecondaryPills()}
                </div>
              </div>

              {/* SimpMusic Right Tinted Lyrics Card */}
              <div className="col-span-7 min-h-0 flex flex-col overflow-hidden bg-[#1e2422]/85 backdrop-blur-xl rounded-[32px]   p-6 shadow-2xl">
                {renderRightDrawerOrLyrics('card')}
              </div>
            </div>
          </div>
        )}

        {/* STYLE 5: SPATIALFLOW (3D Perspective Floating Artwork + Z-Space Lyrics) */}
        {playerStyle === 'spatialflow' && (
          <div className="relative z-10 flex-1 min-h-0 flex items-center px-10 py-4 gap-10 overflow-hidden">
            {/* Left 3D Perspective Floating Stage */}
            <div className="flex-1 max-w-[460px] flex flex-col items-center justify-center gap-6">
              <div style={{ perspective: '1100px' }} className="relative py-2">
                <motion.div
                  animate={{
                    rotateY: isPlaying ? 16 : 6,
                    rotateX: isPlaying ? -6 : 0,
                    scale: coverCompressed ? 0.88 : 1.02,
                  }}
                  transition={{ type: 'spring', stiffness: 180, damping: 20 }}
                  className="w-72 h-72 rounded-[30px] overflow-hidden shadow-[0_30px_70px_rgba(0,0,0,0.75)]   relative"
                >
                  {renderArtworkMedia()}
                </motion.div>
              </div>

              <div className="w-full bg-white/5 backdrop-blur-2xl rounded-3xl   p-5 space-y-3 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                      SPATIAL 3D DEPTH STAGE
                    </span>
                    <h2 className="text-xl font-black text-on-surface truncate">
                      {currentTrack.title}
                    </h2>
                    <p className="text-xs text-on-surface-variant truncate">{currentTrack.artist}</p>
                  </div>
                  <button
                    onClick={() => toggleLikeCurrent(currentTrack)}
                    className={`p-2.5 rounded-full ${
                      liked ? 'bg-pink-500/20 text-pink-400' : 'bg-white/10 text-on-surface'
                    }`}
                  >
                    <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
                  </button>
                </div>
                {renderSeekSlider()}
                <div className="flex justify-center">{renderTransportControls('w-14 h-14')}</div>
              </div>
            </div>

            {/* Right 3D Tilted Plane Lyrics */}
            <div
              style={{ perspective: '1200px' }}
              className="flex-1 h-full min-h-0 flex flex-col overflow-hidden"
            >
              <div
                style={{ transform: 'rotateY(-8deg)' }}
                className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface-container/45 backdrop-blur-2xl rounded-[36px]   p-6 shadow-2xl"
              >
                {renderRightDrawerOrLyrics('spatial_3d')}
              </div>
            </div>
          </div>
        )}

        {/* STYLE 6: TIKTOK RAIL (Vertical 9:16 Feed Frame + Right Action Rail) */}
        {playerStyle === 'tiktok' && (
          <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center gap-6 px-6 py-3 overflow-hidden">
            {/* Vertical 9:16 Cinema Card */}
            <div className="relative w-[390px] h-full max-h-[760px] rounded-[38px] overflow-hidden shadow-2xl   bg-black flex flex-col justify-between">
              <div className="absolute inset-0">{renderArtworkMedia()}</div>
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/25 to-black/90" />

              {/* Top pill inside TikTok frame */}
              <div className="relative z-10 flex items-center justify-between p-4">
                <span className="text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-white  ">
                  For You • Audio Feed
                </span>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-primary/80 text-on-primary">
                  {resolvedSourceBadge || currentTrack.source.toUpperCase()}
                </span>
              </div>

              {/* Center-Lower Live Karaoke Caption Overlay */}
              <div className="relative z-10 px-5 my-auto text-center space-y-2">
                {lyrics.length > 0 && (
                  <div className="bg-black/55 backdrop-blur-md rounded-2xl p-4  ">
                    <p className="text-lg font-black text-white drop-shadow">
                      {lyrics[activeIndex]?.text || currentTrack.title}
                    </p>
                    {activeIndex + 1 < lyrics.length && (
                      <p className="text-xs font-semibold text-white/65 mt-1">
                        {lyrics[activeIndex + 1]?.text}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Track Handle + Transport */}
              <div className="relative z-10 p-5 space-y-3">
                <div>
                  <p className="text-sm font-black text-white">@{currentTrack.artist}</p>
                  <h2 className="text-lg font-bold text-white truncate">{currentTrack.title}</h2>
                </div>
                {renderSeekSlider('accent-pink-500 h-1.5')}
                <div className="flex justify-center">
                  {renderTransportControls('w-12 h-12', 'bg-pink-500 text-white')}
                </div>
              </div>
            </div>

            {/* Right Action Rail (TikTok Style Buttons) */}
            <div className="flex flex-col items-center gap-4 bg-surface-container/70 backdrop-blur-xl p-3 rounded-full  ">
              <button
                onClick={() => toggleLikeCurrent(currentTrack)}
                className={`w-12 h-12 rounded-full flex flex-col items-center justify-center transition ${
                  liked ? 'bg-pink-500 text-white' : 'bg-surface-container-highest text-on-surface'
                }`}
                title="Like"
              >
                <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={() => setSourceSwitcherTrack(currentTrack)}
                className="w-12 h-12 rounded-full bg-surface-container-highest hover:bg-primary hover:text-on-primary flex items-center justify-center"
                title="Switch Audio Source"
              >
                <ArrowLeftRight size={18} />
              </button>
              <button
                onClick={() => setShowShareModal(true)}
                className="w-12 h-12 rounded-full bg-surface-container-highest hover:bg-primary hover:text-on-primary flex items-center justify-center"
                title="Share Lyrics Card"
              >
                <Share2 size={18} />
              </button>
              <button
                onClick={handleDownload}
                className="w-12 h-12 rounded-full bg-surface-container-highest hover:bg-primary hover:text-on-primary flex items-center justify-center"
                title="Save Offline"
              >
                <Download size={18} />
              </button>
              <div
                className={`w-12 h-12 rounded-full overflow-hidden   ${
                  isPlaying ? 'animate-spin' : ''
                }`}
                style={{ animationDuration: '6s' }}
              >
                {renderArtworkMedia()}
              </div>
            </div>
          </div>
        )}

        {/* STYLE 7 & 8: FLAMINGO (Apple Music Blurred Waterfall) & CLASSIC (Hi-Fi Vinyl Split) */}
        {(playerStyle === 'flamingo' || playerStyle === 'classic') && (
          <div className="relative z-10 flex flex-1 min-h-0 overflow-hidden px-8 py-3 gap-8">
            <div className="flex flex-col items-center justify-center gap-5 flex-1 min-w-[300px] max-w-[460px]">
              {/* Cover Art (+ Spinning Vinyl Disc behind sleeve in Classic mode) */}
              <div className="relative flex items-center justify-center">
                {playerStyle === 'classic' && (
                  <div
                    className={`w-64 h-64 rounded-full bg-gradient-to-tr from-zinc-950 via-zinc-800 to-zinc-900   shadow-2xl absolute -right-14 flex items-center justify-center ${
                      isPlaying ? 'animate-spin' : ''
                    }`}
                    style={{ animationDuration: '5s' }}
                  >
                    <div className="w-20 h-20 rounded-full overflow-hidden  ">
                      {renderArtworkMedia()}
                    </div>
                  </div>
                )}

                <motion.div
                  animate={{
                    scale: coverCompressed ? 0.85 : 1.0,
                    borderRadius: coverCompressed ? '36px' : '24px',
                  }}
                  transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                  className="relative z-10 w-72 h-72 overflow-hidden shadow-2xl  "
                >
                  {renderArtworkMedia()}
                  <div className="absolute inset-0 bg-gradient-to-tr from-black/25 via-transparent to-white/10 pointer-events-none" />
                </motion.div>
              </div>

              <div className="w-full flex items-center justify-between gap-3 px-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-black text-on-surface truncate">
                    {currentTrack.title}
                  </h2>
                  <p className="text-sm text-on-surface-variant font-medium truncate mt-0.5">
                    {currentTrack.artist}
                    {currentTrack.album ? ` • ${currentTrack.album}` : ''}
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.75 }}
                  onClick={() => toggleLikeCurrent(currentTrack)}
                  className={`p-2.5 rounded-full transition-colors ${
                    liked
                      ? 'bg-pink-500/20 text-pink-400'
                      : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
                </motion.button>
              </div>

              <div className="w-full px-1">{renderSeekSlider()}</div>
              {renderTransportControls()}
              {renderSecondaryPills()}

              {downloadMsg && downloadState !== 'idle' && (
                <p className="text-[11px] text-primary/90 font-medium">{downloadMsg}</p>
              )}

              <AudioVisualizer height={38} className="mt-1 opacity-85" />
            </div>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface-container/40 backdrop-blur-xl rounded-3xl   p-5">
              {renderRightDrawerOrLyrics(playerStyle === 'flamingo' ? 'apple_blur' : 'default')}
            </div>
          </div>
        )}

        {/* Lyrics Share Card Creator Modal */}
        {showShareModal && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-surface-container-high   rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-on-surface">Lyrics Share Card Creator</h3>
                  <p className="text-xs text-on-surface-variant">
                    Select up to 4 lyric lines to export as an aesthetic PNG card
                  </p>
                </div>
                <button
                  onClick={() => setShowShareModal(false)}
                  className="p-1.5 rounded-full hover:bg-surface-container-highest"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {lyrics.map((l, idx) => {
                  const selected = selectedShareLines.includes(idx);
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        if (selected) {
                          setSelectedShareLines(selectedShareLines.filter((i) => i !== idx));
                        } else if (selectedShareLines.length < 4) {
                          setSelectedShareLines([...selectedShareLines, idx]);
                        }
                      }}
                      className={`w-full text-left px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
                        selected
                          ? 'bg-primary text-on-primary font-bold'
                          : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {l.text}
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowShareModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-surface-container text-on-surface-variant"
                >
                  Cancel
                </button>
                <button
                  onClick={exportLyricsShareCardPng}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-primary text-on-primary shadow-lg shadow-primary/25"
                >
                  Export PNG Card (1080×1350)
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
