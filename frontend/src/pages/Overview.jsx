import { useNavigate } from 'react-router-dom';
import useGreenhouseStore from '../store/useGreenhouseStore';
import { SENSOR_CARD_CONFIG } from '../utils/constants';
import { formatNumber, formatAge } from '../utils/formatters';

function DeviceIndicator({ id, icon, label, on }) {
  return (
    <div className={`device-indicator${on ? ' is-on' : ''}`} id={id} role="status" aria-label={`${label} status`}>
      <span className="device-icon" aria-hidden="true">{icon}</span>
      <span className="device-label">{label}</span>
      <span className={`device-badge ${on ? 'badge-on pulse' : 'badge-off'}`}>{on ? 'ON' : 'OFF'}</span>
    </div>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const greenhouse = useGreenhouseStore((s) => s.getSelectedGreenhouse());
  const sensorRows = useGreenhouseStore((s) => s.sensorRows);
  const latestReading = useGreenhouseStore((s) => s.latestReading);
  const schedules = useGreenhouseStore((s) => s.schedules);
  const deviceState = useGreenhouseStore((s) => s.deviceState);
  const activityLog = useGreenhouseStore((s) => s.activityLog);

  const latest = sensorRows[0] || {};
  const isStale = latestReading?.is_stale;
  const ageText = formatAge(latestReading?.age_seconds);

  const pills = [];
  if (greenhouse) {
    pills.push({ icon: '🏡', label: 'Greenhouse', value: greenhouse.name, dot: greenhouse.status === 'active' ? '#22c55e' : '#f59e0b' });
    pills.push({ icon: '📡', label: 'Readings', value: sensorRows.length, dot: null });
    pills.push({ icon: '🗓️', label: 'Schedules', value: schedules.length, dot: null });
    if (latest.temperature != null) pills.push({ icon: '🌡️', label: 'Temp', value: `${Number(latest.temperature).toFixed(1)} °C`, dot: null });
    if (latest.humidity != null) pills.push({ icon: '💧', label: 'Humid', value: `${Number(latest.humidity).toFixed(1)} %`, dot: null });
  }

  return (
    <section id="page-overview" className="page" aria-label="Overview">
      <div className="overview-stats-bar" id="overview-stats-bar">
        {pills.map((p, i) => (
          <div key={p.label} className="stat-pill stagger-item" style={{ '--i': i }}>
            {p.dot && <span className="stat-pill-dot" style={{ background: p.dot }} />}
            <span>{p.icon}</span>
            <span style={{ color: 'var(--clr-text3)', fontSize: '.75rem' }}>{p.label}:</span>
            <strong>{p.value}</strong>
          </div>
        ))}
        {isStale && (
          <div className="stat-pill" style={{ border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.06)' }}>
            <span>⏳</span>
            <span style={{ color: 'var(--clr-text3)', fontSize: '.75rem' }}>Last update:</span>
            <strong style={{ color: '#f59e0b' }}>{ageText || 'unknown'}</strong>
          </div>
        )}
      </div>

      <div className="sensor-grid" id="overview-sensor-grid" aria-live="polite">
        {!greenhouse ? (
          <div className="empty-state glass empty-state-action" style={{ gridColumn: '1 / -1' }}>
            <div className="empty-state-icon">🏡</div>
            <h3>No Greenhouse Selected</h3>
            <p>Add or select a greenhouse to see live sensor readings.</p>
            <button type="button" className="btn-primary empty-state-cta" onClick={() => navigate('/greenhouses')}>
              Add Greenhouse
            </button>
          </div>
        ) : (
          SENSOR_CARD_CONFIG.map(({ key, label, unit, icon, color, color2, accent, max }, i) => {
            const rawVal = latest[key];
            const val = rawVal != null ? Number(rawVal) : null;
            const display = val != null ? formatNumber(val) : '—';
            const pct = val != null ? Math.max(0, Math.min(100, (val / max) * 100)).toFixed(1) : 0;
            return (
              <article
                key={key}
                className="sensor-card sensor-card-interactive stagger-item"
                style={{ '--i': i, '--card-color': color, '--card-color2': color2, '--card-accent': accent }}
                role="button"
                tabIndex={0}
                title="View sensor history"
                aria-label={`${label}: ${display} ${unit}`}
                onClick={() => navigate('/sensors')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/sensors'); }}
              >
                <div className="sensor-card-bg" />
                <div className="sensor-card-circle" style={{ background: color }} />
                <div className="sensor-card-header">
                  <span className="sensor-card-icon" aria-hidden="true">{icon}</span>
                  {isStale && <span className="sensor-card-stale" title={`Data from ${ageText}`}>⏳</span>}
                </div>
                <div className="sensor-card-label">{label}</div>
                <div className="sensor-card-value">
                  {display}
                  <span className="sensor-card-unit"> {unit}</span>
                </div>
                <div className="sensor-card-bar" aria-hidden="true">
                  <div className="sensor-card-fill" style={{ width: `${pct}%` }} />
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="overview-bottom">
        <div className="card glass device-state-card" id="device-state-card">
          <div className="card-title">
            <span className="card-title-icon" aria-hidden="true">🎛️</span>
            Device Status
          </div>
          <div className="device-indicators" id="device-indicators">
            <DeviceIndicator id="ind-fan-set1" icon="💨" label="Fan Set 1" on={!!deviceState?.fan_set1} />
            <DeviceIndicator id="ind-fan-set2" icon="💨" label="Fan Set 2" on={!!deviceState?.fan_set2} />
            <DeviceIndicator id="ind-pump" icon="💧" label="Pump" on={!!deviceState?.water_pump} />
            <DeviceIndicator id="ind-light" icon="💡" label="Light" on={!!deviceState?.light} />
            <div className="device-indicator" id="ind-energy" role="status" aria-label="Energy mode">
              <span className="device-icon" aria-hidden="true">⚡</span>
              <span className="device-label">Energy</span>
              <span className={`device-badge ${deviceState?.energy_state ? 'badge-on' : 'badge-off'}`}>
                {deviceState?.energy_state || '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="card glass activity-card">
          <div className="card-title">
            <span className="card-title-icon" aria-hidden="true">📋</span>
            Recent Activity
          </div>
          <ul className="activity-list" id="activity-list" aria-live="polite" aria-label="Activity log">
            {!activityLog.length ? (
              <li className="activity-item muted">
                <span className="activity-msg">No activity yet…</span>
              </li>
            ) : (
              activityLog.map((item, idx) => {
                const t = item.time instanceof Date ? item.time : new Date(item.time);
                const timeStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <li key={idx} className="activity-item">
                    <span className="activity-time">{timeStr}</span>
                    <span className="activity-msg">{item.message}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
