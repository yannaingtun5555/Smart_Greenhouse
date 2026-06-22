const state = {
  user: null,
  greenhouses: [],
  selectedGreenhouseId: null,
  page: 'overview',
  schedules: [],
  sensorRows: [],
  deviceState: null,
};

const els = {};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showToast(message) {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 2600);
}

function setActiveScreen(isAuthed) {
  $('auth-screen').classList.toggle('hidden', isAuthed);
  $('auth-screen').classList.toggle('active', !isAuthed);
  $('app-screen').classList.toggle('hidden', !isAuthed);
  $('app-screen').classList.toggle('active', isAuthed);
}

function setBusy(buttonId, busy) {
  const button = $(buttonId);
  if (!button) return;
  button.disabled = busy;
  const loader = button.querySelector('.btn-loader');
  const text = button.querySelector('.btn-text');
  if (loader) loader.classList.toggle('hidden', !busy);
  if (text) text.style.opacity = busy ? '0.5' : '1';
}

function setError(id, message) {
  const node = $(id);
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
}

function renderAuthMode(mode) {
  const loginActive = mode === 'login';
  $('tab-login').classList.toggle('active', loginActive);
  $('tab-register').classList.toggle('active', !loginActive);
  $('login-form').classList.toggle('hidden', !loginActive);
  $('register-form').classList.toggle('hidden', loginActive);
  setError('login-error', '');
  setError('register-error', '');
}

function switchTab(mode) {
  renderAuthMode(mode);
}

async function handleLogin(event) {
  event.preventDefault();
  setError('login-error', '');
  setBusy('login-btn', true);
  try {
    const data = await login({
      username: $('login-username').value.trim(),
      password: $('login-password').value,
    });
    setTokens(data);
    await bootstrapApp();
    showToast('Signed in');
  } catch (error) {
    setError('login-error', error.message);
  } finally {
    setBusy('login-btn', false);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  setError('register-error', '');
  setBusy('register-btn', true);
  try {
    await register({
      username: $('reg-username').value.trim(),
      email: $('reg-email').value.trim(),
      password: $('reg-password').value,
      password2: $('reg-password2').value,
      first_name: $('reg-first').value.trim(),
      last_name: $('reg-last').value.trim(),
      phone: $('reg-phone') ? $('reg-phone').value.trim() : '',
    });
    showToast('Account created. Sign in now.');
    switchTab('login');
  } catch (error) {
    setError('register-error', error.message);
  } finally {
    setBusy('register-btn', false);
  }
}

function handleLogout() {
  clearTokens();
  state.user = null;
  state.greenhouses = [];
  state.selectedGreenhouseId = null;
  setActiveScreen(false);
  switchTab('login');
}

function navigateTo(page) {
  state.page = page;
  $('page-title').textContent = page.charAt(0).toUpperCase() + page.slice(1);
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  const activeNav = $(`nav-${page}`);
  if (activeNav) activeNav.classList.add('active');
  document.querySelectorAll('.page').forEach((section) => section.classList.add('hidden'));
  const activePage = $(`page-${page}`);
  if (activePage) activePage.classList.remove('hidden');
  if (page === 'sensors') loadSensorHistory();
  if (page === 'schedules') loadSchedules();
  if (page === 'greenhouses') renderGreenhouses();
  if (page === 'control') renderDeviceState();
}

function getSelectedGreenhouse() {
  return state.greenhouses.find((item) => String(item.id) === String(state.selectedGreenhouseId));
}

function handleGhChange() {
  state.selectedGreenhouseId = $('gh-select').value || null;
  syncSelectedGreenhouse();
}

function syncSelectedGreenhouse() {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) {
    state.deviceState = null;
    state.sensorRows = [];
    state.schedules = [];
    renderAllData();
    return;
  }
  $('gh-select').value = greenhouse.id;
  refreshSelectedData();
}

async function refreshSelectedData() {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) return;
  try {
    const [sensors, deviceState, schedules] = await Promise.all([
      getSensors(greenhouse.id, $('sensor-limit').value || 50).catch(() => []),
      getDeviceState(greenhouse.id).catch(() => null),
      listSchedules(greenhouse.id).catch(() => []),
    ]);
    state.sensorRows = Array.isArray(sensors) ? sensors : [];
    state.deviceState = deviceState;
    state.schedules = Array.isArray(schedules) ? schedules : [];
    renderAllData();
  } catch (error) {
    showToast(error.message);
  }
}

function renderSensorCards() {
  const container = $('overview-sensor-grid');
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) {
    container.innerHTML = '<div class="card glass table-empty">Add or select a greenhouse to begin</div>';
    return;
  }
  const latest = state.sensorRows[0] || {};
  const cards = [
    ['Temperature', latest.temperature, '°C', '🌡️'],
    ['Humidity', latest.humidity, '%', '💧'],
    ['Soil', latest.soil_moisture, '%', '🪴'],
    ['Light', latest.light_intensity, 'lx', '☀️'],
    ['Battery', latest.battery, 'V', '🔋'],
  ];
  container.innerHTML = cards.map(([label, value, unit, icon]) => `
    <article class="sensor-card glass" style="--card-accent: rgba(34,197,94,.12)">
      <span class="sensor-card-icon">${icon}</span>
      <div class="sensor-card-label">${escapeHtml(label)}</div>
      <div class="sensor-card-value">${escapeHtml(formatNumber(value))}<span class="sensor-card-unit">${escapeHtml(unit)}</span></div>
      <div class="sensor-card-bar"><div class="sensor-card-fill" style="width:${Math.max(0, Math.min(100, Number(value) || 0))}%"></div></div>
    </article>
  `).join('');
}

function renderDeviceState() {
  const stateData = state.deviceState;
  const map = [
    ['fan', 'ind-fan'],
    ['water_pump', 'ind-pump'],
    ['light', 'ind-light'],
  ];
  map.forEach(([key, id]) => {
    const node = $(id);
    const badge = node?.querySelector('.device-badge');
    const on = !!stateData?.[key];
    if (badge) {
      badge.textContent = on ? 'ON' : 'OFF';
      badge.className = `device-badge ${on ? 'badge-on' : 'badge-off'}`;
    }
  });
  const energy = $('ind-energy')?.querySelector('.device-badge');
  if (energy) {
    energy.textContent = stateData?.energy_state || '—';
    energy.className = `device-badge ${stateData?.energy_state ? 'badge-on' : 'badge-off'}`;
  }
  $('last-refresh').textContent = stateData?.updated_at ? `Updated ${formatDateTime(stateData.updated_at)}` : '—';
  const feedback = $('control-notice');
  feedback.textContent = stateData ? 'Control ready for the selected greenhouse.' : 'Select an active greenhouse to control devices.';
  feedback.className = stateData ? 'control-notice notice-info' : 'control-notice notice-warn';
}

function renderSensorsTable() {
  const tbody = $('sensor-tbody');
  if (!state.sensorRows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No sensor data yet</td></tr>';
    return;
  }
  tbody.innerHTML = state.sensorRows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDateTime(row.timestamp))}</td>
      <td>${escapeHtml(formatNumber(row.temperature))}</td>
      <td>${escapeHtml(formatNumber(row.humidity))}</td>
      <td>${escapeHtml(formatNumber(row.soil_moisture))}</td>
      <td>${escapeHtml(formatNumber(row.light_intensity))}</td>
      <td>${escapeHtml(formatNumber(row.battery))}</td>
    </tr>
  `).join('');
}

function renderSchedules() {
  const container = $('schedules-list');
  if (!state.schedules.length) {
    container.innerHTML = '<div class="card glass table-empty">No schedules yet</div>';
    return;
  }
  container.innerHTML = state.schedules.map((item) => `
    <div class="card glass schedule-item">
      <div><strong>${escapeHtml(item.device_type)}</strong> → ${escapeHtml(item.action)}</div>
      <div class="muted">${escapeHtml(item.condition_type)} ${item.time_of_day || `${item.sensor_name} ${item.operator} ${item.threshold}`}</div>
      <button class="btn-secondary" data-delete-schedule="${item.id}">Delete</button>
    </div>
  `).join('');
  container.querySelectorAll('[data-delete-schedule]').forEach((button) => {
    button.addEventListener('click', async () => {
      const greenhouse = getSelectedGreenhouse();
      if (!greenhouse) return;
      await deleteSchedule(greenhouse.id, button.getAttribute('data-delete-schedule'));
      await refreshSelectedData();
      showToast('Schedule deleted');
    });
  });
}

function renderGreenhouses() {
  const grid = $('greenhouses-grid');
  if (!state.greenhouses.length) {
    grid.innerHTML = '<div class="card glass table-empty">No greenhouses yet</div>';
    return;
  }
  grid.innerHTML = state.greenhouses.map((item) => `
    <article class="card glass greenhouse-card">
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.serial_number)}</p>
      <p>${escapeHtml(item.status)}</p>
      <button class="btn-secondary" data-select-gh="${item.id}">Open</button>
      <button class="btn-secondary" data-delete-gh="${item.id}">Delete</button>
    </article>
  `).join('');
  grid.querySelectorAll('[data-select-gh]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedGreenhouseId = button.getAttribute('data-select-gh');
      $('gh-select').value = state.selectedGreenhouseId;
      refreshSelectedData();
      navigateTo('overview');
    });
  });
  grid.querySelectorAll('[data-delete-gh]').forEach((button) => {
    button.addEventListener('click', async () => {
      await deleteGreenhouse(button.getAttribute('data-delete-gh'));
      await loadGreenhouses();
      showToast('Greenhouse deleted');
    });
  });
}

function renderAllData() {
  renderSensorCards();
  renderSensorsTable();
  renderDeviceState();
  renderSchedules();
}

async function loadGreenhouses() {
  const data = await listGreenhouses();
  state.greenhouses = Array.isArray(data) ? data : (data.results || []);
  const select = $('gh-select');
  select.innerHTML = '<option value="">Select Greenhouse…</option>' + state.greenhouses.map((item) =>
    `<option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.serial_number)})</option>`
  ).join('');
  $('greenhouses-grid').classList.remove('hidden');
  if (!state.selectedGreenhouseId && state.greenhouses[0]) {
    state.selectedGreenhouseId = state.greenhouses[0].id;
  }
  if (state.selectedGreenhouseId) select.value = state.selectedGreenhouseId;
  renderGreenhouses();
}

async function loadSensorHistory() {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) return renderSensorsTable();
  state.sensorRows = await getSensors(greenhouse.id, $('sensor-limit').value || 50).catch(() => []);
  renderSensorsTable();
}

async function loadSchedules() {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) return renderSchedules();
  state.schedules = await listSchedules(greenhouse.id).catch(() => []);
  renderSchedules();
}

async function sendControl(device, action) {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) return showToast('Select a greenhouse first');
  try {
    await apiRequest(`/api/v1/greenhouses/${greenhouse.id}/control/`, {
      method: 'PATCH',
      body: JSON.stringify({ device, action }),
    });
    await refreshSelectedData();
    showToast(`${device} ${action}`);
  } catch (error) {
    showToast(error.message);
  }
}

function toggleScheduleCondition() {
  const isTime = $('sched-condition').value === 'time';
  $('sched-time-fields').classList.toggle('hidden', !isTime);
  $('sched-sensor-fields').classList.toggle('hidden', isTime);
}

function openScheduleModal() {
  $('schedule-modal').classList.remove('hidden');
}

function closeScheduleModal(event) {
  if (event && event.target !== event.currentTarget) return;
  $('schedule-modal').classList.add('hidden');
}

function openAddGhModal() {
  $('gh-modal').classList.remove('hidden');
}

function closeGhModal(event) {
  if (event && event.target !== event.currentTarget) return;
  $('gh-modal').classList.add('hidden');
}

async function handleAddGh(event) {
  event.preventDefault();
  setError('gh-modal-error', '');
  try {
    await createGreenhouse({
      name: $('gh-name').value.trim(),
      serial_number: $('gh-serial').value.trim(),
    });
    $('gh-form').reset();
    closeGhModal();
    await loadGreenhouses();
    showToast('Greenhouse added');
  } catch (error) {
    setError('gh-modal-error', error.message);
  }
}

async function handleCreateSchedule(event) {
  event.preventDefault();
  setError('schedule-modal-error', '');
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) return setError('schedule-modal-error', 'Select a greenhouse first.');
  const condition = $('sched-condition').value;
  const payload = {
    device_type: $('sched-device').value,
    action: $('sched-action').value,
    condition_type: condition,
  };
  if (condition === 'time') {
    payload.time_of_day = $('sched-time').value;
  } else {
    payload.sensor_name = $('sched-sensor-name').value;
    payload.operator = $('sched-operator').value;
    payload.threshold = $('sched-threshold').value;
  }
  try {
    await createSchedule(greenhouse.id, payload);
    $('schedule-form').reset();
    toggleScheduleCondition();
    closeScheduleModal();
    await refreshSelectedData();
    showToast('Schedule created');
  } catch (error) {
    setError('schedule-modal-error', error.message);
  }
}

async function bootstrapApp() {
  try {
    const user = await me();
    state.user = user;
    $('sidebar-username').textContent = user.username;
    $('sidebar-role').textContent = user.is_staff ? 'Staff' : 'Farmer';
    $('user-avatar').textContent = user.username ? user.username.slice(0, 1).toUpperCase() : '👤';
    setActiveScreen(true);
    await loadGreenhouses();
    renderAuthMode('login');
    navigateTo('overview');
  } catch (error) {
    clearTokens();
    setActiveScreen(false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  Object.assign(window, {
    switchTab,
    handleLogin,
    handleRegister,
    handleLogout,
    navigateTo,
    handleGhChange,
    refreshData: bootstrapApp,
    sendControl,
    toggleScheduleCondition,
    openScheduleModal,
    closeScheduleModal,
    openAddGhModal,
    closeGhModal,
    handleAddGh,
    handleCreateSchedule,
    setApiBase,
  });

  toggleScheduleCondition();
  renderAuthMode('login');
  setActiveScreen(false);
  if (getAccessToken()) {
    await bootstrapApp();
  }
});

