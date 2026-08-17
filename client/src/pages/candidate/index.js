require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const os = require('os');

const { initDB } = require('./models/db');
const authRoutes     = require('./routes/auth');
const examRoutes     = require('./routes/exams');
const questionRoutes = require('./routes/questions');
const candidateRoutes = require('./routes/candidates');
const analyticsRoutes = require('./routes/analytics');
const proctorRoutes  = require('./routes/proctor');
const subjectRoutes  = require('./routes/subjects');
const importRoutes   = require('./routes/import');
const settingsRoutes = require('./routes/settings');
const { initSocket } = require('./socket/socketManager');

const app = express();
const server = http.createServer(app);

// ── Get all local network IPs ─────────────────────────────────
function getLocalIPs() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// ── CORS: allow localhost + any private LAN IP ────────────────
function isAllowedOrigin(origin) {
  if (!origin) return true;
  const patterns = [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
    /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
    /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:\d+$/,
  ];
  return patterns.some(p => p.test(origin));
}

const corsOptions = {
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// ── Socket.io ─────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST'],
    credentials: false,
  },
  // Start with polling (works everywhere), upgrade to websocket
  transports: ['polling', 'websocket'],
  // Generous timeouts for slow school networks
  pingTimeout: 30000,
  pingInterval: 10000,
  connectTimeout: 30000,
  // Allow reconnections
  allowUpgrades: true,
  upgradeTimeout: 15000,
  // Max payload for photo uploads etc
  maxHttpBufferSize: 5e6,
});

// ── Middleware ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight

// Generous rate limits for classroom use
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.');
  },
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // 100 logins per 15min — enough for a full class
  skip: (req) => {
    const ip = req.ip || '';
    return ip.startsWith('192.168.') || ip.startsWith('10.');
  },
  message: { error: 'Too many login attempts.' },
});
app.use('/api/auth/login', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/exams',      examRoutes);
app.use('/api/questions',  questionRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/analytics',  analyticsRoutes);
app.use('/api/proctor',    proctorRoutes);
app.use('/api/subjects',   subjectRoutes);
app.use('/api/import',     importRoutes);
app.use('/api/settings',   settingsRoutes);

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const ips = getLocalIPs();
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    server_ips: ips,
    student_urls: ips.map(ip => `http://${ip}:3000`),
    timestamp: new Date().toISOString(),
  });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ── Socket.io ─────────────────────────────────────────────────
initSocket(io);

// ── Start server ──────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await initDB();
    console.log('✅ Database connected');

    // Listen on ALL interfaces — required for LAN access
    server.listen(PORT, '0.0.0.0', () => {
      const ips = getLocalIPs();
      console.log('');
      console.log(`🚀 ExamOS Server running on port ${PORT}`);
      console.log(`📡 Socket.io ready (polling + websocket)`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('');
      console.log('📌 Share this URL with students:');
      ips.forEach(ip => console.log(`   → http://${ip}:3000`));
      console.log('');
    });

    // Keep-alive for long exam sessions
    server.keepAliveTimeout = 65000;
    server.headersTimeout   = 66000;

  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

start();

module.exports = { app, io };
