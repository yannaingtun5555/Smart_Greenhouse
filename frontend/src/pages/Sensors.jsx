import { useEffect, useState } from 'react';
import useGreenhouseStore from '../store/useGreenhouseStore';
import { formatDateTime, formatNumber } from '../utils/formatters';

export default function Sensors() {
  const greenhouse = useGreenhouseStore((s) => s.getSelectedGreenhouse());
  const sensorRows = useGreenhouseStore((s) => s.sensorRows);
  const loadSensors = useGreenhouseStore((s) => s.loadSensors);
  const [limit, setLimit] = useState('50');

  const refresh = () => loadSensors(Number(limit));

  useEffect(() => {
    if (greenhouse) {
      loadSensors(Number(limit));
    }
  }, [greenhouse, limit, loadSensors]);

  return (
    <section id="page-sensors" className="page" aria-label="Sensor data">
      <div className="sensor-history-header">
        <div className="sensor-history-controls">
          <div className="field-group inline">
            <label htmlFor="sensor-limit">Show last</label>
            <select
              id="sensor-limit"
              className="compact-select"
              aria-label="Number of sensor readings"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            >
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
            <label>readings</label>
          </div>
        </div>
        <button type="button" className="btn-secondary" onClick={refresh} aria-label="Refresh sensor data">↻ Refresh</button>
      </div>
      <div className="sensor-table-wrap card glass">
        <table className="sensor-table" id="sensor-table" aria-label="Sensor readings">
          <thead>
            <tr>
              <th scope="col">⏰ Timestamp</th>
              <th scope="col">🌡️ Temp (°C)</th>
              <th scope="col">💧 Humidity (%)</th>
              <th scope="col">🪴 Soil (%)</th>
              <th scope="col">☀️ Light (lx)</th>
              <th scope="col">🔋 Battery (V)</th>
            </tr>
          </thead>
          <tbody id="sensor-tbody">
            {!greenhouse ? (
              <tr><td colSpan={6} className="table-empty">Select a greenhouse to load data</td></tr>
            ) : !sensorRows.length ? (
              <tr><td colSpan={6} className="table-empty">No sensor data yet</td></tr>
            ) : (
              sensorRows.map((row, idx) => (
                <tr key={row.id || row.timestamp || idx}>
                  <td>{formatDateTime(row.timestamp)}</td>
                  <td className="val-temp">{formatNumber(row.temperature)}</td>
                  <td className="val-humid">{formatNumber(row.humidity)}</td>
                  <td className="val-soil">{formatNumber(row.soil_moisture)}</td>
                  <td className="val-light">{formatNumber(row.light_intensity)}</td>
                  <td className="val-bat">{formatNumber(row.battery)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
