import { useEffect, useRef, useCallback } from 'react';
import useGreenhouseStore from '../store/useGreenhouseStore';

export default function useAutoRefresh(intervalMs = 15000) {
  const bootstrapApp = useGreenhouseStore((s) => s.bootstrapApp);
  const lastSyncRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      await bootstrapApp();
      lastSyncRef.current = new Date();
    } catch {
      // silently fail — connection pill shows offline
    }
  }, [bootstrapApp]);

  useEffect(() => {
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { refresh, lastSyncRef };
}
