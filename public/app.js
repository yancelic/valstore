/**
 * app.js — ValStore Tactical Manifest Controller
 * Powered by motion.dev animation library and persistent local state.
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
  const text    = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled  = loading;
  if (text)    text.hidden = loading;
  if (spinner) spinner.hidden = !loading;
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

function clearError(el) {
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

// ── Login / Token View ───────────────────────────────────────────────────────

const riotLoginLink = document.getElementById('riot-login-link');
const tokenForm     = document.getElementById('token-form');
const tokenInput    = document.getElementById('token-input');
const tokenBtn      = document.getElementById('token-btn');
const tokenError    = document.getElementById('token-error');
const playerNameEl  = document.getElementById('player-name');

async function setupLoginView() {
  try {
    const res = await api('GET', '/api/auth/url');
    if (res.url && riotLoginLink) riotLoginLink.href = res.url;
  } catch (e) {
    if (riotLoginLink) {
      riotLoginLink.href =
        'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&scope=account%20openid&nonce=1';
    }
  }
}

async function loginWithToken(tokenVal) {
  const data = await api('POST', '/api/auth/token', { tokenInput: tokenVal });
  localStorage.setItem(STORAGE_KEY, tokenVal);

  if (data.player && playerNameEl) {
    playerNameEl.textContent = `${data.player.username.toUpperCase()} #${data.player.tag || ''}`;
  }
  showView('store');
  loadStore();
  return data;
}

tokenForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError(tokenError);
  const tokenVal = tokenInput.value.trim();
  if (!tokenVal) return;

  setLoading(tokenBtn, true);
  try {
    await loginWithToken(tokenVal);
    tokenForm.reset();
  } catch (err) {
    showError(tokenError, err.message);
  } finally {
    setLoading(tokenBtn, false);
  }
});

// ── Storefront View ──────────────────────────────────────────────────────────

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
    timerDisplay.textContent = formatCountdown(remaining);
    if (remaining === 0) {
      clearInterval(timerInterval);
      timerDisplay.textContent = '00:00:00 [GÜNCELLENDİ]';
      setTimeout(loadStore, 3000);
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildOrdinanceCard(skin, index) {
  const slotNum = String(index + 1).padStart(2, '0');
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
      <div class="ordinance-visual">
        ${imgHTML}
      </div>
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
  storeLoading.hidden = false;
  skinsGrid.innerHTML = '';
  if (timerInterval) clearInterval(timerInterval);

  try {
    const data = await api('GET', '/api/store');
    refreshAt = data.refreshAt;

    // Render Balances
    if (data.wallet && walletBar) {
      if (data.wallet.vp !== null) {
        walletVp.textContent = data.wallet.vp.toLocaleString('tr-TR');
        walletBar.hidden = false;
      }
      if (data.wallet.radianite !== null) {
        walletRp.textContent = data.wallet.radianite.toLocaleString('tr-TR');
      }
    }

    // Populate grid
    skinsGrid.innerHTML = data.skins.map((skin, i) => buildOrdinanceCard(skin, i)).join('');
    startTimer();

    // Trigger Motion.dev card entry animation
    if (window.Motion && window.Motion.animate) {
      window.Motion.animate(
        '.ordinance-card',
        { opacity: [0, 1], y: [16, 0] },
        { delay: window.Motion.stagger(0.08), duration: 0.35, easing: [0.25, 1, 0.5, 1] }
      );
    }
  } catch (err) {
    if (err.code === 'session_expired') {
      const savedToken = localStorage.getItem(STORAGE_KEY);
      if (savedToken) {
        try {
          await loginWithToken(savedToken);
          return;
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setupLoginView();
      showView('login');
      return;
    }
    skinsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 3rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem;">
        <span style="color: var(--clr-red); font-weight: 700;">[SİSTEM UYARISI]: ${escapeHTML(err.message || 'Mühimmat verisi alınamadı.')}</span>
        <button onclick="loadStore()" class="docket-btn-submit" style="max-width: 200px; padding: 0.6rem 1rem; cursor: pointer;">
          <span class="btn-text">Tekrar Dene ↻</span>
        </button>
      </div>
    `;
  } finally {
    storeLoading.hidden = true;
  }
}

logoutBtn.addEventListener('click', async () => {
  localStorage.removeItem(STORAGE_KEY);
  try { await api('POST', '/api/auth/logout'); } catch {}
  if (timerInterval) clearInterval(timerInterval);
  skinsGrid.innerHTML = '';
  walletBar.hidden = true;
  setupLoginView();
  showView('login');
});

// ── Boot & Recovery ──────────────────────────────────────────────────────────

async function init() {
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
      storeLoading.hidden = false;
      await loginWithToken(savedToken);
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      storeLoading.hidden = true;
    }
  }

  await setupLoginView();
  showView('login');
}

// ── PWA Installation Controller ───────────────────────────────────────────

let deferredInstallPrompt = null;
const installBannerLogin = document.getElementById('install-banner-login');
const installBtnLogin   = document.getElementById('install-btn-login');
const installBtnFooter  = document.getElementById('install-btn-footer');
const installModal      = document.getElementById('install-modal');
const installModalClose = document.getElementById('install-modal-close');
const installModalOk    = document.getElementById('install-modal-ok');

const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function showInstallUI() {
  if (isStandalone) return;
  if (installBannerLogin) installBannerLogin.hidden = false;
  if (installBtnFooter) installBtnFooter.hidden = false;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallUI();
});

// For iOS / browsers where beforeinstallprompt doesn't fire, show install button on mobile
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
if (isMobile && !isStandalone) {
  showInstallUI();
}

async function handleInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      if (installBannerLogin) installBannerLogin.hidden = true;
      if (installBtnFooter) installBtnFooter.hidden = true;
    }
    deferredInstallPrompt = null;
  } else {
    // Show instruction modal for iOS / manual installation
    if (installModal) installModal.hidden = false;
  }
}

if (installBtnLogin) installBtnLogin.addEventListener('click', handleInstallClick);
if (installBtnFooter) installBtnFooter.addEventListener('click', handleInstallClick);

if (installModalClose) installModalClose.addEventListener('click', () => { installModal.hidden = true; });
if (installModalOk) installModalOk.addEventListener('click', () => { installModal.hidden = true; });
if (installModal) {
  installModal.addEventListener('click', (e) => {
    if (e.target === installModal) installModal.hidden = true;
  });
}

// ── Service Worker ───────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

init();
