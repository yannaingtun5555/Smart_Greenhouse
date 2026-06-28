import { NavLink, useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/useAuthStore';
import useThemeStore from '../../store/useThemeStore';

export default function Sidebar({ onClose, mobileOpen = false }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <aside className={`sidebar${mobileOpen ? ' open' : ''}`} id="sidebar" aria-label="Main navigation">
      <div className="sidebar-logo">
        <span className="logo-icon" aria-hidden="true">🌿</span>
        <span className="logo-text">GreenMind</span>
      </div>

      <nav className="sidebar-nav" aria-label="Main menu">
        <div className="nav-section-label">Main</div>
        <NavLink id="nav-overview" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/overview" onClick={onClose} title="Overview (1)">
          <span className="nav-icon" aria-hidden="true">📊</span>
          <span className="nav-label">Overview</span>
        </NavLink>
        <NavLink id="nav-sensors" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/sensors" onClick={onClose} title="Sensor Data (2)">
          <span className="nav-icon" aria-hidden="true">📡</span>
          <span className="nav-label">Sensor Data</span>
        </NavLink>
        <NavLink id="nav-analytics" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/analytics" onClick={onClose} title="Analytics (3)">
          <span className="nav-icon" aria-hidden="true">📈</span>
          <span className="nav-label">Analytics</span>
        </NavLink>

        <div className="nav-section-label" style={{ marginTop: '6px' }}>Control</div>
        <NavLink id="nav-control" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/control" onClick={onClose} title="Device Control (4)">
          <span className="nav-icon" aria-hidden="true">🎛️</span>
          <span className="nav-label">Device Control</span>
        </NavLink>
        <NavLink id="nav-schedules" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/schedules" onClick={onClose} title="Schedules (5)">
          <span className="nav-icon" aria-hidden="true">🗓️</span>
          <span className="nav-label">Schedules</span>
        </NavLink>

        <div className="nav-section-label" style={{ marginTop: '6px' }}>Manage</div>
        <NavLink id="nav-greenhouses" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/greenhouses" onClick={onClose} title="Greenhouses (6)">
          <span className="nav-icon" aria-hidden="true">🏡</span>
          <span className="nav-label">Greenhouses</span>
        </NavLink>
        <NavLink id="nav-profile" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/profile" onClick={onClose} title="Profile (7)">
          <span className="nav-icon" aria-hidden="true">👤</span>
          <span className="nav-label">Profile</span>
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div className="user-badge" id="user-badge">
          <div className="user-avatar-wrap" id="user-avatar">
            {user?.username ? user.username.slice(0, 1).toUpperCase() : '?'}
          </div>
          <div className="user-info">
            <span className="user-name" id="sidebar-username">{user?.username || '—'}</span>
            <span className="user-role" id="sidebar-role">{user?.is_staff ? 'Staff' : 'Farmer'}</span>
          </div>
        </div>
        <div className="sidebar-actions">
          <button
            className="btn-secondary"
            id="theme-toggle-btn"
            onClick={toggleTheme}
            title="Toggle theme"
            style={{ fontSize: '.85rem' }}
          >
            {theme === 'dark' ? '☀️ Theme' : '🌙 Theme'}
          </button>
          <button className="btn-logout" id="logout-btn" onClick={handleLogout} title="Sign out">
            <span>⏻</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
