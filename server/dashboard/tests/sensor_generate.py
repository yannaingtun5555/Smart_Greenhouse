#!/usr/bin/env python3
"""
Greenhouse simulator that sends incremental sensor data and reacts to MQTT commands.

Usage:
  python greenhouse_controlled_simulator.py --serial GH-001

Prompts for:
  - Initial values and step sizes (can be negative) for all sensors.
  - Then publishes sensor data every 10s and listens for control/schedule messages.
  - Press Ctrl+C to stop.
"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import requests


def register_greenhouse(base_url: str, serial_number: str) -> str:
    url = f"{base_url.rstrip('/')}/api/v1/devices/register/"
    resp = requests.post(url, json={"serial_number": serial_number}, timeout=15)
    resp.raise_for_status()
    token = resp.json().get("api_token")
    if not token:
        raise RuntimeError("Registration succeeded but no api_token returned.")
    return token


def prompt_float(prompt: str, default: float = None) -> float:
    while True:
        val = input(prompt)
        if not val and default is not None:
            return default
        try:
            return float(val)
        except ValueError:
            print("Please enter a valid number.")


class ControlledGreenhouseSimulator:
    def __init__(
        self,
        serial: str,
        api_token: str,
        mqtt_host: str,
        mqtt_port: int,
        base_url: str,
        sensor_config: dict,
    ):
        self.serial = serial
        self.api_token = api_token
        self.mqtt_host = mqtt_host
        self.mqtt_port = mqtt_port
        self.base_url = base_url
        self.sensor_config = sensor_config  # holds current values and steps

        self.running = threading.Event()
        self.running.set()

        # Device state (initial all off)
        self.device_state = {
            "fan": False,
            "water_pump": False,
            "light": False,
            "energy_state": "battery",
        }

        # MQTT client
        self.client = mqtt.Client(client_id=f"gh-ctrl-{serial}")
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            print("[MQTT] Connected.")
            # Subscribe to command and schedule topics
            client.subscribe(f"gh/{self.serial}/cmd", qos=1)
            client.subscribe(f"gh/{self.serial}/schedules", qos=1)
            print(f"[MQTT] Subscribed to gh/{self.serial}/cmd")
            print(f"[MQTT] Subscribed to gh/{self.serial}/schedules")
            # Publish initial device state
            self.publish_state()
        else:
            print(f"[MQTT] Connection failed with code {rc}")

    def _on_message(self, client, userdata, msg):
        payload = msg.payload.decode(errors="replace")
        print(f"[MQTT] {msg.topic} -> {payload}")

        if msg.topic.endswith("/cmd"):
            self._apply_command(payload)
        elif msg.topic.endswith("/schedules"):
            self._print_schedules(payload)

    def _apply_command(self, payload: str):
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            print("[ERROR] Invalid command payload (not JSON)")
            return

        device = data.get("device")
        action = data.get("action")
        if not device or action not in ("on", "off"):
            print("[WARN] Command missing 'device' or 'action'")
            return

        enabled = (action == "on")
        if device == "fan":
            self.device_state["fan"] = enabled
        elif device == "pump":
            self.device_state["water_pump"] = enabled
        elif device == "light":
            self.device_state["light"] = enabled
        else:
            print(f"[WARN] Unknown device: {device}")
            return

        print(f"[ACTION] {device} -> {action}")
        self.publish_state()

    def _print_schedules(self, payload: str):
        try:
            schedules = json.loads(payload)
        except json.JSONDecodeError:
            print("[ERROR] Invalid schedules payload")
            return
        if isinstance(schedules, list):
            print(f"[SCHEDULES] Received {len(schedules)} schedule(s)")
            for idx, sched in enumerate(schedules, 1):
                print(f"  {idx}. {json.dumps(sched)}")
        else:
            print(f"[SCHEDULES] Received: {payload}")

    def publish_state(self):
        """Publish the current device state to the state topic."""
        payload = {
            "token": self.api_token,
            **self.device_state,
        }
        topic = f"gh/{self.serial}/state"
        self.client.publish(topic, json.dumps(payload), qos=1, retain=False)
        print(f"[STATE] Published: {json.dumps(payload)}")

    def publish_sensor_data(self):
        """Build and publish a sensor reading using current values, then apply steps."""
        # Current values
        temp = self.sensor_config["temperature"]["value"]
        hum = self.sensor_config["humidity"]["value"]
        soil = self.sensor_config["soil_moisture"]["value"]
        light = self.sensor_config["light_intensity"]["value"]
        batt = self.sensor_config["battery"]["value"]

        payload = {
            "token": self.api_token,
            "temperature": round(temp, 1),
            "humidity": round(hum, 1),
            "soil_moisture": round(soil, 1),
            "light_intensity": round(light, 1),
            "battery": round(batt, 2),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        topic = f"gh/{self.serial}/sensors"
        self.client.publish(topic, json.dumps(payload), qos=1, retain=False)
        print(f"[SENSORS] Published: {json.dumps(payload, indent=2)}")

        # Apply increments for next cycle
        self.sensor_config["temperature"]["value"] += self.sensor_config["temperature"]["step"]
        self.sensor_config["humidity"]["value"] += self.sensor_config["humidity"]["step"]
        self.sensor_config["soil_moisture"]["value"] += self.sensor_config["soil_moisture"]["step"]
        self.sensor_config["light_intensity"]["value"] += self.sensor_config["light_intensity"]["step"]
        self.sensor_config["battery"]["value"] += self.sensor_config["battery"]["step"]

    def run(self):
        self.client.connect(self.mqtt_host, self.mqtt_port, 60)
        self.client.loop_start()

        print(f"\n[START] Simulator for {self.serial} running. Press Ctrl+C to stop.\n")
        try:
            while self.running.is_set():
                self.publish_sensor_data()
                time.sleep(10)
        except KeyboardInterrupt:
            pass
        finally:
            self.running.clear()
            self.client.loop_stop()
            self.client.disconnect()
            print("[STOP] Simulator terminated.")


def prompt_config():
    """Prompt user for initial values and steps for each sensor."""
    print("\nEnter starting values and increments per 10s (negative allowed).")
    config = {}
    for name, default_val, default_step in [
        ("temperature", 25.0, 0.0),
        ("humidity", 60.0, 0.0),
        ("soil_moisture", 50.0, 0.0),
        ("light_intensity", 800.0, 0.0),
        ("battery", 3.8, 0.0),
    ]:
        print(f"\n--- {name} ---")
        val = prompt_float(f"Initial {name} [{default_val}]: ", default=default_val)
        step = prompt_float(f"Increment per 10s [{default_step}]: ", default=default_step)
        config[name] = {"value": val, "step": step}
    return config


def main():
    parser = argparse.ArgumentParser(description="Controlled greenhouse simulator with increments")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--mqtt-host", default="localhost")
    parser.add_argument("--mqtt-port", type=int, default=1883)
    parser.add_argument("--serial", required=True, help="Greenhouse serial number")
    parser.add_argument("--token", help="Existing API token (if not provided, will register)")
    args = parser.parse_args()

    # Get token
    if args.token:
        api_token = args.token
        print(f"Using provided token for {args.serial}")
    else:
        print(f"Registering greenhouse {args.serial}...")
        api_token = register_greenhouse(args.base_url, args.serial)
        print(f"Registered. Token: {api_token}")

    # Get sensor configuration (interactive)
    sensor_config = prompt_config()

    # Create simulator
    sim = ControlledGreenhouseSimulator(
        serial=args.serial,
        api_token=api_token,
        mqtt_host=args.mqtt_host,
        mqtt_port=args.mqtt_port,
        base_url=args.base_url,
        sensor_config=sensor_config,
    )

    # Handle Ctrl+C gracefully
    def shutdown(*_):
        sim.running.clear()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    sim.run()


if __name__ == "__main__":
    main()