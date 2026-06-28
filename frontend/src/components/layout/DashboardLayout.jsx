import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useMobileSidebar } from './MobileSidebar';
import { PAGE_TITLES } from '../../utils/constants';
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts';
import useAutoRefresh from '../../hooks/useAutoRefresh';

export default function DashboardLayout() {
  const location = useLocation();
  const pageKey = location.pathname.replace(/^\//, '') || 'overview';
  const title = PAGE_TITLES[pageKey] || 'Overview';
  const { open, openSidebar, closeSidebar } = useMobileSidebar();

  useKeyboardShortcuts();
  useAutoRefresh();

  return (
    <div className="screen app-screen" id="app-screen" role="application">
      <Sidebar onClose={closeSidebar} mobileOpen={open} />
      <main className="main-content" id="main-content">
        <Topbar title={title} onOpenSidebar={openSidebar} />
        <Outlet />
      </main>
      <div
        className={`sidebar-overlay${open ? ' active' : ''}`}
        id="sidebar-overlay"
        onClick={closeSidebar}
        aria-hidden={!open}
      />
    </div>
  );
}
