import { $ } from './dom.js';
import { showToast } from './ui.js';

let lastSyncAt = null;

export function updateLastSync() {
  lastSyncAt = new Date();
  const el = $('last-sync');
  if (!el) return;
  el.textContent = 'Updated just now';
  el.classList.remove('hidden');
}

function tickLastSyncLabel() {
  const el = $('last-sync');
  if (!el || !lastSyncAt) return;
  const secs = Math.floor((Date.now() - lastSyncAt.getTime()) / 1000);
  if (secs < 12) el.textContent = 'Updated just now';
  else if (secs < 60) el.textContent = `Updated ${secs}s ago`;
  else if (secs < 3600) el.textContent = `Updated ${Math.floor(secs / 60)}m ago`;
  else el.textContent = `Updated ${Math.floor(secs / 3600)}h ago`;
}

const PAGE_KEYS = {
  1: 'overview',
  2: 'sensors',
  3: 'analytics',
  4: 'control',
  5: 'schedules',
  6: 'greenhouses',
  7: 'profile',
};

function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function isAppVisible() {
  return !$('app-screen')?.classList.contains('hidden');
}

export function initMicroFeatures() {
  document.querySelectorAll('.password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
  });

  $('overview-sensor-grid')?.addEventListener('click', (e) => {
    if (!e.target.closest('.sensor-card-interactive')) return;
    window.navigateTo?.('sensors');
  });
  $('overview-sensor-grid')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.sensor-card-interactive');
    if (!card) return;
    e.preventDefault();
    window.navigateTo?.('sensors');
  });

  $('greenhouses-grid')?.addEventListener('click', (e) => {
    const serial = e.target.closest('[data-copy-serial]');
    if (!serial) return;
    e.stopPropagation();
    const text = serial.dataset.copySerial || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      showToast('Serial copied to clipboard', 'info');
    }).catch(() => showToast('Could not copy serial', 'warning'));
  });

  document.addEventListener('keydown', (e) => {
    if (!isAppVisible() || isTyping()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      window.refreshData?.();
      return;
    }
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      window.toggleTheme?.();
      return;
    }
    const page = PAGE_KEYS[e.key];
    if (page) {
      e.preventDefault();
      window.navigateTo?.(page);
    }
  });

  setInterval(tickLastSyncLabel, 12000);

  $('login-username')?.focus();
}
