import { $ } from '../core/dom.js';
import { state, getSelectedGreenhouse } from '../core/store.js';
import { setConnectionStatus } from '../core/ui.js';
import { formatDateTime } from '../core/dom.js';

export function renderDeviceState() {
  const stateData = state.deviceState;

  [
    ['fan_set1', 'ind-fan-set1'],
    ['fan_set2', 'ind-fan-set2'],
    ['water_pump', 'ind-pump'],
    ['light', 'ind-light'],
  ].forEach(([key, id]) => {
    const node = $(id);
    const badge = node?.querySelector('.device-badge');
    const on = !!stateData?.[key];
    if (node) node.classList.toggle('is-on', on);
    if (badge) {
      badge.textContent = on ? 'ON' : 'OFF';
      badge.className = `device-badge ${on ? 'badge-on pulse' : 'badge-off'}`;
    }
  });

  const energyBadge = $('ind-energy')?.querySelector('.device-badge');
  if (energyBadge) {
    const ev = stateData?.energy_state || '—';
    energyBadge.textContent = ev;
    energyBadge.className = `device-badge ${stateData?.energy_state ? 'badge-on' : 'badge-off'}`;
  }

  [
    ['fan_set1', 'ctrl-fan-set1', 'ctrl-fan-set1-status'],
    ['fan_set2', 'ctrl-fan-set2', 'ctrl-fan-set2-status'],
    ['water_pump', 'ctrl-pump', 'ctrl-pump-status'],
    ['light', 'ctrl-light', 'ctrl-light-status'],
  ].forEach(([key, cardId, statusId]) => {
    const on = !!stateData?.[key];
    const card = $(cardId);
    const status = $(statusId);
    const btnOn = $(`${cardId}-on`);
    const btnOff = $(`${cardId}-off`);
    if (card) card.classList.toggle('active-device', on);
    if (status) status.textContent = on ? '● Running' : '○ Stopped';
    if (btnOn) btnOn.classList.toggle('active', on);
    if (btnOff) btnOff.classList.toggle('active', !on);
  });

  const updatedAt = stateData?.updated_at;
  setConnectionStatus(!!updatedAt);
  const refreshEl = $('last-refresh');
  if (refreshEl) {
    refreshEl.textContent = updatedAt ? `Updated ${formatDateTime(updatedAt)}` : 'No data';
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
