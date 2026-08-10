import { defineConfig } from 'vite';
import { attachMultiplayerServer } from './server/multiplayer.mjs';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    {
      name: 'multiplayer-websocket',
      configureServer(server) {
        if (server.httpServer) attachMultiplayerServer(server.httpServer);
      },
      configurePreviewServer(server) {
        if (server.httpServer) attachMultiplayerServer(server.httpServer);
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: false,
    host: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
