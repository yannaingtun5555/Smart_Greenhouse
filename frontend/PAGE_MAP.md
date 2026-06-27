# Frontend page map

Quick reference for which files build each screen in the GreenMind dashboard.

## How the app is assembled

```
index.html          Shell: auth screen, sidebar, topbar, modals, empty page placeholders
    │
    ├─ style.css    Global styles for every page (single source of truth)
    │
    ├─ src/main.js  Bootstraps app, wires events, exposes window.* handlers
    │
    └─ src/core/page-loader.js
           fetch pages/<name>.html  →  inject into  #page-<name>  in index.html
```

On `DOMContentLoaded`, `main.js` calls `loadPageFragments()` before auth/session init. Each fragment file must contain a root `<section id="page-<name>" data-page-fragment="ready">`.

Navigation is handled by `navigateTo(page)` in `src/features/greenhouses.js`, which toggles `.hidden` on `#page-<name>` sections and runs page-specific data loaders.

---

## Page → file mapping

| Page (route key) | Nav button id   | HTML fragment              | Page logic (JS)           | Styles                         |
|------------------|-----------------|----------------------------|---------------------------|--------------------------------|
| `overview`       | `nav-overview`  | `pages/overview.html`      | `src/pages/overview.js`   | `style.css` (Overview section) |
| `sensors`        | `nav-sensors`   | `pages/sensors.html`       | `src/pages/overview.js`   | `style.css` (Sensors section)  |
| `analytics`      | `nav-analytics` | `pages/analytics.html`     | `src/pages/analytics.js`  | `style.css` (Analytics section) |
| `control`        | `nav-control`   | `pages/control.html`       | `src/pages/control.js`    | `style.css` (Control section)  |
| `schedules`      | `nav-schedules` | `pages/schedules.html`     | `src/pages/schedules.js`  | `style.css` (Schedules section) |
| `profile`        | `nav-profile`   | `pages/profile.html`       | `src/pages/profile.js`    | `style.css` (Profile section)  |
| `greenhouses`    | `nav-greenhouses` | **inline in `index.html`** | `src/features/greenhouses.js` (`renderGreenhouses`) | `style.css` (Greenhouses section) |

### Placeholder in shell (`index.html`)

Each routed page has a mount point inside `#main-content`:

```html
<section id="page-overview" class="page hidden"></section>   <!-- filled by page-loader -->
<section id="page-greenhouses" class="page hidden">…</section> <!-- markup stays inline -->
```

---

## Per-page responsibilities

### Overview (`overview`)
- **HTML:** stats bar, sensor card grid, device status indicators, activity log
- **JS:** `renderOverviewStatsBar()`, `renderSensorCards()`; activity log lives in `greenhouses.js`
- **Triggered on:** every `bootstrapApp()` / data refresh; visible by default after login

### Sensor Data (`sensors`)
- **HTML:** limit selector, sensor readings table
- **JS:** `renderSensorsTable()`, `loadSensorHistory()` (API fetch + render)
- **Triggered on:** `navigateTo('sensors')`, greenhouse change, limit change

### Analytics (`analytics`)
- **HTML:** range selector, stat cards, chart canvases
- **JS:** `loadAnalytics()` — fetches history, renders Chart.js charts
- **Triggered on:** `navigateTo('analytics')`

### Device Control (`control`)
- **HTML:** fan set 1/2, pump, light control cards
- **JS:** `renderDeviceState()`, `sendControlAction()` in `greenhouses.js`
- **Triggered on:** `navigateTo('control')`, after control commands

### Schedules (`schedules`)
- **HTML:** schedule list container
- **JS:** `renderSchedules()`, `loadSchedules()`, `handleCreateSchedule()`, modals wired in `main.js`
- **Triggered on:** `navigateTo('schedules')`, create/delete schedule

### Profile (`profile`)
- **HTML:** avatar, profile form, API base settings
- **JS:** `renderProfilePage()`, `handleProfileUpdate()` in `main.js`
- **Triggered on:** `navigateTo('profile')`, after profile save

### Greenhouses (`greenhouses`)
- **HTML:** header + `#greenhouses-grid` — **not** a fragment file; markup is in `index.html`
- **JS:** `renderGreenhouses()`, `handleAddGh()`, modal in `greenhouses.js`
- **Triggered on:** `navigateTo('greenhouses')`, after add/delete greenhouse

---

## Shared shell (not tied to one page)

| Area | Location | Logic |
|------|----------|-------|
| Auth (login / register) | `index.html` `#auth-screen` | `src/features/auth.js` |
| Sidebar + topbar | `index.html` | `src/main.js` (theme, mobile menu) |
| Greenhouse modal | `index.html` `#gh-modal` | `src/features/greenhouses.js` |
| Schedule modals | `index.html` `#schedule-modal`, `#schedule-details-modal` | `src/pages/schedules.js` |
| Toasts | `index.html` `#toast-container` | `src/core/ui.js` |
| Micro-interactions | `src/core/micro.js` | Keyboard shortcuts, password toggles, last-sync label |

---

## Core modules (used by all pages)

| File | Role |
|------|------|
| `src/main.js` | Entry point, global `window.*` bindings, DOM ready init |
| `src/core/page-loader.js` | `PAGE_FILES` registry + fragment fetch/inject |
| `src/core/api.js` | REST client, JWT, API base URL |
| `src/core/store.js` | Shared app state (`state.user`, greenhouses, sensors, …) |
| `src/core/dom.js` | `$()`, `escapeHtml`, date/number formatters |
| `src/core/ui.js` | Toasts, screens, errors, connection pill, auth tabs |
| `src/features/greenhouses.js` | Navigation, greenhouse CRUD, data bootstrap, control |
| `src/features/auth.js` | Login, register, logout, session restore |

---

## Styles

All page styles live in **`style.css`**. Files under `pages/*.css` are leftover from an earlier split and are **not loaded** at runtime. Edit `style.css` when changing layout or visuals.

Search `style.css` by section comment, e.g. `OVERVIEW`, `SENSORS TABLE`, `CONTROL PAGE`, `ANALYTICS`, `PROFILE`.

---

## Adding a new page

1. Add `<section id="page-<key>" class="page hidden"></section>` to `index.html`.
2. Create `pages/<key>.html` with root `<section id="page-<key>" … data-page-fragment="ready">`.
3. Register in `src/core/page-loader.js` → `PAGE_FILES`.
4. Add nav button `id="nav-<key>"` and `onclick="navigateTo('<key>')"` in `index.html`.
5. Create `src/pages/<key>.js` with render/load exports.
6. Extend `navigateTo()` in `src/features/greenhouses.js` (title, active nav, page-specific loader).
7. Add styles to `style.css`.
8. Update this file.

---

## Build & serve

| Script / path | Purpose |
|---------------|---------|
| `server/dev-frontend.sh` | Static serve on `:5500` (frontend root) |
| Django `frontend_asset` view | Serves `pages/*.html` and assets when using `server/dev.sh` |
| `build-render.sh` | Copies `index.html`, `style.css`, `src/`, `pages/` → `dist/` for Render static deploy |

Fragment paths are relative (`pages/overview.html`), so the app must be served from the `frontend/` root (or equivalent static root that includes `pages/`).
