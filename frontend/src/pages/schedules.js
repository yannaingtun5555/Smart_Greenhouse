import { $, escapeHtml } from '../core/dom.js';
import { state, getSelectedGreenhouse } from '../core/store.js';
import { listSchedules, deleteSchedule, createSchedule } from '../core/api.js';
import { setError, showToast, showErrorToast } from '../core/ui.js';

function safeUpper(value, fallback = '—') {
  return value != null && value !== '' ? String(value).toUpperCase() : fallback;
}

function titleCase(value, fallback = 'Unknown') {
  if (value == null || value === '') return fallback;
  const str = String(value);
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function fanTargetLabel(value) {
  return { set1: 'Fan Set 1', set2: 'Fan Set 2', all: 'All Fan Sets' }[value] || 'All Fan Sets';
}

function fanTargetActionText(value) {
  return { set1: 'Set 1 only', set2: 'Set 2 only', all: 'All fan sets' }[value] || 'All fan sets';
}

function formatScheduleTrigger(item) {
  if (item.condition_type === 'time') return `Daily at ${item.time_of_day || '—'}`;
  return `When ${item.sensor_name || 'sensor'} ${item.operator || '—'} ${item.threshold ?? '—'}`;
}

function isFanSchedule(schedule) {
  return schedule?.device_type === 'fan';
}

function renderScheduleDetails(schedule) {
  const body = $('schedule-details-body');
  const title = $('schedule-details-title');
  if (!body || !title) return;

  const fanTarget = schedule.fan_target || 'all';
  title.textContent = `${titleCase(schedule.device_type)} Schedule`;
  body.innerHTML = `
    <div class="detail-grid">
      <div class="detail-row"><span>Device</span><strong>${escapeHtml(titleCase(schedule.device_type))}</strong></div>
      <div class="detail-row"><span>Action</span><strong class="detail-action-${escapeHtml(schedule.action || 'on')}">${escapeHtml(safeUpper(schedule.action, '—'))}</strong></div>
      <div class="detail-row"><span>Trigger Type</span><strong>${escapeHtml(titleCase(schedule.condition_type || '—'))}</strong></div>
      <div class="detail-row"><span>Condition</span><strong>${escapeHtml(formatScheduleTrigger(schedule))}</strong></div>
      <div class="detail-row"><span>Fan Target</span><strong>${escapeHtml(fanTargetLabel(fanTarget))}</strong></div>
      <div class="detail-row"><span>Applies To</span><strong>${escapeHtml(isFanSchedule(schedule) ? fanTargetActionText(fanTarget) : 'N/A')}</strong></div>
      <div class="detail-row"><span>Schedule ID</span><strong>${escapeHtml(String(schedule.id))}</strong></div>
    </div>
  `;
}

export function openScheduleDetails(schedule) {
  if (!schedule) return;
  renderScheduleDetails(schedule);
  const modal = $('schedule-details-modal');
  modal?.classList.remove('hidden');
  modal?.classList.add('modal-open');
}

export function closeScheduleDetails(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = $('schedule-details-modal');
  modal?.classList.add('hidden');
  modal?.classList.remove('modal-open');
}

export function renderSchedules() {
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
  container.innerHTML = state.schedules.map((item) => {
    const icon = deviceIcons[item.device_type] || '⚙️';
    const isFan = item.device_type === 'fan';
    const fanTarget = item.fan_target || 'all';
    const triggerLabel = item.condition_type === 'time' ? 'Time' : 'Sensor';
    const condText = item.condition_type === 'time'
      ? `⏰ Daily at ${escapeHtml(item.time_of_day || '—')}`
      : `📡 When ${escapeHtml(item.sensor_name || '')} ${escapeHtml(item.operator || '')} ${escapeHtml(String(item.threshold ?? ''))}`;
    const fanHint = isFan ? `<div class="sched-fan-hint">Applies to ${escapeHtml(fanTargetActionText(fanTarget))}.</div>` : '';

    return `
      <div class="card glass schedule-item" role="button" data-schedule-item="${item.id}" tabindex="0" aria-label="Open schedule details">
        <div class="sched-icon-wrap" aria-hidden="true">${icon}</div>
        <div class="sched-info">
          <div class="sched-title">
            ${escapeHtml(titleCase(item.device_type))}
            ${isFan ? `<span class="sched-fan-target-badge">${escapeHtml(fanTargetLabel(fanTarget))}</span>` : ''}
            <span class="sched-action-badge ${item.action === 'on' ? 'badge-action-on' : 'badge-action-off'}">
              ${escapeHtml(safeUpper(item.action, '—'))}
            </span>
          </div>
          <div class="sched-meta-row">
            <span class="sched-meta-pill">${escapeHtml(triggerLabel)}</span>
            <span class="sched-meta-pill">${escapeHtml(isFan ? fanTargetLabel(fanTarget) : 'No fan target')}</span>
          </div>
          <div class="sched-sub">${condText}</div>
          ${fanHint}
        </div>
        <button class="btn-delete" data-delete-schedule="${item.id}" title="Delete schedule" aria-label="Delete schedule">🗑</button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-schedule-item]').forEach((itemEl) => {
    const openDetails = () => {
      const scheduleId = itemEl.getAttribute('data-schedule-item');
      const schedule = state.schedules.find((entry) => String(entry.id) === String(scheduleId));
      if (schedule) openScheduleDetails(schedule);
    };
    itemEl.addEventListener('click', (event) => {
      if (event.target.closest('[data-delete-schedule]')) return;
      openDetails();
    });
    itemEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetails();
      }
    });
  });

  container.querySelectorAll('[data-delete-schedule]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const greenhouse = getSelectedGreenhouse();
      if (!greenhouse) return;
      btn.disabled = true;
      const scheduleId = btn.getAttribute('data-delete-schedule');
      const previousSchedules = state.schedules.slice();
      state.schedules = state.schedules.filter((item) => String(item.id) !== String(scheduleId));
      renderSchedules();
      try {
        await deleteSchedule(greenhouse.id, scheduleId);
        showToast('Schedule deleted');
      } catch (e) {
        state.schedules = previousSchedules;
        renderSchedules();
        showErrorToast(e.message);
      }
    });
  });
}

export async function loadSchedules() {
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) {
    renderSchedules();
    return;
  }
  state.schedules = await listSchedules(greenhouse.id).catch(() => []);
  renderSchedules();
}

export async function handleCreateSchedule(event) {
  event.preventDefault();
  setError('schedule-modal-error', '');
  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) { setError('schedule-modal-error', 'Select a greenhouse first.'); return; }

  const condition = $('sched-condition')?.value;
  const deviceType = $('sched-device')?.value;
  const payload = {
    device_type: deviceType,
    action: $('sched-action')?.value,
    condition_type: condition,
  };
  if (deviceType === 'fan') payload.fan_target = $('sched-fan-target')?.value || 'all';
  if (condition === 'time') payload.time_of_day = $('sched-time')?.value;
  else {
    payload.sensor_name = $('sched-sensor-name')?.value;
    payload.operator = $('sched-operator')?.value;
    payload.threshold = parseFloat($('sched-threshold')?.value);
  }

  try {
    const pendingSchedule = { id: `pending-${Date.now()}`, greenhouse: greenhouse.id, ...payload };
    state.schedules = [pendingSchedule, ...state.schedules];
    renderSchedules();
    const created = await createSchedule(greenhouse.id, payload);
    $('schedule-form')?.reset();
    $('schedule-modal')?.classList.add('hidden');
    await loadSchedules();
    showToast('Schedule created ✅');
    return created;
  } catch (error) {
    setError('schedule-modal-error', error.message);
    await loadSchedules().catch(() => {});
  }
}
