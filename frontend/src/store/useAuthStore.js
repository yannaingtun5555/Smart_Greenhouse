import { create } from 'zustand';
import * as api from '../api';

const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  is_loading: false,

  login: async (username, password) => {
    set({ is_loading: true });
    try {
      const data = await api.login({ username, password });
      api.setTokens(data);
      const user = await api.me();
      set({ user, isAuthenticated: true, is_loading: false });
      return user;
    } catch (error) {
      set({ is_loading: false });
      throw error;
    }
  },

  register: async (payload) => {
    set({ is_loading: true });
    try {
      await api.register(payload);
      set({ is_loading: false });
    } catch (error) {
      set({ is_loading: false });
      throw error;
    }
  },

  logout: () => {
    api.clearTokens();
    localStorage.removeItem('selected_greenhouse_id');
    set({ user: null, isAuthenticated: false });
  },

  restoreSession: async () => {
    try {
      const user = await api.me();
      set({ user, isAuthenticated: true });
      return user;
    } catch {
      api.clearTokens();
      set({ user: null, isAuthenticated: false });
      return null;
    }
  },

  updateProfile: async (payload) => {
    const updated = await api.updateMe(payload);
    const user = get().user;
    set({ user: { ...user, ...updated } });
    return updated;
  },
}));

export default useAuthStore;
