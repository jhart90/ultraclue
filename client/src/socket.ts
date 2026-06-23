import { io, type Socket } from 'socket.io-client';

// Same-origin connection. In dev, Vite proxies /socket.io to the Express server (see vite.config).
export const socket: Socket = io({ autoConnect: true });
