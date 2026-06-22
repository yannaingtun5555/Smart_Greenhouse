#!/usr/bin/env python3
"""
Smart Greenhouse Simulator

Simulates an ESP32 greenhouse:
  1. Registers the greenhouse (or uses an existing API token)
  2. Connects to MQTT and subscribes to control/schedule/state topics
  3. Publishes sensor data every N seconds
  4. Responds to control commands and prints schedule updates
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import signal
import sys
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from getpass import getpass
from typing import Any, Dict

import paho.mqtt.client as mqtt
import requests

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("greenhouse_sim")


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

        self.client = mqtt.Client(client_id=f"gh-sim-{serial_number}")
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

        self.last_state = {
            "fan": False,
            "water_pump": False,
            "light": False,
            "energy_state": "battery",
        }

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

    def _on_connect(self, client, userdata, flags, rc):
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

    def _on_message(self, client, userdata, msg):
        payload = msg.payload.decode(errors="replace")
        logger.debug(f"MQTT {msg.topic} -> {payload}")

        if msg.topic.endswith("/cmd"):
            self._apply_control(payload)
        elif msg.topic.endswith("/schedules"):
            self._print_schedules(payload)
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
            self.last_state["fan"] = enabled
        elif device == "pump":
            self.last_state["water_pump"] = enabled
        elif device == "light":
            self.last_state["light"] = enabled
        else:
            logger.warning(f"Unknown device: {device}")
            return

        logger.info(f"Control: {device} -> {action}")
        self.publish_state()

    def _print_schedules(self, payload: str):
        try:
            schedules = json.loads(payload)
        except json.JSONDecodeError:
            logger.error("Invalid schedules payload (not JSON)")
            return

        if isinstance(schedules, list):
            count = len(schedules)
            logger.info(f"Received {count} schedule(s)")
            if not self.quiet:
                for idx, sched in enumerate(schedules, 1):
                    logger.info(f"  {idx}. {json.dumps(sched, indent=2)}")
        else:
            logger.warning("Schedules payload is not a list")

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
            logger.info("Greenhouse simulator started.")

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
        default="localhost",
        help="MQTT broker host",
    )
    parser.add_argument(
        "--mqtt-port",
        type=int,
        default=1883,
        help="MQTT broker port",
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

    # Get token (register if needed)
    if args.token:
        api_token = args.token
        logger.info(f"Using provided token for {serial}")
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