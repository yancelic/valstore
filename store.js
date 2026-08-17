/**
 * store.js — Valorant Storefront Fetcher
 */

const axios = require('axios');

const VP_UUID = '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741';
const RADIANITE_UUID = 'e59aa87c-4cbf-517a-5983-6e81511be0b0';

const CLIENT_PLATFORM =
  'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';

const skinCache = new Map();
const tierCache = new Map();
let cachedClientVersion = null;

async function getClientVersion() {
  if (cachedClientVersion) return cachedClientVersion;
  try {
    const res = await axios.get('https://valorant-api.com/v1/version', { timeout: 5000 });
    cachedClientVersion = res.data.data.riotClientVersion;
  } catch {
    cachedClientVersion = 'release-13.02-shipping-17-5277781';
  }
  return cachedClientVersion;
}

/** Get skin metadata from valorant-api.com */
async function getSkinLevel(uuid) {
  if (!uuid) return { uuid: '', name: 'Bilinmeyen Skin', image: null, contentTierUuid: null };
  if (skinCache.has(uuid)) return skinCache.get(uuid);

  try {
    const res = await axios.get(
      `https://valorant-api.com/v1/weapons/skinlevels/${uuid}`,
      { timeout: 8000 }
    );
    const skin = res.data.data;
    const info = {
      uuid,
      name: skin.displayName,
      image: skin.displayIcon,
      contentTierUuid: skin.contentTierUuid ?? null,
    };
    skinCache.set(uuid, info);
    return info;
  } catch {
    const fallback = { uuid, name: 'Valorant Skin', image: null, contentTierUuid: null };
    skinCache.set(uuid, fallback);
    return fallback;
  }
}

/** Get content tier info */
async function getContentTier(uuid) {
  if (!uuid) return null;
  if (tierCache.has(uuid)) return tierCache.get(uuid);

  try {
    const res = await axios.get(
      `https://valorant-api.com/v1/contenttiers/${uuid}`,
      { timeout: 8000 }
    );
    const tier = res.data.data;
    const rawColor = tier.highlightColor ?? 'FFFFFF';
    const info = {
      name: tier.displayName,
      color: '#' + rawColor.slice(0, 6),
      icon: tier.displayIcon,
      rank: tier.rank ?? 0,
    };
    tierCache.set(uuid, info);
    return info;
  } catch {
    return null;
  }
}

/** Get player wallet balance (VP & Radianite) */
async function getWallet(accessToken, entitlementToken, puuid, shard) {
  try {
    const res = await axios.get(`https://pd.${shard || 'eu'}.a.pvp.net/store/v1/wallet/${puuid}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Riot-Entitlements-JWT': entitlementToken,
      },
      timeout: 6000,
    });
    const balances = res.data.Balances || {};
    return {
      vp: balances[VP_UUID] ?? 0,
      radianite: balances[RADIANITE_UUID] ?? 0,
    };
  } catch {
    return { vp: null, radianite: null };
  }
}

/**
 * Fetch daily store offers and wallet balances
 */
async function getStore(accessToken, entitlementToken, puuid, shard) {
  const clientVersion = await getClientVersion();
  const reg = shard || 'eu';
  const url = `https://pd.${reg}.a.pvp.net/store/v3/storefront/${puuid}`;

  const [storeRes, wallet] = await Promise.all([
    axios.post(
      url,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Riot-Entitlements-JWT': entitlementToken,
          'X-Riot-ClientPlatform': CLIENT_PLATFORM,
          'X-Riot-ClientVersion': clientVersion,
        },
        timeout: 10000,
      }
    ),
    getWallet(accessToken, entitlementToken, puuid, shard),
  ]);

  const layout = storeRes.data.SkinsPanelLayout || {};
  const offers = layout.SingleItemStoreOffers || [];
  const remainingSeconds = layout.SingleItemOffersRemainingDurationInSeconds || 86400;

  // Enrich all 4 skins in parallel
  const skins = await Promise.all(
    offers.map(async (offer) => {
      const skinUuid = typeof offer === 'string' ? offer : (offer.OfferID || offer.Item?.ItemID || '');
      const skinInfo = await getSkinLevel(skinUuid);
      const tier = await getContentTier(skinInfo.contentTierUuid);
      const cost = offer.Cost ? (offer.Cost[VP_UUID] ?? Object.values(offer.Cost)[0] ?? 0) : 0;

      return {
        uuid: skinInfo.uuid,
        name: skinInfo.name,
        image: skinInfo.image,
        price: cost,
        tier: tier ?? { name: 'Edition', color: '#FF4655', icon: null, rank: 0 },
      };
    })
  );

  return {
    skins,
    wallet,
    remainingSeconds,
    refreshAt: new Date(Date.now() + remainingSeconds * 1000).toISOString(),
  };
}

module.exports = { getStore };
