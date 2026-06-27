import { $ } from '../core/dom.js';
import { getSensors } from '../core/api.js';
import { state, getSelectedGreenhouse } from '../core/store.js';
import { showErrorToast } from '../core/ui.js';

// ── Chart instances ──
let _charts = {};

function destroyCharts() {
  Object.values(_charts).forEach((chart) => {
    try { chart.destroy(); } catch (_) {}
  });
  _charts = {};
}

export function loadAnalytics() {
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
  getSensors(greenhouse.id, limit).then((raw) => {
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

    try {
    // Chart 1: Temp & Humidity
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
  }).catch((error) => {
    destroyCharts();
    showErrorToast(error.message || 'Failed to load analytics data');
  });
}
