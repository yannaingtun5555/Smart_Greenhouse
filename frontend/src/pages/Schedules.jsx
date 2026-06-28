import { useState } from 'react';
import { toast } from 'sonner';
import useGreenhouseStore from '../store/useGreenhouseStore';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import {
  fanTargetLabel,
  fanTargetActionText,
  formatScheduleTrigger,
  isFanSchedule,
  safeUpper,
  titleCase,
} from '../utils/scheduleHelpers';

const DEVICE_ICONS = { fan: '💨', pump: '💧', light: '💡' };

function ScheduleDetailsModal({ schedule, open, onClose }) {
  if (!schedule) return null;
  const fanTarget = schedule.fan_target || 'all';
  return (
    <Modal open={open} onClose={onClose} title={`${titleCase(schedule.device_type)} Schedule`}>
      <div className="schedule-details-body">
        <div className="detail-grid">
          <div className="detail-row"><span>Device</span><strong>{titleCase(schedule.device_type)}</strong></div>
          <div className="detail-row">
            <span>Action</span>
            <strong className={`detail-action-${schedule.action || 'on'}`}>{safeUpper(schedule.action)}</strong>
          </div>
          <div className="detail-row"><span>Trigger Type</span><strong>{titleCase(schedule.condition_type)}</strong></div>
          <div className="detail-row"><span>Condition</span><strong>{formatScheduleTrigger(schedule)}</strong></div>
          <div className="detail-row"><span>Fan Target</span><strong>{fanTargetLabel(fanTarget)}</strong></div>
          <div className="detail-row">
            <span>Applies To</span>
            <strong>{isFanSchedule(schedule) ? fanTargetActionText(fanTarget) : 'N/A'}</strong>
          </div>
          <div className="detail-row"><span>Schedule ID</span><strong>{String(schedule.id)}</strong></div>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function CreateScheduleModal({ open, onClose }) {
  const greenhouse = useGreenhouseStore((s) => s.getSelectedGreenhouse());
  const createScheduleAction = useGreenhouseStore((s) => s.createScheduleAction);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    device_type: 'fan',
    action: 'on',
    condition_type: 'time',
    fan_target: 'all',
    time_of_day: '',
    sensor_name: 'temperature',
    operator: 'gt',
    threshold: '',
  });

  const showFanTarget = form.device_type === 'fan';
  const showTimeFields = form.condition_type === 'time';
  const showSensorFields = form.condition_type === 'sensor';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!greenhouse) {
      setError('Select a greenhouse first.');
      return;
    }
    const payload = {
      device_type: form.device_type,
      action: form.action,
      condition_type: form.condition_type,
    };
    if (form.device_type === 'fan') payload.fan_target = form.fan_target;
    if (form.condition_type === 'time') payload.time_of_day = form.time_of_day;
    else {
      payload.sensor_name = form.sensor_name;
      payload.operator = form.operator;
      payload.threshold = parseFloat(form.threshold);
    }

    setLoading(true);
    try {
      await createScheduleAction(payload);
      toast.success('Schedule created ✅');
      onClose();
      setForm({
        device_type: 'fan',
        action: 'on',
        condition_type: 'time',
        fan_target: 'all',
        time_of_day: '',
        sensor_name: 'temperature',
        operator: 'gt',
        threshold: '',
      });
    } catch (err) {
      setError(err.message || 'Failed to create schedule');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Automation Schedule">
      <form id="schedule-form" onSubmit={handleSubmit} noValidate>
        <div className="field-group">
          <label htmlFor="sched-device">Device</label>
          <select
            id="sched-device"
            required
            aria-label="Select device"
            value={form.device_type}
            onChange={(e) => setForm({ ...form, device_type: e.target.value })}
          >
            <option value="fan">Fan</option>
            <option value="pump">Water Pump</option>
            <option value="light">Light</option>
          </select>
        </div>
        {showFanTarget && (
          <div id="sched-fan-target-fields" className="field-group">
            <label htmlFor="sched-fan-target">Fan Target</label>
            <select
              id="sched-fan-target"
              aria-label="Select fan target"
              value={form.fan_target}
              onChange={(e) => setForm({ ...form, fan_target: e.target.value })}
            >
              <option value="all">All Fan Sets</option>
              <option value="set1">Fan Set 1 Only</option>
              <option value="set2">Fan Set 2 Only</option>
            </select>
          </div>
        )}
        <div className="field-group">
          <label htmlFor="sched-action">Action</label>
          <select
            id="sched-action"
            required
            aria-label="Select action"
            value={form.action}
            onChange={(e) => setForm({ ...form, action: e.target.value })}
          >
            <option value="on">Turn ON</option>
            <option value="off">Turn OFF</option>
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="sched-condition">Trigger Type</label>
          <select
            id="sched-condition"
            required
            aria-label="Select trigger type"
            value={form.condition_type}
            onChange={(e) => setForm({ ...form, condition_type: e.target.value })}
          >
            <option value="time">Time-based</option>
            <option value="sensor">Sensor threshold</option>
          </select>
        </div>
        {showTimeFields && (
          <div id="sched-time-fields" className="field-group">
            <label htmlFor="sched-time">Time of Day</label>
            <input
              type="time"
              id="sched-time"
              value={form.time_of_day}
              onChange={(e) => setForm({ ...form, time_of_day: e.target.value })}
            />
          </div>
        )}
        {showSensorFields && (
          <div id="sched-sensor-fields">
            <div className="field-group">
              <label htmlFor="sched-sensor-name">Sensor</label>
              <select
                id="sched-sensor-name"
                aria-label="Select sensor"
                value={form.sensor_name}
                onChange={(e) => setForm({ ...form, sensor_name: e.target.value })}
              >
                <option value="temperature">Temperature (°C)</option>
                <option value="humidity">Humidity (%)</option>
                <option value="soil_moisture">Soil Moisture (%)</option>
                <option value="light_intensity">Light (lx)</option>
                <option value="battery_voltage">Battery (V)</option>
              </select>
            </div>
            <div className="field-row">
              <div className="field-group">
                <label htmlFor="sched-operator">Operator</label>
                <select
                  id="sched-operator"
                  aria-label="Select operator"
                  value={form.operator}
                  onChange={(e) => setForm({ ...form, operator: e.target.value })}
                >
                  <option value="gt">Greater than (&gt;)</option>
                  <option value="lt">Less than (&lt;)</option>
                  <option value="gte">≥</option>
                  <option value="lte">≤</option>
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="sched-threshold">Threshold</label>
                <input
                  type="number"
                  id="sched-threshold"
                  placeholder="e.g. 30"
                  step="0.1"
                  value={form.threshold}
                  onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}
        {error && <div id="schedule-modal-error" className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <Button type="submit" loading={loading}>Create Schedule</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Schedules() {
  const greenhouse = useGreenhouseStore((s) => s.getSelectedGreenhouse());
  const schedules = useGreenhouseStore((s) => s.schedules);
  const deleteScheduleAction = useGreenhouseStore((s) => s.deleteScheduleAction);
  const loadSchedules = useGreenhouseStore((s) => s.loadSchedules);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailsSchedule, setDetailsSchedule] = useState(null);

  const handleDelete = async (scheduleId) => {
    try {
      await deleteScheduleAction(scheduleId);
      toast.success('Schedule deleted');
    } catch (error) {
      toast.error(error.message || 'Failed to delete schedule');
      loadSchedules();
    }
  };

  return (
    <section id="page-schedules" className="page" aria-label="Schedules">
      <div className="schedules-header">
        <div className="page-section-header">
          <h2>Automation Rules</h2>
          <p>Auto-trigger devices by time or sensor threshold</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)} aria-label="Add new schedule">
          <span>＋</span> New Schedule
        </button>
      </div>

      <div className="schedules-list" id="schedules-list" aria-live="polite">
        {!greenhouse ? (
          <div className="card glass table-empty">Select a greenhouse to view schedules</div>
        ) : !schedules.length ? (
          <div className="empty-state glass" style={{ marginTop: 0 }}>
            <div className="empty-state-icon">🗓️</div>
            <h3>No Schedules Yet</h3>
            <p>Create automation rules to control your devices automatically.</p>
          </div>
        ) : (
          schedules.map((item) => {
            const icon = DEVICE_ICONS[item.device_type] || '⚙️';
            const isFan = item.device_type === 'fan';
            const fanTarget = item.fan_target || 'all';
            const triggerLabel = item.condition_type === 'time' ? 'Time' : 'Sensor';
            const condText = item.condition_type === 'time'
              ? `⏰ Daily at ${item.time_of_day || '—'}`
              : `📡 When ${item.sensor_name || ''} ${item.operator || ''} ${item.threshold ?? ''}`;

            return (
              <div
                key={item.id}
                className="card glass schedule-item"
                role="button"
                tabIndex={0}
                aria-label="Open schedule details"
                onClick={() => setDetailsSchedule(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setDetailsSchedule(item);
                  }
                }}
              >
                <div className="sched-icon-wrap" aria-hidden="true">{icon}</div>
                <div className="sched-info">
                  <div className="sched-title">
                    {titleCase(item.device_type)}
                    {isFan && <span className="sched-fan-target-badge">{fanTargetLabel(fanTarget)}</span>}
                    <span className={`sched-action-badge ${item.action === 'on' ? 'badge-action-on' : 'badge-action-off'}`}>
                      {safeUpper(item.action)}
                    </span>
                  </div>
                  <div className="sched-meta-row">
                    <span className="sched-meta-pill">{triggerLabel}</span>
                    <span className="sched-meta-pill">{isFan ? fanTargetLabel(fanTarget) : 'No fan target'}</span>
                  </div>
                  <div className="sched-sub">{condText}</div>
                  {isFan && <div className="sched-fan-hint">Applies to {fanTargetActionText(fanTarget)}.</div>}
                </div>
                <button
                  type="button"
                  className="btn-delete"
                  title="Delete schedule"
                  aria-label="Delete schedule"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item.id);
                  }}
                >
                  🗑
                </button>
              </div>
            );
          })
        )}
      </div>

      <CreateScheduleModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ScheduleDetailsModal
        schedule={detailsSchedule}
        open={!!detailsSchedule}
        onClose={() => setDetailsSchedule(null)}
      />
    </section>
  );
}
