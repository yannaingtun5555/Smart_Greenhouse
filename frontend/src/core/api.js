export function getDefaultApiBase() {
  if (typeof window === 'undefined') return 'http://localhost:8000';
  const { hostname, origin, port, protocol } = window.location;
  // UI served by Django on the API port — use the same origin (works from phone on LAN).
  if (!port || port === '80' || port === '443' || port === '8000') {
    return origin;
  }
  // Separate static dev server — API stays on :8000 of the same host.
  return `${protocol}//${hostname}:8000`;
}

function apiBase() {
  return (localStorage.getItem('api_base') || getDefaultApiBase()).replace(/\/+$/, '');
}

export function getResolvedApiBase() {
  return apiBase();
}

function token() {
  return localStorage.getItem('access_token');
}

function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  const access = token();
  if (access) headers.set('Authorization', `Bearer ${access}`);
  return fetch(`${apiBase()}${path}`, { ...options, headers }).then(async (response) => {
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error((data && data.detail) || (typeof data === 'string' ? data : 'Request failed'));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  });
}

export function setApiBase(baseUrl) {
  const normalized = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) return apiBase();
  localStorage.setItem('api_base', normalized);
  return normalized;
}

export function setTokens(tokens) {
  if (tokens.access) localStorage.setItem('access_token', tokens.access);
  if (tokens.refresh) localStorage.setItem('refresh_token', tokens.refresh);
}

export function clearTokens() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

export function getAccessToken() {
  return localStorage.getItem('access_token');
}

export const login = (payload) => request('/api/v1/auth/login/', { method: 'POST', body: JSON.stringify(payload) });
export const register = (payload) => request('/api/v1/auth/register/', { method: 'POST', body: JSON.stringify(payload) });
export const me = () => request('/api/v1/auth/me/');
export const updateMe = (payload) => request('/api/v1/auth/me/', { method: 'PATCH', body: JSON.stringify(payload) });
export const listGreenhouses = () => request('/api/v1/greenhouses/');
export const createGreenhouse = (payload) => request('/api/v1/greenhouses/', { method: 'POST', body: JSON.stringify(payload) });
export const deleteGreenhouse = (id) => request(`/api/v1/greenhouses/${id}/`, { method: 'DELETE' });
export const getSensors = (id, limit = 50) => request(`/api/v1/greenhouses/${id}/sensors/?limit=${encodeURIComponent(limit)}`);
export const getDeviceState = (id) => request(`/api/v1/greenhouses/${id}/state/`);
export const sendControl = (id, device, action) => request(`/api/v1/greenhouses/${id}/control/`, { method: 'PATCH', body: JSON.stringify({ device, action }) });
export const listSchedules = (id) => request(`/api/v1/greenhouses/${id}/schedules/`);
export const createSchedule = (id, payload) => request(`/api/v1/greenhouses/${id}/schedules/`, { method: 'POST', body: JSON.stringify(payload) });
export const deleteSchedule = (ghId, scheduleId) => request(`/api/v1/greenhouses/${ghId}/schedules/${scheduleId}/`, { method: 'DELETE' });

