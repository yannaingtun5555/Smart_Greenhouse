import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useGreenhouseStore from '../store/useGreenhouseStore';
import useThemeStore from '../store/useThemeStore';
import useAuthStore from '../store/useAuthStore';
import { PAGE_KEYS } from '../utils/constants';

export default function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const refreshSelectedData = useGreenhouseStore((s) => s.refreshSelectedData);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    function handler(e) {
      if (!isAuthenticated) return;
      const el = document.activeElement;
      if (!el) return;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        refreshSelectedData();
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        toggleTheme();
        return;
      }
      const page = PAGE_KEYS[e.key];
      if (page) {
        e.preventDefault();
        navigate(`/${page}`);
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isAuthenticated, navigate, refreshSelectedData, toggleTheme]);
}
