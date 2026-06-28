export const SELECTED_GH_KEY = 'selected_greenhouse_id';

export const SENSOR_CARD_CONFIG = [
  { key: 'temperature', label: 'Temperature', unit: '°C', icon: '🌡️', color: '#f59e0b', color2: '#f97316', accent: 'rgba(245,158,11,.1)', max: 50 },
  { key: 'humidity', label: 'Humidity', unit: '%', icon: '💧', color: '#3b82f6', color2: '#6366f1', accent: 'rgba(59,130,246,.1)', max: 100 },
  { key: 'soil_moisture', label: 'Soil Moisture', unit: '%', icon: '🪴', color: '#22c55e', color2: '#14b8a6', accent: 'rgba(34,197,94,.1)', max: 100 },
  { key: 'light_intensity', label: 'Light', unit: 'lx', icon: '☀️', color: '#a855f7', color2: '#ec4899', accent: 'rgba(168,85,247,.1)', max: 10000 },
  { key: 'battery', label: 'Battery', unit: 'V', icon: '🔋', color: '#14b8a6', color2: '#06b6d4', accent: 'rgba(20,184,166,.1)', max: 5 },
];

export const PAGE_TITLES = {
  overview: 'Overview',
  sensors: 'Sensor Data',
  control: 'Device Control',
  schedules: 'Schedules',
  greenhouses: 'Greenhouses',
  analytics: 'Analytics',
  profile: 'Profile & Settings',
};

export const PAGE_KEYS = {
  '1': 'overview',
  '2': 'sensors',
  '3': 'analytics',
  '4': 'control',
  '5': 'schedules',
  '6': 'greenhouses',
  '7': 'profile',
};

export const DEVICE_MAP = {
  fan_set1: 'Fan Set 1',
  fan_set2: 'Fan Set 2',
  pump: 'Water Pump',
  light: 'Light',
};

export const DEVICE_STATE_FIELDS = {
  fan_set1: 'fan_set1',
  fan_set2: 'fan_set2',
  pump: 'water_pump',
  light: 'light',
};
