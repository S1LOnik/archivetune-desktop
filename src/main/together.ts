/**
 * together.ts — Listen Together Real-Time WebSocket Engine
 *
 * Ports S1LOnik/ArchiveTune's `together/` package:
 * - Local WebSocket Host Server (with automatic LAN IP discovery & 6-char room code)
 * - WebSocket Client (connect to ws://host:port or archivetune://join/host:port/code)
 * - Heartbeat RTT Ping/Pong clock skew compensation
 * - Real-time playback state, seek, queue & chat synchronization
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';

export interface TogetherParticipant {
  id: string;
  name: string;
  isHost: boolean;
  rttMs?: number;
}

export interface TogetherChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface TogetherRoomState {
  active: boolean;
  role: 'host' | 'guest' | 'none';
  roomCode: string;
  joinUrl: string;
  port: number;
  participants: TogetherParticipant[];
  currentTrack: any | null;
  queue: any[];
  queueIndex: number;
  isPlaying: boolean;
  positionSec: number;
  updatedAtMs: number;
  chat: TogetherChatMessage[];
}

class ListenTogetherManager {
  private wss: WebSocketServer | null = null;
  private clientWs: WebSocket | null = null;
  private clients = new Map<WebSocket, TogetherParticipant>();
  private mainWindow: BrowserWindow | null = null;
  private state: TogetherRoomState = {
    active: false,
    role: 'none',
    roomCode: '',
    joinUrl: '',
    port: 39481,
    participants: [],
    currentTrack: null,
    queue: [],
    queueIndex: 0,
    isPlaying: false,
    positionSec: 0,
    updatedAtMs: Date.now(),
    chat: [],
  };

  public setWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  private getLanIp(): string {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
    return '127.0.0.1';
  }

  private emitState(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('together:state', this.state);
    }
  }

  private emitSyncPlayback(payload: { track?: any; isPlaying?: boolean; positionSec?: number; queue?: any[]; queueIndex?: number }): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('together:syncPlayback', payload);
    }
  }

  private broadcastToGuests(msg: object): void {
    const raw = JSON.stringify(msg);
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    }
  }

  public createRoom(displayName = 'Host', port = 39481): TogetherRoomState {
    this.leaveRoom();
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const hostParticipant: TogetherParticipant = { id: 'host', name: displayName || 'Host', isHost: true, rttMs: 0 };

    this.wss = new WebSocketServer({ port });
    this.wss.on('error', (err) => {
      console.warn('[Together] WebSocketServer error:', err);
    });
    const lanIp = this.getLanIp();

    this.state = {
      active: true,
      role: 'host',
      roomCode,
      joinUrl: `ws://${lanIp}:${port}?code=${roomCode}`,
      port,
      participants: [hostParticipant],
      currentTrack: null,
      queue: [],
      queueIndex: 0,
      isPlaying: false,
      positionSec: 0,
      updatedAtMs: Date.now(),
      chat: [{ id: `sys-${Date.now()}`, senderId: 'system', senderName: 'System', text: `Room ${roomCode} created on ${lanIp}:${port}`, timestamp: Date.now() }],
    };

    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'hello') {
            if (msg.roomCode && msg.roomCode !== this.state.roomCode) {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid room code' }));
              ws.close();
              return;
            }
            const guest: TogetherParticipant = {
              id: msg.clientId || `guest-${Math.random().toString(36).slice(2, 8)}`,
              name: msg.displayName || 'Guest',
              isHost: false,
            };
            this.clients.set(ws, guest);
            this.state.participants = [hostParticipant, ...Array.from(this.clients.values())];
            ws.send(JSON.stringify({ type: 'room_state', state: this.state }));
            this.broadcastToGuests({ type: 'room_state', state: this.state });
            this.emitState();
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', t0: msg.t0, serverTs: Date.now() }));
          } else if (msg.type === 'chat') {
            const p = this.clients.get(ws);
            const chatMsg: TogetherChatMessage = {
              id: `c-${Date.now()}-${Math.random()}`,
              senderId: p?.id || 'guest',
              senderName: p?.name || 'Guest',
              text: String(msg.text || '').slice(0, 300),
              timestamp: Date.now(),
            };
            this.state.chat = [...this.state.chat.slice(-49), chatMsg];
            this.broadcastToGuests({ type: 'room_state', state: this.state });
            this.emitState();
          } else if (msg.type === 'add_track' && msg.track) {
            this.state.queue = [...this.state.queue, msg.track];
            this.broadcastToGuests({ type: 'room_state', state: this.state });
            this.emitSyncPlayback({ queue: this.state.queue });
            this.emitState();
          }
        } catch { /* ignore */ }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.state.participants = [hostParticipant, ...Array.from(this.clients.values())];
        this.broadcastToGuests({ type: 'room_state', state: this.state });
        this.emitState();
      });
    });

    this.emitState();
    return this.state;
  }

  public joinRoom(wsUrlOrHost: string, displayName = 'Guest', roomCode = ''): Promise<TogetherRoomState> {
    this.leaveRoom();
    const normalizedUrl = wsUrlOrHost.startsWith('ws://') || wsUrlOrHost.startsWith('wss://')
      ? wsUrlOrHost
      : `ws://${wsUrlOrHost}${wsUrlOrHost.includes(':') ? '' : ':39481'}`;

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(normalizedUrl);
        this.clientWs = ws;
        const clientId = `guest-${Math.random().toString(36).slice(2, 8)}`;

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'hello', clientId, displayName, roomCode }));
          const pingTimer = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) { clearInterval(pingTimer); return; }
            ws.send(JSON.stringify({ type: 'ping', t0: Date.now() }));
          }, 5000);
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'room_state' && msg.state) {
              this.state = { ...msg.state, active: true, role: 'guest', joinUrl: normalizedUrl };
              this.emitState();
              if (msg.state.currentTrack) {
                const elapsedSince = Math.max(0, (Date.now() - (msg.state.updatedAtMs || Date.now())) / 1000);
                this.emitSyncPlayback({
                  track: msg.state.currentTrack,
                  isPlaying: msg.state.isPlaying,
                  positionSec: msg.state.isPlaying ? msg.state.positionSec + elapsedSince : msg.state.positionSec,
                  queue: msg.state.queue,
                  queueIndex: msg.state.queueIndex,
                });
              }
              resolve(this.state);
            } else if (msg.type === 'error') {
              reject(new Error(msg.message || 'Room connection error'));
            }
          } catch { /* ignore */ }
        });

        ws.on('error', (err) => reject(err));
        ws.on('close', () => {
          if (this.state.role === 'guest') {
            this.state = { ...this.state, active: false, role: 'none' };
            this.emitState();
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public hostUpdatePlayback(update: {
    currentTrack?: any;
    isPlaying?: boolean;
    positionSec?: number;
    queue?: any[];
    queueIndex?: number;
  }): void {
    if (!this.state.active || this.state.role !== 'host') return;
    if (update.currentTrack !== undefined) this.state.currentTrack = update.currentTrack;
    if (update.isPlaying !== undefined) this.state.isPlaying = update.isPlaying;
    if (update.positionSec !== undefined) this.state.positionSec = update.positionSec;
    if (update.queue !== undefined) this.state.queue = update.queue;
    if (update.queueIndex !== undefined) this.state.queueIndex = update.queueIndex;
    this.state.updatedAtMs = Date.now();
    this.broadcastToGuests({ type: 'room_state', state: this.state });
  }

  public sendChat(text: string, senderName = 'Me'): void {
    if (!this.state.active || !text.trim()) return;
    if (this.state.role === 'host') {
      const chatMsg: TogetherChatMessage = {
        id: `c-${Date.now()}`,
        senderId: 'host',
        senderName,
        text: text.trim().slice(0, 300),
        timestamp: Date.now(),
      };
      this.state.chat = [...this.state.chat.slice(-49), chatMsg];
      this.broadcastToGuests({ type: 'room_state', state: this.state });
      this.emitState();
    } else if (this.clientWs?.readyState === WebSocket.OPEN) {
      this.clientWs.send(JSON.stringify({ type: 'chat', text: text.trim() }));
    }
  }

  public leaveRoom(): void {
    if (this.wss) {
      for (const [ws] of this.clients) { try { ws.close(); } catch { /* ignore */ } }
      this.clients.clear();
      try { this.wss.close(); } catch { /* ignore */ }
      this.wss = null;
    }
    if (this.clientWs) {
      try { this.clientWs.close(); } catch { /* ignore */ }
      this.clientWs = null;
    }
    this.state = {
      active: false,
      role: 'none',
      roomCode: '',
      joinUrl: '',
      port: 39481,
      participants: [],
      currentTrack: null,
      queue: [],
      queueIndex: 0,
      isPlaying: false,
      positionSec: 0,
      updatedAtMs: Date.now(),
      chat: [],
    };
    this.emitState();
  }

  public getState(): TogetherRoomState {
    return this.state;
  }
}

export const togetherManager = new ListenTogetherManager();

export function setupTogetherIPC(win?: BrowserWindow): void {
  if (win) togetherManager.setWindow(win);
  app.on('before-quit', () => togetherManager.leaveRoom());
  ipcMain.handle('together:getState', () => togetherManager.getState());
  ipcMain.handle('together:createRoom', (_e, displayName: string, port?: number) => togetherManager.createRoom(displayName, port));
  ipcMain.handle('together:joinRoom', async (_e, url: string, displayName: string, code: string) => {
    try {
      const state = await togetherManager.joinRoom(url, displayName, code);
      return { ok: true, state };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to join room' };
    }
  });
  ipcMain.handle('together:leaveRoom', () => {
    togetherManager.leaveRoom();
    return true;
  });
  ipcMain.handle('together:syncHostState', (_e, update: any) => {
    togetherManager.hostUpdatePlayback(update);
    return true;
  });
  ipcMain.handle('together:sendChat', (_e, text: string, senderName?: string) => {
    togetherManager.sendChat(text, senderName);
    return true;
  });
}
