export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function formatNumber(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
}

export function formatAge(ageSeconds) {
  if (ageSeconds == null || ageSeconds < 0) return '';
  if (ageSeconds < 60) return 'just now';
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)} min ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

export function safeUpper(value, fallback = '—') {
  return value != null && value !== '' ? String(value).toUpperCase() : fallback;
}

export function titleCase(value, fallback = 'Unknown') {
  if (value == null || value === '') return fallback;
  const str = String(value);
  return str.charAt(0).toUpperCase() + str.slice(1);
}
