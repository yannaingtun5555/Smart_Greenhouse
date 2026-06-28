import { useState, useEffect, useRef } from 'react';
import useGreenhouseStore from '../../store/useGreenhouseStore';

export default function Topbar({ title, onOpenSidebar }) {
  const greenhouses = useGreenhouseStore((s) => s.greenhouses);
  const selectedGreenhouseId = useGreenhouseStore((s) => s.selectedGreenhouseId);
  const selectGreenhouse = useGreenhouseStore((s) => s.selectGreenhouse);
  const isOnline = useGreenhouseStore((s) => s.isOnline);
  const [spinning, setSpinning] = useState(false);
  const lastSyncRef = useRef(null);

  // Tick last-sync label
  useEffect(() => {
    const interval = setInterval(() => {
      const el = document.getElementById('last-sync');
      if (!el || !lastSyncRef.current) return;
      const secs = Math.floor((Date.now() - lastSyncRef.current.getTime()) / 1000);
      if (secs < 12) el.textContent = 'Updated just now';
      else if (secs < 60) el.textContent = `Updated ${secs}s ago`;
      else if (secs < 3600) el.textContent = `Updated ${Math.floor(secs / 60)}m ago`;
      else el.textContent = `Updated ${Math.floor(secs / 3600)}h ago`;
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setSpinning(true);
    try {
      await useGreenhouseStore.getState().refreshSelectedData();
      lastSyncRef.current = new Date();
      const el = document.getElementById('last-sync');
      if (el) { el.textContent = 'Updated just now'; el.classList.remove('hidden'); }
    } finally {
      setTimeout(() => setSpinning(false), 600);
    }
  };

  const handleChange = async (e) => {
    const id = e.target.value || null;
    selectGreenhouse(id);
    const gh = useGreenhouseStore.getState().greenhouses.find((g) => String(g.id) === String(id));
    if (gh) useGreenhouseStore.getState().addActivity(`Switched to greenhouse "${gh.name}"`);
    await useGreenhouseStore.getState().refreshSelectedData();
  };

  return (
    <header className="topbar" id="topbar">
      <div className="topbar-left">
        <button className="mobile-menu-btn" id="mobile-menu-btn" onClick={onOpenSidebar} aria-label="Open menu" aria-expanded="false">☰</button>
        <h1 className="page-title" id="page-title">{title}</h1>
      </div>
      <div className="topbar-right">
        <div className="gh-selector-wrap">
          <span className="gh-selector-icon" aria-hidden="true">🏡</span>
          <select id="gh-select" className="gh-select-input" value={selectedGreenhouseId || ''} onChange={handleChange} aria-label="Select greenhouse">
            <option value="">Select Greenhouse…</option>
            {greenhouses.map((g) => (
              <option key={g.id} value={g.id}>{g.name} ({g.serial_number})</option>
            ))}
          </select>
        </div>
        <button
          className={`btn-secondary btn-icon-topbar ${spinning ? 'refresh-spinning' : ''}`}
          id="refresh-btn"
          onClick={handleRefresh}
          title="Refresh data (R)"
          aria-label="Refresh data"
        >↻</button>
        <span className="last-sync hidden" id="last-sync" aria-live="polite" />
        <div className="connection-pill" title="API connection status">
          <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} id="connection-status" aria-label={isOnline ? 'Online' : 'Offline'} />
          <span className={`connection-label ${isOnline ? 'is-live' : ''}`} id="connection-label">{isOnline ? 'Live' : 'Offline'}</span>
        </div>
      </div>
    </header>
  );
}
