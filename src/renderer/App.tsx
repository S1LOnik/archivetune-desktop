import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Play, Pause, SkipBack, SkipForward, Heart } from 'lucide-react';
import Sidebar from './components/Sidebar';
import TitleBar from './components/TitleBar';
import MiniPlayer from './components/MiniPlayer';
import NowPlayingOverlay from './components/NowPlayingOverlay';
import QueueDrawer from './components/QueueDrawer';
import TrackContextMenu from './components/TrackContextMenu';
import SourceSwitcherModal from './components/SourceSwitcherModal';
import AcousticAuditModal from './components/AcousticAuditModal';
import TagEditorModal from './components/TagEditorModal';
import ToastContainer from './components/ToastContainer';
import HomePage from './pages/HomePage';
import ExplorePage from './pages/ExplorePage';
import AlbumPage from './pages/AlbumPage';
import ArtistPage from './pages/ArtistPage';
import PlaylistDetailPage from './pages/PlaylistDetailPage';
import SearchPage from './pages/SearchPage';
import IntegrationsPage from './pages/IntegrationsPage';
import LibraryPage from './pages/LibraryPage';
import TogetherPage from './pages/TogetherPage';
import RecognitionPage from './pages/RecognitionPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import {
  useUIStore,
  usePlayerStore,
  useAccountsStore,
  hydrateStoresFromDatabase,
} from './store';
import { usePlayer, usePlayerEvents } from './lib/usePlayer';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

function AppContent() {
  usePlayerEvents();
  const { showNowPlaying, isMiniPipMode } = useUIStore();
  const { currentTrack, isPlaying, pause, resume, skipNext, skipPrev, toggleLikeCurrent } =
    usePlayer();
  const isTrackLiked = usePlayerStore((s) => s.isTrackLiked);

  useEffect(() => {
    void hydrateStoresFromDatabase().then(() => {
      void useAccountsStore.getState().refreshAllStatuses();
    });
  }, []);

  // Compact Always-on-Top Mini Widget (PiP) Overlay Mode
  if (isMiniPipMode) {
    const liked = isTrackLiked(currentTrack);
    return (
      <div className="flex flex-col h-full bg-surface text-on-surface overflow-hidden select-none relative">
        {currentTrack?.thumbnail && (
          <div
            className="absolute inset-0 bg-cover bg-center blur-2xl opacity-30 scale-125 pointer-events-none"
            style={{ backgroundImage: `url(${currentTrack.thumbnail})` }}
          />
        )}
        <TitleBar />
        <div className="relative z-10 flex-1 flex items-center justify-between px-4 gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-14 h-14 rounded-2xl overflow-hidden bg-surface-container-high shadow-lg flex-shrink-0">
              {currentTrack?.thumbnail ? (
                <img
                  src={currentTrack.thumbnail}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl">🎵</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-on-surface truncate">
                {currentTrack?.title || 'No Track Playing'}
              </p>
              <p className="text-xs text-on-surface-variant truncate">
                {currentTrack?.artist || 'ArchiveTune Mini Widget'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {currentTrack && (
              <button
                onClick={() => toggleLikeCurrent(currentTrack)}
                className={`p-1.5 rounded-full ${
                  liked ? 'text-pink-400' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
              </button>
            )}
            <button
              onClick={skipPrev}
              className="p-1.5 text-on-surface-variant hover:text-on-surface"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={() => (isPlaying ? pause() : resume())}
              className="w-10 h-10 rounded-2xl bg-primary text-on-primary flex items-center justify-center shadow-md"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} className="translate-x-0.5" />}
            </button>
            <button
              onClick={skipNext}
              className="p-1.5 text-on-surface-variant hover:text-on-surface"
            >
              <SkipForward size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface text-on-surface overflow-hidden select-none">
      {/* Custom Titlebar */}
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <main className="app-content flex-1 overflow-y-auto overflow-x-hidden relative">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/spotify" element={<IntegrationsPage />} />
            <Route path="/together" element={<TogetherPage />} />
            <Route path="/recognize" element={<RecognitionPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/album/:id" element={<AlbumPage />} />
            <Route path="/artist/:id" element={<ArtistPage />} />
            <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        {/* Right Queue Drawer */}
        <QueueDrawer />
      </div>

      {/* Mini Player (bottom bar) */}
      {currentTrack && <MiniPlayer />}

      {/* Full Now Playing Overlay */}
      {showNowPlaying && <NowPlayingOverlay />}

      {/* Global Context Menu, Modals & Smart Switch Toasts */}
      <TrackContextMenu />
      <SourceSwitcherModal />
      <AcousticAuditModal />
      <TagEditorModal />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </QueryClientProvider>
  );
}
