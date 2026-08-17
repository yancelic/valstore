/**
 * server.js — ValStore Express Server
 * Serves the frontend PWA and exposes REST API endpoints.
 * Built with Zero-Log, Zero-Retention, and Military-Grade Security.
 */

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { RIOT_AUTH_URL, authenticateWithToken } = require('./auth');
const { getStore } = require('./store');

// Generate safe fallback secret if not provided
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// ─── App setup ─────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

// ─── Security Headers (Helmet + CSP) ──────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://cdn.jsdelivr.net',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: [
          "'self'",
          'data:',
          'https://media.valorant-api.com',
          'https://valorant-api.com',
          'https://*.valorant-api.com',
        ],
        connectSrc: [
          "'self'",
          'https://auth.riotgames.com',
          'https://valorant-api.com',
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Persistent Memory Session ─────────────────────────────────────────────
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days max
    },
    name: '__Host-vs.sid',
  })
);

// ─── Rate limiting ─────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek. Lütfen biraz sonra tekrar dene.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // max 20 login attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi. Lütfen 15 dakika sonra tekrar dene.' },
});

app.use('/api', globalLimiter);
app.use('/api/auth/token', authLimiter);

// ─── Middleware helpers ────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.auth) {
    return res.status(401).json({ error: 'Oturum açılmamış.' });
  }
  next();
}

// ─── API Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/status
 */
app.get('/api/status', (req, res) => {
  res.json({
    isAuthenticated: !!req.session.auth,
    player: req.session.auth
      ? {
          username: req.session.auth.username,
          tag: req.session.auth.tag,
        }
      : null,
  });
});

/**
 * GET /api/auth/url
 */
app.get('/api/auth/url', (req, res) => {
  res.json({ url: RIOT_AUTH_URL });
});

/**
 * POST /api/auth/token
 * Logs in with pasted token/URL and stores in temporary RAM session
 */
app.post('/api/auth/token', async (req, res) => {
  const { tokenInput } = req.body;
  if (!tokenInput || typeof tokenInput !== 'string') {
    return res.status(400).json({ error: 'Lütfen Riot yönlendirme linkini yapıştır.' });
  }

  try {
    const authData = await authenticateWithToken(tokenInput);

    req.session.auth = {
      accessToken: authData.accessToken,
      entitlementToken: authData.entitlementToken,
      puuid: authData.puuid,
      username: authData.username,
      tag: authData.tag,
      shard: authData.shard,
    };

    return res.json({
      success: true,
      player: { username: authData.username, tag: authData.tag },
    });
  } catch (err) {
    const msg =
      err.response?.status === 401
        ? 'Geçersiz veya süresi dolmuş token. Lütfen linki tekrar al.'
        : err.message || 'Giriş doğrulanamadı.';
    return res.status(400).json({ error: msg });
  }
});

/**
 * GET /api/store
 */
app.get('/api/store', requireAuth, async (req, res) => {
  try {
    const { accessToken, entitlementToken, puuid, shard } = req.session.auth;
    const store = await getStore(accessToken, entitlementToken, puuid, shard);
    return res.json(store);
  } catch (err) {
    if (err.response?.status === 401) {
      req.session.auth = null;
      return res.status(401).json({
        error: 'Oturum süresi doldu. Lütfen tekrar giriş yap.',
        code: 'session_expired',
      });
    }
    return res.status(500).json({ error: 'Mağaza verileri alınamadı. Lütfen tekrar dene.' });
  }
});

/**
 * POST /api/auth/logout
 */
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ─── SPA fallback ──────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start server ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎮  ValStore running → http://localhost:${PORT}`);
});
