import { useState } from 'react';
import { toast } from 'sonner';
import useGreenhouseStore from '../store/useGreenhouseStore';
import { formatDateTime } from '../utils/formatters';
import { DEVICE_STATE_FIELDS } from '../utils/constants';

const DEVICES = [
  { key: 'fan_set1', cardId: 'ctrl-fan-set1', title: 'Fan Set 1', icon: '💨' },
  { key: 'fan_set2', cardId: 'ctrl-fan-set2', title: 'Fan Set 2', icon: '💨' },
  { key: 'pump', cardId: 'ctrl-pump', title: 'Water Pump', icon: '💧', stateKey: 'water_pump' },
  { key: 'light', cardId: 'ctrl-light', title: 'Light', icon: '💡' },
];

export default function Control() {
  const greenhouse = useGreenhouseStore((s) => s.getSelectedGreenhouse());
  const deviceState = useGreenhouseStore((s) => s.deviceState);
  const sendControlAction = useGreenhouseStore((s) => s.sendControlAction);
  const [feedback, setFeedback] = useState('');

  const sendControl = async (device, action) => {
    if (!greenhouse) {
      toast.warning('Select a greenhouse first');
      return;
    }
    if (greenhouse.status !== 'active') {
      toast.warning(`Greenhouse status is "${greenhouse.status}". Commands may not reach the device.`);
    }
    try {
      await sendControlAction(device, action);
      const label = DEVICES.find((d) => d.key === device)?.title || device;
      setFeedback(`${label} turned ${action.toUpperCase()}`);
      toast.success(`${label} → ${action.toUpperCase()}`);
    } catch (error) {
      toast.error(error.message || 'Control command failed');
    }
  };

  let noticeText = 'Select an active greenhouse to control devices.';
  let noticeClass = 'control-notice notice-warn';
  if (greenhouse && deviceState) {
    noticeText = `Control ready for ${greenhouse.name}.`;
    noticeClass = 'control-notice notice-info';
  } else if (greenhouse) {
    noticeText = `Waiting for device state from ${greenhouse.name}…`;
    noticeClass = 'control-notice notice-warn';
  }

  return (
    <section id="page-control" className="page" aria-label="Device Control">
      <div className="schedules-header">
        <div className="page-section-header">
          <h2>Device Control</h2>
          <p>Manually control greenhouse devices in real-time</p>
        </div>
        <div id="last-refresh" className="last-refresh muted" style={{ fontSize: '.8rem' }}>
          {deviceState?.updated_at ? `Updated ${formatDateTime(deviceState.updated_at)}` : 'No data'}
        </div>
      </div>

      <div id="control-notice" className={noticeClass} aria-live="polite">{noticeText}</div>

      <div className="control-grid">
        {DEVICES.map(({ key, cardId, title, icon, stateKey }) => {
          const field = stateKey || DEVICE_STATE_FIELDS[key];
          const on = !!deviceState?.[field];
          return (
            <div key={key} className={`control-card glass${on ? ' active-device' : ''}`} id={cardId}>
              <div className="ctrl-icon-wrap" aria-hidden="true">{icon}</div>
              <div className="ctrl-title">{title}</div>
              <div className="ctrl-status" id={`${cardId}-status`}>{on ? '● Running' : '○ Stopped'}</div>
              <div className="ctrl-btns">
                <button
                  type="button"
                  id={`${cardId}-on`}
                  className={`btn-on${on ? ' active' : ''}`}
                  onClick={() => sendControl(key, 'on')}
                  aria-label={`${title} ON`}
                >
                  ON
                </button>
                <button
                  type="button"
                  id={`${cardId}-off`}
                  className={`btn-off${!on ? ' active' : ''}`}
                  onClick={() => sendControl(key, 'off')}
                  aria-label={`${title} OFF`}
                >
                  OFF
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {feedback && (
        <div id="ctrl-feedback" className="ctrl-feedback" aria-live="polite">{feedback}</div>
      )}
    </section>
  );
}
