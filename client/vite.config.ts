import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, proxy Socket.IO traffic to the Express server so the client can use a same-origin
// io() connection (no CORS, matches production behaviour).
export default defineConfig({
  plugins: [react()],
  // Ensure a single React instance across the workspace (zustand + react both consume it),
  // otherwise dev mode throws "Invalid hook call / more than one copy of React".
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    // Allow reading override assets from the repo root (one level above the client workspace).
    fs: { allow: ['..'] },
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
