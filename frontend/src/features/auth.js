import { $, escapeHtml } from '../core/dom.js';
import { clearTokens, login, register, me, setTokens } from '../core/api.js';
import { state } from '../core/store.js';
import { renderAuthMode, setActiveScreen, setBusy, setError, showToast, showErrorToast } from '../core/ui.js';
import { bootstrapApp, navigateTo } from './greenhouses.js';

const SELECTED_GH_KEY = 'selected_greenhouse_id';

function applyUserToSidebar(user) {
  const usernameEl = $('sidebar-username');
  const roleEl     = $('sidebar-role');
  const avatarEl   = $('user-avatar');
  if (usernameEl) usernameEl.textContent = user.username || '—';
  if (roleEl)     roleEl.textContent     = user.is_staff ? 'Staff' : 'Farmer';
  if (avatarEl)   avatarEl.textContent   = user.username
    ? user.username.slice(0, 1).toUpperCase()
    : '?';
}

export function switchTab(mode) {
  renderAuthMode(mode);
}

export async function handleLogin(event) {
  event.preventDefault();
  setError('login-error', '');
  setBusy('login-btn', true);
  try {
    const data = await login({
      username: $('login-username')?.value.trim(),
      password: $('login-password')?.value,
    });
    setTokens(data);
    const user = await me();
    state.user = user;
    applyUserToSidebar(user);
    setActiveScreen(true);
    renderAuthMode('login');
    await bootstrapApp();
    navigateTo('overview');
    showToast(`Welcome back, ${user.username}! 👋`);
  } catch (error) {
    // Show the actual error message in the toast
    const errorMessage = error.message || 'Login failed. Check your credentials.';
    setError('login-error', errorMessage);
    showErrorToast(errorMessage); // Use the actual error message
  } finally {
    setBusy('login-btn', false);
  }
  }

export async function handleRegister(event) {
  event.preventDefault();
  setError('register-error', '');

  const password  = $('reg-password')?.value;
  const password2 = $('reg-password2')?.value;
  if (password !== password2) {
    setError('register-error', 'Passwords do not match.');
    return;
  }

  setBusy('register-btn', true);
  try {
    await register({
      username:   $('reg-username')?.value.trim(),
      email:      $('reg-email')?.value.trim(),
      password,
      password2,
      first_name: $('reg-first')?.value.trim() || '',
      last_name:  $('reg-last')?.value.trim()  || '',
      phone:      $('reg-phone')?.value.trim()  || '',
    });
    showToast('Account created! Please sign in. 🎉');
    switchTab('login');
  } catch (error) {
    // Flatten DRF validation errors
    let msg = error.message;
    if (error.data && typeof error.data === 'object') {
      const parts = [];
      for (const [field, errs] of Object.entries(error.data)) {
        const fieldLabel = field.replace(/_/g, ' ');
        const errText = Array.isArray(errs) ? errs.join(' ') : String(errs);
        parts.push(`${fieldLabel}: ${errText}`);
      }
      if (parts.length) msg = parts.join('\n');
    }
    setError('register-error', msg);
    showErrorToast('Registration failed');
  } finally {
    setBusy('register-btn', false);
  }
}

export function handleLogout() {
  clearTokens();
  localStorage.removeItem(SELECTED_GH_KEY);
  state.user               = null;
  state.greenhouses        = [];
  state.selectedGreenhouseId = null;
  state.deviceState        = null;
  state.sensorRows         = [];
  state.schedules          = [];
  setActiveScreen(false);
  switchTab('login');
  showToast('Signed out. See you soon! 👋', 'info');
}

export async function restoreSession() {
  try {
    const user = await me();
    state.user = user;
    applyUserToSidebar(user);
    setActiveScreen(true);
    await bootstrapApp();
    navigateTo(state.page || 'overview');
  } catch {
    clearTokens();
    setActiveScreen(false);
  }
}
