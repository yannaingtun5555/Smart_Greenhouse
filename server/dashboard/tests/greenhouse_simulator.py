#!/usr/bin/env python3
"""
Smart Greenhouse Simulator

Simulates an ESP32 greenhouse:
  1. Registers the greenhouse (or uses an existing API token)
  2. Connects to MQTT and subscribes to control/schedule/state topics
  3. Persists schedules to a local flash file and runs them locally
  4. Publishes sensor data every N seconds
  5. Responds to control commands
"""

from __future__ import annotations

import argparse
import json
import logging
import operator as op
import random
import signal
import sys
import threading
import time
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import paho.mqtt.client as mqtt
import requests


def _load_env_file() -> None:
    """
    Load server/.env into os.environ so the simulator talks to the same broker
    as the Docker stack (django + mqtt_worker) without manual `export`s.

    Looks for .env in <repo>/server/ (parent of this dashboard dir). Existing
    environment variables always win (os.environ.setdefault) so explicit
    exports / CI config are never overridden.
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

MQTT_USERNAME = os.environ.get("MQTT_USERNAME")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD")
MQTT_USE_TLS = os.environ.get("MQTT_USE_TLS", "false").lower() in {"1", "true", "yes", "on"}
MQTT_HOST_ENV = os.environ.get("MQTT_BROKER", "localhost")
MQTT_PORT_ENV = int(os.environ.get("MQTT_PORT", "1883"))

# ---------------------------------------------------------------------------
# paho-mqtt v2 compatibility: try CallbackAPIVersion.VERSION2, fall back to v1
# ---------------------------------------------------------------------------
try:
    from paho.mqtt.enums import CallbackAPIVersion
    _CALLBACK_API_VERSION = CallbackAPIVersion.VERSION2
except ImportError:
    _CALLBACK_API_VERSION = None  # paho-mqtt v1

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("greenhouse_sim")

OPERATOR_MAP = {
    '>': op.gt,
    '<': op.lt,
    '>=': op.ge,
    '<=': op.le,
    '==': op.eq,
}

SENSOR_FIELD_MAP = {
    'temperature': 'temperature',
    'humidity': 'humidity',
    'soil_moisture': 'soil_moisture',
    'light_intensity': 'light_intensity',
}


@dataclass
class SensorSnapshot:
    temperature: float
    humidity: float
    soil_moisture: float
    light_intensity: float
    battery: float


class GreenhouseSimulator:
    def __init__(
        self,
        base_url: str,
        mqtt_host: str,
        mqtt_port: int,
        serial_number: str,
        api_token: str,
        publish_interval: float = 5.0,
        quiet: bool = False,
        flash_dir: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.mqtt_host = mqtt_host
        self.mqtt_port = mqtt_port
        self.serial_number = serial_number
        self.api_token = api_token
        self.publish_interval = publish_interval
        self.quiet = quiet
        self.running = threading.Event()
        self.running.set()

        # ── Flash storage ───────────────────────────────────────────────
        # Mirrors how a real ESP32 persists data across reboots:
        #   • token_<serial>.json      → API token (so the ESP doesn't
        #                                re-register on every boot)
        #   • schedules_<serial>.json  → full schedule list pushed by server
        flash_root = Path(flash_dir or os.environ.get('GH_FLASH_DIR', '/tmp/greenhouse_flash'))
        flash_root.mkdir(parents=True, exist_ok=True)
        self.flash_dir = flash_root
        self.token_path = flash_root / f'token_{serial_number}.json'
        self.flash_path = flash_root / f'schedules_{serial_number}.json'

        # Persist the token so a reboot skips re-registration (like the ESP).
        self._save_flash_token(api_token)

        self.schedules: List[dict] = self._load_flash_schedules()
        self._schedules_lock = threading.Lock()
        self._fired_time_minute: set = set()
        self._last_minute_checked = -1
        self._last_sensor_snapshot: Optional[SensorSnapshot] = None

        client_kwargs = {
            "client_id": f"gh-sim-{serial_number}",
            "protocol": mqtt.MQTTv311,
        }
        if _CALLBACK_API_VERSION is not None:
            client_kwargs["callback_api_version"] = _CALLBACK_API_VERSION
        self.client = mqtt.Client(**client_kwargs)
        if MQTT_USERNAME:
            self.client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        if MQTT_USE_TLS:
            self.client.tls_set()
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

        self.last_state = {
            "fan_set1": False,
            "fan_set2": False,
            "water_pump": False,
            "light": False,
            "energy_state": "battery",
        }

    def _save_flash_token(self, token: str):
        """Persist the API token to flash (ESP32 stores it in NVS)."""
        try:
            self.token_path.write_text(json.dumps({"token": token, "serial": self.serial_number}))
            logger.info('Saved API token to flash: %s', self.token_path)
        except OSError as exc:
            logger.warning('Could not save token to flash: %s', exc)

    @classmethod
    def load_flash_token(cls, serial_number: str, flash_dir: Optional[str] = None) -> Optional[str]:
        """Load a previously stored token from flash (returns None if missing)."""
        root = Path(flash_dir or os.environ.get('GH_FLASH_DIR', '/tmp/greenhouse_flash'))
        token_path = root / f'token_{serial_number}.json'
        if token_path.exists():
            try:
                data = json.loads(token_path.read_text())
                token = data.get('token')
                if token:
                    logger.info('Recovered API token from flash: %s', token_path)
                    return token
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning('Could not read token from flash: %s', exc)
        return None

    def _load_flash_schedules(self) -> List[dict]:
        if self.flash_path.exists():
            try:
                data = json.loads(self.flash_path.read_text())
                if isinstance(data, list):
                    logger.info('Loaded %d schedule(s) from flash: %s', len(data), self.flash_path)
                    return data
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning('Could not read flash schedules: %s', exc)
        return []

    def _save_flash_schedules(self, schedules: List[dict]):
        self.flash_path.write_text(json.dumps(schedules, indent=2))
        logger.info('Saved %d schedule(s) to flash: %s', len(schedules), self.flash_path)

    def _apply_local_control(self, device: str, action: str, reason: str = 'control', fan_target=None):
        enabled = action == 'on'
        if device == 'fan':
            # Fan schedule fired: fan_target selects all / set1 / set2
            if fan_target == 'set1':
                self.last_state['fan_set1'] = enabled
            elif fan_target == 'set2':
                self.last_state['fan_set2'] = enabled
            else:  # 'all' or unspecified
                self.last_state['fan_set1'] = enabled
                self.last_state['fan_set2'] = enabled
        elif device == 'fan_set1':
            self.last_state['fan_set1'] = enabled
        elif device == 'fan_set2':
            self.last_state['fan_set2'] = enabled
        elif device == 'pump':
            self.last_state['water_pump'] = enabled
        elif device == 'light':
            self.last_state['light'] = enabled
        else:
            logger.warning('Unknown device: %s', device)
            return
        logger.info('[%s] %s -> %s (fan_target=%s)', reason, device, action, fan_target)
        self.publish_state()

    def _evaluate_sensor_schedules(self, snapshot: SensorSnapshot):
        readings = asdict(snapshot)
        with self._schedules_lock:
            rules = [s for s in self.schedules if s.get('condition_type') == 'sensor']

        for rule in rules:
            key = SENSOR_FIELD_MAP.get(rule.get('sensor_name', ''))
            reading = readings.get(key) if key else None
            if reading is None:
                continue
            compare = OPERATOR_MAP.get(rule.get('operator'))
            if compare is None:
                continue
            try:
                if compare(float(reading), float(rule['threshold'])):
                    self._apply_local_control(
                        rule['device_type'], rule['action'],
                        reason='sensor-schedule',
                        fan_target=rule.get('fan_target'),
                    )
            except (TypeError, ValueError):
                continue

    def _time_schedule_loop(self):
        while self.running.is_set():
            time.sleep(15)
            now = datetime.now(timezone.utc)
            current_minute = now.hour * 60 + now.minute
            if current_minute != self._last_minute_checked:
                self._fired_time_minute = set()
                self._last_minute_checked = current_minute

            with self._schedules_lock:
                rules = [s for s in self.schedules if s.get('condition_type') == 'time']

            for rule in rules:
                rule_id = rule.get('id')
                if rule_id in self._fired_time_minute:
                    continue
                tod = rule.get('time_of_day', '')
                if not tod:
                    continue
                parts = tod.split(':')
                if len(parts) < 2:
                    continue
                hour, minute = int(parts[0]), int(parts[1])
                if hour == now.hour and minute == now.minute:
                    self._apply_local_control(
                        rule['device_type'], rule['action'],
                        reason='time-schedule',
                        fan_target=rule.get('fan_target'),
                    )
                    if rule_id is not None:
                        self._fired_time_minute.add(rule_id)

    @property
    def cmd_topic(self) -> str:
        return f"gh/{self.serial_number}/cmd"

    @property
    def schedules_topic(self) -> str:
        return f"gh/{self.serial_number}/schedules"

    @property
    def sensors_topic(self) -> str:
        return f"gh/{self.serial_number}/sensors"

    @property
    def state_topic(self) -> str:
        return f"gh/{self.serial_number}/state"

    def _on_connect(self, client, userdata, flags, rc, *args):
        # paho-mqtt v2 passes an extra 'properties' arg; *args absorbs it
        if rc == 0:
            logger.info("MQTT connected")
            client.subscribe(self.cmd_topic, qos=1)
            client.subscribe(self.schedules_topic, qos=1)
            client.subscribe(self.state_topic, qos=1)
            logger.info(f"Subscribed to {self.cmd_topic}")
            logger.info(f"Subscribed to {self.schedules_topic}")
            logger.info(f"Subscribed to {self.state_topic}")
            # Publish initial state
            self.publish_state()
        else:
            logger.error(f"MQTT connection failed with code {rc}")

    def _on_message(self, client, userdata, msg):  # v1/v2 compatible (same signature)
        payload = msg.payload.decode(errors="replace")
        logger.debug(f"MQTT {msg.topic} -> {payload}")

        if msg.topic.endswith("/cmd"):
            self._apply_control(payload)
        elif msg.topic.endswith("/schedules"):
            self._store_schedules(payload)
        elif msg.topic.endswith("/state"):
            self._print_state(payload)
        else:
            logger.warning(f"Received message on unknown topic: {msg.topic}")

    def _apply_control(self, payload: str):
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            logger.error("Invalid control payload (not JSON)")
            return

        device = data.get("device")
        action = data.get("action")
        if not device or action not in ("on", "off"):
            logger.warning("Control payload missing 'device' or 'action'")
            return

        enabled = action == "on"
        if device == "fan":
            # Fan schedule command with fan_target
            fan_target = data.get("fan_target", "all")
            if fan_target == "set1":
                self.last_state["fan_set1"] = enabled
            elif fan_target == "set2":
                self.last_state["fan_set2"] = enabled
            else:  # "all"
                self.last_state["fan_set1"] = enabled
                self.last_state["fan_set2"] = enabled
        elif device == "fan_set1":
            self.last_state["fan_set1"] = enabled
        elif device == "fan_set2":
            self.last_state["fan_set2"] = enabled
        elif device == "pump":
            self.last_state["water_pump"] = enabled
        elif device == "light":
            self.last_state["light"] = enabled
        else:
            logger.warning(f"Unknown device: {device}")
            return

        logger.info(f"Control: {device} -> {action}")
        self.publish_state()

    def _store_schedules(self, payload: str):
        try:
            schedules = json.loads(payload)
        except json.JSONDecodeError:
            logger.error("Invalid schedules payload (not JSON)")
            return

        if not isinstance(schedules, list):
            logger.warning("Schedules payload is not a list")
            return

        with self._schedules_lock:
            self.schedules = schedules
            self._save_flash_schedules(schedules)

        # NOTE: This message arrives ONCE per schedule change (server pushes the
        # full list with retain=True). The ESP/sim stores it to flash and runs
        # the schedules locally forever — even while the backend sleeps.
        logger.info(f"Received {len(schedules)} schedule(s) – stored to flash (run locally)")
        if not self.quiet:
            for idx, sched in enumerate(schedules, 1):
                logger.info(f"  {idx}. {json.dumps(sched, indent=2)}")

    def _print_state(self, payload: str):
        logger.info(f"State update: {payload}")

    def publish_state(self):
        payload = {
            "token": self.api_token,
            **self.last_state,
        }
        self.client.publish(
            self.state_topic, json.dumps(payload), qos=1, retain=False
        )
        if not self.quiet:
            logger.info(f"Published state")

    def _generate_sensor_snapshot(self) -> SensorSnapshot:
        """Generate realistic random sensor readings."""
        return SensorSnapshot(
            temperature=round(random.uniform(24.0, 36.0), 1),
            humidity=round(random.uniform(45.0, 82.0), 1),
            soil_moisture=round(random.uniform(18.0, 72.0), 1),
            light_intensity=round(random.uniform(300.0, 1200.0), 1),
            battery=round(random.uniform(3.55, 4.15), 2),
        )

    def publish_sensor_data(self):
        snapshot = self._generate_sensor_snapshot()
        self._last_sensor_snapshot = snapshot
        self._evaluate_sensor_schedules(snapshot)
        payload = {
            "token": self.api_token,
            **asdict(snapshot),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self.client.publish(
            self.sensors_topic, json.dumps(payload), qos=1, retain=False
        )
        if not self.quiet:
            logger.info(f"Sensors: {json.dumps(payload, indent=2)}")

    def run(self):
        try:
            logger.info("Connecting to MQTT broker...")
            self.client.connect(self.mqtt_host, self.mqtt_port, 60)
            self.client.loop_start()
            threading.Thread(target=self._time_schedule_loop, daemon=True).start()
            logger.info("Greenhouse simulator started (local schedule execution enabled).")

            while self.running.is_set():
                self.publish_sensor_data()
                time.sleep(self.publish_interval)

        except KeyboardInterrupt:
            pass
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
        finally:
            self.running.clear()
            self.client.loop_stop()
            self.client.disconnect()
            logger.info("Simulator stopped.")


def register_greenhouse(base_url: str, serial_number: str) -> str:
    """
    Register the greenhouse with the Django backend.
    Returns the API token.
    """
    url = f"{base_url.rstrip('/')}/api/v1/devices/register/"
    logger.info(f"Registering greenhouse with serial: {serial_number}")

    try:
        resp = requests.post(
            url,
            json={"serial_number": serial_number},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        token = data.get("api_token")
        if not token:
            raise RuntimeError("Registration succeeded but no api_token returned.")
        return token
    except requests.exceptions.RequestException as e:
        logger.error(f"Registration failed: {e}")
        if hasattr(e, "response") and e.response:
            logger.error(f"Response: {e.response.text}")
        raise SystemExit(1)


def prompt_serial() -> str:
    serial = input("Serial number: ").strip()
    if not serial:
        logger.error("Serial number is required.")
        sys.exit(1)
    return serial


def main():
    parser = argparse.ArgumentParser(
        description="Smart Greenhouse MQTT Simulator",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Django API base URL (without trailing slash)",
    )
    parser.add_argument(
        "--mqtt-host",
        default=MQTT_HOST_ENV,
        help="MQTT broker host (default: $MQTT_BROKER)",
    )
    parser.add_argument(
        "--mqtt-port",
        type=int,
        default=MQTT_PORT_ENV,
        help="MQTT broker port (default: $MQTT_PORT)",
    )
    parser.add_argument(
        "--serial",
        help="Greenhouse serial number (will prompt if not provided)",
    )
    parser.add_argument(
        "--token",
        help="Existing greenhouse API token (skips registration)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=5.0,
        help="Sensor publish interval in seconds",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress verbose sensor and state publication logs",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging (MQTT and all messages)",
    )
    args = parser.parse_args()

    # Set log level
    if args.debug:
        logger.setLevel(logging.DEBUG)
    elif args.quiet:
        logger.setLevel(logging.INFO)  # still show important messages

    # Get serial
    serial = args.serial or prompt_serial()

    # Get token — try flash first (like an ESP32 reboot), then flags, then register.
    flash_token = GreenhouseSimulator.load_flash_token(serial)
    if args.token:
        api_token = args.token
        logger.info(f"Using provided token for {serial}")
    elif flash_token:
        api_token = flash_token
        logger.info(f"Reused token from flash for {serial} (no re-registration needed)")
    else:
        logger.info(f"Registering greenhouse {serial}...")
        api_token = register_greenhouse(args.base_url, serial)
        logger.info(f"Registration successful. Token: {api_token}")

    # Create simulator
    sim = GreenhouseSimulator(
        base_url=args.base_url,
        mqtt_host=args.mqtt_host,
        mqtt_port=args.mqtt_port,
        serial_number=serial,
        api_token=api_token,
        publish_interval=args.interval,
        quiet=args.quiet,
    )

    # Handle shutdown signals
    def shutdown(*_):
        sim.running.clear()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    sim.run()


if __name__ == "__main__":
    main()
