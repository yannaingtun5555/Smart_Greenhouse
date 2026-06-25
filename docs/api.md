# Smart Greenhouse – REST API Reference

**Base URL:** `http://<server>:8000`  
**API Prefix:** `/api/v1/`  
**Auth:** Bearer JWT (`Authorization: Bearer <access_token>`)  
**Content-Type:** `application/json`

---

## Table of Contents

1. [Authentication](#authentication)
2. [Greenhouses](#greenhouses)
3. [Sensor Data](#sensor-data)
4. [Device Control](#device-control)
5. [Schedules](#schedules)
6. [ESP32 Device Provisioning](#esp32-device-provisioning)
7. [Staff Panel](#staff-panel)
8. [MQTT Topic Map](#mqtt-topic-map)
9. [Data Models](#data-models)

---

## 1. Authentication

All auth endpoints are **public** (no token required) except `/auth/me/`.

### POST `/api/v1/auth/register/`
Register a new user account.

**Request:**
```json
{
  "username": "farmer_john",
  "email": "john@farm.com",
  "password": "SecurePass123",
  "password2": "SecurePass123",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+959123456789"
}
```

**Response `201`:**
```json
{
  "id": 1,
  "username": "farmer_john",
  "email": "john@farm.com",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+959123456789",
  "is_staff": false,
  "date_joined": "2026-06-14T00:00:00Z"
}
```

---

### POST `/api/v1/auth/login/`
Obtain JWT access and refresh tokens.

**Request:**
```json
{
  "username": "farmer_john",
  "password": "SecurePass123"
}
```

**Response `200`:**
```json
{
  "access": "<jwt_access_token>",
  "refresh": "<jwt_refresh_token>"
}
```

> **Staff redirect hint:** After login, check `is_staff` field from `/auth/me/`. If `true`, redirect to the staff panel UI.

---

### POST `/api/v1/auth/token/refresh/`
Get a new access token using a refresh token.

**Request:**
```json
{ "refresh": "<jwt_refresh_token>" }
```

**Response `200`:**
```json
{ "access": "<new_jwt_access_token>" }
```

---

### GET `/api/v1/auth/me/`
Get current user's profile. **Requires auth.**

**Response `200`:**
```json
{
  "id": 1,
  "username": "farmer_john",
  "email": "john@farm.com",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+959123456789",
  "is_staff": false,
  "date_joined": "2026-06-14T00:00:00Z"
}
```

### PATCH `/api/v1/auth/me/`
Update profile fields (`first_name`, `last_name`, `phone`). **Requires auth.**

---

## 2. Greenhouses

All endpoints **require auth**. Users only see their own greenhouses.

### GET `/api/v1/greenhouses/`
List all owned greenhouses (excludes deleted).

**Query params:**
- `?status=pending|active|offline` – filter by status

**Response `200`:**
```json
[
  {
    "id": 1,
    "owner_username": "farmer_john",
    "serial_number": "GH-001",
    "name": "Main Greenhouse",
    "status": "pending",
    "created_at": "2026-06-14T00:00:00Z",
    "updated_at": "2026-06-14T00:00:00Z"
  }
]
```

**Status values:**
| Status | Meaning |
|--------|---------|
| `pending` | Greenhouse registered in app, ESP32 not yet connected |
| `active` | ESP32 connected and token issued |
| `offline` | ESP32 was active but went offline |
| `deleted` | Soft-deleted by user (hidden from list) |

---

### POST `/api/v1/greenhouses/`
Add a new greenhouse. **Requires auth.**

**Request:**
```json
{
  "name": "Main Greenhouse",
  "serial_number": "GH-001"
}
```

**Response `201`:** Greenhouse object (status will be `pending`).

---

### GET `/api/v1/greenhouses/{id}/`
Get greenhouse detail. **Requires auth + ownership.**

---

### DELETE `/api/v1/greenhouses/{id}/`
Soft-delete a greenhouse (sets `status=deleted`). **Requires auth + ownership.**

**Response `200`:**
```json
{ "detail": "Greenhouse deleted." }
```

---

## 3. Sensor Data

### GET `/api/v1/greenhouses/{id}/sensors/`
Get latest sensor readings. **Requires auth + ownership.**

**Query params:**
- `?limit=50` – number of records to return (max 500, default 50)

**Response `200`:**
```json
[
  {
    "id": 1001,
    "greenhouse": 1,
    "timestamp": "2026-06-14T10:30:00Z",
    "temperature": 28.5,
    "humidity": 65.2,
    "soil_moisture": 42.1,
    "light_intensity": 800.0,
    "battery": 3.7
  }
]
```

### GET `/api/v1/greenhouses/{id}/state/`
Get current device state (fan, pump, light). **Requires auth + ownership.**

**Response `200`:**
```json
{
  "greenhouse_id": 1,
  "fan": false,
  "water_pump": false,
  "light": true,
  "energy_state": "battery",
  "updated_at": "2026-06-14T10:30:00Z"
}
```

### GET `/api/v1/greenhouses/{id}/sensors/latest/`
Get the denormalized latest sensor snapshot. **Requires auth + ownership.**

Use this endpoint when the backend may have been asleep on Render free tier.
It reads the single `LatestSensorReading` row instead of scanning the history
table, so the UI can show the last known values immediately after wake-up.

---

## 4. Device Control

### PATCH `/api/v1/greenhouses/{id}/control/`
Send a real-time control command to the ESP32 via MQTT. **Requires auth + ownership.**

> Greenhouse must have `status=active` (ESP32 connected).

**Request:**
```json
{
  "device": "fan",
  "action": "on"
}
```

| Field | Values |
|-------|--------|
| `device` | `fan`, `pump`, `light` |
| `action` | `on`, `off` |

**Response `200`:**
```json
{
  "device": "fan",
  "action": "on",
  "mqtt_sent": true,
  "state": {
    "greenhouse_id": 1,
    "fan": true,
    "water_pump": false,
    "light": true,
    "energy_state": "battery",
    "updated_at": "2026-06-14T10:31:00Z"
  }
}
```

**Error `400`** if greenhouse is not active:
```json
{ "detail": "Greenhouse is not active." }
```

---

## 5. Schedules

### GET `/api/v1/greenhouses/{id}/schedules/`
List all schedules for a greenhouse. **Requires auth + ownership.**

**Response `200`:**
```json
[
  {
    "id": 1,
    "greenhouse": 1,
    "device_type": "fan",
    "condition_type": "sensor",
    "time_of_day": null,
    "sensor_name": "temperature",
    "operator": ">=",
    "threshold": 30.0,
    "action": "on",
    "created_at": "2026-06-14T00:00:00Z"
  },
  {
    "id": 2,
    "greenhouse": 1,
    "device_type": "pump",
    "condition_type": "time",
    "time_of_day": "16:00:00",
    "sensor_name": null,
    "operator": null,
    "threshold": null,
    "action": "on",
    "created_at": "2026-06-14T00:00:00Z"
  }
]
```

---

### POST `/api/v1/greenhouses/{id}/schedules/`
Create a new schedule. **Requires auth + ownership.**

**Time-based example** (pump on at 16:00 every day):
```json
{
  "device_type": "pump",
  "condition_type": "time",
  "time_of_day": "16:00:00",
  "action": "on"
}
```

**Sensor-based example** (fan on when temp ≥ 30°C):
```json
{
  "device_type": "fan",
  "condition_type": "sensor",
  "sensor_name": "temperature",
  "operator": ">=",
  "threshold": 30.0,
  "action": "on"
}
```

**Sensor name options:** `temperature`, `humidity`, `soil_moisture`, `light_intensity`  
**Operator options:** `>`, `<`, `>=`, `<=`, `==`  
**Device options:** `fan`, `pump`, `light`  
**Action options:** `on`, `off`

**Response `201`:** Schedule object. The backend also pushes the full schedule list to the ESP32 via MQTT.

---

### PUT `/api/v1/greenhouses/{id}/schedules/{sid}/`
Replace a schedule. **Requires auth + ownership.**

### PATCH `/api/v1/greenhouses/{id}/schedules/{sid}/`
Partial update a schedule. **Requires auth + ownership.**

### DELETE `/api/v1/greenhouses/{id}/schedules/{sid}/`
Delete a schedule. **Requires auth + ownership.**  
Response: `204 No Content`

> Any write to schedules (create/update/delete) triggers a retained MQTT push
> of the full updated schedule list to `gh/{serial}/schedules`. The ESP32
> should write that list to flash and run schedules locally so they keep
> working even if the Render backend spins down.

---

## 6. ESP32 Device Provisioning

> This endpoint is **public** – no JWT required. The ESP32 calls it once on first boot.

### POST `/api/v1/devices/register/`
Register an ESP32 and receive its API token.

**Request (from ESP32):**
```json
{ "serial_number": "GH-001" }
```

**Response `201`** (first registration):
```json
{ "api_token": "a3f1c8...64 hex chars" }
```

**Response `200`** (already registered – idempotent):
```json
{ "api_token": "a3f1c8...same token" }
```

**Response `404`** if serial_number not in DB (owner hasn't added it yet):
```json
{ "detail": "No greenhouse found with this serial number." }
```

**Flow:**
1. Owner adds greenhouse via frontend → status = `pending`
2. ESP32 boots → `POST /api/v1/devices/register/` with `serial_number`
3. Django generates token → status = `active`
4. ESP32 stores token in flash memory
5. All future MQTT messages include `"token": "<api_token>"` in payload

---

## 7. Staff Panel

> All staff endpoints require `is_staff=true` on the user account.  
> A non-staff user calling these will receive `403 Forbidden`.

### GET `/api/v1/staff/greenhouses/`
List ALL greenhouses system-wide (across all owners).

**Query params:**
- `?status=pending|active|offline|deleted`

**Response `200`:** Same as regular greenhouse list format.

---

### GET `/api/v1/staff/notifications/`
List new greenhouses with `status=pending` (awaiting ESP32 activation).

**Response `200`:**
```json
{
  "count": 2,
  "results": [
    {
      "id": 5,
      "name": "South Greenhouse",
      "serial_number": "GH-005",
      "owner": "farmer_jane",
      "owner_email": "jane@farm.com",
      "created_at": "2026-06-14T08:00:00Z",
      "status": "pending"
    }
  ]
}
```

---

### PATCH `/api/v1/staff/greenhouses/{id}/status/`
Manually override a greenhouse status.

**Request:**
```json
{ "status": "active" }
```

**Valid statuses:** `pending`, `active`, `offline`, `deleted`

**Response `200`:** Updated greenhouse object.

---

## 8. MQTT Topic Map

| Direction | Topic | Publisher | Subscriber | Notes |
|-----------|-------|-----------|------------|-------|
| ESP32 → Server | `gh/{serial}/sensors` | ESP32 | MQTT Worker | Sensor readings |
| ESP32 → Server | `gh/{serial}/state` | ESP32 | MQTT Worker | Actual device state |
| Server → ESP32 | `gh/{serial}/cmd` | Django / MQTT Worker | ESP32 | Control command |
| Server → ESP32 | `gh/{serial}/schedules` | MQTT Worker | ESP32 | Full schedule list |

### Payload: `gh/{serial}/sensors` (ESP32 → Server)
```json
{
  "token": "a3f1c8...",
  "temperature": 28.5,
  "humidity": 65.2,
  "soil_moisture": 42.1,
  "light_intensity": 800.0,
  "battery": 3.7
}
```
> `soil_moisture`, `light_intensity`, `battery` are optional.

### Payload: `gh/{serial}/state` (ESP32 → Server)
```json
{
  "token": "a3f1c8...",
  "fan": true,
  "water_pump": false,
  "light": false,
  "energy_state": "battery"
}
```

### Payload: `gh/{serial}/cmd` (Server → ESP32)
```json
{
  "device": "fan",
  "action": "on"
}
```

### Payload: `gh/{serial}/schedules` (Server → ESP32, retained)
```json
[
  {
    "id": 1,
    "device_type": "fan",
    "condition_type": "sensor",
    "sensor_name": "temperature",
    "operator": ">=",
    "threshold": 30.0,
    "action": "on",
    "time_of_day": null
  },
  {
    "id": 2,
    "device_type": "pump",
    "condition_type": "time",
    "time_of_day": "16:00",
    "action": "on",
    "sensor_name": null,
    "operator": null,
    "threshold": null
  }
]
```

---

## 9. Data Models

### User
| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Auto |
| `username` | string | Unique |
| `email` | string | Unique |
| `first_name` | string | |
| `last_name` | string | |
| `phone` | string | Optional |
| `is_staff` | bool | Staff panel access |
| `date_joined` | datetime | Auto |

### Greenhouse
| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Auto |
| `owner` | FK → User | |
| `serial_number` | string | Unique, from ESP32 sticker |
| `name` | string | User-defined |
| `status` | enum | `pending`, `active`, `offline`, `deleted` |
| `api_token` | string | Generated on ESP32 first boot |
| `created_at` | datetime | Auto |
| `updated_at` | datetime | Auto |

### SensorData
| Field | Type | Notes |
|-------|------|-------|
| `id` | bigint | Auto |
| `greenhouse` | FK | |
| `timestamp` | datetime | Auto (indexed) |
| `temperature` | float | °C |
| `humidity` | float | % |
| `soil_moisture` | float | Optional |
| `light_intensity` | float | Optional |
| `battery` | float | Optional |

### DeviceState (1:1 with Greenhouse)
| Field | Type | Notes |
|-------|------|-------|
| `greenhouse_id` | PK/FK | |
| `fan` | bool | |
| `water_pump` | bool | |
| `light` | bool | |
| `energy_state` | enum | `battery`, `grid` |
| `updated_at` | datetime | Auto |

### Schedule
| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Auto |
| `greenhouse` | FK | |
| `device_type` | enum | `fan`, `pump`, `light` |
| `condition_type` | enum | `time`, `sensor` |
| `time_of_day` | time | Used only when `condition_type=time` |
| `sensor_name` | enum | `temperature`, `humidity`, `soil_moisture`, `light_intensity` |
| `operator` | enum | `>`, `<`, `>=`, `<=`, `==` |
| `threshold` | float | Sensor trigger value |
| `action` | enum | `on`, `off` |
| `created_at` | datetime | Auto |

---

## Error Responses

| Status | Meaning |
|--------|---------|
| `400` | Validation error – check `detail` or field errors |
| `401` | Missing or invalid JWT token |
| `403` | Authenticated but not authorized (wrong owner / not staff) |
| `404` | Resource not found |

**Validation error format:**
```json
{
  "field_name": ["Error message."],
  "non_field_errors": ["General error."]
}
```

---

## Quick Start (curl examples)

```bash
# 1. Register
curl -X POST http://localhost:8000/api/v1/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{"username":"john","email":"john@farm.com","password":"Pass123!","password2":"Pass123!"}'

# 2. Login → get token
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"john","password":"Pass123!"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access'])")

# 3. Add greenhouse
curl -X POST http://localhost:8000/api/v1/greenhouses/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Greenhouse","serial_number":"GH-001"}'

# 4. Simulate ESP32 registration (no token needed)
curl -X POST http://localhost:8000/api/v1/devices/register/ \
  -H "Content-Type: application/json" \
  -d '{"serial_number":"GH-001"}'

# 5. Control fan
curl -X PATCH http://localhost:8000/api/v1/greenhouses/1/control/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device":"fan","action":"on"}'

# 6. Create time-based schedule
curl -X POST http://localhost:8000/api/v1/greenhouses/1/schedules/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device_type":"pump","condition_type":"time","time_of_day":"16:00:00","action":"on"}'
```
