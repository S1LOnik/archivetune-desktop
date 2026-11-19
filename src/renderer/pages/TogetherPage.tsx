import React, { useState } from 'react';
import { Radio, Send, LogOut, Copy, Link2 } from 'lucide-react';
import { useAccountsStore, usePlayerStore, useUIStore } from '../store';

export default function TogetherPage() {
  const { together, setTogetherState } = useAccountsStore();
  const { currentTrack, isPlaying, position } = usePlayerStore();
  const { pushToast } = useUIStore();

  const [displayName, setDisplayName] = useState(together.displayName || 'Listener');
  const [port, setPort] = useState(26590);
  const [joinUrl, setJoinUrl] = useState('ws://127.0.0.1:26590');
  const [joinCode, setJoinCode] = useState('');
  const [chatMsg, setChatMsg] = useState('');

  const handleCreate = async () => {
    const state = await window.electronAPI?.together?.createRoom(displayName || 'Host', port);
    if (state) {
      setTogetherState(state);
      pushToast(`Комната ${state.roomCode} создана!`, 'lossless');
      if (currentTrack) {
        await window.electronAPI?.together?.syncHostState({ track: currentTrack, position, isPlaying });
      }
    }
  };

  const handleJoin = async () => {
    const res = await window.electronAPI?.together?.joinRoom(joinUrl.trim(), displayName || 'Guest', joinCode.trim());
    if (res?.ok && res.state) {
      setTogetherState(res.state);
      pushToast(`Вы подключились к комнате ${res.state.roomCode}`, 'lossless');
    } else {
      pushToast(res?.error || 'Не удалось подключиться к комнате', 'error');
    }
  };

  const handleLeave = async () => {
    await window.electronAPI?.together?.leaveRoom();
    const st = await window.electronAPI?.together?.getState();
    if (st) setTogetherState(st);
  };

  const handleSendChat = async () => {
    if (!chatMsg.trim()) return;
    await window.electronAPI?.together?.sendChat(chatMsg.trim(), displayName);
    setChatMsg('');
  };

  return (
    <div className="screen screen-settings">
      <header className="screen-header">
        <h1>Слушать вместе</h1>
      </header>

      {together.role === 'idle' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="p-5 rounded-3xl bg-surface-container   space-y-4">
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <Radio size={17} className="text-primary" /> Создать комнату
            </h2>
            <div className="space-y-2.5 text-xs">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ваше имя"
                className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none"
              />
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || 26590)}
                placeholder="WebSocket порт (26590)"
                className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none"
              />
              <button
                onClick={handleCreate}
                className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-bold"
              >
                Запустить хост-комнату
              </button>
            </div>
          </div>

          <div className="p-5 rounded-3xl bg-surface-container   space-y-4">
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <Link2 size={17} className="text-primary" /> Подключиться к другу (Guest)
            </h2>
            <div className="space-y-2.5 text-xs">
              <input
                value={joinUrl}
                onChange={(e) => setJoinUrl(e.target.value)}
                placeholder="ws://IP:26590"
                className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none"
              />
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Код комнаты (например A4F91C)"
                className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none font-mono"
              />
              <button
                onClick={handleJoin}
                className="w-full py-2.5 rounded-xl bg-surface-container-highest hover:bg-primary hover:text-on-primary font-bold transition"
              >
                Присоединиться
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1 p-5 rounded-3xl bg-surface-container   space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold uppercase">
                {together.role} • {together.roomCode}
              </span>
              <button
                onClick={handleLeave}
                className="px-2.5 py-1 rounded-xl bg-red-500/15 text-red-300 text-xs font-semibold flex items-center gap-1"
              >
                <LogOut size={12} /> Выйти
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-surface-container-high text-xs space-y-1">
              <div className="text-on-surface-variant">Ссылка подключения:</div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-primary truncate">{together.roomUrl}</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(`${together.roomUrl} (${together.roomCode})`);
                    pushToast('Скопировано в буфер обмена', 'info');
                  }}
                  className="p-1 rounded hover:bg-surface-container-highest"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase text-on-surface-variant">
                Участники ({together.participants.length})
              </h3>
              {together.participants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface-container-high/60 text-xs"
                >
                  <span className="font-semibold text-on-surface">{p.name}</span>
                  <span className="text-[11px] text-on-surface-variant">
                    {p.role === 'host' ? 'Host' : `${p.rttMs}ms`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 p-5 rounded-3xl bg-surface-container   flex flex-col h-[420px]">
            <h3 className="text-sm font-bold text-on-surface mb-3">Чат комнаты</h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              {together.chat.length === 0 ? (
                <p className="text-xs text-on-surface-variant text-center py-12">
                  Сообщений пока нет. Поделитесь кодом <b>{together.roomCode}</b>!
                </p>
              ) : (
                together.chat.map((m) => (
                  <div key={m.id} className="p-2.5 rounded-2xl bg-surface-container-high/70 text-xs">
                    <span className="font-bold text-primary mr-2">{m.sender}:</span>
                    <span className="text-on-surface">{m.text}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2 pt-3   mt-2">
              <input
                value={chatMsg}
                onChange={(e) => setChatMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSendChat()}
                placeholder="Написать в комнату..."
                className="flex-1 px-3 py-2 rounded-xl bg-surface-container-high text-xs text-on-surface outline-none"
              />
              <button
                onClick={() => void handleSendChat()}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold inline-flex items-center gap-1"
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
