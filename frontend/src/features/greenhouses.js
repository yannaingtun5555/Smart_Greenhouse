import { $, escapeHtml, formatDateTime, formatNumber } from '../core/dom.js';
import {
  createGreenhouse, deleteGreenhouse, getDeviceState,
  getSensors, getLatestSensors, listGreenhouses, listSchedules,
  sendControl, createSchedule, deleteSchedule,
  getResolvedApiBase,
} from '../core/api.js';
import { state, getSelectedGreenhouse } from '../core/store.js';
import { setError, showToast, showErrorToast, setConnectionStatus } from '../core/ui.js';

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

// ── Chart instances ──
let _charts = {};

function destroyCharts() {
  Object.values(_charts).forEach((c) => { try { c.destroy(); } catch (_) {} });
  _charts = {};
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

// ── Render live stats bar (top of Overview) ──
function renderOverviewStatsBar() {
  const bar = $('overview-stats-bar');
  if (!bar) return;
  const gh = getSelectedGreenhouse();
  if (!gh) { bar.innerHTML = ''; return; }
  const latest = state.sensorRows[0] || {};
  const isStale = state.latestReading?.is_stale;
  const ageText = formatAge(state.latestReading?.age_seconds);
  const pills = [
    { icon: '🏡', label: 'Greenhouse', value: gh.name, dot: gh.status === 'active' ? '#22c55e' : '#f59e0b' },
    { icon: '📡', label: 'Readings', value: state.sensorRows.length, dot: null },
    { icon: '🗓️', label: 'Schedules', value: state.schedules.length, dot: null },
  ];
  if (latest.temperature != null) pills.push({ icon: '🌡️', label: 'Temp', value: `${Number(latest.temperature).toFixed(1)} °C`, dot: null });
  if (latest.humidity != null) pills.push({ icon: '💧', label: 'Humid', value: `${Number(latest.humidity).toFixed(1)} %`, dot: null });
  bar.innerHTML = pills.map(p => `
    <div class="stat-pill">
      ${p.dot ? `<span class="stat-pill-dot" style="background:${p.dot};"></span>` : ''}
      <span>${p.icon}</span>
      <span style="color:var(--clr-text3);font-size:.75rem;">${p.label}:</span>
      <strong>${escapeHtml(String(p.value))}</strong>
    </div>
  `).join('') + (isStale ? `
    <div class="stat-pill" style="border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.06);">
      <span>⏳</span>
      <span style="color:var(--clr-text3);font-size:.75rem;">Last update:</span>
      <strong style="color:#f59e0b;">${escapeHtml(ageText || 'unknown')}</strong>
    </div>
  ` : '');
}

// ── Sensor card config ──
const SENSOR_CARD_CONFIG = [
  {
    key: 'temperature',
    label: 'Temperature',
    unit: '°C',
    icon: '🌡️',
    color: '#f59e0b',
    color2: '#f97316',
    accent: 'rgba(245,158,11,.1)',
    max: 50,
    tableClass: 'val-temp',
  },
  {
    key: 'humidity',
    label: 'Humidity',
    unit: '%',
    icon: '💧',
    color: '#3b82f6',
    color2: '#6366f1',
    accent: 'rgba(59,130,246,.1)',
    max: 100,
    tableClass: 'val-humid',
  },
  {
    key: 'soil_moisture',
    label: 'Soil Moisture',
    unit: '%',
    icon: '🪴',
    color: '#22c55e',
    color2: '#14b8a6',
    accent: 'rgba(34,197,94,.1)',
    max: 100,
    tableClass: 'val-soil',
  },
  {
    key: 'light_intensity',
    label: 'Light',
    unit: 'lx',
    icon: '☀️',
    color: '#a855f7',
    color2: '#ec4899',
    accent: 'rgba(168,85,247,.1)',
    max: 10000,
    tableClass: 'val-light',
  },
  {
    key: 'battery',
    label: 'Battery',
    unit: 'V',
    icon: '🔋',
    color: '#14b8a6',
    color2: '#06b6d4',
    accent: 'rgba(20,184,166,.1)',
    max: 5,
    tableClass: 'val-bat',
  },
];

// ── Render device state ──
function renderDeviceState() {
  const stateData = state.deviceState;

  // Overview indicators
  [
    ['fan_set1',   'ind-fan-set1'],
    ['fan_set2',   'ind-fan-set2'],
    ['water_pump', 'ind-pump'],
    ['light',      'ind-light'],
  ].forEach(([key, id]) => {
    const node  = $(id);
    const badge = node?.querySelector('.device-badge');
    const on    = !!stateData?.[key];
    if (node) node.classList.toggle('is-on', on);
    if (badge) {
      badge.textContent = on ? 'ON' : 'OFF';
      badge.className   = `device-badge ${on ? 'badge-on pulse' : 'badge-off'}`;
    }
  });

  const energyBadge = $('ind-energy')?.querySelector('.device-badge');
  if (energyBadge) {
    const ev = stateData?.energy_state || '—';
    energyBadge.textContent = ev;
    energyBadge.className = `device-badge ${stateData?.energy_state ? 'badge-on' : 'badge-off'}`;
  }

  // Control page button highlight
  [
    ['fan_set1',   'ctrl-fan-set1',   'ctrl-fan-set1-status'],
    ['fan_set2',   'ctrl-fan-set2',   'ctrl-fan-set2-status'],
    ['water_pump', 'ctrl-pump',  'ctrl-pump-status'],
    ['light',      'ctrl-light', 'ctrl-light-status'],
  ].forEach(([key, cardId, statusId]) => {
    const on     = !!stateData?.[key];
    const card   = $(cardId);
    const status = $(statusId);
    const btnOn  = $(`${cardId}-on`);
    const btnOff = $(`${cardId}-off`);
    if (card)   card.classList.toggle('active-device', on);
    if (status) status.textContent = on ? '● Running' : '○ Stopped';
    if (btnOn)  btnOn.classList.toggle('active', on);
    if (btnOff) btnOff.classList.toggle('active', !on);
  });

  // Connection / refresh
  const updatedAt = stateData?.updated_at;
  setConnectionStatus(!!updatedAt);
  const refreshEl = $('last-refresh');
  if (refreshEl) {
    refreshEl.textContent = updatedAt
      ? `Updated ${formatDateTime(updatedAt)}`
      : 'No data';
  }

  const notice = $('control-notice');
  const greenhouse = getSelectedGreenhouse();
  if (notice) {
    if (!greenhouse) {
      notice.textContent = 'Select an active greenhouse to control devices.';
      notice.className = 'control-notice notice-warn';
    } else if (stateData) {
      notice.textContent = `Control ready for ${greenhouse.name}.`;
      notice.className = 'control-notice notice-info';
    } else {
      notice.textContent = `Waiting for device state from ${greenhouse.name}…`;
      notice.className = 'control-notice notice-warn';
    }
  }
}

// ── Render sensor cards (Overview) ──
function renderSensorCards() {
  const container = $('overview-sensor-grid');
  if (!container) return;

  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) {
    container.innerHTML = `
      <div class="empty-state glass" style="grid-column:1/-1;">
        <div class="empty-state-icon">🏡</div>
        <h3>No Greenhouse Selected</h3>
        <p>Add or select a greenhouse to see live sensor data.</p>
      </div>`;
    return;
  }

  const latest = state.sensorRows[0] || {};
  const isStale = state.latestReading?.is_stale;
  const ageText = formatAge(state.latestReading?.age_seconds);

  container.innerHTML = SENSOR_CARD_CONFIG.map(({ key, label, unit, icon, color, color2, accent, max }) => {
    const rawVal  = latest[key];
    const val     = rawVal != null ? Number(rawVal) : null;
    const display = val != null ? formatNumber(val) : '—';
    const pct     = val != null ? Math.max(0, Math.min(100, (val / max) * 100)).toFixed(1) : 0;

    return `
      <article class="sensor-card"
        style="--card-color:${color};--card-color2:${color2};--card-accent:${accent};"
        role="region" aria-label="${label}: ${display} ${unit}">
        <div class="sensor-card-bg"></div>
        <div class="sensor-card-circle" style="background:${color};"></div>
        <div class="sensor-card-header">
          <span class="sensor-card-icon" aria-hidden="true">${icon}</span>
          ${isStale ? `<span class="sensor-card-stale" title="Data from ${ageText} — backend may have been sleeping">⏳</span>` : ''}
        </div>
        <div class="sensor-card-label">${escapeHtml(label)}</div>
        <div class="sensor-card-value">${escapeHtml(display)}<span class="sensor-card-unit"> ${escapeHtml(unit)}</span></div>
        <div class="sensor-card-bar" aria-hidden="true">
          <div class="sensor-card-fill" style="width:${pct}%;"></div>
        </div>
      </article>
    `;
  }).join('');
}

// ── Render sensor table ──
function renderSensorsTable() {
  const tbody = $('sensor-tbody');
  if (!tbody) return;

  if (!state.sensorRows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No sensor data yet</td></tr>';
    return;
  }

  tbody.innerHTML = state.sensorRows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDateTime(row.timestamp))}</td>
      <td class="val-temp">${escapeHtml(formatNumber(row.temperature))}</td>
      <td class="val-humid">${escapeHtml(formatNumber(row.humidity))}</td>
      <td class="val-soil">${escapeHtml(formatNumber(row.soil_moisture))}</td>
      <td class="val-light">${escapeHtml(formatNumber(row.light_intensity))}</td>
      <td class="val-bat">${escapeHtml(formatNumber(row.battery))}</td>
    </tr>
  `).join('');
}

// ── Render schedules ──
function renderSchedules() {
  const container = $('schedules-list');
  if (!container) return;

  if (!state.schedules.length) {
    container.innerHTML = `
      <div class="empty-state glass" style="margin-top:0;">
        <div class="empty-state-icon">🗓️</div>
        <h3>No Schedules Yet</h3>
        <p>Create automation rules to control your devices automatically.</p>
      </div>`;
    return;
  }

  const deviceIcons = { fan: '💨', pump: '💧', light: '💡' };
  const fanTargetLabels = { set1: '💨 Fan Set 1', set2: '💨 Fan Set 2', all: '💨 All Fan Sets' };
  container.innerHTML = state.schedules.map((item) => {
    const icon = deviceIcons[item.device_type] || '⚙️';
    const isFanSchedule = item.device_type === 'fan';
    const fanTarget = item.fan_target || 'all';

    // Build device title with fan target badge
    let deviceTitle = escapeHtml(titleCase(item.device_type));
    if (isFanSchedule && fanTarget !== 'all') {
      deviceTitle += ` <span class="sched-fan-target-badge">${fanTarget === 'set1' ? 'Set 1' : 'Set 2'}</span>`;
    }

    const condText = item.condition_type === 'time'
      ? `⏰ Daily at ${escapeHtml(item.time_of_day || '—')}`
      : `📡 When ${escapeHtml(item.sensor_name || '')} ${escapeHtml(item.operator || '')} ${escapeHtml(String(item.threshold ?? ''))}`;

    return `
      <div class="card glass schedule-item" role="listitem">
        <div class="sched-icon-wrap" aria-hidden="true">${icon}</div>
        <div class="sched-info">
          <div class="sched-title">
            ${deviceTitle}
            <span class="sched-action-badge ${item.action === 'on' ? 'badge-action-on' : 'badge-action-off'}">
              ${escapeHtml(safeUpper(item.action, '—'))}
            </span>
          </div>
          <div class="sched-sub">${condText}</div>
        </div>
        <button class="btn-delete" data-delete-schedule="${item.id}" title="Delete schedule" aria-label="Delete schedule">🗑</button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-delete-schedule]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const greenhouse = getSelectedGreenhouse();
      if (!greenhouse) return;
      btn.disabled = true;
      try {
        await deleteSchedule(greenhouse.id, btn.getAttribute('data-delete-schedule'));
        await refreshSelectedData();
        showToast('Schedule deleted');
        addActivity('Schedule deleted');
      } catch (e) {
        showErrorToast(e.message);
      }
    });
  });
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
            <div class="gh-card-serial">${escapeHtml(item.serial_number || '—')}</div>
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

// ── Load schedules ──
export async function loadSchedules() {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) { renderSchedules(); return; }
  state.schedules = await listSchedules(greenhouse.id).catch(() => []);
  renderSchedules();
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
    showToast(error.message, 'error');
    const feedback = $('ctrl-feedback');
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

// ── Create schedule ──
export async function handleCreateSchedule(event) {
  event.preventDefault();
  setError('schedule-modal-error', '');
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) { setError('schedule-modal-error', 'Select a greenhouse first.'); return; }

  const condition = $('sched-condition')?.value;
  const deviceType = $('sched-device')?.value;
  const payload = {
    device_type:    deviceType,
    action:         $('sched-action')?.value,
    condition_type: condition,
  };

  // Include fan_target when device is fan
  if (deviceType === 'fan') {
    payload.fan_target = $('sched-fan-target')?.value || 'all';
  }
  if (condition === 'time') {
    payload.time_of_day = $('sched-time')?.value;
  } else {
    payload.sensor_name = $('sched-sensor-name')?.value;
    payload.operator    = $('sched-operator')?.value;
    payload.threshold   = parseFloat($('sched-threshold')?.value);
  }

  try {
    await createSchedule(greenhouse.id, payload);
    $('schedule-form')?.reset();
    toggleScheduleCondition();
    closeScheduleModal();
    await refreshSelectedData();
    showToast('Schedule created ✅');
    addActivity(`Schedule created: ${payload.device_type} → ${payload.action}`);
  } catch (error) {
    setError('schedule-modal-error', error.message);
  }
}

// ── Analytics ──
export async function loadAnalytics() {
  const greenhouse = getSelectedGreenhouse();
  const noData  = $('analytics-no-data');
  const content = $('analytics-content');

  if (!greenhouse) {
    noData?.classList.remove('hidden');
    content?.classList.add('hidden');
    destroyCharts();
    return;
  }

  noData?.classList.add('hidden');
  content?.classList.remove('hidden');

  const limit = $('analytics-limit')?.value || 200;
  const raw  = await getSensors(greenhouse.id, limit).catch(() => []);
  const rows = (Array.isArray(raw) ? raw : (raw.results || [])).slice().reverse();

  if (!rows.length) {
    destroyCharts();
    $('analytics-empty')?.classList.remove('hidden');
    $('analytics-charts-grid')?.classList.add('hidden');
    return;
  }
  $('analytics-empty')?.classList.add('hidden');
  $('analytics-charts-grid')?.classList.remove('hidden');

  const labels   = rows.map((r) => {
    const d = new Date(r.timestamp);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
  });
  const temps    = rows.map((r) => r.temperature ?? null);
  const humidity = rows.map((r) => r.humidity ?? null);
  const soil     = rows.map((r) => r.soil_moisture ?? null);
  const light    = rows.map((r) => r.light_intensity ?? null);
  const battery  = rows.map((r) => r.battery ?? null);

  // Stat computation
  function stat(arr) {
    const valid = arr.filter((v) => v !== null);
    if (!valid.length) return { min: '—', max: '—', avg: '—' };
    return {
      min: Math.min(...valid).toFixed(1),
      max: Math.max(...valid).toFixed(1),
      avg: (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1),
    };
  }
  function fillStat(prefix, s) {
    const minEl = $(`${prefix}-min`); const maxEl = $(`${prefix}-max`); const avgEl = $(`${prefix}-avg`);
    if (minEl) minEl.textContent = s.min;
    if (maxEl) maxEl.textContent = s.max;
    if (avgEl) avgEl.textContent = s.avg;
  }
  fillStat('stat-temp',     stat(temps));
  fillStat('stat-humidity', stat(humidity));
  fillStat('stat-soil',     stat(soil));
  fillStat('stat-light',    stat(light));
  fillStat('stat-battery',  stat(battery));

  destroyCharts();

  if (typeof Chart === 'undefined') {
    $('analytics-empty')?.classList.remove('hidden');
    $('analytics-charts-grid')?.classList.add('hidden');
    showErrorToast('Charts unavailable — Chart.js failed to load');
    return;
  }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor   = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const tickColor   = isDark ? '#64748b' : '#94a3b8';
  const legendColor = isDark ? '#94a3b8' : '#475569';
  const tooltipBg   = isDark ? 'rgba(7,12,16,0.95)' : 'rgba(255,255,255,0.96)';
  const tooltipTitle = isDark ? '#e2f0ec' : '#0f172a';
  const tooltipBody  = isDark ? '#94a3b8' : '#475569';

  const sharedDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 600, easing: 'easeInOutQuart' },
    plugins: {
      legend: {
        labels: { color: legendColor, font: { family: 'Inter', size: 12 }, boxWidth: 14, padding: 16 },
      },
      tooltip: {
        backgroundColor: tooltipBg,
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        padding: 12,
        cornerRadius: 10,
        titleFont: { family: 'Outfit', weight: '700', size: 13 },
        bodyFont: { family: 'Inter', size: 12 },
      },
    },
    scales: {
      x: {
        ticks: { color: tickColor, maxRotation: 45, font: { size: 10, family: 'Inter' } },
        grid:  { color: gridColor },
        border: { display: false },
      },
      y: {
        ticks: { color: tickColor, font: { size: 11, family: 'Inter' } },
        grid:  { color: gridColor },
        border: { display: false },
      },
    },
  };

  function makeGradient(ctx, color1, color2) {
    const g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, color1);
    g.addColorStop(1, color2);
    return g;
  }

  const pointRadius = rows.length > 60 ? 0 : 3;

  // Chart 1: Temp & Humidity
  try {
  const c1 = $('chart-temp-humidity');
  if (c1) {
    const ctx = c1.getContext('2d');
    _charts.tempHumidity = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Temperature (°C)',
            data: temps,
            borderColor: '#f59e0b',
            backgroundColor: makeGradient(ctx, 'rgba(245,158,11,.28)', 'rgba(245,158,11,.02)'),
            fill: true, tension: 0.4,
            pointRadius, pointHoverRadius: 6, borderWidth: 2,
          },
          {
            label: 'Humidity (%)',
            data: humidity,
            borderColor: '#3b82f6',
            backgroundColor: makeGradient(ctx, 'rgba(59,130,246,.22)', 'rgba(59,130,246,.02)'),
            fill: true, tension: 0.4,
            pointRadius, pointHoverRadius: 6, borderWidth: 2,
          },
        ],
      },
      options: { ...sharedDefaults },
    });
  }

  // Chart 2: Soil Moisture
  const c2 = $('chart-soil');
  if (c2) {
    const ctx = c2.getContext('2d');
    _charts.soil = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Soil Moisture (%)',
          data: soil,
          borderColor: '#22c55e',
          backgroundColor: makeGradient(ctx, 'rgba(34,197,94,.3)', 'rgba(34,197,94,.02)'),
          fill: true, tension: 0.4,
          pointRadius, pointHoverRadius: 6, borderWidth: 2,
        }],
      },
      options: { ...sharedDefaults },
    });
  }

  // Chart 3: Light (bar)
  const c3 = $('chart-light');
  if (c3) {
    const ctx = c3.getContext('2d');
    _charts.light = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Light Intensity (lx)',
          data: light,
          backgroundColor: 'rgba(168,85,247,.45)',
          borderColor: '#a855f7',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        ...sharedDefaults,
        plugins: { ...sharedDefaults.plugins, legend: { display: false } },
      },
    });
  }

  // Chart 4: Battery
  const c4 = $('chart-battery');
  if (c4) {
    const ctx = c4.getContext('2d');
    _charts.battery = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Battery (V)',
          data: battery,
          borderColor: '#14b8a6',
          backgroundColor: makeGradient(ctx, 'rgba(20,184,166,.28)', 'rgba(20,184,166,.02)'),
          fill: true, tension: 0.4,
          pointRadius, pointHoverRadius: 6, borderWidth: 2,
        }],
      },
      options: { ...sharedDefaults },
    });
  }
  } catch (error) {
    destroyCharts();
    showErrorToast(error.message || 'Failed to render analytics charts');
  }
}

// ── Render Profile Page ──
export function renderProfilePage() {
  const { user, greenhouses, schedules, sensorRows } = state;
  if (!user) return;

  // Avatar & name
  const avatarLarge = $('profile-avatar-large');
  const nameDisp    = $('profile-name-display');
  const emailDisp   = $('profile-email-display');
  const roleBadge   = $('profile-role-badge');
  if (avatarLarge) avatarLarge.textContent = (user.username || '?').slice(0,1).toUpperCase();
  if (nameDisp)   nameDisp.textContent = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '—';
  if (emailDisp)  emailDisp.textContent = user.email || '—';
  if (roleBadge)  roleBadge.innerHTML = user.is_staff ? '⭐ Staff' : '🌿 Farmer';

  // Form pre-fill
  const fi = $('profile-first'); if (fi) fi.value = user.first_name || '';
  const la = $('profile-last');  if (la) la.value = user.last_name  || '';
  const em = $('profile-email'); if (em) em.value = user.email      || '';
  const ph = $('profile-phone'); if (ph) ph.value = user.phone      || '';

  // Stats
  const ghCount   = $('profile-gh-count');      if (ghCount)   ghCount.textContent   = greenhouses.length;
  const rdCount   = $('profile-reading-count'); if (rdCount)   rdCount.textContent   = sensorRows.length > 0 ? `${sensorRows.length}+` : '—';
  const scCount   = $('profile-sched-count');   if (scCount)   scCount.textContent   = schedules.length;

  // API base
  const resolvedApiBase = getResolvedApiBase();
  const curBase = $('current-api-base'); if (curBase) curBase.textContent = resolvedApiBase;
  const apiInp  = $('api-base-input');   if (apiInp)  apiInp.value = resolvedApiBase;
}

// ── Bootstrap ──
export async function bootstrapApp() {
  try {
    await loadGreenhouses();
    await refreshSelectedData();
  } catch {
    setConnectionStatus(false);
  }
}
