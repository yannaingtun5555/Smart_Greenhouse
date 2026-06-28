import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import useGreenhouseStore from '../store/useGreenhouseStore';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import { formatDateTime, safeUpper } from '../utils/formatters';

const STATUS_GLOW = {
  active: 'rgba(34,197,94,.4)',
  pending: 'rgba(245,158,11,.4)',
  offline: 'rgba(239,68,68,.4)',
  deleted: 'rgba(100,116,139,.3)',
};

export default function Greenhouses() {
  const navigate = useNavigate();
  const greenhouses = useGreenhouseStore((s) => s.greenhouses);
  const selectGreenhouse = useGreenhouseStore((s) => s.selectGreenhouse);
  const refreshSelectedData = useGreenhouseStore((s) => s.refreshSelectedData);
  const addGreenhouse = useGreenhouseStore((s) => s.addGreenhouse);
  const deleteGreenhouse = useGreenhouseStore((s) => s.deleteGreenhouse);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', serial_number: '' });

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await addGreenhouse(form.name.trim(), form.serial_number.trim());
      toast.success('Greenhouse added ✅');
      setForm({ name: '', serial_number: '' });
      setModalOpen(false);
    } catch (err) {
      setError(err.message || 'Failed to add greenhouse');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (id) => {
    selectGreenhouse(String(id));
    await refreshSelectedData();
    navigate('/overview');
  };

  const handleDelete = async (id) => {
    try {
      await deleteGreenhouse(id);
      toast.success('Greenhouse deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete greenhouse');
    }
  };

  const copySerial = async (serial) => {
    if (!serial) return;
    try {
      await navigator.clipboard.writeText(serial);
      toast.success('Serial copied to clipboard');
    } catch {
      toast.error('Could not copy serial');
    }
  };

  return (
    <section id="page-greenhouses" className="page" aria-label="Greenhouses">
      <div className="schedules-header">
        <div className="page-section-header">
          <h2>My Greenhouses</h2>
          <p>Manage your registered greenhouse devices</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setModalOpen(true)} aria-label="Add new greenhouse">
          <span>＋</span> Add Greenhouse
        </button>
      </div>

      <div id="greenhouses-grid" role="list" aria-label="Greenhouses list">
        {!greenhouses.length ? (
          <div className="empty-state glass" style={{ gridColumn: '1 / -1' }}>
            <div className="empty-state-icon">🏡</div>
            <h3>No Greenhouses Yet</h3>
            <p>Add your first greenhouse to get started.</p>
          </div>
        ) : (
          greenhouses.map((item) => {
            const status = item.status || 'pending';
            return (
              <article
                key={item.id}
                className="gh-card"
                role="listitem"
                style={{ '--gh-glow': STATUS_GLOW[status] || STATUS_GLOW.pending }}
              >
                <div className="gh-card-glow" />
                <div className="gh-card-header">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
                    <div className="gh-card-icon" aria-hidden="true">🏡</div>
                    <div className="gh-card-info">
                      <div className="gh-card-title">{item.name || 'Unnamed'}</div>
                      <div
                        className="gh-card-serial copyable-serial"
                        title="Click to copy serial"
                        role="button"
                        tabIndex={0}
                        onClick={() => copySerial(item.serial_number)}
                        onKeyDown={(e) => { if (e.key === 'Enter') copySerial(item.serial_number); }}
                      >
                        {item.serial_number || '—'}
                      </div>
                    </div>
                  </div>
                  <span className={`status-badge status-${status}`}>{safeUpper(status)}</span>
                </div>
                <div className="gh-card-meta">
                  <div className="gh-meta-row">
                    <span className="gh-meta-icon" aria-hidden="true">📅</span>
                    Added {formatDateTime(item.created_at)}
                  </div>
                  {status === 'active' ? (
                    <div className="gh-meta-row"><span className="gh-meta-icon">✅</span>Connected & receiving data</div>
                  ) : (
                    <div className="gh-meta-row"><span className="gh-meta-icon">⏳</span>Waiting for device connection</div>
                  )}
                </div>
                <div className="gh-card-footer">
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: '9px 18px', fontSize: '.85rem' }}
                    onClick={() => handleSelect(item.id)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    style={{ padding: '9px 14px' }}
                    onClick={() => handleDelete(item.id)}
                  >
                    🗑 Delete
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Greenhouse">
        <form id="gh-form" onSubmit={handleAdd} noValidate>
          <div className="field-group">
            <label htmlFor="gh-name">Greenhouse Name</label>
            <input
              type="text"
              id="gh-name"
              placeholder="e.g. Main Greenhouse"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field-group">
            <label htmlFor="gh-serial">Serial Number</label>
            <input
              type="text"
              id="gh-serial"
              placeholder="e.g. GH-001-XYZ"
              required
              value={form.serial_number}
              onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
            />
          </div>
          {error && <div id="gh-modal-error" className="form-error" role="alert">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <Button type="submit" id="gh-submit-btn" loading={loading}>Add Greenhouse</Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
