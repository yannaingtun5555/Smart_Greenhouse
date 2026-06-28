import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getAccessToken } from './api';
import useAuthStore from './store/useAuthStore';
import useThemeStore from './store/useThemeStore';
import useGreenhouseStore from './store/useGreenhouseStore';
import MobileSidebarProvider from './components/layout/MobileSidebar';
import DashboardLayout from './components/layout/DashboardLayout';
import AuthScreen from './components/auth/AuthScreen';
import Overview from './pages/Overview';
import Sensors from './pages/Sensors';
import Analytics from './pages/Analytics';
import Control from './pages/Control';
import Schedules from './pages/Schedules';
import Greenhouses from './pages/Greenhouses';
import Profile from './pages/Profile';

function ProtectedApp() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapApp = useGreenhouseStore((s) => s.bootstrapApp);

  useEffect(() => {
    if (isAuthenticated) {
      bootstrapApp().catch(() => {});
    }
  }, [isAuthenticated, bootstrapApp]);

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <DashboardLayout />;
}

export default function App() {
  const initTheme = useThemeStore((s) => s.initTheme);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [booting, setBooting] = useState(!!getAccessToken());

  useEffect(() => {
    initTheme();
    if (getAccessToken()) {
      restoreSession().finally(() => setBooting(false));
    } else {
      setBooting(false);
    }
  }, [initTheme, restoreSession]);

  if (booting) {
    return (
      <div className="screen auth-screen active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="auth-card glass-strong" style={{ textAlign: 'center', padding: '40px' }}>
          <span className="logo-icon" style={{ fontSize: '2rem' }}>🌿</span>
          <p style={{ marginTop: '12px', color: 'var(--clr-text3)' }}>Loading GreenMind…</p>
        </div>
      </div>
    );
  }

  return (
    <MobileSidebarProvider>
      <Routes>
        <Route
          path="/"
          element={isAuthenticated ? <Navigate to="/overview" replace /> : <AuthScreen />}
        />
        <Route element={<ProtectedApp />}>
          <Route path="/overview" element={<Overview />} />
          <Route path="/sensors" element={<Sensors />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/control" element={<Control />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/greenhouses" element={<Greenhouses />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to={isAuthenticated ? '/overview' : '/'} replace />} />
      </Routes>
    </MobileSidebarProvider>
  );
}
