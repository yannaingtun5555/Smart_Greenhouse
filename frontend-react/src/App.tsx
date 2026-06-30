import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Overview from './pages/Overview';
import Analytics from './pages/Analytics';
import Control from './pages/Control';
import Greenhouses from './pages/Greenhouses';
import Sensors from './pages/Sensors';
import Schedules from './pages/Schedules';
import Profile from './pages/Profile';

const navItems = [
  { to: '/overview', label: 'Overview' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/control', label: 'Control' },
  { to: '/greenhouses', label: 'Greenhouses' },
  { to: '/sensors', label: 'Sensors' },
  { to: '/schedules', label: 'Schedules' },
  { to: '/profile', label: 'Profile' },
];

export default function App() {
  return (
    <div style={{ minHeight: '100vh', padding: '16px' }}>
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: '16px',
          borderBottom: '1px solid #e5e7eb',
          marginBottom: '16px',
        }}
      >
        <Link to="/overview" style={{ fontWeight: 700, textDecoration: 'none', color: 'inherit' }}>
          Smart Greenhouse
        </Link>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                textDecoration: 'none',
                color: 'inherit',
                border: '1px solid #d1d5db',
                borderRadius: '9999px',
                padding: '6px 12px',
                background: isActive ? '#111827' : 'transparent',
                color: isActive ? '#ffffff' : 'inherit',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/control" element={<Control />} />
          <Route path="/greenhouses" element={<Greenhouses />} />
          <Route path="/sensors" element={<Sensors />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
      <footer style={{ marginTop: '24px', paddingTop: '12px', borderTop: '1px solid #e5e7eb', fontSize: '0.875rem', color: '#6b7280' }}>
        Plain React shell, using the existing frontend pages.
      </footer>
    </div>
  );
}
