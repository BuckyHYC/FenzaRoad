import { MULTIPLAYER_CONFIG } from '../core/Constants';
import { eventBus, Events } from '../core/EventBus';
import type { MultiplayerPlayer, RoomInfo } from '../core/types';

interface WirePlayer {
  id: string;
  username: string;
  vehicleId: string;
  color: string;
  x: number;
  z: number;
  heading: number;
  speedMs: number;
  isHost: boolean;
}

interface WireRoom {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  players: WirePlayer[];
  maxPlayers: number;
  status: 'lobby' | 'playing';
}

function toPlayer(player: WirePlayer): MultiplayerPlayer {
  return {
    id: player.id,
    username: player.username,
    vehicleId: player.vehicleId,
    color: player.color,
    x: player.x,
    z: player.z,
    heading: player.heading,
    speedMs: player.speedMs,
    isHost: player.isHost,
  };
}

function toRoom(room: WireRoom): RoomInfo {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    hostName: room.hostName,
    players: room.players.map(toPlayer),
    maxPlayers: room.maxPlayers,
    status: room.status,
  };
}

interface ServerMessage {
  type: string;
  username?: string;
  rooms?: WireRoom[];
  room?: WireRoom;
  players?: WirePlayer[];
  mapMode?: string;
  message?: string;
}

export class MultiplayerClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private retryCount = 0;
  private closedByUser = false;
  private readonly sendQueue: unknown[] = [];

  connect(): void {
    this.closedByUser = false;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}${MULTIPLAYER_CONFIG.SERVER_PATH}`;
    try {
      this.socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket.addEventListener('open', () => {
      this.retryCount = 0;
      this.flushQueue();
      this.send({ type: 'hello' });
    });
    this.socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(String(event.data)) as ServerMessage;
        this.handleMessage(data);
      } catch {
        // Ignore malformed frames.
      }
    });
    this.socket.addEventListener('close', () => {
      this.socket = null;
      if (!this.closedByUser) this.scheduleReconnect();
    });
    this.socket.addEventListener('error', () => {
      this.socket?.close();
    });
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  createRoom(name: string): void {
    this.send({ type: 'createRoom', name: name.trim().slice(0, 24) });
  }

  joinRoom(roomId: string): void {
    this.send({ type: 'joinRoom', roomId });
  }

  leaveRoom(): void {
    this.send({ type: 'leaveRoom' });
  }

  startGame(): void {
    this.send({ type: 'startGame' });
  }

  sendState(state: {
    x: number;
    z: number;
    heading: number;
    speedMs: number;
    vehicleId: string;
    color: string;
  }): void {
    this.send({ type: 'state', ...state });
  }

  private send(payload: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    } else {
      this.sendQueue.push(payload);
    }
  }

  private flushQueue(): void {
    while (this.sendQueue.length > 0) {
      const payload = this.sendQueue.shift();
      if (payload !== undefined) this.send(payload);
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer !== null) return;
    this.retryCount += 1;
    const delay = Math.min(3000 * this.retryCount, 10000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        eventBus.emit(Events.MULTIPLAYER_CONNECTED, {
          username: message.username ?? '',
          rooms: (message.rooms ?? []).map(toRoom),
        });
        break;
      case 'rooms':
        eventBus.emit(Events.MULTIPLAYER_ROOMS, {
          rooms: (message.rooms ?? []).map(toRoom),
        });
        break;
      case 'joined':
      case 'roomUpdated':
      case 'playerJoined':
      case 'playerLeft':
        if (message.room) {
          eventBus.emit(Events.MULTIPLAYER_JOINED, { room: toRoom(message.room) });
        }
        break;
      case 'gameStarted':
        if (message.room) {
          eventBus.emit(Events.MULTIPLAYER_GAME_STARTED, {
            room: toRoom(message.room),
            mapMode: message.mapMode ?? 'finite',
          });
        }
        break;
      case 'state':
        eventBus.emit(Events.MULTIPLAYER_STATE, {
          players: (message.players ?? []).map(toPlayer),
        });
        break;
      case 'error':
        console.warn('[multiplayer]', message.message ?? 'unknown error');
        break;
      default:
        break;
    }
  }
}
