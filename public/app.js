/**
 * app.js — ValStore Tactical Manifest Controller
 */

'use strict';

const STORAGE_KEY = 'valstore_auth_token';

// ── View System ──────────────────────────────────────────────────────────────

const views = {
  login: document.getElementById('view-login'),
  store: document.getElementById('view-store'),
};

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) el.hidden = key !== name;
  });
  window.scrollTo(0, 0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function setLoading(btn, loading) {
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled = loading;
  if (text) text.hidden = loading;
  if (spinner) spinner.hidden = !loading;
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function clearError(el) {
  if (!el) return;
  el.textContent = '';
  el.hidden = true;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'İşlem başarısız'), { code: data.code });
  return data;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Login / Token View ───────────────────────────────────────────────────────

const riotLoginLink      = document.getElementById('riot-login-link');
const tokenForm          = document.getElementById('token-form');
const tokenInput         = document.getElementById('token-input');
const tokenBtn           = document.getElementById('token-btn');
const tokenError         = document.getElementById('token-error');
const linkExpiryNotice   = document.getElementById('link-expiry-notice');
const playerNameEl       = document.getElementById('player-name');

async function setupLoginView() {
  try {
    const res = await api('GET', '/api/auth/url');
    if (res.url && riotLoginLink) riotLoginLink.href = res.url;
  } catch {
    if (riotLoginLink) {
      riotLoginLink.href =
        'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&scope=account%20openid&nonce=1';
    }
  }
}

tokenForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError(tokenError);
  const tokenVal = tokenInput.value.trim();
  if (!tokenVal) return;

  setLoading(tokenBtn, true);
  try {
    const data = await api('POST', '/api/auth/token', { tokenInput: tokenVal });
    localStorage.setItem(STORAGE_KEY, tokenVal);
    if (linkExpiryNotice) linkExpiryNotice.hidden = true;
    onLoginSuccess(data.player);
    tokenForm.reset();
  } catch (err) {
    showError(tokenError, err.message);
  } finally {
    setLoading(tokenBtn, false);
  }
});

function onLoginSuccess(player) {
  if (player && playerNameEl) {
    playerNameEl.textContent = `${player.username.toUpperCase()} #${player.tag || ''}`;
  }
  showView('store');
  loadStore();
}

// ── Storefront ────────────────────────────────────────────────────────────────

const skinsGrid    = document.getElementById('skins-grid');
const storeLoading = document.getElementById('store-loading');
const timerDisplay = document.getElementById('timer-display');
const logoutBtn    = document.getElementById('logout-btn');
const walletBar    = document.getElementById('wallet-bar');
const walletVp     = document.getElementById('wallet-vp');
const walletRp     = document.getElementById('wallet-rp');

let timerInterval = null;
let refreshAt     = null;

function formatCountdown(seconds) {
  if (seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  if (!refreshAt)    return;

  function tick() {
    const remaining = Math.max(0, Math.floor((new Date(refreshAt) - Date.now()) / 1000));
    if (timerDisplay) timerDisplay.textContent = formatCountdown(remaining);
    if (remaining === 0) {
      clearInterval(timerInterval);
      if (timerDisplay) timerDisplay.textContent = '00:00:00';
      setTimeout(loadStore, 3000);
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function buildOrdinanceCard(skin, index) {
  const slotNum  = String(index + 1).padStart(2, '0');
  const tierName = skin.tier?.name || 'STANDART';

  const imgHTML = skin.image
    ? `<img class="ordinance-image" src="${skin.image}" alt="${escapeHTML(skin.name)}" loading="lazy" decoding="async"/>`
    : `<div class="ordinance-image no-img">[GÖRSEL BULUNAMADI]</div>`;

  return `
    <article class="ordinance-card" data-slot="${slotNum}">
      <div class="ordinance-head">
        <span class="slot-tag">SLOT // ${slotNum}</span>
        <span class="tier-tag">${escapeHTML(tierName)}</span>
      </div>
      <div class="ordinance-visual">${imgHTML}</div>
      <div class="ordinance-data">
        <div class="ordinance-name-group">
          <span class="data-sub">SİLAH</span>
          <span class="ordinance-name" title="${escapeHTML(skin.name)}">${escapeHTML(skin.name)}</span>
        </div>
        <div class="ordinance-cost-group">
          <span class="data-sub">FİYAT</span>
          <div class="ordinance-price">
            ${skin.price.toLocaleString('tr-TR')}
            <span class="price-unit">VP</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

async function loadStore() {
  if (storeLoading) storeLoading.hidden = false;
  if (skinsGrid) skinsGrid.innerHTML = '';
  if (timerInterval) clearInterval(timerInterval);

  try {
    const data = await api('GET', '/api/store');
    refreshAt = data.refreshAt;

    if (data.wallet && walletBar) {
      if (data.wallet.vp !== null) {
        if (walletVp) walletVp.textContent = data.wallet.vp.toLocaleString('tr-TR');
        walletBar.hidden = false;
      }
      if (data.wallet.radianite !== null && walletRp) {
        walletRp.textContent = data.wallet.radianite.toLocaleString('tr-TR');
      }
    }

    if (skinsGrid) {
      skinsGrid.innerHTML = data.skins.map((skin, i) => buildOrdinanceCard(skin, i)).join('');
    }
    startTimer();

    if (window.Motion?.animate) {
      window.Motion.animate(
        '.ordinance-card',
        { opacity: [0, 1], y: [16, 0] },
        { delay: window.Motion.stagger(0.08), duration: 0.35, easing: [0.25, 1, 0.5, 1] }
      );
    }
  } catch (err) {
    // Token süresi dolduysa veya yetkisiz erişimse kullanıcıyı giriş ekranına yönlendir
    if (err.code === 'token_expired' || err.code === 'no_session') {
      localStorage.removeItem(STORAGE_KEY);
      await setupLoginView();
      if (linkExpiryNotice) linkExpiryNotice.hidden = false;
      showView('login');
      return;
    }
    if (skinsGrid) {
      skinsGrid.innerHTML = `
        <div style="grid-column:1/-1;padding:2rem;text-align:center;color:var(--clr-red);">
          [HATA]: ${escapeHTML(err.message || 'Mağaza verileri alınamadı.')}
        </div>`;
    }
  } finally {
    if (storeLoading) storeLoading.hidden = true;
  }
}

logoutBtn?.addEventListener('click', async () => {
  localStorage.removeItem(STORAGE_KEY);
  try { await api('POST', '/api/auth/logout'); } catch {}
  if (timerInterval) clearInterval(timerInterval);
  if (skinsGrid) skinsGrid.innerHTML = '';
  if (walletBar) walletBar.hidden = true;
  await setupLoginView();
  if (linkExpiryNotice) linkExpiryNotice.hidden = true;
  showView('login');
});

// ── PWA Install ───────────────────────────────────────────────────────────────

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.querySelectorAll('.install-banner').forEach((b) => (b.hidden = false));
});

document.querySelectorAll('[id^="install-btn"]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.querySelectorAll('.install-banner').forEach((b) => (b.hidden = true));
  });
});

window.addEventListener('appinstalled', () => {
  document.querySelectorAll('.install-banner').forEach((b) => (b.hidden = true));
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  await setupLoginView();

  try {
    const status = await api('GET', '/api/status');
    if (status.isAuthenticated) {
      if (status.player && playerNameEl) {
        playerNameEl.textContent = `${status.player.username.toUpperCase()} #${status.player.tag || ''}`;
      }
      showView('store');
      loadStore();
      return;
    }
  } catch {}

  const savedToken = localStorage.getItem(STORAGE_KEY);
  if (savedToken) {
    try {
      if (storeLoading) storeLoading.hidden = false;
      const data = await api('POST', '/api/auth/token', { tokenInput: savedToken });
      onLoginSuccess(data.player);
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      if (storeLoading) storeLoading.hidden = true;
    }
  }

  showView('login');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

init();
