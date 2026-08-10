import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const rooms = new Map();
const clients = new Map();
const usedUsernames = new Set();
const MAX_PLAYERS = 8;

function randomUsername() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const name = `城市司机_${Math.floor(1000 + Math.random() * 9000)}`;
    if (!usedUsernames.has(name)) {
      usedUsernames.add(name);
      return name;
    }
  }
  return `城市司机_${crypto.randomUUID().slice(0, 4)}`;
}

function sanitizeRoomName(name) {
  const clean = String(name ?? '').trim().slice(0, 24);
  return clean || '默认房间';
}

function toWirePlayer(client) {
  const player = client.player ?? {};
  return {
    id: client.id,
    username: client.username,
    vehicleId: player.vehicleId ?? 'sedan',
    color: player.color ?? '#cc3333',
    x: player.x ?? 300,
    z: player.z ?? 450,
    heading: player.heading ?? 0,
    speedMs: player.speedMs ?? 0,
    isHost: client.isHost === true,
  };
}

function toWireRoom(room) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    hostName: room.hostName,
    players: room.players.map((client) => toWirePlayer(client)),
    maxPlayers: room.maxPlayers,
    status: room.status,
  };
}

function broadcastRooms(wss) {
  const payload = JSON.stringify({
    type: 'rooms',
    rooms: [...rooms.values()].map(toWireRoom),
  });
  for (const [ws, client] of clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

function sendToRoom(wss, room, payload) {
  const data = JSON.stringify(payload);
  for (const client of room.players) {
    if (client.ws.readyState === 1) client.ws.send(data);
  }
}

function removeFromRoom(wss, client) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  room.players = room.players.filter((entry) => entry.id !== client.id);
  client.roomId = null;
  client.isHost = false;
  if (room.players.length === 0) {
    rooms.delete(room.id);
  } else if (client.id === room.hostId) {
    const next = room.players[0];
    room.hostId = next.id;
    room.hostName = next.username;
    next.isHost = true;
  }
  if (rooms.has(room.id)) {
    sendToRoom(wss, room, {
      type: 'roomUpdated',
      room: toWireRoom(room),
    });
  }
  broadcastRooms(wss);
}

export function attachMultiplayerServer(httpServer, pathname = '/multiplayer') {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== pathname) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    const client = {
      id: crypto.randomUUID(),
      ws,
      username: randomUsername(),
      roomId: null,
      isHost: false,
      player: {},
    };
    clients.set(ws, client);
    ws.send(
      JSON.stringify({
        type: 'welcome',
        username: client.username,
        rooms: [...rooms.values()].map(toWireRoom),
      }),
    );

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      switch (message.type) {
        case 'listRooms':
          ws.send(JSON.stringify({ type: 'rooms', rooms: [...rooms.values()].map(toWireRoom) }));
          break;
        case 'createRoom': {
          if (client.roomId) removeFromRoom(wss, client);
          const id = crypto.randomUUID().slice(0, 8);
          const room = {
            id,
            name: sanitizeRoomName(message.name),
            hostId: client.id,
            hostName: client.username,
            players: [client],
            maxPlayers: MAX_PLAYERS,
            status: 'lobby',
          };
          client.roomId = id;
          client.isHost = true;
          rooms.set(id, room);
          ws.send(JSON.stringify({ type: 'joined', room: toWireRoom(room) }));
          broadcastRooms(wss);
          break;
        }
        case 'joinRoom': {
          const room = rooms.get(String(message.roomId ?? ''));
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
            break;
          }
          if (room.status === 'playing') {
            ws.send(JSON.stringify({ type: 'error', message: '游戏已经开始' }));
            break;
          }
          if (room.players.length >= room.maxPlayers) {
            ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
            break;
          }
          if (client.roomId) removeFromRoom(wss, client);
          client.roomId = room.id;
          room.players.push(client);
          ws.send(JSON.stringify({ type: 'joined', room: toWireRoom(room) }));
          sendToRoom(wss, room, { type: 'roomUpdated', room: toWireRoom(room) });
          broadcastRooms(wss);
          break;
        }
        case 'leaveRoom':
          if (client.roomId) removeFromRoom(wss, client);
          break;
        case 'startGame': {
          const room = rooms.get(client.roomId);
          if (!room || room.hostId !== client.id) break;
          room.status = 'playing';
          sendToRoom(wss, room, {
            type: 'gameStarted',
            room: toWireRoom(room),
            mapMode: 'finite',
          });
          broadcastRooms(wss);
          break;
        }
        case 'state': {
          client.player = {
            vehicleId: typeof message.vehicleId === 'string' ? message.vehicleId : 'sedan',
            color: typeof message.color === 'string' ? message.color : '#cc3333',
            x: Number(message.x) || 0,
            z: Number(message.z) || 0,
            heading: Number(message.heading) || 0,
            speedMs: Number(message.speedMs) || 0,
          };
          const room = rooms.get(client.roomId);
          if (room) {
            sendToRoom(wss, room, {
              type: 'state',
              players: room.players.map(toWirePlayer),
            });
          }
          break;
        }
        default:
          break;
      }
    });

    ws.on('close', () => {
      if (client.roomId) removeFromRoom(wss, client);
      clients.delete(ws);
      usedUsernames.delete(client.username);
    });
  });

  return wss;
}

function serveStatic(req, res, staticDir) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let filePath = path.resolve(staticDir, `.${url.pathname}`);
  if (filePath === path.resolve(staticDir, '.')) {
    filePath = path.join(staticDir, 'index.html');
  }
  if (!filePath.startsWith(path.resolve(staticDir))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.glb': 'model/gltf-binary',
      '.png': 'image/png',
    }[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
}

export function startStandaloneServer({ port = 8080, staticDir = 'dist' } = {}) {
  const server = http.createServer((req, res) => serveStatic(req, res, path.resolve(staticDir)));
  attachMultiplayerServer(server);
  server.listen(port, '0.0.0.0', () => {
    console.log(`MoronTown server running at http://localhost:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStandaloneServer();
}
