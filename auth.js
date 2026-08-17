/**
 * auth.js — Riot RSO Authentication Flow
 * Handles: initial login, 2FA/MFA, cookie-based token refresh
 */

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const AUTH_USER_AGENT =
  'RiotClient/60.0.6.4770705.4749685 rso-auth/2 (Windows;10;;Professional, x64)';

const CLIENT_PLATFORM = Buffer.from(
  JSON.stringify({
    platformType: 'PC',
    platformOS: 'Windows',
    platformOSVersion: '10.0.19042.1.256.64bit',
    platformChipset: 'Unknown',
  })
).toString('base64');

/** Create an axios instance that automatically manages cookies */
function createClient(jar) {
  return wrapper(
    axios.create({
      jar,
      headers: { 'User-Agent': AUTH_USER_AGENT },
      withCredentials: true,
    })
  );
}

/** Fetch current Valorant client version from valorant-api.com */
async function getClientVersion() {
  try {
    const res = await axios.get('https://valorant-api.com/v1/version', {
      timeout: 5000,
    });
    return res.data.data.riotClientVersion;
  } catch {
    // Fallback version — update if things break
    return 'release-09.10-shipping-18-2671381';
  }
}

/** Exchange access token for entitlement token */
async function getEntitlementToken(accessToken) {
  const res = await axios.post(
    'https://entitlements.auth.riotgames.com/api/token/v1',
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': AUTH_USER_AGENT,
      },
    }
  );
  return res.data.entitlements_token;
}

/** Get player PUUID from userinfo endpoint */
async function getUserInfo(accessToken) {
  const res = await axios.get('https://auth.riotgames.com/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': AUTH_USER_AGENT,
    },
  });
  return res.data.sub; // PUUID
}

/** Determine shard (server region) via Riot Geo */
async function getShard(accessToken, idToken) {
  const res = await axios.put(
    'https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant',
    { id_token: idToken },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': AUTH_USER_AGENT,
      },
    }
  );
  return res.data.affinities.live; // e.g. "eu", "na", "ap"
}

/** Extract access_token and id_token from Riot's redirect URI */
function extractTokensFromURI(uri) {
  // URI looks like: https://playvalorant.com/opt_in#access_token=...&id_token=...
  const hashIndex = uri.indexOf('#');
  if (hashIndex === -1) throw new Error('No hash fragment in URI');
  const params = new URLSearchParams(uri.slice(hashIndex + 1));
  const accessToken = params.get('access_token');
  const idToken = params.get('id_token');
  if (!accessToken) throw new Error('No access_token in URI');
  return { accessToken, idToken };
}

/** Complete the auth flow after receiving a redirect URI */
async function finishAuth(jar, uri) {
  const { accessToken, idToken } = extractTokensFromURI(uri);
  const [entitlementToken, puuid, shard] = await Promise.all([
    getEntitlementToken(accessToken),
    getUserInfo(accessToken),
    getShard(accessToken, idToken),
  ]);

  return {
    type: 'response',
    accessToken,
    entitlementToken,
    puuid,
    shard,
    cookieJar: jar.toJSON(), // serialized for session storage
  };
}

/**
 * Start the auth flow with username + password.
 * Returns:
 *   { type: 'response', accessToken, entitlementToken, puuid, shard, cookieJar }
 *   { type: 'multifactor', cookieJar }
 * Throws on bad credentials.
 */
async function startAuth(username, password) {
  const jar = new CookieJar();
  const client = createClient(jar);

  // Step 1: Initialize auth session (sets cookies)
  await client.post('https://auth.riotgames.com/api/v1/authorization', {
    client_id: 'play-valorant-web-prod',
    nonce: '1',
    redirect_uri: 'https://playvalorant.com/opt_in',
    response_type: 'token id_token',
    scope: 'account openid',
  });

  // Step 2: Submit credentials
  const authRes = await client.put(
    'https://auth.riotgames.com/api/v1/authorization',
    {
      type: 'auth',
      username,
      password,
      remember: true,
      language: 'en_US',
    }
  );

  const data = authRes.data;

  if (data.type === 'response') {
    return await finishAuth(jar, data.response.parameters.uri);
  }

  if (data.type === 'multifactor') {
    return {
      type: 'multifactor',
      cookieJar: jar.toJSON(),
    };
  }

  // auth_failure or rate_limited
  const error = new Error(data.error || 'auth_failure');
  error.code = data.error;
  throw error;
}

/**
 * Complete 2FA/MFA verification.
 * Returns: { type: 'response', accessToken, entitlementToken, puuid, shard, cookieJar }
 * Throws on bad code.
 */
async function submitMFA(cookieJarJSON, code) {
  const jar = CookieJar.fromJSON(cookieJarJSON);
  const client = createClient(jar);

  const res = await client.put(
    'https://auth.riotgames.com/api/v1/authorization',
    {
      type: 'multifactor',
      code: String(code).trim(),
      rememberDevice: true,
    }
  );

  const data = res.data;

  if (data.type === 'response') {
    return await finishAuth(jar, data.response.parameters.uri);
  }

  const error = new Error('invalid_mfa_code');
  error.code = 'invalid_mfa_code';
  throw error;
}

/**
 * Silently refresh tokens using stored ssid cookie (no password needed).
 * Returns: { accessToken, entitlementToken, cookieJar }
 * Throws if cookie has expired (user must log in again).
 */
async function refreshTokens(cookieJarJSON) {
  const jar = CookieJar.fromJSON(cookieJarJSON);
  const client = createClient(jar);

  const res = await client.get(
    'https://auth.riotgames.com/authorize' +
      '?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in' +
      '&client_id=play-valorant-web-prod' +
      '&response_type=token%20id_token' +
      '&scope=account%20openid' +
      '&nonce=1',
    {
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
    }
  );

  const location = res.headers['location'];
  if (location?.includes('access_token')) {
    const { accessToken } = extractTokensFromURI(location);
    const entitlementToken = await getEntitlementToken(accessToken);
    return { accessToken, entitlementToken, cookieJar: jar.toJSON() };
  }

  const error = new Error('cookie_expired');
  error.code = 'cookie_expired';
  throw error;
}

module.exports = {
  startAuth,
  submitMFA,
  refreshTokens,
  getClientVersion,
  CLIENT_PLATFORM,
};
