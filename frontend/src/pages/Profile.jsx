import { useState } from 'react';
import { toast } from 'sonner';
import useAuthStore from '../store/useAuthStore';
import useGreenhouseStore from '../store/useGreenhouseStore';
import useThemeStore from '../store/useThemeStore';
import { getResolvedApiBase, setApiBase } from '../api';
import Button from '../components/ui/Button';

function formatApiError(error) {
  if (error?.data && typeof error.data === 'object') {
    const parts = [];
    for (const [field, errs] of Object.entries(error.data)) {
      parts.push(`${field}: ${Array.isArray(errs) ? errs.join(' ') : errs}`);
    }
    if (parts.length) return parts.join('\n');
  }
  return error?.message || 'Request failed';
}

export default function Profile() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const greenhouses = useGreenhouseStore((s) => s.greenhouses);
  const sensorRows = useGreenhouseStore((s) => s.sensorRows);
  const schedules = useGreenhouseStore((s) => s.schedules);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const [form, setForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiBase, setApiBaseInput] = useState(getResolvedApiBase());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);
    const payload = {};
    if (form.first_name !== undefined) payload.first_name = form.first_name.trim();
    if (form.last_name !== undefined) payload.last_name = form.last_name.trim();
    if (form.email) payload.email = form.email.trim();
    if (form.phone !== undefined) payload.phone = form.phone.trim();

    try {
      await updateProfile(payload);
      setSuccess(true);
      toast.success('Profile updated! ✅');
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const applyApiBase = () => {
    const val = apiBase.trim();
    if (!val) return;
    setApiBase(val);
    toast.success('API base URL updated. Refreshing…');
    setTimeout(() => useGreenhouseStore.getState().bootstrapApp().catch(() => {}), 400);
  };

  if (!user) return null;

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '—';

  return (
    <section id="page-profile" className="page" aria-label="Profile settings">
      <div style={{ maxWidth: '760px' }}>
        <div className="page-section-header">
          <h2>Profile &amp; Settings</h2>
          <p>Manage your account information</p>
        </div>

        <div className="profile-grid">
          <div className="profile-card" style={{ gridColumn: '1 / -1' }}>
            <div className="profile-avatar-wrap">
              <div className="profile-avatar-large" id="profile-avatar-large">
                {(user.username || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="profile-user-info">
                <div className="user-name-large" id="profile-name-display">{displayName}</div>
                <div className="user-since" id="profile-email-display" style={{ color: 'var(--clr-text3)', marginTop: '3px' }}>
                  {user.email || '—'}
                </div>
                <div
                  id="profile-role-badge"
                  style={{
                    marginTop: '8px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 12px',
                    background: 'rgba(34,197,94,.12)',
                    border: '1px solid rgba(34,197,94,.22)',
                    borderRadius: '20px',
                    fontSize: '.75rem',
                    fontWeight: 700,
                    color: 'var(--clr-green)',
                  }}
                >
                  {user.is_staff ? '⭐ Staff' : '🌿 Farmer'}
                </div>
              </div>
            </div>

            <form id="profile-form" onSubmit={handleSubmit} noValidate>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="field-row">
                  <div className="field-group">
                    <label htmlFor="profile-first">First Name</label>
                    <input
                      type="text"
                      id="profile-first"
                      placeholder="John"
                      autoComplete="given-name"
                      value={form.first_name}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="profile-last">Last Name</label>
                    <input
                      type="text"
                      id="profile-last"
                      placeholder="Doe"
                      autoComplete="family-name"
                      value={form.last_name}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    />
                  </div>
                </div>
                <div className="field-group">
                  <label htmlFor="profile-email">Email</label>
                  <input
                    type="email"
                    id="profile-email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="profile-phone">Phone</label>
                  <input
                    type="tel"
                    id="profile-phone"
                    placeholder="+959123456789"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                {error && <div id="profile-error" className="form-error" role="alert">{error}</div>}
                {success && (
                  <div id="profile-success" className="ctrl-feedback success" role="status">
                    ✅ Profile updated successfully!
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit" id="profile-save-btn" style={{ minWidth: '140px' }} loading={loading}>
                    Save Changes
                  </Button>
                </div>
              </div>
            </form>
          </div>

          <div className="profile-card">
            <div className="card-title">
              <span className="card-title-icon">📊</span>
              Account Stats
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--clr-surface2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--clr-border)' }}>
                <span style={{ fontSize: '.83rem', color: 'var(--clr-text3)' }}>🏡 Greenhouses</span>
                <strong id="profile-gh-count" style={{ fontFamily: "'Outfit',sans-serif", fontSize: '1.1rem' }}>{greenhouses.length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--clr-surface2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--clr-border)' }}>
                <span style={{ fontSize: '.83rem', color: 'var(--clr-text3)' }}>📡 Total Readings</span>
                <strong id="profile-reading-count" style={{ fontFamily: "'Outfit',sans-serif", fontSize: '1.1rem' }}>
                  {sensorRows.length > 0 ? `${sensorRows.length}+` : '—'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--clr-surface2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--clr-border)' }}>
                <span style={{ fontSize: '.83rem', color: 'var(--clr-text3)' }}>🗓️ Schedules</span>
                <strong id="profile-sched-count" style={{ fontFamily: "'Outfit',sans-serif", fontSize: '1.1rem' }}>{schedules.length}</strong>
              </div>
            </div>
          </div>

          <div className="profile-card">
            <div className="card-title">
              <span className="card-title-icon">⚙️</span>
              App Settings
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--clr-surface2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--clr-border)' }}>
                <div>
                  <div style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '2px' }}>Dark Mode</div>
                  <div style={{ fontSize: '.75rem', color: 'var(--clr-text3)' }}>Toggle app theme</div>
                </div>
                <button type="button" className="btn-secondary" id="settings-theme-btn" onClick={toggleTheme} style={{ fontSize: '.82rem', padding: '7px 14px' }}>
                  {theme === 'dark' ? '☀️ Theme' : '🌙 Theme'}
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--clr-surface2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--clr-border)' }}>
                <div>
                  <div style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '2px' }}>Auto-Refresh</div>
                  <div style={{ fontSize: '.75rem', color: 'var(--clr-text3)' }}>Updates every 15 seconds</div>
                </div>
                <span style={{ fontSize: '.78rem', color: 'var(--clr-green)', background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.22)', padding: '4px 10px', borderRadius: '20px', fontWeight: 700 }}>ON</span>
              </div>
              <div style={{ padding: '12px 14px', background: 'var(--clr-surface2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--clr-border)' }}>
                <div style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '6px' }}>API Base URL</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="url"
                    id="api-base-input"
                    placeholder="Auto (same host as this page)"
                    style={{ flex: 1, padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--clr-border2)', borderRadius: 'var(--radius-sm)', color: 'var(--clr-text)', fontSize: '.82rem', fontFamily: 'inherit', outline: 'none' }}
                    value={apiBase}
                    onChange={(e) => setApiBaseInput(e.target.value)}
                  />
                  <button type="button" className="btn-secondary" onClick={applyApiBase} style={{ padding: '8px 14px', fontSize: '.82rem' }}>Apply</button>
                </div>
                <small className="field-hint" style={{ marginTop: '5px', display: 'block' }}>
                  Current: <span id="current-api-base" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '.78rem', color: 'var(--clr-green)' }}>{getResolvedApiBase()}</span>
                </small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
