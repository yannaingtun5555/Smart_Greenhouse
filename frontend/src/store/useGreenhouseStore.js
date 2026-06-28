import { create } from 'zustand';
import * as api from '../api';
import { SELECTED_GH_KEY } from '../utils/constants';

const useGreenhouseStore = create((set, get) => ({
  greenhouses: [],
  selectedGreenhouseId: null,
  sensorRows: [],
  latestReading: null,
  deviceState: null,
  schedules: [],
  isOnline: false,
  activityLog: [],

  getSelectedGreenhouse: () => {
    const { greenhouses, selectedGreenhouseId } = get();
    return greenhouses.find((item) => String(item.id) === String(selectedGreenhouseId));
  },

  addActivity: (message) => {
    set((state) => {
      const log = [{ message, time: new Date() }, ...state.activityLog].slice(0, 20);
      return { activityLog: log };
    });
  },

  loadGreenhouses: async () => {
    try {
      const data = await api.listGreenhouses();
      const greenhouses = Array.isArray(data) ? data : (data.results || []);
      set((state) => {
        const persisted = localStorage.getItem(SELECTED_GH_KEY);
        let selectedGreenhouseId = state.selectedGreenhouseId;
        if (persisted && greenhouses.some((g) => String(g.id) === persisted)) {
          selectedGreenhouseId = persisted;
        } else if (!selectedGreenhouseId && greenhouses[0]) {
          selectedGreenhouseId = String(greenhouses[0].id);
        }
        if (selectedGreenhouseId) {
          localStorage.setItem(SELECTED_GH_KEY, selectedGreenhouseId);
        }
        return { greenhouses, selectedGreenhouseId };
      });
    } catch (error) {
      set({ greenhouses: [] });
      throw error;
    }
  },

  selectGreenhouse: (id) => {
    set({ selectedGreenhouseId: id });
    if (id) {
      localStorage.setItem(SELECTED_GH_KEY, id);
    } else {
      localStorage.removeItem(SELECTED_GH_KEY);
    }
  },

  refreshSelectedData: async () => {
    const greenhouse = get().getSelectedGreenhouse();
    if (!greenhouse) {
      set({ deviceState: null, sensorRows: [], schedules: [], isOnline: false });
      return;
    }

    try {
      const [sensors, latest, deviceState, schedules] = await Promise.all([
        api.getSensors(greenhouse.id).catch(() => []),
        api.getLatestSensors(greenhouse.id).catch(() => null),
        api.getDeviceState(greenhouse.id).catch(() => null),
        api.listSchedules(greenhouse.id).catch(() => []),
      ]);

      const normalizeSensorResponse = (response) => {
        if (Array.isArray(response)) return response;
        if (response && Array.isArray(response.results)) return response.results;
        return [];
      };

      const sensorRows = normalizeSensorResponse(sensors);
      const finalRows = !sensorRows.length && latest ? [latest] : sensorRows;

      set({
        sensorRows: finalRows,
        latestReading: latest,
        deviceState,
        schedules: Array.isArray(schedules) ? schedules : [],
        isOnline: true,
      });
    } catch {
      set({ isOnline: false });
    }
  },

  loadSensors: async (limit = 50) => {
    const greenhouse = get().getSelectedGreenhouse();
    if (!greenhouse) { set({ sensorRows: [] }); return; }
    try {
      const response = await api.getSensors(greenhouse.id, limit);
      const normalizeSensorResponse = (r) => {
        if (Array.isArray(r)) return r;
        if (r && Array.isArray(r.results)) return r.results;
        return [];
      };
      set({ sensorRows: normalizeSensorResponse(response) });
    } catch {
      set({ sensorRows: [] });
    }
  },

  loadSchedules: async () => {
    const greenhouse = get().getSelectedGreenhouse();
    if (!greenhouse) { set({ schedules: [] }); return; }
    try {
      const schedules = await api.listSchedules(greenhouse.id);
      set({ schedules: Array.isArray(schedules) ? schedules : [] });
    } catch {
      set({ schedules: [] });
    }
  },

  sendControlAction: async (device, action) => {
    const greenhouse = get().getSelectedGreenhouse();
    if (!greenhouse) throw new Error('Select a greenhouse first');

    const previousState = get().deviceState ? { ...get().deviceState } : null;
    const optimisticState = previousState ? { ...previousState } : {
      greenhouse_id: greenhouse.id,
      fan_set1: false, fan_set2: false, water_pump: false, light: false,
    };
    const stateField = { fan_set1: 'fan_set1', fan_set2: 'fan_set2', pump: 'water_pump', light: 'light' }[device];
    if (stateField) {
      optimisticState[stateField] = action === 'on';
      optimisticState.updated_at = new Date().toISOString();
      set({ deviceState: optimisticState });
    }

    try {
      await api.sendControl(greenhouse.id, device, action);
      await get().refreshSelectedData();
    } catch (error) {
      if (previousState) set({ deviceState: previousState });
      throw error;
    }
  },

  addGreenhouse: async (name, serial_number) => {
    const gh = await api.createGreenhouse({ name, serial_number });
    await get().loadGreenhouses();
    get().addActivity(`Greenhouse "${gh.name}" registered`);
    return gh;
  },

  deleteGreenhouse: async (id) => {
    const gh = get().greenhouses.find((g) => String(g.id) === String(id));
    await api.deleteGreenhouse(id);
    if (String(get().selectedGreenhouseId) === String(id)) {
      set({ selectedGreenhouseId: null });
      localStorage.removeItem(SELECTED_GH_KEY);
    }
    await get().loadGreenhouses();
    get().addActivity(`Greenhouse "${gh?.name}" deleted`);
  },

  createScheduleAction: async (payload) => {
    const greenhouse = get().getSelectedGreenhouse();
    if (!greenhouse) throw new Error('Select a greenhouse first.');
    const created = await api.createSchedule(greenhouse.id, payload);
    await get().loadSchedules();
    return created;
  },

  deleteScheduleAction: async (scheduleId) => {
    const greenhouse = get().getSelectedGreenhouse();
    if (!greenhouse) return;
    await api.deleteSchedule(greenhouse.id, scheduleId);
    set((state) => ({
      schedules: state.schedules.filter((item) => String(item.id) !== String(scheduleId)),
    }));
  },

  bootstrapApp: async () => {
    try {
      await get().loadGreenhouses();
      await get().refreshSelectedData();
    } catch {
      set({ isOnline: false });
    }
  },
}));

export default useGreenhouseStore;
