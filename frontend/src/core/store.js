export const state = {
  user: null,
  greenhouses: [],
  selectedGreenhouseId: null,
  page: 'overview',
  schedules: [],
  sensorRows: [],
  latestReading: null,    // denormalized latest reading with age_seconds, is_stale
  deviceState: null,
};

export function getSelectedGreenhouse() {
  return state.greenhouses.find((item) => String(item.id) === String(state.selectedGreenhouseId));
}

