function getDefaultApiBase() {
  if (typeof window === 'undefined') return 'http://localhost:8000';
  const { hostname, origin, port, protocol } = window.location;
  if (!port || port === '80' || port === '443' || port === '8000') {
    return origin;
  }
  return `${protocol}//${hostname}:8000`;
}

function getRuntimeApiBase() {
  if (typeof window === 'undefined') return '';
  const value = window.__GREENHOUSE_API_BASE__;
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function setApiBase(baseUrl) {
  const normalized = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) return getDefaultApiBase();
  localStorage.setItem('api_base', normalized);
  return normalized;
}

function getApiBase() {
  return (
    localStorage.getItem('api_base') ||
    getRuntimeApiBase() ||
    getDefaultApiBase()
  ).replace(/\/+$/, '');
}

function getAccessToken() {
  return localStorage.getItem('access_token');
}

function getRefreshToken() {
  return localStorage.getItem('refresh_token');
}

function setTokens(tokens) {
  if (tokens.access) localStorage.setItem('access_token', tokens.access);
  if (tokens.refresh) localStorage.setItem('refresh_token', tokens.refresh);
}

function clearTokens() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

async function apiRequest(path, options = {}) {
  const url = `${getApiBase()}${path}`;
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error = new Error(
      (data && data.detail) ||
      (typeof data === 'string' ? data : 'Request failed')
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function login(payload) {
  return apiRequest('/api/v1/auth/login/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function register(payload) {
  return apiRequest('/api/v1/auth/register/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function me() {
  return apiRequest('/api/v1/auth/me/');
}

function updateMe(payload) {
  return apiRequest('/api/v1/auth/me/', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

function listGreenhouses() {
  return apiRequest('/api/v1/greenhouses/');
}

function createGreenhouse(payload) {
  return apiRequest('/api/v1/greenhouses/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function getGreenhouse(id) {
  return apiRequest(`/api/v1/greenhouses/${id}/`);
}

function deleteGreenhouse(id) {
  return apiRequest(`/api/v1/greenhouses/${id}/`, {
    method: 'DELETE',
  });
}

function getSensors(id, limit = 50) {
  return apiRequest(`/api/v1/greenhouses/${id}/sensors/?limit=${encodeURIComponent(limit)}`);
}

function getDeviceState(id) {
  return apiRequest(`/api/v1/greenhouses/${id}/state/`);
}

function sendControl(id, device, action) {
  return apiRequest(`/api/v1/greenhouses/${id}/control/`, {
    method: 'PATCH',
    body: JSON.stringify({ device, action }),
  });
}

function listSchedules(id) {
  return apiRequest(`/api/v1/greenhouses/${id}/schedules/`);
}

function createSchedule(id, payload) {
  return apiRequest(`/api/v1/greenhouses/${id}/schedules/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function deleteSchedule(ghId, scheduleId) {
  return apiRequest(`/api/v1/greenhouses/${ghId}/schedules/${scheduleId}/`, {
    method: 'DELETE',
  });
}
