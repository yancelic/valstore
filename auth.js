/**
 * auth.js — Valorant Auth via Direct Token / Redirect URL
 */

const axios = require('axios');

const CLIENT_PLATFORM = Buffer.from(
  JSON.stringify({
    platformType: 'PC',
    platformOS: 'Windows',
    platformOSVersion: '10.0.19042.1.256.64bit',
    platformChipset: 'Unknown',
  })
).toString('base64');

const STORE_USER_AGENT = 'ShooterGame/13 Windows/10.0.19043.1.256.64bit';

// Official Riot Auth URL for Valorant Web Client
const RIOT_AUTH_URL =
  'https://auth.riotgames.com/authorize' +
  '?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in' +
  '&client_id=play-valorant-web-prod' +
  '&response_type=token%20id_token' +
  '&scope=account%20openid' +
  '&nonce=1';

/** Extract access_token and id_token from pasted URL or raw token string */
function extractTokens(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Lütfen yönlendirme linkini veya tokenı yapıştır.');
  }

  const text = input.trim();

  // Guard against oversized payload (DDoS / Memory exhaustion)
  if (text.length > 4096) {
    throw new Error('Girdi boyutu sınırı aşıldı.');
  }

  let search = text;
  if (text.includes('#')) {
    search = text.slice(text.indexOf('#') + 1);
  } else if (text.includes('?')) {
    search = text.slice(text.indexOf('?') + 1);
  }

  const params = new URLSearchParams(search);
  const rawAccess = params.get('access_token');
  const accessToken = rawAccess || (text.startsWith('ey') ? text : null);
  const idToken = params.get('id_token') || accessToken;

  // Validate JWT / token format (only allowed base64url characters)
  const tokenRegex = /^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;
  if (!accessToken || (!tokenRegex.test(accessToken) && accessToken.length < 20)) {
    throw new Error('Geçersiz link veya token. Lütfen Riot linkini eksiksiz kopyalayınız.');
  }

  return { accessToken, idToken };
}

/** Get entitlement token using access token */
async function getEntitlementToken(accessToken) {
  const res = await axios.post(
    'https://entitlements.auth.riotgames.com/api/token/v1',
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );
  return res.data.entitlements_token;
}

/** Get PAS token if available */
async function getPasToken(accessToken) {
  try {
    const res = await axios.get('https://auth.riotgames.com/pas/v1/service/tokens', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 6000,
    });
    return res.data?.token || res.data;
  } catch {
    return null;
  }
}

/** Get player PUUID and Riot username */
async function getUserInfo(accessToken) {
  const res = await axios.get('https://auth.riotgames.com/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });
  return {
    puuid: res.data.sub,
    username: res.data.acct?.game_name || res.data.username || 'Oyuncu',
    tag: res.data.acct?.tag_line || '',
  };
}

/** Determine player region/shard */
async function getShard(accessToken, idToken) {
  try {
    const res = await axios.put(
      'https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant',
      { id_token: idToken },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      }
    );
    const affinity = (res.data.affinities?.live || '').toLowerCase();
    if (['eu', 'tr', 'ru', 'eune', 'euw'].includes(affinity)) return 'eu';
    if (['na', 'latam', 'br'].includes(affinity)) return 'na';
    if (['ap', 'sea', 'oce'].includes(affinity)) return 'ap';
    if (['kr', 'ko'].includes(affinity)) return 'kr';
    return 'eu';
  } catch (err) {
    return 'eu';
  }
}

/** Validate pasted URL/token and obtain full player session */
async function authenticateWithToken(tokenInput) {
  const { accessToken, idToken } = extractTokens(tokenInput);
  
  const [entitlementToken, pasToken, userInfo, shard] = await Promise.all([
    getEntitlementToken(accessToken),
    getPasToken(accessToken),
    getUserInfo(accessToken),
    getShard(accessToken, idToken),
  ]);

  return {
    accessToken,
    entitlementToken,
    pasToken,
    puuid: userInfo.puuid,
    username: userInfo.username,
    tag: userInfo.tag,
    shard,
  };
}

/** Fetch current Valorant client version */
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
  extractTokens,
  authenticateWithToken,
  getClientVersion,
  CLIENT_PLATFORM,
  STORE_USER_AGENT,
};
