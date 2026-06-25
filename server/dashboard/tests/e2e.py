"""
Smart Greenhouse – Full End-to-End Integration Tests
=====================================================

Simulates the complete lifecycle:
  1. Register + Login (user auth)
  2. FE creates greenhouse → server stores it as status=pending
  3. ESP32 registers with serial_number → server sets status=active, issues api_token
  4. ESP32 sends sensor data via MQTT → mqtt_worker writes to DB
  5. FE reads sensor data from API
  6. FE sends control command → server sends MQTT cmd, updates DeviceState
  7. FE creates schedule → server saves it + pushes via MQTT
  8. Verify DB state at each step

Requirements (all available via Docker stack):
  - Django/DB running at http://localhost:8000
  - MQTT broker on MQTT_BROKER:MQTT_PORT
"""

import json
import os
import time
import uuid
import warnings
from pathlib import Path

import paho.mqtt.client as mqtt
import pytest
import requests


def _load_env_file() -> None:
    """
    Load server/.env into os.environ so the tests talk to the same broker as
    the Docker stack (django + mqtt_worker) without manual `export`s.

    Existing environment variables always win (os.environ.setdefault) so
    explicit exports / CI config are never overridden.
    """
    candidates = [
        Path(__file__).resolve().parents[2] / '.env',           # server/.env
        Path(__file__).resolve().parents[1] / '.env',           # dashboard/.env
        Path.cwd() / '.env',
    ]
    for env_path in candidates:
        if not env_path.exists():
            continue
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip())
        break


_load_env_file()

# ---------------------------------------------------------------------------
# paho-mqtt v2 compatibility: use CallbackAPIVersion.VERSION2 so v1-style
# callbacks don't raise the deprecation error on connect.
# ---------------------------------------------------------------------------
try:
    from paho.mqtt.enums import CallbackAPIVersion
    _CALLBACK_API_VERSION = CallbackAPIVersion.VERSION2
except ImportError:  # paho-mqtt v1
    _CALLBACK_API_VERSION = None

# Suppress paho-mqtt v1 callback deprecation warnings in test code
warnings.filterwarnings("ignore", message="Callback API version 1 is deprecated.*", category=DeprecationWarning)

# ---------------------------------------------------------------------------
# Config – can be overridden via env vars for CI
# ---------------------------------------------------------------------------
BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")
MQTT_HOST = os.environ.get("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USERNAME = os.environ.get("MQTT_USERNAME")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD")
MQTT_USE_TLS = os.environ.get("MQTT_USE_TLS", "false").lower() in {"1", "true", "yes", "on"}


def make_mqtt_client(client_id: str) -> mqtt.Client:
    """Create an MQTT client with the right callback API version for paho v1/v2."""
    kwargs = {"client_id": client_id, "protocol": mqtt.MQTTv311}
    if _CALLBACK_API_VERSION is not None:
        kwargs["callback_api_version"] = _CALLBACK_API_VERSION
    return mqtt.Client(**kwargs)

# Unique suffix so parallel runs don't collide
RUN_ID = uuid.uuid4().hex[:6]
TEST_USER = f"gh_test_{RUN_ID}"
TEST_EMAIL = f"{TEST_USER}@test.local"
TEST_PASS = "TestPass@123"
SERIAL = f"ESP-TEST-{RUN_ID.upper()}"


# ---------------------------------------------------------------------------
# Helper: HTTP session with base URL
# ---------------------------------------------------------------------------
class APIClient:
    def __init__(self, base_url):
        self.base = base_url.rstrip("/")
        self.session = requests.Session()
        self.token = None

    def set_token(self, token):
        self.token = token
        self.session.headers["Authorization"] = f"Bearer {token}"

    def post(self, path, **kw):
        return self.session.post(f"{self.base}{path}", **kw)

    def get(self, path, **kw):
        return self.session.get(f"{self.base}{path}", **kw)

    def patch(self, path, **kw):
        return self.session.patch(f"{self.base}{path}", **kw)

    def delete(self, path, **kw):
        return self.session.delete(f"{self.base}{path}", **kw)


# ---------------------------------------------------------------------------
# MQTT helper: publish a message and optionally wait for a subscription
# ---------------------------------------------------------------------------
def mqtt_publish(topic, payload_dict, host=MQTT_HOST, port=MQTT_PORT):
    """Publish a single message to the broker. Returns True on success."""
    try:
        import paho.mqtt.publish as pub
        kwargs = {
            "topic": topic,
            "payload": json.dumps(payload_dict),
            "hostname": host,
            "port": port,
            "qos": 1,
        }
        if MQTT_USERNAME:
            kwargs["auth"] = {"username": MQTT_USERNAME, "password": MQTT_PASSWORD}
        if MQTT_USE_TLS:
            kwargs["tls"] = {}
        pub.single(**kwargs)
        return True
    except Exception as exc:
        print(f"[MQTT publish error] {exc}")
        return False


def mqtt_subscribe_once(topic, timeout=5, host=MQTT_HOST, port=MQTT_PORT):
    """Subscribe to a topic and return the first payload received (as dict)."""
    received = {}

    def on_message(client, userdata, msg):
        try:
            received["data"] = json.loads(msg.payload.decode())
        except Exception:
            received["data"] = msg.payload.decode()
        client.disconnect()

    client = make_mqtt_client(f"test_sub_{uuid.uuid4().hex[:6]}")
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    if MQTT_USE_TLS:
        client.tls_set()
    client.on_message = on_message
    client.connect(host, port, 60)
    client.subscribe(topic, qos=1)
    client.loop_start()

    deadline = time.time() + timeout
    while time.time() < deadline and "data" not in received:
        time.sleep(0.1)

    client.loop_stop()
    return received.get("data")


# ===========================================================================
# Test Suite
# ===========================================================================

class TestGreenhouseFullFlow:
    """
    Runs as a single ordered class so state carries between methods.
    pytest-ordering or run order matters; methods are prefixed 01_, 02_... etc.
    """

    api = APIClient(BASE_URL)
    gh_id = None
    api_token = None  # ESP32 api_token after registration

    # -----------------------------------------------------------------------
    # Step 0: Health – ensure the server is reachable
    # -----------------------------------------------------------------------
    def test_00_server_health(self):
        """Server must return a valid response (even 404 means it's alive)."""
        r = requests.get(f"{BASE_URL}/api/v1/greenhouses/", timeout=10)
        assert r.status_code in (200, 401, 403), \
            f"Server unreachable or unexpected status: {r.status_code}"
        print("\n✅  Server is reachable")

    # -----------------------------------------------------------------------
    # Step 1: Register a new user
    # -----------------------------------------------------------------------
    def test_01_user_register(self):
        r = self.api.post("/api/v1/auth/register/", json={
            "username": TEST_USER,
            "email": TEST_EMAIL,
            "password": TEST_PASS,
            "password2": TEST_PASS,
        })
        assert r.status_code == 201, f"Register failed: {r.text}"
        data = r.json()
        assert data["username"] == TEST_USER
        print(f"\n✅  User registered: {TEST_USER}")

    # -----------------------------------------------------------------------
    # Step 2: Login and get JWT token
    # -----------------------------------------------------------------------
    def test_02_user_login(self):
        r = self.api.post("/api/v1/auth/login/", json={
            "username": TEST_USER,
            "password": TEST_PASS,
        })
        assert r.status_code == 200, f"Login failed: {r.text}"
        tokens = r.json()
        assert "access" in tokens
        self.__class__.api.set_token(tokens["access"])
        print(f"\n✅  Login successful, JWT acquired")

    # -----------------------------------------------------------------------
    # Step 2b: Verify anon POST to /greenhouses/ is rejected (bug fix check)
    # -----------------------------------------------------------------------
    def test_02b_anon_create_greenhouse_rejected(self):
        """Unauthenticated POST must return 401, not crash with 500."""
        r = requests.post(f"{BASE_URL}/api/v1/greenhouses/", json={
            "name": "Anon GH",
            "serial_number": "ANON-001",
        })
        assert r.status_code == 401, \
            f"Expected 401 for anonymous create, got {r.status_code}: {r.text}"
        print("\n✅  Anonymous greenhouse create correctly rejected (401)")

    # -----------------------------------------------------------------------
    # Step 3: FE creates a new greenhouse (status should be 'pending')
    # -----------------------------------------------------------------------
    def test_03_fe_create_greenhouse(self):
        r = self.api.post("/api/v1/greenhouses/", json={
            "name": "Test Greenhouse",
            "serial_number": SERIAL,
        })
        assert r.status_code == 201, f"GH create failed: {r.text}"
        data = r.json()
        assert data["serial_number"] == SERIAL
        assert data["status"] == "pending", \
            f"Expected status=pending, got {data['status']}"
        self.__class__.gh_id = data["id"]
        print(f"\n✅  Greenhouse created: id={self.__class__.gh_id} status=pending")

    # -----------------------------------------------------------------------
    # Step 4: Verify greenhouse appears in list
    # -----------------------------------------------------------------------
    def test_04_list_greenhouses(self):
        r = self.api.get("/api/v1/greenhouses/")
        assert r.status_code == 200, f"List failed: {r.text}"
        data = r.json()
        assert isinstance(data, list)
        ids = [g["id"] for g in data]
        assert self.__class__.gh_id in ids, \
            f"New greenhouse id {self.__class__.gh_id} not in list"
        print(f"\n✅  Greenhouse appears in list ({len(data)} total)")

    # -----------------------------------------------------------------------
    # Step 5: ESP32 registers with serial_number → gets api_token + active
    # -----------------------------------------------------------------------
    def test_05_esp32_device_register(self):
        # No auth header needed; ESP32 uses serial number only
        sched_topic = f"gh/{SERIAL}/schedules"
        sched_received = {}

        def on_sched(client, userdata, msg):
            try:
                data = json.loads(msg.payload.decode())
                if isinstance(data, list):
                    sched_received["data"] = data
                    client.disconnect()
            except Exception:
                pass

        sub = make_mqtt_client(f"test_reg_sched_{uuid.uuid4().hex[:6]}")
        if MQTT_USERNAME:
            sub.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        if MQTT_USE_TLS:
            sub.tls_set()
        sub.on_message = on_sched
        sub.connect(MQTT_HOST, MQTT_PORT, 60)
        sub.subscribe(sched_topic, qos=1)
        sub.loop_start()
        time.sleep(0.3)

        r = requests.post(f"{BASE_URL}/api/v1/devices/register/", json={
            "serial_number": SERIAL,
        })
        assert r.status_code == 201, f"Device register failed: {r.text}"
        data = r.json()
        assert "api_token" in data, "No api_token in response"
        assert len(data["api_token"]) == 64, "Token should be 64 hex chars"
        self.__class__.api_token = data["api_token"]

        deadline = time.time() + 5
        while time.time() < deadline and not sched_received.get("data"):
            time.sleep(0.1)
        sub.loop_stop()

        assert sched_received.get("data") is not None, \
            "Did not receive schedules on MQTT after device register"
        assert isinstance(sched_received["data"], list)
        print(f"\n✅  ESP32 registered, token: {self.__class__.api_token[:16]}... schedules pushed ({len(sched_received['data'])} rules)")

    # -----------------------------------------------------------------------
    # Step 5b: ESP32 register again → idempotent (same token, 200)
    # -----------------------------------------------------------------------
    def test_05b_esp32_register_idempotent(self):
        r = requests.post(f"{BASE_URL}/api/v1/devices/register/", json={
            "serial_number": SERIAL,
        })
        assert r.status_code == 200, f"Expected 200 for re-register, got {r.status_code}"
        assert r.json()["api_token"] == self.__class__.api_token, "Token changed on re-register!"
        print("\n✅  ESP32 re-register is idempotent (same token returned)")

    # -----------------------------------------------------------------------
    # Step 6: Greenhouse status is now 'active' (API confirms)
    # -----------------------------------------------------------------------
    def test_06_greenhouse_status_active(self):
        r = self.api.get(f"/api/v1/greenhouses/{self.__class__.gh_id}/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "active", \
            f"Expected status=active after ESP32 register, got {data['status']}"
        print("\n✅  Greenhouse status = active ✓")

    # -----------------------------------------------------------------------
    # Step 7: MQTT broker connectivity check
    # -----------------------------------------------------------------------
    def test_07_mqtt_broker_reachable(self):
        received = {}

        def on_message(client, userdata, msg):
            if msg.payload.decode() == "ping":
                received["ok"] = True
            client.disconnect()

        c = make_mqtt_client(f"test_health_{uuid.uuid4().hex[:6]}")
        if MQTT_USERNAME:
            c.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        if MQTT_USE_TLS:
            c.tls_set()
        c.on_message = on_message
        c.connect(MQTT_HOST, MQTT_PORT, 60)
        c.subscribe("test/health_check", qos=0)
        c.loop_start()
        time.sleep(0.3)

        import paho.mqtt.publish as pub
        kwargs = {
            "topic": "test/health_check",
            "payload": "ping",
            "hostname": MQTT_HOST,
            "port": MQTT_PORT,
        }
        if MQTT_USERNAME:
            kwargs["auth"] = {"username": MQTT_USERNAME, "password": MQTT_PASSWORD}
        if MQTT_USE_TLS:
            kwargs["tls"] = {}
        pub.single(**kwargs)

        deadline = time.time() + 3
        while time.time() < deadline and not received.get("ok"):
            time.sleep(0.1)
        c.loop_stop()

        assert received.get("ok"), "Did not receive MQTT test ping"
        print("\n✅  MQTT broker is reachable and pub/sub works")

    # -----------------------------------------------------------------------
    # Step 8: ESP32 sends sensor data via MQTT → mqtt_worker → DB
    # -----------------------------------------------------------------------
    def test_08_mqtt_sensor_data_flow(self):
        """
        Simulate ESP32 publishing sensor data.
        The mqtt_worker should consume it and write to DB.
        We verify by checking the sensor data API endpoint.
        """
        token = self.__class__.api_token
        topic = f"gh/{SERIAL}/sensors"
        payload = {
            "token": token,
            "temperature": 27.5,
            "humidity": 62.3,
            "soil_moisture": 45.0,
            "light_intensity": 850.0,
            "battery": 3.8,
        }

        ok = mqtt_publish(topic, payload)
        assert ok, "MQTT publish failed"

        # Wait for mqtt_worker to process and write to DB (up to 5s)
        time.sleep(3)

        # Check via API
        r = self.api.get(f"/api/v1/greenhouses/{self.__class__.gh_id}/sensors/")
        assert r.status_code == 200, f"Sensor data fetch failed: {r.text}"
        raw = r.json()
        # Handle both paginated ({results: [...]}) and plain list responses
        data = raw.get("results", raw) if isinstance(raw, dict) else raw
        assert isinstance(data, list) and len(data) > 0, \
            "No sensor data found in DB after MQTT publish"

        latest = data[0]  # ordered by -timestamp
        assert abs(latest["temperature"] - 27.5) < 0.1, f"Temp mismatch: {latest}"
        assert abs(latest["humidity"] - 62.3) < 0.1, f"Humidity mismatch: {latest}"
        assert abs(latest["soil_moisture"] - 45.0) < 0.1, f"Soil mismatch: {latest}"
        print(f"\n✅  Sensor data written to DB via MQTT: temp={latest['temperature']} hum={latest['humidity']}")

    # -----------------------------------------------------------------------
    # Step 8b: Latest sensor reading endpoint (survives backend sleep)
    # -----------------------------------------------------------------------
    def test_08b_latest_sensor_reading(self):
        """GET /sensors/latest/ returns denormalized last reading."""
        r = self.api.get(f"/api/v1/greenhouses/{self.__class__.gh_id}/sensors/latest/")
        assert r.status_code == 200, f"Latest sensor fetch failed: {r.text}"
        latest = r.json()
        assert abs(latest["temperature"] - 27.5) < 0.1, f"Latest temp mismatch: {latest}"
        assert abs(latest["humidity"] - 62.3) < 0.1, f"Latest hum mismatch: {latest}"
        assert "timestamp" in latest
        print(f"\n✅  Latest sensor reading available: temp={latest['temperature']} @ {latest['timestamp']}")

    # -----------------------------------------------------------------------
    # Step 9: MQTT state update from ESP32 → DeviceState in DB
    # -----------------------------------------------------------------------
    def test_09_mqtt_state_update(self):
        token = self.__class__.api_token
        topic = f"gh/{SERIAL}/state"
        payload = {
            "token": token,
            "fan": True,
            "water_pump": False,
            "light": True,
            "energy_state": "grid",
        }

        ok = mqtt_publish(topic, payload)
        assert ok, "MQTT state publish failed"
        time.sleep(2)

        r = self.api.get(f"/api/v1/greenhouses/{self.__class__.gh_id}/state/")
        assert r.status_code == 200, r.text
        state = r.json()
        assert state["fan"] is True, f"Expected fan=True: {state}"
        assert state["light"] is True, f"Expected light=True: {state}"
        assert state["energy_state"] == "grid", f"Expected grid: {state}"
        print(f"\n✅  Device state from MQTT verified in DB: fan={state['fan']} light={state['light']}")

    # -----------------------------------------------------------------------
    # Step 10: FE sends control command → server → MQTT cmd → ESP32
    # -----------------------------------------------------------------------
    def test_10_fe_control_command(self):
        """
        FE POSTs a control command.
        We also subscribe to the MQTT cmd topic to verify the message was published.
        """
        cmd_topic = f"gh/{SERIAL}/cmd"
        cmd_received = {}

        def on_cmd(client, userdata, msg):
            try:
                cmd_received["data"] = json.loads(msg.payload.decode())
            except Exception:
                pass
            client.disconnect()

        sub_client = make_mqtt_client(f"test_cmd_sub_{uuid.uuid4().hex[:6]}")
        if MQTT_USERNAME:
            sub_client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        if MQTT_USE_TLS:
            sub_client.tls_set()
        sub_client.on_message = on_cmd
        sub_client.connect(MQTT_HOST, MQTT_PORT, 60)
        sub_client.subscribe(cmd_topic, qos=1)
        sub_client.loop_start()
        time.sleep(0.3)  # ensure subscription is active before we send

        # FE sends control
        r = self.api.patch(f"/api/v1/greenhouses/{self.__class__.gh_id}/control/", json={
            "device": "fan",
            "action": "on",
        })
        assert r.status_code == 200, f"Control failed: {r.text}"
        resp = r.json()
        assert resp["mqtt_sent"] is True, "MQTT send reported False"
        assert resp["state"]["fan"] is True, "DB state not updated"

        # Wait for MQTT subscription to receive the cmd
        deadline = time.time() + 3
        while time.time() < deadline and not cmd_received.get("data"):
            time.sleep(0.1)
        sub_client.loop_stop()

        assert cmd_received.get("data"), "Did not receive control cmd on MQTT"
        cmd = cmd_received["data"]
        assert cmd["device"] == "fan", f"Device mismatch: {cmd}"
        assert cmd["action"] == "on", f"Action mismatch: {cmd}"
        print(f"\n✅  Control command verified: MQTT cmd received {cmd}")

    # -----------------------------------------------------------------------
    # Step 11: FE creates a time-based schedule → schedule saved + MQTT push
    # -----------------------------------------------------------------------
    def test_11_create_time_schedule(self):
        """FE creates a schedule; server saves it and pushes to ESP32 via MQTT."""
        sched_topic = f"gh/{SERIAL}/schedules"
        sched_received = {}

        def on_sched(client, userdata, msg):
            try:
                data = json.loads(msg.payload.decode())
                # Ignore stale retained empty list from device register
                if isinstance(data, list) and len(data) >= 1:
                    sched_received["data"] = data
                    client.disconnect()
            except Exception:
                pass

        sub = make_mqtt_client(f"test_sched_sub_{uuid.uuid4().hex[:6]}")
        if MQTT_USERNAME:
            sub.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        if MQTT_USE_TLS:
            sub.tls_set()
        sub.on_message = on_sched
        sub.connect(MQTT_HOST, MQTT_PORT, 60)
        sub.subscribe(sched_topic, qos=1)
        sub.loop_start()
        time.sleep(0.3)

        # FE creates a time-based schedule
        r = self.api.post(f"/api/v1/greenhouses/{self.__class__.gh_id}/schedules/", json={
            "device_type": "fan",
            "condition_type": "time",
            "time_of_day": "06:00",
            "action": "on",
        })
        assert r.status_code == 201, f"Schedule create failed: {r.text}"
        sched = r.json()
        assert sched["device_type"] == "fan"
        assert sched["time_of_day"] == "06:00:00"

        # Wait for MQTT schedule push
        deadline = time.time() + 5
        while time.time() < deadline and not sched_received.get("data"):
            time.sleep(0.1)
        sub.loop_stop()

        assert sched_received.get("data") is not None, \
            "Did not receive schedules on MQTT after schedule create"
        schedules = sched_received["data"]
        assert isinstance(schedules, list) and len(schedules) >= 1
        assert schedules[0]["time_of_day"] == "06:00", \
            f"Schedule time mismatch: {schedules[0]}"
        print(f"\n✅  Schedule created and pushed via MQTT: {schedules}")

    # -----------------------------------------------------------------------
    # Step 12: FE creates a sensor-based schedule
    # -----------------------------------------------------------------------
    def test_12_create_sensor_schedule(self):
        r = self.api.post(f"/api/v1/greenhouses/{self.__class__.gh_id}/schedules/", json={
            "device_type": "pump",
            "condition_type": "sensor",
            "sensor_name": "soil_moisture",
            "operator": "<",
            "threshold": 30.0,
            "action": "on",
        })
        assert r.status_code == 201, f"Sensor schedule create failed: {r.text}"
        data = r.json()
        assert data["condition_type"] == "sensor"
        assert data["sensor_name"] == "soil_moisture"
        assert data["operator"] == "<"
        assert data["threshold"] == 30.0
        print(f"\n✅  Sensor-based schedule created: pump on when soil_moisture < 30")

    # -----------------------------------------------------------------------
    # Step 13: Sensor-based schedule auto-fires via MQTT
    #          (soil_moisture < 30 → pump on)
    # -----------------------------------------------------------------------
    def test_13_sensor_schedule_auto_fires(self):
        """
        Send a sensor reading with soil_moisture=20 (< 30 threshold).
        Expect the mqtt_worker to fire a pump:on cmd automatically.
        """
        token = self.__class__.api_token
        cmd_topic = f"gh/{SERIAL}/cmd"
        cmd_received = {}

        def on_cmd(client, userdata, msg):
            try:
                d = json.loads(msg.payload.decode())
                if d.get("device") == "pump":
                    cmd_received["data"] = d
                    client.disconnect()
            except Exception:
                pass

        sub = make_mqtt_client(f"test_sensor_sched_{uuid.uuid4().hex[:6]}")
        if MQTT_USERNAME:
            sub.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        if MQTT_USE_TLS:
            sub.tls_set()
        sub.on_message = on_cmd
        sub.connect(MQTT_HOST, MQTT_PORT, 60)
        sub.subscribe(cmd_topic, qos=1)
        sub.loop_start()
        time.sleep(0.3)

        # ESP32 publishes soil_moisture=20 (below threshold of 30)
        ok = mqtt_publish(f"gh/{SERIAL}/sensors", {
            "token": token,
            "temperature": 26.0,
            "humidity": 55.0,
            "soil_moisture": 20.0,  # triggers pump on
        })
        assert ok, "MQTT publish failed"

        # Wait for auto-fire cmd from mqtt_worker
        deadline = time.time() + 6
        while time.time() < deadline and not cmd_received.get("data"):
            time.sleep(0.1)
        sub.loop_stop()

        assert cmd_received.get("data"), \
            "Sensor schedule did NOT auto-fire pump:on cmd (check mqtt_worker logs)"
        cmd = cmd_received["data"]
        assert cmd["device"] == "pump", f"Expected pump, got: {cmd}"
        assert cmd["action"] == "on", f"Expected on, got: {cmd}"
        print(f"\n✅  Sensor schedule auto-fired: {cmd} (soil_moisture=20 < threshold=30)")

    # -----------------------------------------------------------------------
    # Step 14: Reject invalid token from ESP32
    # -----------------------------------------------------------------------
    def test_14_invalid_token_rejected(self):
        """MQTT messages with wrong token should be ignored by mqtt_worker."""
        fake_topic = f"gh/{SERIAL}/sensors"
        ok = mqtt_publish(fake_topic, {
            "token": "invalid_token_abc123",
            "temperature": 99.9,
            "humidity": 99.9,
        })
        assert ok, "MQTT publish failed"
        time.sleep(2)

        # Check that no bogus 99.9 reading was stored
        r = self.api.get(f"/api/v1/greenhouses/{self.__class__.gh_id}/sensors/")
        raw = r.json()
        # Handle both paginated and plain list responses
        data = raw.get("results", raw) if isinstance(raw, dict) else raw
        temps = [d["temperature"] for d in data]
        assert 99.9 not in temps, \
            f"Invalid token message was NOT rejected! Bogus reading stored: {temps[:3]}"
        print("\n✅  Invalid token correctly rejected by mqtt_worker")

    # -----------------------------------------------------------------------
    # Step 15: Verify /auth/me/ returns current user
    # -----------------------------------------------------------------------
    def test_15_auth_me(self):
        r = self.api.get("/api/v1/auth/me/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["username"] == TEST_USER
        print(f"\n✅  /auth/me/ returns correct user: {data['username']}")

    # -----------------------------------------------------------------------
    # Step 16: List schedules
    # -----------------------------------------------------------------------
    def test_16_list_schedules(self):
        r = self.api.get(f"/api/v1/greenhouses/{self.__class__.gh_id}/schedules/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data) >= 2, f"Expected ≥2 schedules, got {len(data)}"
        print(f"\n✅  {len(data)} schedules listed correctly")

    # -----------------------------------------------------------------------
    # Step 16b: Schedule push is RETAINED on the broker (fire-once pattern).
    # A fresh subscriber that NEVER saw the publish should still receive the
    # schedule list immediately on subscribe — proving retain=True, so the
    # ESP gets it after a reboot/wake without the server re-publishing.
    # -----------------------------------------------------------------------
    def test_16b_schedule_push_is_retained(self):
        sched_topic = f"gh/{SERIAL}/schedules"
        received = {}

        def on_message(client, userdata, msg):
            try:
                data = json.loads(msg.payload.decode())
                if isinstance(data, list):
                    received["data"] = data
                    client.disconnect()
            except Exception:
                pass

        # Brand-new subscriber — no publish happens in this test.
        sub = make_mqtt_client(f"test_retain_{uuid.uuid4().hex[:6]}")
        if MQTT_USERNAME:
            sub.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        if MQTT_USE_TLS:
            sub.tls_set()
        sub.on_message = on_message
        sub.connect(MQTT_HOST, MQTT_PORT, 60)
        sub.subscribe(sched_topic, qos=1)
        sub.loop_start()

        deadline = time.time() + 4
        while time.time() < deadline and not received.get("data"):
            time.sleep(0.1)
        sub.loop_stop()

        assert received.get("data") is not None, \
            "Schedule is NOT retained — a new subscriber received nothing. " \
            "The ESP would not get schedules after a reboot/wake."
        assert isinstance(received["data"], list) and len(received["data"]) >= 2
        print(f"\n✅  Schedule push is retained on broker (fire-once works): "
              f"{len(received['data'])} rules delivered to a fresh subscriber")

    # -----------------------------------------------------------------------
    # Step 16c: ESP-style consumer stores pushed schedules to flash.
    # Mirrors what the ESP32/greenhouse_simulator does: receive the retain
    # push ONCE, persist it, and verify the stored copy matches what the
    # server has — proving schedules survive independently of the backend.
    # -----------------------------------------------------------------------
    def test_16c_esp_stores_schedule_to_flash(self, tmp_path):
        sched_topic = f"gh/{SERIAL}/schedules"
        flash_file = tmp_path / f"schedules_{SERIAL}.json"
        received = {}

        def on_message(client, userdata, msg):
            try:
                data = json.loads(msg.payload.decode())
                if isinstance(data, list):
                    received["data"] = data
                    # ESP writes the full list to flash on receipt.
                    flash_file.write_text(json.dumps(data))
                    client.disconnect()
            except Exception:
                pass

        sub = make_mqtt_client(f"test_flash_{uuid.uuid4().hex[:6]}")
        if MQTT_USERNAME:
            sub.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        if MQTT_USE_TLS:
            sub.tls_set()
        sub.on_message = on_message
        sub.connect(MQTT_HOST, MQTT_PORT, 60)
        sub.subscribe(sched_topic, qos=1)
        sub.loop_start()

        deadline = time.time() + 4
        while time.time() < deadline and not received.get("data"):
            time.sleep(0.1)
        sub.loop_stop()

        assert flash_file.exists(), "ESP never wrote schedules to flash"
        stored = json.loads(flash_file.read_text())
        assert isinstance(stored, list) and len(stored) >= 2, \
            f"Flash schedule list incomplete: {stored}"

        # The flash copy must match what the server reports via API.
        api_scheds = self.api.get(
            f"/api/v1/greenhouses/{self.__class__.gh_id}/schedules/"
        ).json()
        assert len(stored) == len(api_scheds), \
            "Flash schedule count drifts from server — schedules may not run after wake"
        print(f"\n✅  ESP stored {len(stored)} schedule(s) to flash (matches server)")

    # -----------------------------------------------------------------------
    # Step 16d: Latest reading endpoint returns staleness info and survives
    # even when the history scan returns nothing (simulating a backend that
    # just woke from Render spin-down with an empty/incomplete history scan).
    # -----------------------------------------------------------------------
    def test_16d_latest_reading_has_staleness(self):
        r = self.api.get(
            f"/api/v1/greenhouses/{self.__class__.gh_id}/sensors/latest/"
        )
        assert r.status_code == 200, f"Latest fetch failed: {r.text}"
        latest = r.json()

        # The new staleness fields drive the frontend "last seen" indicator.
        assert "age_seconds" in latest, "Missing age_seconds field"
        assert "is_stale" in latest, "Missing is_stale field"
        assert latest["age_seconds"] is not None, "age_seconds should not be null"
        assert isinstance(latest["is_stale"], bool), "is_stale must be boolean"
        # Fresh reading (created in step 8) should not be stale yet.
        assert latest["is_stale"] is False, \
            f"Reading from step 8 flagged stale (age={latest['age_seconds']}s)"
        print(f"\n✅  Latest reading has staleness: "
              f"age={latest['age_seconds']}s, is_stale={latest['is_stale']}")

    # -----------------------------------------------------------------------
    # Step 17: Soft-delete the greenhouse
    # -----------------------------------------------------------------------
    def test_17_delete_greenhouse(self):
        r = self.api.delete(f"/api/v1/greenhouses/{self.__class__.gh_id}/")
        assert r.status_code == 200, r.text
        assert r.json()["detail"] == "Greenhouse deleted."

        # Verify it no longer appears in list
        r2 = self.api.get("/api/v1/greenhouses/")
        ids = [g["id"] for g in r2.json()]
        assert self.__class__.gh_id not in ids, "Deleted GH still in list!"
        print(f"\n✅  Greenhouse soft-deleted and removed from list")


class TestRenderFallbackBehavior:
    """
    Focused tests for Render free-tier behavior.

    Run these directly when you want to validate the two parts of the design:
      1. schedules are retained so the ESP can persist them once
      2. latest sensor reads come from the denormalized snapshot endpoint
    """

    api = APIClient(BASE_URL)

    def test_01_latest_sensor_snapshot_endpoint(self):
        """
        GET /sensors/latest/ should return the last known reading directly.

        This is the fast path the frontend should use when the backend may
        have just woken up on Render free tier.
        """
        greenhouse_id = os.environ.get('TEST_GREENHOUSE_ID')
        if not greenhouse_id:
            pytest.skip('Set TEST_GREENHOUSE_ID to run this standalone.')

        r = self.api.get(f"/api/v1/greenhouses/{greenhouse_id}/sensors/latest/")
        assert r.status_code == 200, f"Latest sensor fetch failed: {r.text}"
        data = r.json()
        assert "temperature" in data
        assert "humidity" in data
        assert "age_seconds" in data
        assert "is_stale" in data
        assert isinstance(data["is_stale"], bool)

    def test_02_retained_schedule_payload_is_available_to_new_subscriber(self):
        """
        A fresh MQTT subscriber should receive the retained schedule payload.

        This proves the server is pushing schedules once with retain=True so
        the ESP32 can write them to flash and keep running locally.
        """
        greenhouse_serial = os.environ.get('TEST_GREENHOUSE_SERIAL')
        if not greenhouse_serial:
            pytest.skip('Set TEST_GREENHOUSE_SERIAL to run this standalone.')

        received = {}
        topic = f"gh/{greenhouse_serial}/schedules"

        def on_message(client, userdata, msg):
            try:
                payload = json.loads(msg.payload.decode())
                if isinstance(payload, list):
                    received["data"] = payload
                    client.disconnect()
            except Exception:
                pass

        sub = make_mqtt_client(f"render_retain_{uuid.uuid4().hex[:6]}")
        if MQTT_USERNAME:
            sub.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        if MQTT_USE_TLS:
            sub.tls_set()
        sub.on_message = on_message
        sub.connect(MQTT_HOST, MQTT_PORT, 60)
        sub.subscribe(topic, qos=1)
        sub.loop_start()

        deadline = time.time() + 4
        while time.time() < deadline and not received.get("data"):
            time.sleep(0.1)
        sub.loop_stop()

        assert received.get("data") is not None, \
            "Retained schedule payload was not delivered to a fresh subscriber"
        assert isinstance(received["data"], list)

# ===========================================================================
# Stand-alone tests (not part of the ordered flow)
# ===========================================================================

class TestAPIValidation:
    """Validate error handling and edge cases."""

    api = APIClient(BASE_URL)
    _setup_done = False

    def _ensure_logged_in(self):
        """Register & login a helper user if needed."""
        if not self.__class__._setup_done:
            uid = uuid.uuid4().hex[:6]
            r = requests.post(f"{BASE_URL}/api/v1/auth/register/", json={
                "username": f"val_{uid}",
                "email": f"val_{uid}@test.local",
                "password": "TestPass@123",
                "password2": "TestPass@123",
            })
            assert r.status_code == 201
            r2 = requests.post(f"{BASE_URL}/api/v1/auth/login/", json={
                "username": f"val_{uid}",
                "password": "TestPass@123",
            })
            assert r2.status_code == 200
            self.__class__.api.set_token(r2.json()["access"])
            self.__class__._setup_done = True

    def test_duplicate_serial_number(self):
        """Creating two greenhouses with the same serial should fail."""
        self._ensure_logged_in()
        serial = f"DUP-{uuid.uuid4().hex[:6]}"
        self.api.post("/api/v1/greenhouses/", json={"name": "GH A", "serial_number": serial})
        r2 = self.api.post("/api/v1/greenhouses/", json={"name": "GH B", "serial_number": serial})
        assert r2.status_code == 400, f"Expected 400 for duplicate serial, got {r2.status_code}"
        print("\n✅  Duplicate serial number correctly rejected")

    def test_device_register_unknown_serial(self):
        """ESP32 with unknown serial → 404."""
        r = requests.post(f"{BASE_URL}/api/v1/devices/register/", json={
            "serial_number": "UNKNOWN-XYZ-9999",
        })
        assert r.status_code == 404, f"Expected 404 for unknown serial, got {r.status_code}"
        print("\n✅  Unknown serial correctly returns 404")

    def test_control_command_invalid_device(self):
        """Control with unknown device name should return 400."""
        self._ensure_logged_in()
        # Create + activate a greenhouse first
        serial = f"CTRL-{uuid.uuid4().hex[:6]}"
        r = self.api.post("/api/v1/greenhouses/", json={
            "name": "Control Test GH",
            "serial_number": serial,
        })
        assert r.status_code == 201
        gh_id = r.json()["id"]

        # Activate via device register
        requests.post(f"{BASE_URL}/api/v1/devices/register/", json={"serial_number": serial})

        r2 = self.api.patch(f"/api/v1/greenhouses/{gh_id}/control/", json={
            "device": "unknown_device",
            "action": "on",
        })
        assert r2.status_code == 400, f"Expected 400 for invalid device, got {r2.status_code}"
        print("\n✅  Invalid control device correctly rejected (400)")

    def test_schedule_time_missing_time_of_day(self):
        """Time schedule without time_of_day should return 400."""
        self._ensure_logged_in()
        serial = f"SCHED-{uuid.uuid4().hex[:6]}"
        r = self.api.post("/api/v1/greenhouses/", json={
            "name": "Schedule Test GH",
            "serial_number": serial,
        })
        assert r.status_code == 201
        gh_id = r.json()["id"]

        r2 = self.api.post(f"/api/v1/greenhouses/{gh_id}/schedules/", json={
            "device_type": "fan",
            "condition_type": "time",
            # Missing time_of_day
            "action": "on",
        })
        assert r2.status_code == 400, f"Expected 400 for missing time_of_day, got {r2.status_code}"
        print("\n✅  Missing time_of_day correctly rejected (400)")
