/**
 * Examaye Production Server - CORS / Static Assets Fix
 *
 * IMPORTANT:
 * This file is a corrected server template based on the production
 * configuration visible in the current deployment logs.
 *
 * It fixes:
 * 1. https://examaye.com CORS blocking
 * 2. Same-origin frontend assets being unnecessarily passed through CORS
 * 3. Vite/React client/dist static serving
 * 4. SPA fallback
 * 5. Prevents accidental public access to .env/.git files
 *
 * Keep your existing API route imports/mounts from the original index.js
 * in the marked section below. Do not delete them.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// BASIC CONFIGURATION
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

const normalizeOrigin = (value = '') =>
  String(value).trim().replace(/\/+$/, '');

const CLIENT_URL = normalizeOrigin(process.env.CLIENT_URL);

const allowedOrigins = new Set([
  'https://examaye.com',
  'https://www.examaye.com',

  // Local development
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

if (CLIENT_URL) {
  allowedOrigins.add(CLIENT_URL);
}

// ---------------------------------------------------------------------------
// SECURITY
// ---------------------------------------------------------------------------

app.disable('x-powered-by');

app.use(
  helmet({
    // The frontend is served by this same Express server.
    // Keep Helmet enabled, but do not let CSP prevent normal Vite assets.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Never serve environment/git/secret files.
app.use((req, res, next) => {
  const blocked = [
    /^\/\.env(?:$|\.)/i,
    /^\/\.git(?:\/|$)/i,
    /^\/\.svn(?:\/|$)/i,
    /^\/\.hg(?:\/|$)/i,
    /^\/config\/\.env(?:$|\.)/i,
    /^\/backend\/\.env(?:$|\.)/i,
    /^\/server\/\.env(?:$|\.)/i,
  ];

  if (blocked.some((pattern) => pattern.test(req.path))) {
    return res.status(404).json({ error: 'Not found' });
  }

  next();
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
//
// IMPORTANT:
// Do NOT put app.use(cors(corsOptions)) globally before express.static().
// The production frontend is same-origin at https://examaye.com.
// CORS is needed for API requests, especially when the API is called from
// another origin.
//
// If your API router is mounted under /api, the preferred configuration is:
//     app.use('/api', cors(corsOptions));
//
// The global OPTIONS handler below also supports API preflight requests.
// ---------------------------------------------------------------------------

function isAllowedOrigin(origin) {
  if (!origin) return true;

  const cleanOrigin = normalizeOrigin(origin);

  // Explicit production domains.
  if (allowedOrigins.has(cleanOrigin)) return true;

  // Railway generated domains.
  if (/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i.test(cleanOrigin)) {
    return true;
  }

  // Common local development addresses.
  if (
    /^http:\/\/192\.168\.\d+\.\d+:3000$/i.test(cleanOrigin) ||
    /^http:\/\/10\.\d+\.\d+\.\d+:3000$/i.test(cleanOrigin) ||
    /^http:\/\/172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+:3000$/i.test(cleanOrigin)
  ) {
    return true;
  }

  console.warn(`CORS blocked origin: ${origin}`);
  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },

  credentials: true,

  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'X-CSRF-Token',
  ],

  exposedHeaders: [
    'Content-Length',
    'Content-Type',
    'Authorization',
  ],

  optionsSuccessStatus: 204,
};

// ---------------------------------------------------------------------------
// BODY PARSERS
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------------------------------------------------------------------------
// HEALTH CHECK
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'examaye',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// API CORS
// ---------------------------------------------------------------------------
//
// Keep CORS on the API rather than applying it to the entire application.
// This prevents the frontend's /assets/*.js and /assets/*.css from being
// rejected by CORS.

app.use('/api', cors(corsOptions));
app.options('/api/*', cors(corsOptions));

// ---------------------------------------------------------------------------
// YOUR EXISTING API ROUTES
// ---------------------------------------------------------------------------
//
// IMPORTANT:
// Keep the route imports and app.use(...) statements from your ORIGINAL
// index.js here.
//
// Examples:
// import authRoutes from './routes/auth.js';
// app.use('/api/auth', authRoutes);
//
// import userRoutes from './routes/users.js';
// app.use('/api/users', userRoutes);
//
// Do not invent or remove your application's existing routes.
//
// ---------------------------------------------------------------------------

// >>> PASTE/KEEP YOUR EXISTING API ROUTE IMPORTS AND MOUNTS HERE <<<


// ---------------------------------------------------------------------------
// PRODUCTION FRONTEND
// ---------------------------------------------------------------------------

if (IS_PRODUCTION) {
  const clientDist = path.resolve(__dirname, '..', 'client', 'dist');

  console.log(`Serving frontend from: ${clientDist}`);

  // Serve Vite assets explicitly first.
  // This guarantees /assets/*.js and /assets/*.css are treated as static
  // files and are NOT sent through the React SPA fallback.
  app.use(
    '/assets',
    express.static(path.join(clientDist, 'assets'), {
      fallthrough: false,
      maxAge: '1y',
      immutable: true,
    })
  );

  // Serve the rest of the Vite build.
  app.use(
    express.static(clientDist, {
      index: false,
      maxAge: '1h',
    })
  );

  // React/Vite SPA fallback.
  // Never rewrite API, upload, Socket.IO, or asset requests to index.html.
  app.get(/^(?!\/api(?:\/|$)|\/uploads(?:\/|$)|\/socket\.io(?:\/|$)|\/assets(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      message: 'Examaye API server is running',
      environment: NODE_ENV,
    });
  });
}

// ---------------------------------------------------------------------------
// 404 HANDLER
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl,
  });
});

// ---------------------------------------------------------------------------
// ERROR HANDLER
// ---------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  console.error(err);

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS blocked',
      origin: req.headers.origin || null,
    });
  }

  res.status(err.status || 500).json({
    error: IS_PRODUCTION ? 'Internal server error' : err.message,
  });
});

// ---------------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Examaye server running on port ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Client URL: ${CLIENT_URL || '(not set)'}`);
  console.log(
    `Allowed production origins: https://examaye.com, https://www.examaye.com`
  );
});

export default app;
