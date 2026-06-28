import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { toast } from 'sonner';
import * as api from '../api';
import useGreenhouseStore from '../store/useGreenhouseStore';
import useThemeStore from '../store/useThemeStore';

function computeStats(arr) {
  const valid = arr.filter((v) => v != null && !Number.isNaN(v));
  if (!valid.length) return { min: '—', max: '—', avg: '—' };
  return {
    min: Math.min(...valid).toFixed(1),
    max: Math.max(...valid).toFixed(1),
    avg: (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1),
  };
}

function StatCard({ color, icon, label, stats }) {
  return (
    <div className="analytics-stat-card" style={{ '--stat-color': color }}>
      <div className="stat-card-header">
        <span className="stat-icon" aria-hidden="true">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-values">
        <div className="stat-value-item"><span className="stat-key">Min</span><span className="stat-val">{stats.min}</span></div>
        <div className="stat-value-item"><span className="stat-key">Avg</span><span className="stat-val stat-val-accent">{stats.avg}</span></div>
        <div className="stat-value-item"><span className="stat-key">Max</span><span className="stat-val">{stats.max}</span></div>
      </div>
    </div>
  );
}

export default function Analytics() {
  const navigate = useNavigate();
  const greenhouse = useGreenhouseStore((s) => s.getSelectedGreenhouse());
  const theme = useThemeStore((s) => s.theme);
  const [limit, setLimit] = useState('200');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const isDark = theme === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const tickColor = isDark ? '#64748b' : '#94a3b8';
  const tooltipStyle = {
    backgroundColor: isDark ? 'rgba(7,12,16,0.95)' : 'rgba(255,255,255,0.96)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    color: isDark ? '#e2f0ec' : '#0f172a',
  };

  const loadAnalytics = async () => {
    if (!greenhouse) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const raw = await api.getSensors(greenhouse.id, Number(limit));
      const data = (Array.isArray(raw) ? raw : (raw.results || [])).slice().reverse();
      setRows(data);
    } catch (error) {
      setRows([]);
      toast.error(error.message || 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [greenhouse?.id, limit]);

  const chartData = useMemo(() => rows.map((r) => {
    const d = new Date(r.timestamp);
    return {
      label: `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`,
      temperature: r.temperature ?? null,
      humidity: r.humidity ?? null,
      soil_moisture: r.soil_moisture ?? null,
      light_intensity: r.light_intensity ?? null,
      battery: r.battery ?? null,
    };
  }), [rows]);

  const stats = useMemo(() => ({
    temp: computeStats(rows.map((r) => r.temperature)),
    humidity: computeStats(rows.map((r) => r.humidity)),
    soil: computeStats(rows.map((r) => r.soil_moisture)),
    light: computeStats(rows.map((r) => r.light_intensity)),
    battery: computeStats(rows.map((r) => r.battery)),
  }), [rows]);

  if (!greenhouse) {
    return (
      <section id="page-analytics" className="page" aria-label="Analytics">
        <div id="analytics-no-data" className="analytics-empty-state glass card">
          <div className="analytics-empty-icon" aria-hidden="true">📈</div>
          <h3>No Greenhouse Selected</h3>
          <p className="muted">Select a greenhouse from the top bar to view its analytics.</p>
          <button type="button" className="btn-primary" onClick={() => navigate('/greenhouses')}>Add a Greenhouse</button>
        </div>
      </section>
    );
  }

  return (
    <section id="page-analytics" className="page" aria-label="Analytics">
      <div id="analytics-content">
        <div className="analytics-range-bar">
          <label htmlFor="analytics-limit">Data points:</label>
          <select
            id="analytics-limit"
            className="compact-select"
            aria-label="Number of data points"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          >
            <option value="50">Last 50</option>
            <option value="100">Last 100</option>
            <option value="200">Last 200</option>
            <option value="500">Last 500</option>
          </select>
          <button type="button" className="btn-secondary" onClick={loadAnalytics} style={{ padding: '7px 14px', fontSize: '.83rem' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>

        <div className="analytics-stat-grid">
          <StatCard color="#f59e0b" icon="🌡️" label="Temperature °C" stats={stats.temp} />
          <StatCard color="#3b82f6" icon="💧" label="Humidity %" stats={stats.humidity} />
          <StatCard color="#22c55e" icon="🪴" label="Soil Moisture %" stats={stats.soil} />
          <StatCard color="#a855f7" icon="☀️" label="Light Intensity lx" stats={stats.light} />
          <StatCard color="#14b8a6" icon="🔋" label="Battery V" stats={stats.battery} />
        </div>

        {!rows.length ? (
          <div id="analytics-empty" className="empty-state glass" style={{ marginBottom: '20px' }}>
            <div className="empty-state-icon" aria-hidden="true">📭</div>
            <h3>No Sensor Data Yet</h3>
            <p>Once your ESP32 starts sending data, charts will appear here.</p>
          </div>
        ) : (
          <div className="analytics-charts-grid" id="analytics-charts-grid">
            <div className="analytics-chart-card">
              <div className="card-title"><span className="card-title-icon" aria-hidden="true">🌡️</span>Temperature &amp; Humidity Over Time</div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData}>
                    <CartesianGrid stroke={gridColor} />
                    <XAxis dataKey="label" tick={{ fill: tickColor, fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: tickColor, fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend />
                    <Line type="monotone" dataKey="temperature" name="Temperature (°C)" stroke="#f59e0b" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#3b82f6" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="analytics-chart-card">
              <div className="card-title"><span className="card-title-icon" aria-hidden="true">🪴</span>Soil Moisture Over Time</div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData}>
                    <CartesianGrid stroke={gridColor} />
                    <XAxis dataKey="label" tick={{ fill: tickColor, fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: tickColor, fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="soil_moisture" name="Soil Moisture (%)" stroke="#22c55e" dot={false} strokeWidth={2} fill="rgba(34,197,94,.1)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="analytics-chart-card">
              <div className="card-title"><span className="card-title-icon" aria-hidden="true">☀️</span>Light Intensity</div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid stroke={gridColor} />
                    <XAxis dataKey="label" tick={{ fill: tickColor, fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: tickColor, fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="light_intensity" name="Light (lx)" fill="rgba(168,85,247,.45)" stroke="#a855f7" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="analytics-chart-card">
              <div className="card-title"><span className="card-title-icon" aria-hidden="true">🔋</span>Battery Voltage Over Time</div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData}>
                    <CartesianGrid stroke={gridColor} />
                    <XAxis dataKey="label" tick={{ fill: tickColor, fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: tickColor, fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="battery" name="Battery (V)" stroke="#14b8a6" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
