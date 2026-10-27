import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';

import { connectDB } from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';

import sessionRoutes from './routes/session.js';
import memberRoutes from './routes/members.js';
import menuRoutes from './routes/menu.js';
import orderRoutes from './routes/orders.js';

const app = express();
const server = http.createServer(app);

// Comma-separated list of allowed frontend origins (shared by REST CORS and Socket.IO)
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ── Socket.IO ──────────────────────────────────────────────────────────────
const io = new SocketIO(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`❌ Client disconnected: ${socket.id}`));
});

// ── Security / parsing ─────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'));
    },
    credentials: true,
  })
);

app.use(express.json());

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/session', sessionRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);

// Uptime monitor target: keeps the Render instance awake and the Mongo connection warm.
// GET and HEAD both work; 503 tells the monitor the database is unreachable.
app.get('/api/health', async (_req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ ok: true, db: 'up', uptime: Math.round(process.uptime()) });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Chai Time API running on http://localhost:${PORT}`);
  });
});

export { app, server, io };

