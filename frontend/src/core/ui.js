import { $, escapeHtml } from './dom.js';

// ── Toast notifications (success, error, info, warning) ──
export function showToast(message, type = 'success') {
  const container = $('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icons[type] || '✅'}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  // Animate out
  const duration = type === 'error' ? 4000 : 2800;
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

export function showErrorToast(message) { showToast(message, 'error'); }
export function showInfoToast(message)  { showToast(message, 'info'); }
export function showWarnToast(message)  { showToast(message, 'warning'); }

// ── Screen visibility ──
export function setActiveScreen(isAuthed) {
  const auth = $('auth-screen');
  const app  = $('app-screen');
  if (auth) {
    auth.classList.toggle('hidden', isAuthed);
    auth.classList.toggle('active', !isAuthed);
  }
  if (app) {
    app.classList.toggle('hidden', !isAuthed);
    app.classList.toggle('active', isAuthed);
  }
}

// ── Button busy state ──
export function setBusy(buttonId, busy) {
  const btn = $(buttonId);
  if (!btn) return;
  btn.disabled = busy;
  const loader = btn.querySelector('.btn-loader');
  const text   = btn.querySelector('.btn-text');
  if (loader) loader.classList.toggle('hidden', !busy);
  if (text)   text.style.opacity = busy ? '0.5' : '1';
}

// ── Inline error display ──
export function setError(id, message) {
  const node = $(id);
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

// ── Auth tab switcher ──
export function renderAuthMode(mode) {
  const loginActive = mode === 'login';
  const tabLogin    = $('tab-login');
  const tabReg      = $('tab-register');
  const loginForm   = $('login-form');
  const regForm     = $('register-form');
  if (tabLogin)  tabLogin.classList.toggle('active', loginActive);
  if (tabReg)    tabReg.classList.toggle('active', !loginActive);
  if (loginForm) loginForm.classList.toggle('hidden', !loginActive);
  if (regForm)   regForm.classList.toggle('hidden', loginActive);
  setError('login-error', '');
  setError('register-error', '');
}

// ── Connection status indicator ──
export function setConnectionStatus(online) {
  const dot = $('connection-status');
  if (!dot) return;
  dot.classList.toggle('online', online);
  dot.classList.toggle('offline', !online);
  dot.setAttribute('aria-label', online ? 'Online' : 'Offline');
}
