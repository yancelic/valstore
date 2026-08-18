/**
 * auth.js — Valorant Authentication
 *
 * İki giriş yöntemi destekler:
 * 1. Kullanıcı adı + şifre (credentials) — şifre kaydedilmez, ssid cookie saklanır
 * 2. Riot OAuth redirect linki yapıştırma
 */

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const CLIENT_PLATFORM = Buffer.from(
  JSON.stringify({
    platformType: 'PC',
    platformOS: 'Windows',
    platformOSVersion: '10.0.19042.1.256.64bit',
    platformChipset: 'Unknown',
  })
).toString('base64');

const RIOT_CLIENT_UA =
  'RiotClient/75.0.1.2189.4094 riot-client (Windows; 10;;Professional, x64)';

const RIOT_AUTH_URL =
  'https://auth.riotgames.com/authorize' +
  '?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in' +
  '&client_id=play-valorant-web-prod' +
  '&response_type=token%20id_token' +
  '&scope=account%20openid' +
  '&nonce=1';

// ── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

/** Cookie-enabled axios client oluşturur */
function makeRiotClient(jar) {
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 15000,
      headers: {
        'User-Agent': RIOT_CLIENT_UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Content-Type': 'application/json',
        Origin: 'https://auth.riotgames.com',
        Referer: 'https://auth.riotgames.com/',
      },
    })
  );
}

/** URL veya ham token'dan access_token + id_token çıkarır */
function extractTokens(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Lütfen yönlendirme linkini veya tokenı yapıştır.');
  }
  const text = input.trim();
  if (text.length > 4096) throw new Error('Girdi boyutu sınırı aşıldı.');

  let search = text;
  if (text.includes('#')) search = text.slice(text.indexOf('#') + 1);
  else if (text.includes('?')) search = text.slice(text.indexOf('?') + 1);

  const params = new URLSearchParams(search);
  const rawAccess = params.get('access_token');
  const accessToken = rawAccess || (text.startsWith('ey') ? text : null);
  const idToken = params.get('id_token') || accessToken;

  const tokenRegex = /^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;
  if (!accessToken || (!tokenRegex.test(accessToken) && accessToken.length < 20)) {
    throw new Error('Geçersiz link veya token. Riot linkini tam kopyaladığınızdan emin olun.');
  }

  return { accessToken, idToken };
}

/** Entitlement token alır */
async function getEntitlementToken(accessToken) {
  const res = await axios.post(
    'https://entitlements.auth.riotgames.com/api/token/v1',
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': RIOT_CLIENT_UA,
      },
      timeout: 10000,
    }
  );
  return res.data.entitlements_token;
}

/** Kullanıcı PUUID ve Riot adını alır */
async function getUserInfo(accessToken) {
  const res = await axios.get('https://auth.riotgames.com/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': RIOT_CLIENT_UA,
    },
    timeout: 10000,
  });
  return {
    puuid: res.data.sub,
    username: res.data.acct?.game_name || res.data.username || 'Oyuncu',
    tag: res.data.acct?.tag_line || '',
  };
}

/** Oyuncunun bölgesini/shard'ını belirler */
async function getShard(accessToken, idToken) {
  try {
    const res = await axios.put(
      'https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant',
      { id_token: idToken },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': RIOT_CLIENT_UA,
        },
        timeout: 10000,
      }
    );
    const affinity = (res.data.affinities?.live || '').toLowerCase();
    if (['eu', 'tr', 'ru', 'eune', 'euw'].includes(affinity)) return 'eu';
    if (['na', 'latam', 'br'].includes(affinity)) return 'na';
    if (['ap', 'sea', 'oce'].includes(affinity)) return 'ap';
    if (['kr', 'ko'].includes(affinity)) return 'kr';
    return 'eu';
  } catch {
    return 'eu';
  }
}

/** Ortak session oluşturma: token'lardan tam auth verisi üretir */
async function buildAuthSession(accessToken, idToken, ssid = null, serializedJar = null) {
  const [entitlementToken, userInfo, shard] = await Promise.all([
    getEntitlementToken(accessToken),
    getUserInfo(accessToken),
    getShard(accessToken, idToken),
  ]);

  return {
    accessToken,
    idToken,
    entitlementToken,
    ssid,
    serializedJar,
    puuid: userInfo.puuid,
    username: userInfo.username,
    tag: userInfo.tag,
    shard,
  };
}

// ── Yöntem 1: Kullanıcı adı + şifre ─────────────────────────────────────────

/**
 * Riot kullanıcı adı ve şifresiyle giriş yapar.
 * Şifre bu fonksiyon dışına çıkmaz; yalnızca ssid cookie saklanır.
 *
 * @returns auth oturum nesnesi | { mfaRequired: true, jar } (2FA gerekiyorsa)
 */
async function authenticateWithCredentials(username, password) {
  const jar = new CookieJar();
  const client = makeRiotClient(jar);

  // Adım 1: Riot Client Auth oturumu başlat
  await client.post('https://auth.riotgames.com/api/v1/authorization', {
    client_id: 'riot-client',
    nonce: '1',
    redirect_uri: 'http://localhost/redirect',
    response_type: 'token id_token',
    scope: 'openid link ban lol_region account',
  });

  // Adım 2: Kimlik bilgilerini gönder
  const authRes = await client.put('https://auth.riotgames.com/api/v1/authorization', {
    type: 'auth',
    username,
    password,
    remember: true,
    language: 'en_US',
  });

  const data = authRes.data;

  if (data.type === 'response') {
    const { accessToken, idToken } = extractTokens(data.response.parameters.uri);
    const cookies = await jar.getCookies('https://auth.riotgames.com');
    const ssid = cookies.find((c) => c.key === 'ssid')?.value || null;
    const serializedJar = JSON.stringify(jar.toJSON());
    return buildAuthSession(accessToken, idToken, ssid, serializedJar);
  }

  if (data.type === 'multifactor') {
    // 2FA gerekiyor — jar'ı serileştirip geri döndür
    return {
      mfaRequired: true,
      mfaMethod: data.multifactor?.method || 'email',
      mfaEmail: data.multifactor?.email || '',
      serializedJar: JSON.stringify(jar.toJSON()),
    };
  }

  if (data.type === 'auth' && data.error) {
    if (data.error === 'auth_failure') {
      throw new Error('Kullanıcı adı veya şifre hatalı. (Oyundaki takma adınız değil, Riot Launcher\'a girerken yazdığınız asıl Giriş Adınız olmalıdır)');
    }
    if (data.error === 'rate_limited') {
      throw new Error('Çok fazla deneme yapıldı. Lütfen birkaç dakika bekleyin veya "Riot Linki ile" yöntemini kullanın.');
    }
    throw new Error(`Giriş başarısız (${data.error}). Lütfen "Riot Linki ile" yöntemini deneyin.`);
  }

  throw new Error('Giriş başarısız. Lütfen tekrar dene.');
}

/**
 * 2FA kodunu doğrular. serializedJar, önceki aşamadan geliyor.
 */
async function verifyMfaCode(code, serializedJar) {
  const jar = CookieJar.fromJSON(JSON.parse(serializedJar));
  const client = makeRiotClient(jar);

  const mfaRes = await client.put('https://auth.riotgames.com/api/v1/authorization', {
    type: 'multifactor',
    code: String(code).trim(),
    rememberDevice: true,
  });

  const data = mfaRes.data;

  if (data.type === 'response') {
    const { accessToken, idToken } = extractTokens(data.response.parameters.uri);
    const cookies = await jar.getCookies('https://auth.riotgames.com');
    const ssid = cookies.find((c) => c.key === 'ssid')?.value || null;
    const newSerializedJar = JSON.stringify(jar.toJSON());
    return buildAuthSession(accessToken, idToken, ssid, newSerializedJar);
  }

  throw new Error('Geçersiz 2FA kodu. Lütfen tekrar dene.');
}

/**
 * ssid cookie ile sessiz token yenileme.
 * access_token süresi dolduğunda kullanılır.
 */
async function reauthWithSsid(ssid, serializedJar) {
  if (!ssid) return null;

  let jar;
  if (serializedJar) {
    try {
      jar = CookieJar.fromJSON(JSON.parse(serializedJar));
    } catch {
      jar = new CookieJar();
    }
  } else {
    jar = new CookieJar();
    await jar.setCookie(`ssid=${ssid}`, 'https://auth.riotgames.com');
  }

  const client = makeRiotClient(jar);

  try {
    const initRes = await client.post('https://auth.riotgames.com/api/v1/authorization', {
      client_id: 'riot-client',
      nonce: '1',
      redirect_uri: 'http://localhost/redirect',
      response_type: 'token id_token',
      scope: 'openid link ban lol_region account',
    });

    const data = initRes.data;

    if (data.type === 'response') {
      const { accessToken, idToken } = extractTokens(data.response.parameters.uri);
      const cookies = await jar.getCookies('https://auth.riotgames.com');
      const newSsid = cookies.find((c) => c.key === 'ssid')?.value || ssid;
      const newJar = JSON.stringify(jar.toJSON());
      console.log('[auth] ssid ile sessiz yenileme başarılı.');
      return buildAuthSession(accessToken, idToken, newSsid, newJar);
    }

    console.log('[auth] ssid session süresi dolmuş, yeniden giriş gerekiyor.');
    return null;
  } catch (e) {
    console.warn('[auth] ssid reauth hatası:', e.message);
    return null;
  }
}

// ── Yöntem 2: OAuth redirect link ────────────────────────────────────────────

async function authenticateWithToken(tokenInput) {
  const { accessToken, idToken } = extractTokens(tokenInput);
  return buildAuthSession(accessToken, idToken);
}

// ── Valorant API yardımcıları ─────────────────────────────────────────────────

async function getClientVersion() {
  try {
    const res = await axios.get('https://valorant-api.com/v1/version', { timeout: 5000 });
    return res.data.data.riotClientVersion;
  } catch {
    return 'release-13.02-shipping-17-5277781';
  }
}

module.exports = {
  RIOT_AUTH_URL,
  CLIENT_PLATFORM,
  extractTokens,
  authenticateWithCredentials,
  verifyMfaCode,
  reauthWithSsid,
  authenticateWithToken,
  getClientVersion,
};
