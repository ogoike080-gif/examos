if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { initDB } = require('./models/db');
const authRoutes     = require('./routes/auth');
const examRoutes     = require('./routes/exams');
const questionRoutes = require('./routes/questions');
const candidateRoutes = require('./routes/candidates');
const analyticsRoutes = require('./routes/analytics');
const proctorRoutes  = require('./routes/proctor');
const subjectRoutes  = require('./routes/subjects');
const importRoutes   = require('./routes/import');
const importBatchesRoutes = require('./routes/importBatches');
const syllabusRoutes = require('./routes/syllabus');
const settingsRoutes = require('./routes/settings');
const resultsRoutes   = require('./routes/results');
const aiRoutes        = require('./routes/ai');
const parentRoutes    = require('./routes/parent');
const { initSocket } = require('./socket/socketManager');

const app = express();
const server = http.createServer(app);

// Trust Railway's reverse proxy so req.ip and X-Forwarded-For are read
// correctly. Without this, express-rate-limit v7 throws on every request
// when it detects X-Forwarded-For but doesn't trust the proxy — which is
// exactly what was causing the global 500s on both API routes and static
// assets (CSS/JS returning JSON error bodies instead of file content).
app.set('trust proxy', 1);

const gamificationRoutes = require('./routes/gamification');
app.use('/api/gamification', gamificationRoutes);

const paymentsRoutes = require('./routes/payments');
app.use('/api/payments', paymentsRoutes);


// ── CORS: allow localhost AND any 192.168.x.x / 10.x.x.x on port 3000 ──
function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser / curl requests
  const allowed = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  // Allow the deployed production domain itself (client is served from
  // this same server, so its own JS module requests carry this Origin).
  if (process.env.CLIENT_URL && origin === process.env.CLIENT_URL) return true;
  // Also allow any *.up.railway.app domain as a safety net in case
  // CLIENT_URL isn't set or Railway's assigned domain changes.
  if (/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin)) return true;
  if (allowed.includes(origin)) return true;
  // Allow any LAN IP on port 3000
  if (/^http:\/\/192\.168\.\d+\.\d+:3000$/.test(origin)) return true;
  if (/^http:\/\/10\.\d+\.\d+\.\d+:3000$/.test(origin))  return true;
  if (/^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:3000$/.test(origin)) return true;
  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: false,
};

// ── Socket.io ──
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin));
    },
    methods: ['GET', 'POST'],
    credentials: false,
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 10000,
  pingInterval: 5000,
});

// ── Middleware ──
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);
app.use(cors(corsOptions));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1',
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many login attempts.' },
});
app.use('/api/auth/', authLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API Routes ──
app.use('/api/auth',       authRoutes);
app.use('/api/exams',      examRoutes);
app.use('/api/questions',  questionRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/analytics',  analyticsRoutes);
app.use('/api/proctor',    proctorRoutes);
app.use('/api/subjects',   subjectRoutes);
app.use('/api/import',     importRoutes);
// New batch-based staging pipeline (Milestone 3) — mounted separately so the
// existing zip-extract/image-extract routes above are completely untouched.
app.use('/api/import/batches', importBatchesRoutes);
// Exam Preparation Learning System — Exam Body Manager + topic content
app.use('/api/syllabus', syllabusRoutes);
app.use('/api/settings',   settingsRoutes);
app.use('/api/results',  resultsRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/parent',   parentRoutes);

// Health check — shows server IP so students know what to connect to
app.get('/api/health', (req, res) => {
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    server_ips: ips,
    student_url: ips.map(ip => `http://${ip}:3000`),
    timestamp: new Date().toISOString(),
  });
});

// ── Serve the built React app in production ──
// Keeps this to one deployed service (cheaper on Railway) instead of hosting
// the frontend separately. Anything not matched by an API route above falls
// through to index.html so React Router can handle client-side routes.
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/uploads|\/socket\.io).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Initialize Socket.io
initSocket(io);

// ── Start ──
const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await initDB();
    console.log('✅ Database connected');

    server.listen(PORT, '0.0.0.0', () => {
      // Show all network IPs on startup
      const os = require('os');
      const nets = os.networkInterfaces();
      console.log(`🚀 ExamOS Server running on port ${PORT}`);
      console.log(`📡 Socket.io ready`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`\n📌 Student access URLs (share with students):`);
      for (const ifaces of Object.values(nets)) {
        for (const iface of ifaces) {
          if (iface.family === 'IPv4' && !iface.internal) {
            console.log(`   http://${iface.address}:3000`);
          }
        }
      }
      console.log('');
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();

module.exports = { app, io };
