import { $ } from './core/dom.js';
import { getAccessToken, setApiBase, updateMe } from './core/api.js';
import { renderAuthMode, setActiveScreen, showToast } from './core/ui.js';
import { loadPageFragments } from './core/page-loader.js';
import { initMicroFeatures, updateLastSync } from './core/micro.js';
import {
  handleAddGh, handleGhChange,
  navigateTo as goToPage, openAddGhModal, openScheduleModal,
  closeGhModal, closeScheduleModal,
  sendControlAction, toggleScheduleCondition, toggleFanTarget,
  loadSensorHistory,
  bootstrapApp,
} from './features/greenhouses.js';
import { loadAnalytics } from './pages/analytics.js';
import { renderProfilePage } from './pages/profile.js';
import {
  handleCreateSchedule,
  loadSchedules,
  openScheduleDetails,
  closeScheduleDetails,
} from './pages/schedules.js';
import { handleLogout, handleLogin, handleRegister, switchTab, restoreSession } from './features/auth.js';
import { state } from './core/store.js';
import { me } from './core/api.js';
import { setError, setBusy } from './core/ui.js';

// ── Theme management ──
function getTheme() { return localStorage.getItem('theme') || 'dark'; }
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const btn  = $('theme-toggle-btn');
  const btn2 = $('settings-theme-btn');
  const icon = theme === 'dark' ? '☀️ Theme' : '🌙 Theme';
  if (btn)  btn.innerHTML  = icon;
  if (btn2) btn2.innerHTML = icon;
}
function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

// ── Mobile sidebar ──
function openMobileSidebar() {
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  const btn = $('mobile-menu-btn');
  if (sidebar) sidebar.classList.add('open');
  if (overlay) overlay.classList.add('active');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function closeMobileSidebar() {
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  const btn = $('mobile-menu-btn');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// ── Refresh spinner ──
function setRefreshSpin(spinning) {
  const btn = $('refresh-btn');
  if (!btn) return;
  if (spinning) {
    btn.classList.add('refresh-spinning');
  } else {
    btn.classList.remove('refresh-spinning');
  }
}

// ── Auto-refresh ──
let refreshTimer = null;
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    bootstrapApp().catch(() => {});
  }, 15000);
}

// ── Profile update handler ──
async function handleProfileUpdate(event) {
  event.preventDefault();
  setError('profile-error', '');
  const successEl = $('profile-success');
  if (successEl) successEl.classList.add('hidden');
  setBusy('profile-save-btn', true);

  const payload = {};
  const first = $('profile-first')?.value.trim();
  const last  = $('profile-last')?.value.trim();
  const email = $('profile-email')?.value.trim();
  const phone = $('profile-phone')?.value.trim();
  if (first !== undefined) payload.first_name = first;
  if (last  !== undefined) payload.last_name  = last;
  if (email)  payload.email = email;
  if (phone !== undefined) payload.phone = phone;

  try {
    const updated = await updateMe(payload);
    state.user = { ...state.user, ...updated };

    // Update sidebar
    const sidebarUser = $('sidebar-username');
    const sidebarAvatar = $('user-avatar');
    if (sidebarUser) sidebarUser.textContent = updated.username || '—';
    if (sidebarAvatar) sidebarAvatar.textContent = (updated.username || '?').slice(0,1).toUpperCase();

    renderProfilePage();
    if (successEl) successEl.classList.remove('hidden');
    showToast('Profile updated! ✅');
  } catch (error) {
    let msg = error.message;
    if (error.data && typeof error.data === 'object') {
      const parts = [];
      for (const [field, errs] of Object.entries(error.data)) {
        parts.push(`${field}: ${Array.isArray(errs) ? errs.join(' ') : errs}`);
      }
      if (parts.length) msg = parts.join('\n');
    }
    setError('profile-error', msg);
  } finally {
    setBusy('profile-save-btn', false);
  }
}

// ── Apply API base URL ──
function applyApiBase() {
  const input = $('api-base-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  setApiBase(val);
  const curBase = $('current-api-base');
  if (curBase) curBase.textContent = val;
  showToast('API base URL updated. Refreshing…');
  setTimeout(() => bootstrapApp().catch(() => {}), 400);
}

// ── Global bindings (called from inline HTML handlers) ──
const globals = {
  switchTab,
  handleLogin,
  handleRegister,
  handleLogout,
  navigateTo: (page) => {
    closeMobileSidebar(); // Close sidebar when navigating
    goToPage(page);
  },
  handleGhChange,
  refreshData: async () => {
    setRefreshSpin(true);
    try {
      await bootstrapApp();
      updateLastSync();
    } finally {
      setTimeout(() => setRefreshSpin(false), 600);
    }
  },
  sendControl: sendControlAction,
  toggleScheduleCondition,
  toggleFanTarget,
  openScheduleModal,
  closeScheduleModal,
  openScheduleDetails,
  closeScheduleDetails,
  openAddGhModal,
  closeGhModal,
  handleAddGh,
  handleCreateSchedule,
  setApiBase,
  loadSensorHistory,
  loadSchedules,
  loadAnalytics,
  toggleTheme,
  openMobileSidebar,
  closeMobileSidebar,
  handleProfileUpdate,
  applyApiBase,
};
Object.assign(window, globals);

// ── DOM ready ──
document.addEventListener('DOMContentLoaded', async () => {
  // Apply saved theme
  applyTheme(getTheme());
  await loadPageFragments();
  initMicroFeatures();
  // Event listeners
  const registerForm = $('register-form');
  const loginForm    = $('login-form');
  const ghSelect     = $('gh-select');
  const sensorLimit  = $('sensor-limit');
  const schedCond    = $('sched-condition');
  const schedDevice  = $('sched-device');
  const profileForm  = $('profile-form');
  
  // MODAL EVENT LISTENERS - FIXED
  const ghModal = $('gh-modal');
  const scheduleModal = $('schedule-modal');
  const scheduleDetailsModal = $('schedule-details-modal');
  
  // Add click handlers for modal backdrops
  if (ghModal) {
    ghModal.addEventListener('click', function(e) {
      // Close only if clicking the backdrop itself (not the modal card)
      if (e.target === this) {
        closeGhModal();
      }
    });
  }
  
  if (scheduleModal) {
    scheduleModal.addEventListener('click', function(e) {
      // Close only if clicking the backdrop itself (not the modal card)
      if (e.target === this) {
        closeScheduleModal();
      }
    });
  }

  if (scheduleDetailsModal) {
    scheduleDetailsModal.addEventListener('click', function(e) {
      if (e.target === this) {
        closeScheduleDetails();
      }
    });
  }
  
  // SIDEBAR OVERLAY - FIXED
  const sidebarOverlay = $('sidebar-overlay');
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', function(e) {
      // Close sidebar when clicking overlay
      closeMobileSidebar();
    });
  }

  if (registerForm) registerForm.addEventListener('submit', handleRegister);
  if (loginForm)    loginForm.addEventListener('submit', handleLogin);
  if (ghSelect)     ghSelect.addEventListener('change', handleGhChange);
  if (sensorLimit)  sensorLimit.addEventListener('change', loadSensorHistory);
  if (schedCond)    schedCond.addEventListener('change', toggleScheduleCondition);
  if (schedDevice)  schedDevice.addEventListener('change', toggleFanTarget);
  if (profileForm)  profileForm.addEventListener('submit', handleProfileUpdate);

  // Escape key closes modals and sidebar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeScheduleModal();
      closeGhModal();
      closeMobileSidebar();
    }
  });

  // Initialize
  toggleScheduleCondition();
  toggleFanTarget();
  renderAuthMode('login');
  setActiveScreen(false);

  if (getAccessToken()) {
    await restoreSession();
  }

  startAutoRefresh();
});
