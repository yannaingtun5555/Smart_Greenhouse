export const state = {
  user: null,
  greenhouses: [],
  selectedGreenhouseId: null,
  page: 'overview',
  schedules: [],
  sensorRows: [],
  deviceState: null,
};

export function getSelectedGreenhouse() {
  return state.greenhouses.find((item) => String(item.id) === String(state.selectedGreenhouseId));
}

