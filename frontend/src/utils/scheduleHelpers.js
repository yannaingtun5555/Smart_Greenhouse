import { safeUpper, titleCase } from './formatters';

export function fanTargetLabel(value) {
  return { set1: 'Fan Set 1', set2: 'Fan Set 2', all: 'All Fan Sets' }[value] || 'All Fan Sets';
}

export function fanTargetActionText(value) {
  return { set1: 'Set 1 only', set2: 'Set 2 only', all: 'All fan sets' }[value] || 'All fan sets';
}

export function formatScheduleTrigger(item) {
  if (item.condition_type === 'time') return `Daily at ${item.time_of_day || '—'}`;
  return `When ${item.sensor_name || 'sensor'} ${item.operator || '—'} ${item.threshold ?? '—'}`;
}

export function isFanSchedule(schedule) {
  return schedule?.device_type === 'fan';
}

export { safeUpper, titleCase };
