import { $, escapeHtml, formatDateTime, formatNumber } from '../core/dom.js';
import { state, getSelectedGreenhouse } from '../core/store.js';

function formatAge(ageSeconds) {
  if (ageSeconds == null || ageSeconds < 0) return '';
  if (ageSeconds < 60) return 'just now';
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)} min ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

const SENSOR_CARD_CONFIG = [
  { key: 'temperature', label: 'Temperature', unit: '°C', icon: '🌡️', color: '#f59e0b', color2: '#f97316', accent: 'rgba(245,158,11,.1)', max: 50 },
  { key: 'humidity', label: 'Humidity', unit: '%', icon: '💧', color: '#3b82f6', color2: '#6366f1', accent: 'rgba(59,130,246,.1)', max: 100 },
  { key: 'soil_moisture', label: 'Soil Moisture', unit: '%', icon: '🪴', color: '#22c55e', color2: '#14b8a6', accent: 'rgba(34,197,94,.1)', max: 100 },
  { key: 'light_intensity', label: 'Light', unit: 'lx', icon: '☀️', color: '#a855f7', color2: '#ec4899', accent: 'rgba(168,85,247,.1)', max: 10000 },
  { key: 'battery', label: 'Battery', unit: 'V', icon: '🔋', color: '#14b8a6', color2: '#06b6d4', accent: 'rgba(20,184,166,.1)', max: 5 },
];

export function renderOverviewStatsBar() {
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
  bar.innerHTML = pills.map((p, i) => `
    <div class="stat-pill stagger-item" style="--i:${i};">
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

export function renderSensorCards() {
  const container = $('overview-sensor-grid');
  if (!container) return;

  const greenhouse = getSelectedGreenhouse();
  if (!greenhouse) {
    container.innerHTML = `
      <div class="empty-state glass empty-state-action" style="grid-column:1/-1;">
        <div class="empty-state-icon">🏡</div>
        <h3>No Greenhouse Selected</h3>
        <p>Add or select a greenhouse to see live sensor readings.</p>
        <button type="button" class="btn-primary empty-state-cta" onclick="navigateTo('greenhouses')">Add Greenhouse</button>
      </div>`;
    return;
  }

  const latest = state.sensorRows[0] || {};
  const isStale = state.latestReading?.is_stale;
  const ageText = formatAge(state.latestReading?.age_seconds);

  container.innerHTML = SENSOR_CARD_CONFIG.map(({ key, label, unit, icon, color, color2, accent, max }, i) => {
    const rawVal = latest[key];
    const val = rawVal != null ? Number(rawVal) : null;
    const display = val != null ? formatNumber(val) : '—';
    const pct = val != null ? Math.max(0, Math.min(100, (val / max) * 100)).toFixed(1) : 0;
    return `
      <article class="sensor-card sensor-card-interactive stagger-item" style="--i:${i};--card-color:${color};--card-color2:${color2};--card-accent:${accent};" role="button" tabindex="0" title="View sensor history" aria-label="${label}: ${display} ${unit}">
        <div class="sensor-card-bg"></div>
        <div class="sensor-card-circle" style="background:${color};"></div>
        <div class="sensor-card-header">
          <span class="sensor-card-icon" aria-hidden="true">${icon}</span>
          ${isStale ? `<span class="sensor-card-stale" title="Data from ${ageText} — backend may have been sleeping">⏳</span>` : ''}
        </div>
        <div class="sensor-card-label">${escapeHtml(label)}</div>
        <div class="sensor-card-value">${escapeHtml(display)}<span class="sensor-card-unit"> ${escapeHtml(unit)}</span></div>
        <div class="sensor-card-bar" aria-hidden="true"><div class="sensor-card-fill" style="width:${pct}%;"></div></div>
      </article>
    `;
  }).join('');
}

export function renderSensorsTable() {
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
