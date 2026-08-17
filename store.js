/**
 * store.js — Valorant Storefront Fetcher
 * Fetches daily store offers and enriches them with skin metadata
 * from the public valorant-api.com API.
 */

const axios = require('axios');
const { getClientVersion, CLIENT_PLATFORM } = require('./auth');

const STORE_USER_AGENT = 'ShooterGame/13 Windows/10.0.19043.1.256.64bit';

// VP currency UUID (Valorant Points)
const VP_UUID = '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741';

// In-memory caches to avoid repeated valorant-api.com requests
let cachedClientVersion = null;
const skinCache = new Map();
const tierCache = new Map();

async function getCachedClientVersion() {
  if (!cachedClientVersion) {
    cachedClientVersion = await getClientVersion();
  }
  return cachedClientVersion;
}

/** Get skin metadata (name, image, tier) from valorant-api.com */
async function getSkinLevel(uuid) {
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
    const fallback = { uuid, name: 'Unknown Skin', image: null, contentTierUuid: null };
    skinCache.set(uuid, fallback);
    return fallback;
  }
}

/** Get content tier info (Select, Deluxe, Premium, Ultra, Exclusive) */
async function getContentTier(uuid) {
  if (!uuid) return null;
  if (tierCache.has(uuid)) return tierCache.get(uuid);

  try {
    const res = await axios.get(
      `https://valorant-api.com/v1/contenttiers/${uuid}`,
      { timeout: 8000 }
    );
    const tier = res.data.data;
    // highlightColor is RGBA hex like "0F4C5C99" — take first 6 chars for RGB
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

/**
 * Fetch the player's current daily storefront.
 * Returns enriched skin data with names, images, prices, and tier info.
 */
async function getStore(accessToken, entitlementToken, puuid, shard) {
  const clientVersion = await getCachedClientVersion();

  const res = await axios.get(
    `https://pd.${shard}.a.pvp.net/store/v2/storefront/${puuid}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Riot-Entitlements-JWT': entitlementToken,
        'X-Riot-ClientVersion': clientVersion,
        'X-Riot-ClientPlatform': CLIENT_PLATFORM,
        'User-Agent': STORE_USER_AGENT,
      },
      timeout: 10000,
    }
  );

  const layout = res.data.SkinsPanelLayout;
  const offers = layout.SingleItemStoreOffers;
  const remainingSeconds = layout.SingleItemOffersRemainingDurationInSeconds;

  // Enrich all 4 skins in parallel
  const skins = await Promise.all(
    offers.map(async (offer) => {
      const skinInfo = await getSkinLevel(offer.OfferID);
      const tier = await getContentTier(skinInfo.contentTierUuid);
      return {
        uuid: skinInfo.uuid,
        name: skinInfo.name,
        image: skinInfo.image,
        price: offer.Cost[VP_UUID] ?? 0,
        tier: tier ?? { name: 'Standard', color: '#FFFFFF', icon: null, rank: 0 },
      };
    })
  );

  return {
    skins,
    remainingSeconds,
    refreshAt: new Date(Date.now() + remainingSeconds * 1000).toISOString(),
  };
}

module.exports = { getStore };
