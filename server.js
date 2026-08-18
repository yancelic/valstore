/**
 * server.js — ValStore Express Server
 */

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');

const {
  RIOT_AUTH_URL,
  authenticateWithCredentials,
  verifyMfaCode,
  reauthWithSsid,
  authenticateWithToken,
} = require('./auth');
const { getStore } = require('./store');

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Session ────────────────────────────────────────────────────────────────
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
    },
    name: 'vs.sid',
  })
);

// ─── Rate Limiting ───────────────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek. Biraz sonra tekrar dene.' },
}));

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi.' },
}));

// ─── Middleware ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.auth) {
    return res.status(401).json({ error: 'Oturum açılmamış.', code: 'no_session' });
  }
  next();
}

function saveAuthToSession(req, authData) {
  req.session.auth = {
    accessToken: authData.accessToken,
    idToken: authData.idToken,
    entitlementToken: authData.entitlementToken,
    puuid: authData.puuid,
    username: authData.username,
    tag: authData.tag,
    shard: authData.shard,
    ssid: authData.ssid || null,
    serializedJar: authData.serializedJar || null,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    isAuthenticated: !!req.session.auth,
    player: req.session.auth
      ? { username: req.session.auth.username, tag: req.session.auth.tag }
      : null,
  });
});

app.get('/api/auth/url', (req, res) => {
  res.json({ url: RIOT_AUTH_URL });
});

/**
 * POST /api/auth/credentials
 * Kullanıcı adı + şifre ile giriş. Şifre kaydedilmez.
 */
app.post('/api/auth/credentials', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
  }

  try {
    const result = await authenticateWithCredentials(username, password);

    if (result.mfaRequired) {
      // 2FA gerekiyor — jar'ı geçici session'a kaydet
      req.session.pendingMfa = { serializedJar: result.serializedJar };
      return res.json({
        mfa_required: true,
        method: result.mfaMethod,
        email: result.mfaEmail,
      });
    }

    saveAuthToSession(req, result);
    return res.json({
      success: true,
      player: { username: result.username, tag: result.tag },
    });
  } catch (err) {
    console.error('[auth/credentials]', err.message);
    // Cloudflare engellemesi
    if (err.response?.status === 403 || err.response?.status === 429) {
      return res.status(503).json({
        error: 'Riot sunucusu isteği reddetti (bot koruması). Lütfen "Riot Linki" yöntemini dene.',
        code: 'cloudflare_blocked',
      });
    }
    return res.status(400).json({ error: err.message || 'Giriş başarısız.' });
  }
});

/**
 * POST /api/auth/mfa
 * 2FA kodunu doğrular.
 */
app.post('/api/auth/mfa', async (req, res) => {
  const { code } = req.body;
  const pending = req.session.pendingMfa;

  if (!code || !pending?.serializedJar) {
    return res.status(400).json({ error: '2FA kodu veya oturum bilgisi eksik.' });
  }

  try {
    const result = await verifyMfaCode(code, pending.serializedJar);
    req.session.pendingMfa = null;
    saveAuthToSession(req, result);
    return res.json({
      success: true,
      player: { username: result.username, tag: result.tag },
    });
  } catch (err) {
    console.error('[auth/mfa]', err.message);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/auth/token
 * OAuth redirect link yapıştırma yöntemi.
 */
app.post('/api/auth/token', async (req, res) => {
  const { tokenInput } = req.body;
  if (!tokenInput || typeof tokenInput !== 'string') {
    return res.status(400).json({ error: 'Lütfen Riot yönlendirme linkini yapıştır.' });
  }

  try {
    const authData = await authenticateWithToken(tokenInput);
    saveAuthToSession(req, authData);
    return res.json({
      success: true,
      player: { username: authData.username, tag: authData.tag },
    });
  } catch (err) {
    console.error('[auth/token]', err.message);
    return res.status(400).json({ error: err.message || 'Giriş doğrulanamadı.' });
  }
});

/**
 * POST /api/auth/retoken
 * Sessiz token yenileme: ssid cookie ile veya link ile.
 */
app.post('/api/auth/retoken', async (req, res) => {
  const { tokenInput } = req.body;
  const currentAuth = req.session.auth;

  // Önce ssid ile sessiz yenileme dene
  if (currentAuth?.ssid) {
    try {
      const refreshed = await reauthWithSsid(currentAuth.ssid, currentAuth.serializedJar);
      if (refreshed) {
        saveAuthToSession(req, refreshed);
        return res.json({ success: true, player: { username: refreshed.username, tag: refreshed.tag } });
      }
    } catch (e) {
      console.warn('[retoken] ssid reauth başarısız:', e.message);
    }
  }

  // ssid yoksa veya başarısızsa, saved token link ile dene
  if (tokenInput) {
    try {
      const authData = await authenticateWithToken(tokenInput);
      saveAuthToSession(req, authData);
      return res.json({ success: true, player: { username: authData.username, tag: authData.tag } });
    } catch (err) {
      return res.status(401).json({ error: 'Token süresi dolmuş.', code: 'token_expired' });
    }
  }

  return res.status(401).json({ error: 'Yenileme başarısız.', code: 'reauth_failed' });
});

/**
 * GET /api/store
 * Token süresi dolmuşsa ssid ile otomatik yeniler.
 */
app.get('/api/store', requireAuth, async (req, res) => {
  try {
    const { accessToken, entitlementToken, puuid, shard } = req.session.auth;
    const store = await getStore(accessToken, entitlementToken, puuid, shard);
    return res.json(store);
  } catch (err) {
    console.error('[store]', err.message);

    if (err.response?.status === 401) {
      // Token öldü — ssid varsa sessiz yenile
      const { ssid, serializedJar, username, tag } = req.session.auth;
      if (ssid) {
        try {
          const refreshed = await reauthWithSsid(ssid, serializedJar);
          if (refreshed) {
            saveAuthToSession(req, refreshed);
            // Bir kez daha dene
            const store = await getStore(
              refreshed.accessToken,
              refreshed.entitlementToken,
              refreshed.puuid,
              refreshed.shard
            );
            return res.json(store);
          }
        } catch (e) {
          console.warn('[store] ssid reauth sonrası store hatası:', e.message);
        }
      }

      req.session.auth = null;
      return res.status(401).json({ error: 'Token süresi doldu.', code: 'token_expired' });
    }

    return res.status(500).json({ error: 'Mağaza verileri alınamadı. Lütfen tekrar dene.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🎮  ValStore running → http://localhost:${PORT}`);
});
