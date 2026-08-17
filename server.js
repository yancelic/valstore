/**
 * server.js — ValStore Express Server
 * Serves the frontend PWA and exposes REST API endpoints.
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { startAuth, submitMFA, refreshTokens } = require('./auth');
const { getStore } = require('./store');

// ─── Startup validation ────────────────────────────────────────────────────
const INVITE_CODE = process.env.INVITE_CODE;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!INVITE_CODE) {
  console.error('❌  INVITE_CODE environment variable is required.');
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET === 'replace-this-with-a-long-random-string') {
  console.error('❌  SESSION_SECRET is not set or is using the default value.');
  process.exit(1);
}

// ─── App setup ─────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1); // Required for Render / reverse proxy

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Sessions ──────────────────────────────────────────────────────────────
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD, // HTTPS only in production
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    name: 'vs.sid',
  })
);

// ─── Rate limiting ─────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek. Lütfen 15 dakika sonra tekrar dene.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8, // 8 login attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi. Lütfen 15 dakika bekle.' },
});

app.use('/api', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/mfa', authLimiter);

// ─── Middleware helpers ────────────────────────────────────────────────────
function requireInvite(req, res, next) {
  if (!req.session.hasInvite) {
    return res.status(403).json({ error: 'Davet kodu gerekli.' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.auth) {
    return res.status(401).json({ error: 'Oturum açılmamış.' });
  }
  next();
}

// ─── API Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/status
 * Returns current session state so the frontend knows which view to render.
 */
app.get('/api/status', (req, res) => {
  res.json({
    hasInvite: !!req.session.hasInvite,
    isAuthenticated: !!req.session.auth,
    pendingMFA: !!req.session.pendingMFA,
  });
});

/**
 * POST /api/invite
 * Validate invite code. Sets session flag on success.
 */
app.post('/api/invite', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Kod eksik.' });

  if (code.trim() === INVITE_CODE) {
    req.session.hasInvite = true;
    return res.json({ success: true });
  }

  return res.status(403).json({ error: 'Geçersiz davet kodu.' });
});

/**
 * POST /api/auth/login
 * Initiate Riot RSO login with username + password.
 */
app.post('/api/auth/login', requireInvite, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
  }

  try {
    const result = await startAuth(username, password);

    if (result.type === 'response') {
      req.session.auth = {
        accessToken: result.accessToken,
        entitlementToken: result.entitlementToken,
        puuid: result.puuid,
        shard: result.shard,
        cookieJar: result.cookieJar,
        tokenExpiry: Date.now() + 55 * 60 * 1000, // 55 min (tokens last 1h)
      };
      req.session.pendingMFA = null;
      return res.json({ success: true, type: 'success' });
    }

    if (result.type === 'multifactor') {
      req.session.pendingMFA = { cookieJar: result.cookieJar };
      return res.json({ success: true, type: 'mfa' });
    }
  } catch (err) {
    if (err.code === 'auth_failure') {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }
    if (err.code === 'rate_limited') {
      return res.status(429).json({ error: 'Riot sunucusu çok fazla deneme yaptığın için kısa süreliğine erişimi engelledi. Birkaç dakika bekle.' });
    }
    console.error('[login]', err.message);
    return res.status(500).json({ error: 'Giriş sırasında bir hata oluştu.' });
  }
});

/**
 * POST /api/auth/mfa
 * Submit 2FA verification code.
 */
app.post('/api/auth/mfa', requireInvite, async (req, res) => {
  if (!req.session.pendingMFA) {
    return res.status(400).json({ error: '2FA bekleyen oturum yok.' });
  }

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Doğrulama kodu gerekli.' });

  try {
    const result = await submitMFA(req.session.pendingMFA.cookieJar, code);

    req.session.auth = {
      accessToken: result.accessToken,
      entitlementToken: result.entitlementToken,
      puuid: result.puuid,
      shard: result.shard,
      cookieJar: result.cookieJar,
      tokenExpiry: Date.now() + 55 * 60 * 1000,
    };
    req.session.pendingMFA = null;
    return res.json({ success: true });
  } catch (err) {
    if (err.code === 'invalid_mfa_code') {
      return res.status(401).json({ error: 'Doğrulama kodu hatalı.' });
    }
    console.error('[mfa]', err.message);
    return res.status(500).json({ error: '2FA doğrulaması sırasında hata oluştu.' });
  }
});

/**
 * GET /api/store
 * Return current daily store for the authenticated user.
 * Auto-refreshes token if it's about to expire.
 */
app.get('/api/store', requireInvite, requireAuth, async (req, res) => {
  const authData = req.session.auth;

  try {
    // Refresh token if expiring within 2 minutes
    if (Date.now() > authData.tokenExpiry - 2 * 60 * 1000) {
      try {
        const refreshed = await refreshTokens(authData.cookieJar);
        req.session.auth = {
          ...authData,
          accessToken: refreshed.accessToken,
          entitlementToken: refreshed.entitlementToken,
          cookieJar: refreshed.cookieJar,
          tokenExpiry: Date.now() + 55 * 60 * 1000,
        };
      } catch (refreshErr) {
        if (refreshErr.code === 'cookie_expired') {
          req.session.auth = null;
          return res.status(401).json({ error: 'Oturum süresi doldu. Lütfen tekrar giriş yap.', code: 'session_expired' });
        }
        throw refreshErr;
      }
    }

    const { accessToken, entitlementToken, puuid, shard } = req.session.auth;
    const store = await getStore(accessToken, entitlementToken, puuid, shard);
    return res.json(store);
  } catch (err) {
    // Riot returned 400/401 — token is invalid
    if (err.response?.status === 400 || err.response?.status === 401) {
      req.session.auth = null;
      return res.status(401).json({ error: 'Oturum süresi doldu. Lütfen tekrar giriş yap.', code: 'session_expired' });
    }
    console.error('[store]', err.message);
    return res.status(500).json({ error: 'Mağaza verileri alınamadı. Lütfen tekrar dene.' });
  }
});

/**
 * POST /api/auth/logout
 * Destroy the user's session.
 */
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('[logout]', err);
    res.json({ success: true });
  });
});

// ─── SPA fallback — serve index.html for all non-API routes ───────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start server ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎮  ValStore running → http://localhost:${PORT}`);
});
