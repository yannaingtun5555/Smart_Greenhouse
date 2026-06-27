import { $, escapeHtml, formatDateTime } from '../core/dom.js';
import {
  createGreenhouse, deleteGreenhouse, getDeviceState,
  getSensors, getLatestSensors, listGreenhouses, listSchedules,
  sendControl,
} from '../core/api.js';
import { state, getSelectedGreenhouse } from '../core/store.js';
import { setError, showToast, showErrorToast, setConnectionStatus } from '../core/ui.js';
import { updateLastSync } from '../core/micro.js';
import { renderOverviewStatsBar, renderSensorCards, renderSensorsTable } from '../pages/overview.js';
import { renderDeviceState } from '../pages/control.js';
import { renderSchedules, loadSchedules } from '../pages/schedules.js';
import { loadAnalytics } from '../pages/analytics.js';
import { renderProfilePage } from '../pages/profile.js';

const SELECTED_GH_KEY = 'selected_greenhouse_id';

// ── Safe string helpers ──
function safeUpper(value, fallback = '—') {
  return value != null && value !== '' ? String(value).toUpperCase() : fallback;
}

function titleCase(value, fallback = 'Unknown') {
  if (value == null || value === '') return fallback;
  const str = String(value);
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Staleness helper ──
function formatAge(ageSeconds) {
  if (ageSeconds == null || ageSeconds < 0) return '';
  if (ageSeconds < 60) return 'just now';
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)} min ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

// ── Normalize sensor API response ──
function normalizeSensorResponse(response) {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.results)) return response.results;
  return [];
}

// ── Activity log (in-memory, session only) ──
const _activityLog = [];
function addActivity(message, time = new Date()) {
  _activityLog.unshift({ message, time });
  if (_activityLog.length > 20) _activityLog.pop();
  renderActivityLog();
}

function renderActivityLog() {
  const list = $('activity-list');
  if (!list) return;
  if (!_activityLog.length) {
    list.innerHTML = '<li class="activity-item muted"><span class="activity-msg">No activity yet…</span></li>';
    return;
  }
  list.innerHTML = _activityLog.map(({ message, time }) => {
    const t = time instanceof Date ? time : new Date(time);
    const timeStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <li class="activity-item">
        <span class="activity-time">${escapeHtml(timeStr)}</span>
        <span class="activity-msg">${escapeHtml(message)}</span>
      </li>
    `;
  }).join('');
}

// ── Render greenhouses grid ──
function renderGreenhouses() {
  const grid = $('greenhouses-grid');
  if (!grid) return;

  if (!state.greenhouses.length) {
    grid.innerHTML = `
      <div class="empty-state glass" style="grid-column:1/-1;">
        <div class="empty-state-icon">🏡</div>
        <h3>No Greenhouses Yet</h3>
        <p>Add your first greenhouse to get started.</p>
      </div>`;
    return;
  }

  const statusGlow = {
    active:  'rgba(34,197,94,.4)',
    pending: 'rgba(245,158,11,.4)',
    offline: 'rgba(239,68,68,.4)',
    deleted: 'rgba(100,116,139,.3)',
  };

  grid.innerHTML = state.greenhouses.map((item) => {
    const status = item.status || 'pending';
    return `
    <article class="gh-card" role="listitem" style="--gh-glow:${statusGlow[status] || statusGlow.pending};">
      <div class="gh-card-glow"></div>
      <div class="gh-card-header">
        <div style="display:flex;align-items:flex-start;gap:0;">
          <div class="gh-card-icon" aria-hidden="true">🏡</div>
          <div class="gh-card-info">
            <div class="gh-card-title">${escapeHtml(item.name || 'Unnamed')}</div>
            <div class="gh-card-serial copyable-serial" data-copy-serial="${escapeHtml(item.serial_number || '')}" title="Click to copy serial" role="button" tabindex="0">${escapeHtml(item.serial_number || '—')}</div>
          </div>
        </div>
        <span class="status-badge status-${escapeHtml(status)}">${escapeHtml(safeUpper(status))}</span>
      </div>
      <div class="gh-card-meta">
        <div class="gh-meta-row">
          <span class="gh-meta-icon" aria-hidden="true">📅</span>
          Added ${escapeHtml(formatDateTime(item.created_at))}
        </div>
        ${status === 'active'
          ? `<div class="gh-meta-row"><span class="gh-meta-icon">✅</span>Connected & receiving data</div>`
          : `<div class="gh-meta-row"><span class="gh-meta-icon">⏳</span>Waiting for device connection</div>`
        }
      </div>
      <div class="gh-card-footer">
        <button class="btn-primary" data-select-gh="${item.id}" style="padding:9px 18px;font-size:.85rem;">Open</button>
        <button class="btn-danger" data-delete-gh="${item.id}" style="padding:9px 14px;">🗑 Delete</button>
      </div>
    </article>
  `;
  }).join('');

  grid.querySelectorAll('[data-select-gh]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedGreenhouseId = btn.getAttribute('data-select-gh');
      const sel = $('gh-select');
      if (sel) sel.value = state.selectedGreenhouseId;
      localStorage.setItem(SELECTED_GH_KEY, state.selectedGreenhouseId);
      refreshSelectedData();
      window.navigateTo('overview');
    });
  });

  grid.querySelectorAll('[data-delete-gh]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ghId = btn.getAttribute('data-delete-gh');
      const gh = state.greenhouses.find((g) => String(g.id) === String(ghId));
      if (!confirm(`Delete "${gh?.name || 'this greenhouse'}"? This cannot be undone.`)) return;
      btn.disabled = true;
      try {
        await deleteGreenhouse(ghId);
        if (String(state.selectedGreenhouseId) === String(ghId)) {
          state.selectedGreenhouseId = null;
          localStorage.removeItem(SELECTED_GH_KEY);
        }
        await loadGreenhouses();
        showToast('Greenhouse deleted');
        addActivity(`Greenhouse "${gh?.name}" deleted`);
      } catch (e) {
        showErrorToast(e.message);
        btn.disabled = false;
      }
    });
  });
}

// ── Render all data ──
function renderAllData() {
  renderSensorCards();
  renderSensorsTable();
  renderDeviceState();
  renderSchedules();
  renderOverviewStatsBar();
}

// ── Load greenhouses ──
export async function loadGreenhouses() {
  try {
    const data = await listGreenhouses();
    state.greenhouses = Array.isArray(data) ? data : (data.results || []);
  } catch (error) {
    state.greenhouses = [];
    showErrorToast(error.message || 'Failed to load greenhouses');
    throw error;
  }

  const select = $('gh-select');
  if (select) {
    select.innerHTML = '<option value="">Select Greenhouse…</option>' +
      state.greenhouses.map((g) =>
        `<option value="${g.id}">${escapeHtml(g.name)} (${escapeHtml(g.serial_number)})</option>`
      ).join('');

    const persisted = localStorage.getItem(SELECTED_GH_KEY);
    if (persisted && state.greenhouses.some((g) => String(g.id) === persisted)) {
      state.selectedGreenhouseId = persisted;
    } else if (!state.selectedGreenhouseId && state.greenhouses[0]) {
      state.selectedGreenhouseId = String(state.greenhouses[0].id);
    }
    if (state.selectedGreenhouseId) {
      select.value = state.selectedGreenhouseId;
      localStorage.setItem(SELECTED_GH_KEY, state.selectedGreenhouseId);
    }
  }

  renderGreenhouses();
}

// ── Refresh selected greenhouse data ──
export async function refreshSelectedData() {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) {
    state.deviceState = null;
    state.sensorRows  = [];
    state.schedules   = [];
    renderAllData();
    setConnectionStatus(false);
    return;
  }

  const limit = $('sensor-limit')?.value || 50;
  const [sensors, latest, deviceState, schedules] = await Promise.all([
    getSensors(greenhouse.id, limit).catch(() => []),
    getLatestSensors(greenhouse.id).catch(() => null),
    getDeviceState(greenhouse.id).catch(() => null),
    listSchedules(greenhouse.id).catch(() => []),
  ]);

  state.sensorRows  = normalizeSensorResponse(sensors);
  if (!state.sensorRows.length && latest) {
    state.sensorRows = [latest];
  }
  state.latestReading = latest;
  state.deviceState = deviceState;
  state.schedules   = Array.isArray(schedules) ? schedules : [];
  renderAllData();
  setConnectionStatus(true);
  updateLastSync();
}

// ── Navigation ──
export function navigateTo(page) {
  state.page = page;
  const titles = {
    overview:    'Overview',
    sensors:     'Sensor Data',
    control:     'Device Control',
    schedules:   'Schedules',
    greenhouses: 'Greenhouses',
    analytics:   'Analytics',
    profile:     'Profile & Settings',
  };
  const titleEl = $('page-title');
  if (titleEl) titleEl.textContent = titles[page] || page;
  document.title = `${titles[page] || page} · GreenMind`;

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.remove('active');
    el.removeAttribute('aria-current');
  });
  const activeNav = $(`nav-${page}`);
  if (activeNav) {
    activeNav.classList.add('active');
    activeNav.setAttribute('aria-current', 'page');
  }

  document.querySelectorAll('.page').forEach((s) => s.classList.add('hidden'));
  const activePage = $(`page-${page}`);
  if (activePage) {
    activePage.classList.remove('hidden');
    activePage.classList.remove('page-enter');
    void activePage.offsetWidth;
    activePage.classList.add('page-enter');
    activePage.scrollTop = 0;
  }

  // Page-specific data loads
  if (page === 'sensors')     loadSensorHistory();
  if (page === 'schedules')   loadSchedules();
  if (page === 'greenhouses') renderGreenhouses();
  if (page === 'control')     renderDeviceState();
  if (page === 'analytics')   loadAnalytics();
  if (page === 'profile')     renderProfilePage();
}

// ── Greenhouse selector change ──
export function handleGhChange() {
  state.selectedGreenhouseId = $('gh-select')?.value || null;
  if (state.selectedGreenhouseId) {
    localStorage.setItem(SELECTED_GH_KEY, state.selectedGreenhouseId);
    const gh = getSelectedGreenhouse();
    if (gh) addActivity(`Switched to greenhouse "${gh.name}"`);
  } else {
    localStorage.removeItem(SELECTED_GH_KEY);
  }
  refreshSelectedData();
}

// ── Load sensor history ──
export async function loadSensorHistory() {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) { renderSensorsTable(); return; }
  const limit = $('sensor-limit')?.value || 50;
  const response = await getSensors(greenhouse.id, limit).catch(() => []);
  state.sensorRows = normalizeSensorResponse(response);
  renderSensorsTable();
}

// ── Send control action ──
export async function sendControlAction(device, action) {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) {
    showToast('Select a greenhouse first', 'warning');
    return;
  }

  if (greenhouse.status !== 'active') {
    const notice = $('control-notice');
    if (notice) {
      notice.textContent = `⚠️ Greenhouse status is "${greenhouse.status}". Commands may not reach the device.`;
      notice.className = 'control-notice notice-warn';
    }
  }

  const deviceLabel = { fan_set1: 'Fan Set 1', fan_set2: 'Fan Set 2', pump: 'Water Pump', light: 'Light' };
  const previousState = state.deviceState ? { ...state.deviceState } : null;
  const optimisticState = previousState ? { ...previousState } : {
    greenhouse_id: greenhouse.id,
    fan_set1: false,
    fan_set2: false,
    water_pump: false,
    light: false,
  };
  const stateField = { fan_set1: 'fan_set1', fan_set2: 'fan_set2', pump: 'water_pump', light: 'light' }[device];
  if (stateField) {
    optimisticState[stateField] = action === 'on';
    optimisticState.updated_at = new Date().toISOString();
    state.deviceState = optimisticState;
    renderDeviceState();
  }

  const feedback = $('ctrl-feedback');
  if (feedback) {
    feedback.textContent = `⏳ Sending ${deviceLabel[device] || device} ${action.toUpperCase()}…`;
    feedback.className = 'ctrl-feedback pending';
    feedback.classList.remove('hidden');
  }

  try {
    await sendControl(greenhouse.id, device, action);
    await refreshSelectedData();
    const msg = `${deviceLabel[device] || device} turned ${action.toUpperCase()}`;
    showToast(msg);
    addActivity(msg);

    const feedback = $('ctrl-feedback');
    if (feedback) {
      feedback.textContent = `✅ ${msg}`;
      feedback.className = 'ctrl-feedback success';
      feedback.classList.remove('hidden');
      setTimeout(() => feedback.classList.add('hidden'), 3000);
    }
  } catch (error) {
    if (previousState) {
      state.deviceState = previousState;
      renderDeviceState();
    }
    showToast(error.message, 'error');
    if (feedback) {
      feedback.textContent = `❌ ${error.message}`;
      feedback.className = 'ctrl-feedback error';
      feedback.classList.remove('hidden');
      setTimeout(() => feedback.classList.add('hidden'), 4000);
    }
  }
}

// ── Toggle schedule condition fields ──
export function toggleScheduleCondition() {
  const val = $('sched-condition')?.value;
  const isTime = val === 'time';
  const timeFields   = $('sched-time-fields');
  const sensorFields = $('sched-sensor-fields');
  if (timeFields)   timeFields.classList.toggle('hidden', !isTime);
  if (sensorFields) sensorFields.classList.toggle('hidden', isTime);
}

// ── Toggle fan target selector visibility ──
export function toggleFanTarget() {
  const device = $('sched-device')?.value;
  const fanTargetFields = $('sched-fan-target-fields');
  if (fanTargetFields) {
    fanTargetFields.classList.toggle('hidden', device !== 'fan');
  }
}

// ── Modal handlers ──
export function openScheduleModal() {
  const greenhouse = getSelectedGreenhouse();
  const errEl = $('schedule-modal-error');
  if (!greenhouse) {
    showToast('Select a greenhouse first', 'warning');
    return;
  }
  if (errEl) errEl.classList.add('hidden');
  $('schedule-modal')?.classList.remove('hidden');
}

export function closeScheduleModal(event) {
  if (event && event.target !== event.currentTarget) return;
  $('schedule-modal')?.classList.add('hidden');
}

export function openAddGhModal() {
  const errEl = $('gh-modal-error');
  if (errEl) errEl.classList.add('hidden');
  $('gh-form')?.reset();
  $('gh-modal')?.classList.remove('hidden');
}

export function closeGhModal(event) {
  if (event && event.target !== event.currentTarget) return;
  $('gh-modal')?.classList.add('hidden');
}

// ── Create greenhouse ──
export async function handleAddGh(event) {
  event.preventDefault();
  setError('gh-modal-error', '');
  const submitBtn = $('gh-submit-btn');
  if (submitBtn) submitBtn.disabled = true;
  try {
    const gh = await createGreenhouse({
      name:          $('gh-name')?.value.trim(),
      serial_number: $('gh-serial')?.value.trim(),
    });
    $('gh-form')?.reset();
    closeGhModal();
    await loadGreenhouses();
    showToast('Greenhouse added successfully! 🎉');
    addActivity(`Greenhouse "${gh.name}" registered`);
  } catch (error) {
    setError('gh-modal-error', error.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ── Re-export page functions for backward compat (main.js imports from here) ──
export { loadAnalytics } from '../pages/analytics.js';
export { renderProfilePage } from '../pages/profile.js';

// ── Bootstrap ──
export async function bootstrapApp() {
  try {
    await loadGreenhouses();
    await refreshSelectedData();
  } catch {
    setConnectionStatus(false);
  }
}
