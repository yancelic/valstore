/**
 * app.js — ValStore Frontend SPA
 * Handles view routing, API calls, store rendering, and countdown timer.
 */

'use strict';

// ── View management ──────────────────────────────────────────────────────────

const views = {
  invite: document.getElementById('view-invite'),
  login:  document.getElementById('view-login'),
  mfa:    document.getElementById('view-mfa'),
  store:  document.getElementById('view-store'),
};

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  // Scroll to top on view change
  window.scrollTo(0, 0);
}

// ── Button loading state helpers ─────────────────────────────────────────────

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

// ── API helpers ──────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Bir hata oluştu'), { code: data.code });
  return data;
}

// ── Invite view ──────────────────────────────────────────────────────────────

const inviteForm  = document.getElementById('invite-form');
const inviteInput = document.getElementById('invite-input');
const inviteBtn   = document.getElementById('invite-btn');
const inviteError = document.getElementById('invite-error');

inviteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError(inviteError);
  const code = inviteInput.value.trim();
  if (!code) return;

  setLoading(inviteBtn, true);
  try {
    await api('POST', '/api/invite', { code });
    showView('login');
    // Focus username field after transition
    setTimeout(() => usernameInput.focus(), 50);
  } catch (err) {
    showError(inviteError, err.message);
    inviteInput.value = '';
    inviteInput.focus();
  } finally {
    setLoading(inviteBtn, false);
  }
});

// ── Login view ───────────────────────────────────────────────────────────────

const loginForm     = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const passwordToggle = document.getElementById('password-toggle');
const loginBtn      = document.getElementById('login-btn');
const loginError    = document.getElementById('login-error');

// Password show/hide toggle
passwordToggle.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  passwordToggle.setAttribute('aria-label', isPassword ? 'Şifreyi gizle' : 'Şifreyi göster');
  // Swap icon
  const icon = document.getElementById('eye-icon');
  if (isPassword) {
    icon.innerHTML = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    `;
  } else {
    icon.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    `;
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError(loginError);
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) return;

  setLoading(loginBtn, true);
  try {
    const data = await api('POST', '/api/auth/login', { username, password });
    if (data.type === 'mfa') {
      showView('mfa');
      setTimeout(() => mfaInput.focus(), 50);
    } else {
      // Direct success
      loginForm.reset();
      showView('store');
      loadStore();
    }
  } catch (err) {
    showError(loginError, err.message);
    passwordInput.value = '';
    passwordInput.focus();
  } finally {
    setLoading(loginBtn, false);
  }
});

// ── MFA / 2FA view ───────────────────────────────────────────────────────────

const mfaForm    = document.getElementById('mfa-form');
const mfaInput   = document.getElementById('mfa-input');
const mfaBtn     = document.getElementById('mfa-btn');
const mfaError   = document.getElementById('mfa-error');
const mfaBackBtn = document.getElementById('mfa-back-btn');

// Auto-format: only digits
mfaInput.addEventListener('input', () => {
  mfaInput.value = mfaInput.value.replace(/\D/g, '');
});

mfaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError(mfaError);
  const code = mfaInput.value.trim();
  if (!code) return;

  setLoading(mfaBtn, true);
  try {
    await api('POST', '/api/auth/mfa', { code });
    mfaForm.reset();
    showView('store');
    loadStore();
  } catch (err) {
    showError(mfaError, err.message);
    mfaInput.value = '';
    mfaInput.focus();
  } finally {
    setLoading(mfaBtn, false);
  }
});

mfaBackBtn.addEventListener('click', () => {
  clearError(mfaError);
  mfaForm.reset();
  showView('login');
});

// ── Store view ───────────────────────────────────────────────────────────────

const skinsGrid     = document.getElementById('skins-grid');
const storeLoading  = document.getElementById('store-loading');
const storeError    = document.getElementById('store-error');
const storeErrorMsg = document.getElementById('store-error-msg');
const storeRetryBtn = document.getElementById('store-retry-btn');
const timerDisplay  = document.getElementById('timer-display');
const logoutBtn     = document.getElementById('logout-btn');

let timerInterval   = null;
let refreshAt       = null;

/** Format seconds as HH:MM:SS */
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
      timerDisplay.textContent = 'Yenilendi!';
      // Auto-reload store after 5 seconds
      setTimeout(loadStore, 5000);
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

/** Build a VP icon SVG */
function vpIconSVG() {
  return `<svg class="vp-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 2L3 7l7 11 7-11-7-5z" fill="#7a8fa3" stroke="none"/>
  </svg>`;
}

/** Build a single skin card HTML */
function buildSkinCard(skin) {
  const tierColor = skin.tier?.color ?? '#555';
  const tierName  = skin.tier?.name  ?? 'Standard';

  const imgHTML = skin.image
    ? `<img class="skin-image" src="${skin.image}" alt="${escapeHTML(skin.name)}" loading="lazy" decoding="async"/>`
    : `<div class="skin-no-image">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9l4-4 4 4 4-4 4 4"/>
        </svg>
       </div>`;

  return `
    <article class="skin-card" style="--tier-color:${tierColor}">
      <div class="skin-image-wrap">${imgHTML}</div>
      <div class="skin-info">
        <div class="skin-tier-badge">
          <span class="skin-tier-dot"></span>
          ${escapeHTML(tierName)}
        </div>
        <p class="skin-name">${escapeHTML(skin.name)}</p>
        <div class="skin-price">
          ${vpIconSVG()}
          ${skin.price.toLocaleString('tr-TR')}
        </div>
      </div>
    </article>
  `;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadStore() {
  // Show loading, clear error + grid
  storeLoading.classList.remove('hidden');
  storeError.hidden = true;
  skinsGrid.innerHTML = '';
  if (timerInterval) clearInterval(timerInterval);

  try {
    const data = await api('GET', '/api/store');
    refreshAt = data.refreshAt;

    // Render cards
    skinsGrid.innerHTML = data.skins.map(buildSkinCard).join('');

    // Start countdown
    startTimer();

    // Fade out loading overlay
    storeLoading.classList.add('hidden');
    setTimeout(() => { storeLoading.style.display = 'none'; }, 300);
  } catch (err) {
    storeLoading.classList.add('hidden');
    setTimeout(() => { storeLoading.style.display = 'none'; }, 300);

    if (err.code === 'session_expired') {
      // Force re-login
      showView('login');
      return;
    }

    storeError.hidden = false;
    storeErrorMsg.textContent = err.message;
  }
}

storeRetryBtn.addEventListener('click', loadStore);

logoutBtn.addEventListener('click', async () => {
  try {
    await api('POST', '/api/auth/logout');
  } catch { /* ignore */ }
  if (timerInterval) clearInterval(timerInterval);
  skinsGrid.innerHTML = '';
  storeLoading.style.display = '';
  storeLoading.classList.remove('hidden');
  showView('invite');
});

// ── Boot: check session state ────────────────────────────────────────────────

async function init() {
  try {
    const status = await api('GET', '/api/status');
    if (status.isAuthenticated) {
      showView('store');
      loadStore();
    } else if (status.pendingMFA) {
      showView('mfa');
      setTimeout(() => mfaInput.focus(), 50);
    } else if (status.hasInvite) {
      showView('login');
      setTimeout(() => usernameInput.focus(), 50);
    } else {
      showView('invite');
      setTimeout(() => inviteInput.focus(), 50);
    }
  } catch {
    // If status check fails, show invite screen
    showView('invite');
  }
}

// ── Service Worker registration ──────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ── Start ────────────────────────────────────────────────────────────────────
init();
